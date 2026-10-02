/**
 * Estratégia "rótulos verticais": blocos com várias linhas por cliente,
 * rótulos na coluna A ("ATRASADOS:", "CLIENTE:", "CONTRATUAIS (25%):"),
 * valores na coluna B e informações adicionais em colunas laterais.
 *
 * Abas: PREVISÃO EXECUÇÃO, CUMP RPV-PRECATORIO, PRECATÓRIO 2024.
 *
 * Os blocos são delimitados pela COMBINAÇÃO de rótulos, nomes, tribunais,
 * seções e contexto — não apenas por linhas vazias. Um bloco pode começar
 * por "ATRASADOS" antes de o cliente ser identificado.
 */

import { interpretarTextoLivre, lancamento, parcelamentosDoBloco } from "./comum";
import { Contexto, k } from "./contexto";
import { aplicarTextoRequisicao, montarCobranca, sinaisRequisicao } from "./detectores";
import { letraColuna, linhasDaAba, type Aba, type Celula } from "./planilha";
import {
  CATEGORIAS_HONORARIOS,
  ROTULO_CATEGORIA,
  type Bloco,
  type CategoriaFinanceira,
  type LancamentoRascunho,
  type NaturezaLancamento,
  type PerfilAba,
} from "./modelo";
import { ABRE_BLOCO, ORDEM_ROTULO, lerRotuloFinanceiro, type RotuloFinanceiro } from "./rotulos";
import {
  arred,
  ausenciaDeclarada,
  chaveTexto,
  compactar,
  ehSomenteTribunal,
  extrairNome,
  lerCelulaMonetaria,
  primeiraData,
  tribunaisNoTexto,
  valoresMonetariosNoTexto,
  type NomeExtraido,
} from "./texto";

type TipoLinha =
  | { tipo: "vazia" }
  | { tipo: "secao"; texto: string }
  | {
      tipo: "rotulo";
      rotulo: RotuloFinanceiro;
      nome: NomeExtraido | null;
      valor: ReturnType<typeof lerCelulaMonetaria>;
    }
  | { tipo: "nome"; nome: NomeExtraido; valorAoLado: number | null }
  | { tipo: "tribunal"; texto: string }
  | { tipo: "nota" };

const COL_PRINCIPAL = 1;
const COL_VALOR = 2;

function naturezaPara(
  perfil: PerfilAba,
  categoria: CategoriaFinanceira,
  principal: boolean,
): NaturezaLancamento {
  if (!principal) return "informativo";
  if (categoria === "ajuste" || categoria === "calculo_inss") return "informativo";
  if (perfil === "previsao_execucao") return "previsto";
  if (["atrasados", "valor_total", "valor_cliente", "repasse_cliente"].includes(categoria))
    return "previsto";
  return "devido";
}

function servicoPara(perfil: PerfilAba): string {
  if (perfil === "previsao_execucao") return "Previsão de execução (RPV/precatório)";
  if (perfil === "precatorio") return "Precatório";
  return "Cumprimento de sentença / execução";
}

function ehAno(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 2000 && v <= 2100;
}

function ehMarcadorAtualizacao(texto: string): boolean {
  const t = chaveTexto(texto);
  return (
    /^(VALOR(ES)? )?ATUALIZAD\w*\b/.test(t) ||
    /^ATUALIZADP$/.test(t) ||
    /^\d{1,2}\/\d{4}\s*-\s*INSS$/.test(t)
  );
}

export function analisarRotulosVerticais(aba: Aba, perfil: PerfilAba, ctx: Contexto): void {
  const linhas = linhasDaAba(aba);
  const celulaEm = (linha: number, coluna: number): Celula | undefined => {
    const c = aba.porRef.get(`${letraColuna(coluna)}${linha}`);
    return c && !ctx.reservadas.has(k(c)) ? c : undefined;
  };

  // ---- 1. Classificação de cada linha pela coluna principal -------------
  const tipos = new Map<number, TipoLinha>();
  for (let r = 1; r <= aba.maxLinha; r++) {
    const a = celulaEm(r, COL_PRINCIPAL);
    if (!a) {
      tipos.set(r, { tipo: "vazia" });
      continue;
    }
    if (ehAno(a.bruto) || (typeof a.bruto === "string" && /^\s*20\d{2}\s*$/.test(a.bruto))) {
      tipos.set(r, { tipo: "secao", texto: a.texto.trim() });
      continue;
    }
    if (typeof a.bruto !== "string") {
      tipos.set(r, { tipo: "nota" });
      continue;
    }
    const b = celulaEm(r, COL_VALOR);
    const valorB = lerCelulaMonetaria(b?.tipo === "d" ? null : b?.bruto);
    const rot = lerRotuloFinanceiro(a.texto, valorB.tipo === "valor");
    if (rot) {
      let nome: NomeExtraido | null = null;
      if (["atrasados", "valor_total", "valor_cliente"].includes(rot.categoria) && rot.resto) {
        nome = extrairNome(rot.resto);
      }
      // "CLIENTE: NOME" sem valor ao lado funciona como cabeçalho do bloco.
      if (
        rot.categoria === "valor_cliente" &&
        nome &&
        valorB.tipo !== "valor" &&
        !/\d/.test(rot.resto)
      ) {
        tipos.set(r, { tipo: "nome", nome, valorAoLado: null });
        continue;
      }
      tipos.set(r, { tipo: "rotulo", rotulo: rot, nome, valor: valorB });
      continue;
    }
    if (ehSomenteTribunal(a.texto)) {
      tipos.set(r, { tipo: "tribunal", texto: a.texto });
      continue;
    }
    const nome = extrairNome(a.texto);
    if (nome && a.texto.length <= 120 && (!nome.complemento || nome.complemento.length <= 60)) {
      tipos.set(r, {
        tipo: "nome",
        nome,
        valorAoLado: valorB.tipo === "valor" ? valorB.valor : null,
      });
      continue;
    }
    tipos.set(r, { tipo: "nota" });
  }

  // ---- 2. Segmentação em blocos -----------------------------------------
  const blocoDaLinha = new Map<number, Bloco>();
  const rotulosVistos = new WeakMap<Bloco, Set<string>>();
  let atual: Bloco | null = null;
  let secao: string | null = null;
  let ultimaLinhaConteudo = 0;
  const notasIncertas: { r: number; a: Celula; anterior: Bloco }[] = [];

  const abrir = (r: number): Bloco => {
    const b = ctx.novoBloco({
      aba,
      perfil,
      tipo: "cliente",
      linhaInicio: r,
      colunaBase: COL_PRINCIPAL,
    });
    b.dados.secao = secao;
    b.dados.natureza = "judicial";
    b.dados.servico = servicoPara(perfil);
    rotulosVistos.set(b, new Set());
    return b;
  };
  const vistos = (b: Bloco) => rotulosVistos.get(b)!;
  const temFinanceiro = (b: Bloco) =>
    [...vistos(b)].some((x) => x !== "_nome" && x !== "_tribunal");
  const proximaNaoVazia = (r: number): number | null => {
    for (let i = r + 1; i <= aba.maxLinha; i++) if (tipos.get(i)!.tipo !== "vazia") return i;
    return null;
  };
  const iniciaBloco = (r: number | null): boolean => {
    if (r === null) return false;
    const t = tipos.get(r)!;
    return (
      t.tipo === "nome" ||
      t.tipo === "tribunal" ||
      (t.tipo === "rotulo" && ABRE_BLOCO.includes(t.rotulo.categoria))
    );
  };

  for (let r = 1; r <= aba.maxLinha; r++) {
    const t = tipos.get(r)!;
    if (t.tipo === "vazia") {
      if (atual) blocoDaLinha.set(r, atual);
      continue;
    }
    const a = celulaEm(r, COL_PRINCIPAL)!;

    if (t.tipo === "secao") {
      secao = t.texto;
      ctx.destinar(a, "resumo_arquivo", "secao", "elemento_arquivo", { secao });
      atual = null;
      continue;
    }

    if (t.tipo === "tribunal") {
      atual = abrir(r);
      vistos(atual).add("_tribunal");
      atual.dados.tribunais.push(compactar(t.texto));
      ctx.incluir(atual, a);
      ctx.destinar(
        a,
        "campo",
        "atendimento.tribunal",
        "interpretado",
        { tribunal: t.texto },
        atual.ref,
      );
    } else if (t.tipo === "nome") {
      const podeAproveitar =
        atual &&
        !atual.nome &&
        (!temFinanceiro(atual) || (vistos(atual).size === 1 && vistos(atual).has("atrasados")));
      if (!podeAproveitar) atual = abrir(r);
      const b = atual!;
      b.nome = t.nome;
      b.celulaNome = k(a);
      vistos(b).add("_nome");
      ctx.incluir(b, a);
      for (const tr of t.nome.tribunais)
        if (!b.dados.tribunais.includes(tr)) b.dados.tribunais.push(tr);
      ctx.destinar(
        a,
        "campo",
        "cliente.nome",
        "interpretado",
        { nome: t.nome.nome, complemento: t.nome.complemento },
        b.ref,
      );
      if (t.nome.complemento && sinaisRequisicao(t.nome.complemento)) {
        b.dados.requisicoes[0] = aplicarTextoRequisicao(
          b.dados.requisicoes[0] ?? null,
          t.nome.complemento,
          k(a),
          null,
        )!;
      }
      // Nome com valor ao lado e sem rótulo "CLIENTE:" (ex.: após "ATRASADOS").
      if (t.valorAoLado !== null && podeAproveitar) {
        const vcel = celulaEm(r, COL_VALOR)!;
        ctx.incluir(b, vcel);
        b.dados.lancamentos.push(
          lancamento({
            categoria: "valor_cliente",
            natureza: naturezaPara(perfil, "valor_cliente", true),
            valor: t.valorAoLado,
            rotuloOriginal: `${t.nome.nome} (sem rótulo)`,
            celulas: [k(a), k(vcel)],
          }),
        );
        vistos(b).add("valor_cliente");
        ctx.destinar(
          vcel,
          "campo",
          "lancamento:valor_cliente",
          "incerto",
          { valor: t.valorAoLado },
          b.ref,
        );
        ctx.pendencia(b, {
          tipo: "associacao_conteudo",
          bloqueante: false,
          descricao: `O valor ${t.valorAoLado.toFixed(2)} está ao lado do nome, sem rótulo. Foi interpretado como "valor destinado ao cliente" pela posição no bloco — confirme.`,
          celulas: [k(a), k(vcel)],
        });
      }
    } else if (t.tipo === "rotulo") {
      const cat = t.rotulo.categoria;
      const ordem = ORDEM_ROTULO[cat];
      let novo = !atual;
      if (atual) {
        const v = vistos(atual);
        if (ABRE_BLOCO.includes(cat) && (temFinanceiro(atual) || v.has("valor_cliente")))
          novo = true;
        if (cat === "valor_cliente") {
          const depois = [...v].some((x) => (ORDEM_ROTULO[x as CategoriaFinanceira] ?? 0) > 2);
          if (v.has("valor_cliente") || depois) novo = true;
        }
        if (!ABRE_BLOCO.includes(cat) && cat !== "valor_cliente" && ordem && v.has(cat))
          novo = true;
      }
      if (novo) atual = abrir(r);
      const b = atual!;
      vistos(b).add(cat);
      processarRotulo(ctx, aba, perfil, b, r, a, celulaEm(r, COL_VALOR), t.rotulo, t.nome, t.valor);
    } else {
      // Nota na coluna principal.
      const proxima = proximaNaoVazia(r);
      const separada = ultimaLinhaConteudo > 0 && r - ultimaLinhaConteudo > 1;
      if (atual && separada && proxima === r + 1 && iniciaBloco(proxima)) {
        // Nota "solta" entre blocos, colada no próximo: associação incerta.
        notasIncertas.push({ r, a, anterior: atual });
        ultimaLinhaConteudo = r;
        continue;
      }
      if (!atual) {
        atual = abrir(r);
        atual.tipo = "sem_identificacao";
      }
      interpretarTextoLivre(ctx, atual, a, { categoriaHistorico: "observacao" });
    }
    blocoDaLinha.set(r, atual!);
    ultimaLinhaConteudo = r;

    // Notas entre blocos: associadas ao bloco que começa logo abaixo, com revisão.
    if (notasIncertas.length && atual) {
      for (const n of notasIncertas.splice(0)) {
        interpretarTextoLivre(ctx, atual, n.a, { categoriaHistorico: "observacao" });
        blocoDaLinha.set(n.r, atual);
        ctx.pendencia(atual, {
          tipo: "associacao_conteudo",
          bloqueante: false,
          descricao: `A anotação da célula ${n.a.ref} está entre dois blocos. Foi associada ao bloco seguinte${
            atual.nome ? ` (${atual.nome.nome})` : ""
          }; ela também pode pertencer ao bloco anterior${n.anterior.nome ? ` (${n.anterior.nome.nome})` : ""}.`,
          celulas: [k(n.a)],
          dados: { alternativaBloco: n.anterior.ref },
        });
      }
    }
  }

  // ---- 3. Colunas laterais e valores fora do rótulo -------------------
  const contextoColuna = new Map<
    string,
    { data: string | null; marcador: string | null; linha: number }
  >();
  for (let r = 1; r <= aba.maxLinha; r++) {
    const cels = (linhas.get(r) ?? []).filter(
      (c) => !ctx.reservadas.has(k(c)) && !ctx.temDestino(c),
    );
    if (!cels.length) continue;
    let bloco = blocoDaLinha.get(r) ?? null;
    const tipo = tipos.get(r)!;
    // Cabeçalho lateral na linha anterior ao início de um bloco pertence ao bloco seguinte.
    const seguinte = blocoDaLinha.get(r + 1);
    if (seguinte && seguinte !== bloco && seguinte.linhaInicio === r + 1) {
      const todosCabecalho = cels.every(
        (c) => c.tipo === "d" || (typeof c.bruto === "string" && ehMarcadorAtualizacao(c.texto)),
      );
      if (todosCabecalho) bloco = seguinte;
    }
    if (!bloco) {
      // Anterior mais próximo
      for (let i = r - 1; i >= 1 && !bloco; i--) bloco = blocoDaLinha.get(i) ?? null;
    }
    if (!bloco) {
      bloco = ctx.novoBloco({
        aba,
        perfil,
        tipo: "sem_identificacao",
        linhaInicio: r,
        colunaBase: 2,
      });
    }
    const rotuloLinha = tipo.tipo === "rotulo" ? tipo.rotulo : null;
    const lancPrincipal = rotuloLinha
      ? bloco.dados.lancamentos.find(
          (l) => l.principal && l.celulas.some((c) => c.endsWith(`!A${r}`)),
        )
      : undefined;

    for (const c of cels.sort((x, y) => x.coluna - y.coluna)) {
      if (ctx.temDestino(c)) continue;
      const chave = ctx.incluir(bloco, c);
      const col = letraColuna(c.coluna);
      const ctxCol = contextoColuna.get(`${bloco.ref}:${col}`);

      if (c.formula) {
        ctx.destinar(
          c,
          "informacao_adicional",
          "formula_bloco",
          "interpretado",
          { formula: c.formula, armazenado: c.bruto },
          bloco.ref,
        );
        continue;
      }
      if (c.tipo === "d") {
        contextoColuna.set(`${bloco.ref}:${col}`, {
          data: c.data?.texto ?? null,
          marcador: null,
          linha: r,
        });
        ctx.destinar(
          c,
          "informacao_adicional",
          "data_lateral",
          "interpretado",
          { data: c.data },
          bloco.ref,
        );
        continue;
      }
      if (ehAno(c.bruto)) {
        const req = bloco.dados.requisicoes[0];
        if (perfil === "precatorio" || req) {
          bloco.dados.requisicoes[0] = aplicarTextoRequisicao(
            req ?? null,
            `PRECATÓRIO ${c.bruto}`,
            chave,
            null,
          )!;
          bloco.dados.requisicoes[0].anoPrevisto = c.bruto;
          ctx.destinar(
            c,
            "campo",
            "requisicao.ano_previsto",
            "incerto",
            { ano: c.bruto },
            bloco.ref,
          );
        } else {
          ctx.destinar(
            c,
            "informacao_adicional",
            "ano",
            "interpretado",
            { ano: c.bruto },
            bloco.ref,
          );
        }
        continue;
      }
      const valor = lerCelulaMonetaria(c.bruto);
      if (valor.tipo === "valor") {
        // Rótulo textual imediatamente à esquerda ("CÁLCULO INSS:", "TUTELA:")
        const esquerda = aba.porRef.get(`${letraColuna(c.coluna - 1)}${r}`);
        const rotuloEsq =
          c.coluna - 1 > COL_VALOR &&
          esquerda &&
          typeof esquerda.bruto === "string" &&
          /:\s*$/.test(esquerda.texto)
            ? esquerda
            : null;
        if (rotuloEsq) {
          const kr = chaveTexto(rotuloEsq.texto);
          if (/CALCULO INSS/.test(kr)) {
            bloco.dados.lancamentos.push(
              lancamento({
                categoria: "calculo_inss",
                natureza: "informativo",
                valor: valor.valor,
                rotuloOriginal: rotuloEsq.texto.trim(),
                coluna: col,
                versao: 1,
                principal: false,
                observacao: rotuloLinha
                  ? `linha de ${ROTULO_CATEGORIA[rotuloLinha.categoria as CategoriaFinanceira] ?? rotuloLinha.rotulo}`
                  : null,
                celulas: [k(rotuloEsq), chave],
              }),
            );
            ctx.destinar(
              rotuloEsq,
              "campo",
              "lancamento:calculo_inss:rotulo",
              "interpretado",
              undefined,
              bloco.ref,
            );
            ctx.destinar(
              c,
              "campo",
              "lancamento:calculo_inss",
              "interpretado",
              { valor: valor.valor },
              bloco.ref,
            );
          } else {
            ctx.destinar(
              rotuloEsq,
              "informacao_adicional",
              "rotulo_lateral",
              "interpretado",
              undefined,
              bloco.ref,
            );
            ctx.destinar(
              c,
              "informacao_adicional",
              "valor_rotulado",
              "interpretado",
              { rotulo: rotuloEsq.texto.trim(), valor: valor.valor },
              bloco.ref,
            );
          }
          continue;
        }
        if (rotuloLinha && rotuloLinha.categoria !== "total_bloco") {
          const cat = rotuloLinha.categoria as CategoriaFinanceira;
          const versao =
            bloco.dados.lancamentos.filter(
              (l) => l.categoria === cat && l.celulas.some((x) => new RegExp(`!\\D+${r}$`).test(x)),
            ).length + 1;
          const marcador = ctxCol?.marcador ?? null;
          bloco.dados.lancamentos.push(
            lancamento({
              categoria: cat,
              natureza: "informativo",
              valor: valor.valor,
              rotuloOriginal: rotuloLinha.rotulo,
              percentual: rotuloLinha.percentual,
              versao: Math.max(versao, 2),
              coluna: col,
              dataReferencia: ctxCol?.data ?? null,
              principal: false,
              observacao:
                (marcador ? `Coluna marcada como "${marcador}"` : "Valor em coluna lateral") +
                (ctxCol?.data ? ` (data ${ctxCol.data})` : "") +
                " — significado não confirmado; não somado aos totais.",
              celulas: [chave],
            }),
          );
          ctx.destinar(
            c,
            "campo",
            `lancamento:${cat}:lateral:${col}`,
            "interpretado",
            { valor: valor.valor, coluna: col },
            bloco.ref,
          );
          continue;
        }
        ctx.destinar(
          c,
          "informacao_adicional",
          "valor_lateral_sem_rotulo",
          "interpretado",
          { valor: valor.valor, linha: rotuloLinha?.rotulo ?? null },
          bloco.ref,
        );
        continue;
      }
      if (valor.tipo === "malformado") {
        ctx.destinar(
          c,
          "pendencia_revisao",
          "valor_malformado",
          "pendente",
          { original: c.texto },
          bloco.ref,
        );
        ctx.pendencia(bloco, {
          tipo: "valor_malformado",
          bloqueante: false,
          descricao: `Valor com formato inválido na célula ${c.ref}: "${c.texto}". O conteúdo original foi preservado.`,
          celulas: [chave],
        });
        continue;
      }
      // Texto lateral
      const texto = c.texto;
      if (rotuloLinha && ausenciaDeclarada(texto)) {
        const cat = rotuloLinha.categoria as CategoriaFinanceira;
        if (rotuloLinha.categoria !== "total_bloco") {
          bloco.dados.lancamentos.push(
            lancamento({
              categoria: cat,
              natureza: "informativo",
              ausenciaDeclarada: ausenciaDeclarada(texto),
              rotuloOriginal: rotuloLinha.rotulo,
              versao: 2,
              coluna: col,
              principal: false,
              observacao: "Ausência declarada em coluna lateral",
              celulas: [chave],
            }),
          );
          ctx.destinar(
            c,
            "campo",
            `lancamento:${cat}:ausencia`,
            "interpretado",
            { ausencia: texto.trim() },
            bloco.ref,
          );
          continue;
        }
      }
      if (ehMarcadorAtualizacao(texto)) {
        contextoColuna.set(`${bloco.ref}:${col}`, {
          data: primeiraData(texto)?.texto ?? null,
          marcador: texto.trim(),
          linha: r,
        });
        ctx.destinar(
          c,
          "informacao_adicional",
          "marcador_atualizacao",
          "interpretado",
          { marcador: texto.trim() },
          bloco.ref,
        );
        continue;
      }
      if (ehSomenteTribunal(texto)) {
        for (const tr of tribunaisNoTexto(texto))
          if (!bloco.dados.tribunais.includes(tr)) bloco.dados.tribunais.push(tr);
        ctx.destinar(
          c,
          "campo",
          "atendimento.tribunal",
          "interpretado",
          { tribunal: texto.trim() },
          bloco.ref,
        );
        continue;
      }
      if (/^\s*dados banc[aá]rios\s*:?\s*$/i.test(texto)) {
        // "Dados bancários:" com os dados nas células vizinhas.
        const partes = [texto];
        const usadas: Celula[] = [c];
        for (let rr = r; rr <= r + 2; rr++) {
          for (const v of linhas.get(rr) ?? []) {
            if (v === c || v.coluna <= c.coluna - 0 || ctx.temDestino(v)) continue;
            if (
              /\d/.test(v.texto) &&
              /ag|c\/?c|conta|ita|banc|caixa|santander|bradesco|op\b/i.test(v.texto)
            ) {
              partes.push(v.texto);
              usadas.push(v);
            }
          }
        }
        const juntos = partes.join(" ");
        interpretarTextoLivre(ctx, bloco, { ...c, texto: juntos } as Celula, {
          lateral: true,
          categoriaHistorico: "dados_bancarios",
        });
        for (const u of usadas) {
          ctx.incluir(bloco, u);
          ctx.destinar(u, "campo", "dados_bancarios", "interpretado", undefined, bloco.ref, true);
        }
        continue;
      }
      if (
        rotuloLinha &&
        /^\s*(ok|pago|pagos|recebidos)\s*!*\s*$/i.test(texto) === false &&
        /^[A-Za-zÀ-ú .]{0,25}:\s*$/.test(texto)
      ) {
        // Rótulo lateral sem valor à direita (ex.: "CÁLCULO INSS:" vazio)
        ctx.destinar(
          c,
          "informacao_adicional",
          "rotulo_lateral",
          "interpretado",
          undefined,
          bloco.ref,
        );
        continue;
      }
      const catLinha =
        rotuloLinha && rotuloLinha.categoria !== "total_bloco"
          ? (rotuloLinha.categoria as CategoriaFinanceira)
          : null;
      if (lancPrincipal && catLinha && !sinaisRequisicao(texto)) {
        lancPrincipal.situacaoTexto = lancPrincipal.situacaoTexto
          ? `${lancPrincipal.situacaoTexto} | ${texto.trim()}`
          : texto.trim();
      }
      interpretarTextoLivre(ctx, bloco, c, {
        lateral: true,
        campoLinha: rotuloLinha ? rotuloLinha.rotulo : null,
        categoriaLinha: catLinha,
        valorLinha: lancPrincipal?.valor ?? null,
      });
    }
  }

  // ---- 4. Fechamento de cada bloco ------------------------------------
  for (const bloco of ctx.blocos.filter((b) => b.aba === aba.nome)) {
    finalizarBloco(ctx, bloco);
  }
}

function processarRotulo(
  ctx: Contexto,
  aba: Aba,
  perfil: PerfilAba,
  b: Bloco,
  r: number,
  a: Celula,
  vcel: Celula | undefined,
  rot: RotuloFinanceiro,
  nome: NomeExtraido | null,
  valor: ReturnType<typeof lerCelulaMonetaria>,
): void {
  const chaveA = ctx.incluir(b, a);
  if (nome && !b.nome) {
    b.nome = nome;
    b.celulaNome = chaveA;
    for (const tr of nome.tribunais)
      if (!b.dados.tribunais.includes(tr)) b.dados.tribunais.push(tr);
  } else if (nome && b.nome && chaveTexto(nome.nome) !== chaveTexto(b.nome.nome)) {
    ctx.pendencia(b, {
      tipo: "associacao_conteudo",
      bloqueante: true,
      descricao: `O bloco tem dois nomes: "${b.nome.nome}" e "${nome.nome}" (${a.ref}). Separe ou escolha o correto.`,
      celulas: [b.celulaNome ?? chaveA, chaveA],
    });
  }

  if (rot.categoria === "total_bloco") {
    ctx.destinar(a, "informacao_adicional", "total_bloco:rotulo", "interpretado", undefined, b.ref);
    if (vcel) {
      ctx.incluir(b, vcel);
      ctx.destinar(
        vcel,
        "informacao_adicional",
        "total_bloco",
        "interpretado",
        { valor: valor.tipo === "valor" ? valor.valor : vcel.texto },
        b.ref,
      );
    }
    return;
  }
  const categoria = rot.categoria as CategoriaFinanceira;
  const celulas = [chaveA];
  let principal: LancamentoRascunho | null = null;

  // Resto do rótulo: nome, valor em texto, ausência, requisição, observação
  const resto = nome ? (nome.complemento ?? "") : rot.resto;
  const valoresTexto = resto ? valoresMonetariosNoTexto(resto) : [];
  const ausenciaResto = resto ? ausenciaDeclarada(resto) : null;

  if (valor.tipo === "valor" && vcel) {
    celulas.push(ctx.incluir(b, vcel));
    principal = lancamento({
      categoria,
      natureza: naturezaPara(perfil, categoria, true),
      valor: valor.valor,
      percentual: rot.percentual,
      baseCalculo: rot.baseCalculo,
      quantidadeBeneficios: rot.quantidadeBeneficios,
      rotuloOriginal: rot.rotulo,
      coluna: "B",
      celulas,
    });
    ctx.destinar(
      vcel,
      "campo",
      `lancamento:${categoria}`,
      "interpretado",
      { valor: valor.valor },
      b.ref,
    );
  } else if (valor.tipo === "ausencia" && vcel) {
    celulas.push(ctx.incluir(b, vcel));
    principal = lancamento({
      categoria,
      natureza: naturezaPara(perfil, categoria, true),
      ausenciaDeclarada: ausenciaDeclarada(valor.texto),
      percentual: rot.percentual,
      rotuloOriginal: rot.rotulo,
      celulas,
    });
    ctx.destinar(
      vcel,
      "campo",
      `lancamento:${categoria}:ausencia`,
      "interpretado",
      { ausencia: valor.texto },
      b.ref,
    );
  } else if (valor.tipo === "malformado" && vcel) {
    celulas.push(ctx.incluir(b, vcel));
    ctx.destinar(
      vcel,
      "pendencia_revisao",
      "valor_malformado",
      "pendente",
      { original: vcel.texto },
      b.ref,
    );
    ctx.pendencia(b, {
      tipo: "valor_malformado",
      bloqueante: false,
      descricao: `${rot.rotulo}: valor com formato inválido "${vcel.texto}" (${vcel.ref}). O original foi preservado; informe o valor correto.`,
      celulas: [k(vcel)],
      dados: { categoria },
    });
  } else if (valor.tipo === "texto" && vcel) {
    // Texto na coluna de valores (ex.: "PRECATÓRIO 2027") — tratado como anotação da linha.
    interpretarTextoLivre(ctx, b, vcel, {
      lateral: true,
      campoLinha: rot.rotulo,
      categoriaLinha: categoria,
    });
  }

  // Valor escrito no próprio rótulo ("VALOR TOTAL: R$ 91.622,27")
  if (valoresTexto.length) {
    const v = valoresTexto[0]!;
    if (v.malformado) {
      ctx.pendencia(b, {
        tipo: "valor_malformado",
        bloqueante: false,
        descricao: `${rot.rotulo}: "${v.original}" na célula ${a.ref} não é um valor válido. O original foi preservado.`,
        celulas: [chaveA],
        dados: { categoria },
      });
      ctx.destinar(
        a,
        "pendencia_revisao",
        "valor_malformado",
        "pendente",
        { original: a.texto },
        b.ref,
      );
    } else if (!principal) {
      principal = lancamento({
        categoria,
        natureza: naturezaPara(perfil, categoria, true),
        valor: v.valor,
        valorTexto: v.original,
        percentual: rot.percentual,
        baseCalculo: rot.baseCalculo,
        quantidadeBeneficios: rot.quantidadeBeneficios,
        rotuloOriginal: rot.rotulo,
        coluna: "A",
        celulas,
      });
    } else {
      const data = primeiraData(resto);
      b.dados.lancamentos.push(
        lancamento({
          categoria,
          natureza: "informativo",
          valor: v.valor,
          valorTexto: v.original,
          rotuloOriginal: rot.rotulo,
          versao: 2,
          coluna: "A",
          dataReferencia: data?.texto ?? null,
          principal: false,
          observacao: `Valor informado no texto do rótulo${data ? ` (referência ${data.texto})` : ""}`,
          celulas: [chaveA],
        }),
      );
    }
  }
  if (!principal && ausenciaResto) {
    principal = lancamento({
      categoria,
      natureza: naturezaPara(perfil, categoria, true),
      ausenciaDeclarada: ausenciaResto,
      percentual: rot.percentual,
      rotuloOriginal: rot.rotulo,
      celulas,
    });
  }
  if (principal) {
    if (
      resto &&
      !nome &&
      !valoresTexto.length &&
      !ausenciaResto &&
      !sinaisRequisicao(resto) &&
      !ehSomenteTribunal(resto)
    ) {
      principal.observacao = compactar(resto);
    }
    if (principal.valor === null && valor.tipo === "valor" && ausenciaResto)
      principal.ausenciaDeclarada = ausenciaResto;
    if (ausenciaResto && principal.valor !== null) {
      principal.observacao = `${principal.observacao ? principal.observacao + "; " : ""}rótulo indica "${ausenciaResto}"`;
    }
    b.dados.lancamentos.push(principal);
  }

  // Tribunal / requisição no resto do rótulo
  if (resto) {
    for (const tr of tribunaisNoTexto(resto))
      if (!b.dados.tribunais.includes(tr)) b.dados.tribunais.push(tr);
    if (sinaisRequisicao(resto)) {
      b.dados.requisicoes[0] = aplicarTextoRequisicao(
        b.dados.requisicoes[0] ?? null,
        resto,
        chaveA,
        categoria,
      )!;
    }
  }
  const sit = ctx.destinos.get(chaveA)?.destino === "pendencia_revisao";
  if (!sit) {
    ctx.destinar(
      a,
      "campo",
      nome ? `cliente.nome+lancamento:${categoria}` : `lancamento:${categoria}:rotulo`,
      "interpretado",
      {
        rotulo: rot.rotulo,
        percentual: rot.percentual,
        base: rot.baseCalculo,
        nome: nome?.nome ?? null,
        resto: rot.resto || null,
        valor: principal?.valor ?? null,
      },
      b.ref,
    );
  }
}

/** Requisição, coerência percentual × valor, cobranças e tipo do bloco. */
export function finalizarBloco(ctx: Contexto, bloco: Bloco): void {
  const lanc = bloco.dados.lancamentos;
  const temValor = lanc.some((l) => l.valor !== null) || bloco.dados.historico.length > 0;
  if (!bloco.nome) {
    if (!temValor && !bloco.dados.requisicoes.length && !bloco.dados.historico.length) {
      bloco.tipo = "modelo_vazio";
      for (const c of bloco.celulas) {
        const d = ctx.destinos.get(c);
        if (d) {
          d.destino = "resumo_arquivo";
          d.ref = "bloco_modelo_vazio";
          d.situacao = "elemento_arquivo";
        }
      }
    } else if (bloco.tipo === "cliente") {
      bloco.tipo = "sem_identificacao";
    }
  }

  // Coerência percentual × valor (contratuais sobre atrasados/valor total)
  const base =
    lanc.find((l) => l.principal && l.categoria === "atrasados" && l.valor !== null) ??
    lanc.find((l) => l.principal && l.categoria === "valor_total" && l.valor !== null);
  const contr = lanc.find(
    (l) =>
      l.principal &&
      l.categoria === "honorarios_contratuais" &&
      l.valor !== null &&
      l.percentual !== null,
  );
  const clienteSemBase = !base
    ? lanc.find((l) => l.principal && l.categoria === "valor_cliente" && l.valor !== null)
    : undefined;
  if (!base && contr && clienteSemBase) {
    const total = clienteSemBase.valor! + contr.valor!;
    const esperado = arred((contr.percentual! / 100) * total);
    if (Math.abs(esperado - contr.valor!) > Math.max(1, contr.valor! * 0.005)) {
      ctx.pendencia(bloco, {
        tipo: "divergencia_percentual",
        bloqueante: false,
        descricao: `${contr.rotuloOriginal}: ${contr.percentual}% não confere com os valores do bloco (cliente ${clienteSemBase.valor!.toFixed(2)} + honorários ${contr.valor!.toFixed(2)}). Verifique se os valores estão alinhados aos rótulos corretos. Nenhum valor foi alterado.`,
        celulas: [...contr.celulas, ...clienteSemBase.celulas],
      });
    }
  }
  if (base && contr && base.valor! > 0) {
    const esperado = arred((contr.percentual! / 100) * base.valor!);
    const tolerancia = Math.max(1, contr.valor! * 0.005);
    if (Math.abs(esperado - contr.valor!) > tolerancia) {
      const cliente = lanc.find(
        (l) => l.principal && l.categoria === "valor_cliente" && l.valor !== null,
      );
      let hipotese = "";
      if (
        cliente &&
        Math.abs(cliente.valor! * (contr.percentual! / 100) - (base.valor! - cliente.valor!)) < 1
      ) {
        hipotese =
          " Os valores parecem deslocados uma linha (o valor ao lado de CLIENTE corresponderia aos ATRASADOS).";
      }
      ctx.pendencia(bloco, {
        tipo: "divergencia_percentual",
        bloqueante: false,
        descricao: `${contr.rotuloOriginal}: ${contr.percentual}% de ${base.valor!.toFixed(2)} seria ${esperado.toFixed(2)}, mas a planilha informa ${contr.valor!.toFixed(2)}.${hipotese} Nenhum valor foi alterado.`,
        celulas: [...contr.celulas, ...base.celulas],
        dados: { esperado, informado: contr.valor, percentual: contr.percentual, base: base.valor },
      });
    }
  }

  // Cobranças a partir de parcelamentos
  for (const p of parcelamentosDoBloco(bloco)) {
    const ja = bloco.dados.cobrancas.some(
      (c) =>
        c.historico.includes(p.parcelamento.texto) ||
        (c.quantidadeParcelas !== null &&
          c.quantidadeParcelas === p.parcelamento.quantidade &&
          c.valorParcela === p.parcelamento.valorParcela),
    );
    if (ja) continue;
    const honor = lanc.filter(
      (l) => l.principal && l.valor !== null && CATEGORIAS_HONORARIOS.includes(l.categoria),
    );
    const q = p.parcelamento;
    const alvoExato =
      q.quantidade && q.valorParcela
        ? honor.find(
            (l) =>
              Math.round(l.valor! * 100) ===
              Math.round(q.quantidade! * q.valorParcela! * 100 + (q.entrada ?? 0) * 100),
          )
        : undefined;
    const naLinha =
      p.valorLinha !== null && p.categoria && CATEGORIAS_HONORARIOS.includes(p.categoria)
        ? p.valorLinha
        : null;
    const implantacao = honor.filter((l) => l.categoria === "honorarios_implantacao");
    const contratado =
      naLinha ??
      alvoExato?.valor ??
      (implantacao.length === 1
        ? implantacao[0]!.valor
        : honor.length === 1
          ? honor[0]!.valor
          : null);
    const cob = montarCobranca({
      descricao: `Parcelamento — ${p.categoria ? ROTULO_CATEGORIA[p.categoria] : "honorários"}`,
      parcelamento: q,
      valorContratado: contratado,
      textos: [q.texto],
      celulas: [p.celula],
    });
    bloco.dados.cobrancas.push(cob);
    if (cob.divergencia) {
      ctx.pendencia(bloco, {
        tipo: "parcelamento_divergente",
        bloqueante: false,
        descricao: `Parcelamento não confere: ${cob.divergencia} As parcelas não foram criadas; o acordo foi preservado.`,
        celulas: [p.celula],
      });
    } else if (cob.completar) {
      ctx.pendencia(bloco, {
        tipo: "parcelamento_incompleto",
        bloqueante: false,
        descricao: `Parcelamento registrado; falta completar: ${cob.completar}.`,
        celulas: [p.celula],
      });
    }
  }

  // Dados bancários inconsistentes
  for (const banc of bloco.dados.bancarios) {
    if (!banc.consistente) {
      ctx.pendencia(bloco, {
        tipo: "conta_inconsistente",
        bloqueante: false,
        descricao: `Dados bancários incompletos ou com formato incomum (${banc.observacao}): "${banc.textoOriginal}".`,
        celulas: banc.celulas,
      });
    }
  }

  // Intervalo
  const linhasB = bloco.celulas.map((c) => Number(c.match(/(\d+)$/)?.[1] ?? 0)).filter(Boolean);
  if (linhasB.length) {
    bloco.linhaInicio = Math.min(...linhasB);
    bloco.linhaFim = Math.max(...linhasB);
  }
  const colunas = bloco.celulas.map((c) => c.split("!")[1]!.replace(/\d+$/, ""));
  const ordenadas = [...new Set(colunas)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  bloco.intervalo = `${ordenadas[0] ?? "A"}${bloco.linhaInicio}:${ordenadas[ordenadas.length - 1] ?? "A"}${bloco.linhaFim}`;
}
