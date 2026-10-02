/**
 * Estratégia "campos em célula": cada linha traz "RÓTULO: valor" dentro da
 * própria célula ("DIB: 10/03/2022", "HONORÁRIOS: 30%"), com anotações em
 * colunas laterais e, às vezes, um segundo bloco em outra coluna (ex.: a
 * coluna F da aba IMPLANTAÇÃO).
 *
 * Abas: IMPLANTAÇÃO, Implantação Administrativa.
 */

import { interpretarTextoLivre, lancamento, registrarIdentificadores } from "./comum";
import { Contexto, k } from "./contexto";
import { finalizarBloco } from "./estrategiaVertical";
import { letraColuna, linhasDaAba, type Aba, type Celula } from "./planilha";
import {
  beneficioVazio,
  type BeneficioRascunho,
  type Bloco,
  type CategoriaFinanceira,
  type PerfilAba,
} from "./modelo";
import { lerRotuloFinanceiro } from "./rotulos";
import {
  arred,
  ausenciaDeclarada,
  chaveTexto,
  compactar,
  cpfsNoTexto,
  datasNoTexto,
  extrairNome,
  lerCelulaMonetaria,
  lerDadosBancarios,
  lerNumeroBR,
  nbsNoTexto,
  percentualNoTexto,
  primeiraData,
  processosNoTexto,
  quantidadeBeneficiosNoTexto,
  valoresMonetariosNoTexto,
  type DataLida,
} from "./texto";

type Campo =
  | "beneficio"
  | "nb"
  | "dib"
  | "dib_judicial"
  | "dib_origem"
  | "dip"
  | "dip_hist"
  | "dcb"
  | "rmi"
  | "rma"
  | "previsao"
  | "transito"
  | "atrasados"
  | "honorarios"
  | "honorarios_valor"
  | "comunicacao"
  | "solicitar_dados"
  | "cobrar"
  | "prorrogacao"
  | "banco"
  | "obs"
  | "cpf"
  | "requerimento"
  | "concessao"
  | "a_receber"
  | "recebidos_cliente"
  | "processo"
  | "implantacao";

const CAMPOS: [RegExp, Campo][] = [
  [/^BENEFICIO\b/, "beneficio"],
  [/^NB\b/, "nb"],
  [/^DIB (JUDI|JUDICIAL)\b/, "dib_judicial"],
  [/^DIB ORIGEM\b/, "dib_origem"],
  [/^DIB\b/, "dib"],
  [/^DIP (REVISAO|REATIVACAO)\b/, "dip_hist"],
  [/^DIP\b/, "dip"],
  [/^DCB\b/, "dcb"],
  [/^RMI\b/, "rmi"],
  [/^RMA\b/, "rma"],
  [/^PREVISAO DE PAGAMENTO\b/, "previsao"],
  [/^TRANSITO EM JULGADO\b/, "transito"],
  [/^(ATRASADOS|ATRASDOS)\b/, "atrasados"],
  [
    /^(VALOR HONORARIOS|VALOR IMPLANTACAO|HONORARIOS (DA )?IMPLANTACAO|VALOR HONORARIOS DA IMPLANTACAO)/,
    "honorarios_valor",
  ],
  [/^(HONORARIOS|TOTAL DOS HONORARIOS)\b/, "honorarios"],
  [/^(O?MUNICAR CLIENTE|COMUNICAR CLIENTE|AVISAR CLIENTE)\b/, "comunicacao"],
  [/^SOLICITAR DADOS\b/, "solicitar_dados"],
  [/^(COBRAR (A )?CLIENTE|FORMA DE PAGAMENTO|COBREI CLIENTE)/, "cobrar"],
  [/^PEDIR PRORROGACAO\b/, "prorrogacao"],
  [/^(DADOS BANCARIOS|BANCO|AGENCIA BANCARIA)\b/, "banco"],
  [/^(OBS|ATENCAO)\b/, "obs"],
  [/^CPF\b/, "cpf"],
  [/^(DATA DO REQUERIMENTO|DPR)\b/, "requerimento"],
  [/^DATA DA CONCESSAO\b/, "concessao"],
  [/^VALORES A RECEBER\b/, "a_receber"],
  [
    /^(RECEBIDOS? NA VIA ADM|VALORES ADM|VALORES RECEBIDOS VIA TUTELA|RECEBEU AINDA OUTROS)/,
    "recebidos_cliente",
  ],
  [/^PROCESSO\b/, "processo"],
  [/^IMPLANTACAO\b/, "implantacao"],
];

interface CampoLido {
  campo: Campo | null;
  chave: string;
  valor: string;
}

function lerCampo(texto: string): CampoLido | null {
  const m = texto.match(/^\s*\**\s*([^:\n]{1,45}?)\s*:+\.?\s*([\s\S]*)$/);
  if (!m) return null;
  const chave = m[1]!.trim();
  const kc = chaveTexto(chave);
  for (const [re, campo] of CAMPOS) if (re.test(kc)) return { campo, chave, valor: m[2]!.trim() };
  // Chave desconhecida curta → informação adicional; frases não são campos.
  if (kc.split(" ").length <= 4 && !/[.,;]/.test(chave))
    return { campo: null, chave, valor: m[2]!.trim() };
  return null;
}

function inicioDeBloco(texto: string): ReturnType<typeof extrairNome> | "sem_nome" | null {
  if (/^\s*CLIENTE\s*:/i.test(texto)) {
    if (/^\s*CLIENTE\s*:\s*$/i.test(texto)) return null;
    const n = extrairNome(texto);
    return n ?? "sem_nome";
  }
  const campo = lerCampo(texto);
  if (campo?.campo && campo.campo !== "atrasados") return null;
  if (campo?.campo === "atrasados") {
    const n = extrairNome(texto);
    return n && n.prefixo?.startsWith("ATRASADO") ? n : null;
  }
  const n = extrairNome(texto);
  if (!n) return null;
  if (n.prefixo) return n;
  // Nome seguido de complemento curto ("NAME - 2 concessões...", "NAME   CPF: ...")
  if (
    !n.complemento ||
    n.cpf ||
    /^[-–]/.test(texto.slice(texto.indexOf(n.nome) + n.nome.length).trim()) ||
    n.complemento.length < 40
  ) {
    return n;
  }
  return n;
}

const CODIGO_ESPECIE = /(?:^|\b|B\s?)(\d{2})\b(?=\s*[-–)]|\s+-|\s*$|\s+[A-ZÀ-Ú])/;

function especieDe(texto: string): { especie: string; codigo: string | null } {
  const semNB = texto.replace(/NB\s*:?\s*[\d.\-\s]+/i, "").trim();
  const t = semNB.replace(/\s{2,}/g, " ");
  let codigo: string | null = null;
  const m1 =
    t.match(/^\s*B?\s?(\d{2})\b/i) ??
    t.match(/\bB\s?(\d{2})\b/) ??
    t.match(/\((\d{2})\)/) ??
    t.match(CODIGO_ESPECIE);
  if (m1) codigo = m1[1]!;
  return { especie: compactar(t), codigo };
}

function primeiroNumero(texto: string): number | null {
  const m = texto.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}\b)/);
  if (!m) return null;
  const v = lerNumeroBR(m[1]!).valor;
  return v === null ? null : arred(v);
}

function dataCampo(valor: string): { data: DataLida | null; texto: string } {
  const d = datasNoTexto(valor).find((x) => x.precisao === "dia" || x.precisao === "mes") ?? null;
  return { data: d, texto: valor };
}

interface EstadoBloco {
  bloco: Bloco;
  beneficio: BeneficioRascunho;
  rmaPorAno: { ano: number; valor: number; texto: string }[];
  bancoTextos: { texto: string; celula: string }[];
}

export function analisarCamposEmCelula(aba: Aba, perfil: PerfilAba, ctx: Contexto): void {
  const linhas = linhasDaAba(aba);
  const adm = perfil === "implantacao_administrativa";
  const cel = (r: number, c: number): Celula | undefined => aba.porRef.get(`${letraColuna(c)}${r}`);

  // ---- Faixas (lanes): coluna A e colunas com blocos próprios -----------
  const faixas: { coluna: number; inicio: number; fim: number }[] = [];
  for (const c of aba.celulas) {
    if (c.coluna === 1 || typeof c.bruto !== "string") continue;
    if (!/^\s*CLIENTE\s*:/i.test(c.texto)) continue;
    const prox = [1, 2]
      .map((d) => cel(c.linha + d, c.coluna))
      .filter((x) => x && lerCampo(x.texto)?.campo);
    if (prox.length < 2) continue;
    let fim = c.linha;
    let vazias = 0;
    for (let r = c.linha + 1; r <= aba.maxLinha && vazias < 2; r++) {
      if (cel(r, c.coluna)) {
        fim = r;
        vazias = 0;
      } else vazias++;
    }
    faixas.push({ coluna: c.coluna, inicio: c.linha, fim });
  }
  const naFaixa = (c: Celula) =>
    faixas.find((f) => f.coluna === c.coluna && c.linha >= f.inicio && c.linha <= f.fim);

  const estados = new Map<Bloco, EstadoBloco>();
  const novoEstado = (
    r: number,
    coluna: number,
    nome: ReturnType<typeof extrairNome>,
    celNome: Celula | null,
  ): EstadoBloco => {
    const bloco = ctx.novoBloco({
      aba,
      perfil,
      tipo: nome ? "cliente" : "sem_identificacao",
      linhaInicio: r,
      colunaBase: coluna,
      nome,
      celulaNome: celNome ? k(celNome) : null,
    });
    bloco.dados.natureza = adm ? "administrativo" : "judicial";
    bloco.dados.servico = adm ? "Concessão administrativa" : "Implantação de benefício (judicial)";
    const est: EstadoBloco = { bloco, beneficio: beneficioVazio(), rmaPorAno: [], bancoTextos: [] };
    estados.set(bloco, est);
    return est;
  };

  const processarColuna = (coluna: number, rIni: number, rFim: number, lateraisDe: boolean) => {
    let atual: EstadoBloco | null = null;
    const blocoDaLinha = new Map<number, EstadoBloco>();
    for (let r = rIni; r <= rFim; r++) {
      const a = cel(r, coluna);
      if (!a || ctx.reservadas.has(k(a))) {
        if (atual) blocoDaLinha.set(r, atual);
        continue;
      }
      if (typeof a.bruto !== "string") {
        if (!atual) atual = novoEstado(r, coluna, null, null);
        ctx.incluir(atual.bloco, a);
        const v = lerCelulaMonetaria(a.bruto);
        ctx.destinar(
          a,
          "informacao_adicional",
          a.tipo === "d" ? "data" : "valor_sem_rotulo",
          "interpretado",
          { valor: a.tipo === "d" ? a.data : v },
          atual.bloco.ref,
        );
        blocoDaLinha.set(r, atual);
        continue;
      }
      const inicio = inicioDeBloco(a.texto);
      if (inicio) {
        const nome = inicio === "sem_nome" ? null : inicio;
        atual = novoEstado(r, coluna, nome, a);
        ctx.incluir(atual.bloco, a);
        if (nome) {
          ctx.destinar(
            a,
            "campo",
            "cliente.nome",
            "interpretado",
            { nome: nome.nome, complemento: nome.complemento },
            atual.bloco.ref,
          );
          if (nome.cpf) atual.bloco.dados.cpfs.push(nome.cpf);
          if (nome.complemento) {
            registrarIdentificadores(atual.bloco, nome.complemento, k(a));
            if (nome.complemento.length > 20 && !nome.cpf) {
              atual.bloco.dados.historico.push({
                categoria: "observacao",
                texto: compactar(a.texto),
                dataTexto: null,
                celulas: [k(a)],
              });
            }
          }
        } else {
          ctx.destinar(
            a,
            "pendencia_revisao",
            "cliente.nome",
            "pendente",
            undefined,
            atual.bloco.ref,
          );
        }
        blocoDaLinha.set(r, atual);
        continue;
      }
      if (!atual) atual = novoEstado(r, coluna, null, null);
      blocoDaLinha.set(r, atual);
      processarLinhaCampo(ctx, aba, perfil, atual, a, r, coluna);
    }

    // Células laterais de cada linha
    if (!lateraisDe) return;
    for (let r = rIni; r <= rFim; r++) {
      const est =
        blocoDaLinha.get(r) ?? [...blocoDaLinha.entries()].filter(([l]) => l < r).pop()?.[1];
      for (const c of linhas.get(r) ?? []) {
        if (c.coluna === coluna || ctx.temDestino(c) || ctx.reservadas.has(k(c)) || naFaixa(c))
          continue;
        if (!est) continue;
        processarLateral(ctx, est, c, cel(r, coluna));
      }
    }
  };

  processarColuna(1, 1, aba.maxLinha, true);
  for (const f of faixas) processarColuna(f.coluna, f.inicio, f.fim, false);

  // Fechamento
  for (const est of estados.values()) {
    const b = est.bloco;
    const ben = est.beneficio;
    if (est.rmaPorAno.length > 1) {
      const maisRecente = [...est.rmaPorAno].sort((x, y) => y.ano - x.ano)[0]!;
      ben.rma = maisRecente.valor;
      ben.rmaTexto = maisRecente.texto;
    }
    if (est.bancoTextos.length) {
      const texto = est.bancoTextos.map((x) => x.texto).join(" ");
      const banc = lerDadosBancarios(texto);
      if (banc)
        b.dados.bancarios.push({
          ...banc,
          textoOriginal: compactar(texto),
          celulas: est.bancoTextos.map((x) => x.celula),
        });
    }
    const temBeneficio =
      ben.especie ||
      ben.nb ||
      ben.dib ||
      ben.dip ||
      ben.rmi !== null ||
      ben.rma !== null ||
      ben.dcbTexto;
    if (temBeneficio) {
      for (const nb of b.dados.nbs) if (!ben.nb) ben.nb = nb;
      if (ben.nb) ben.nbDigitos = ben.nb.replace(/\D/g, "");
      b.dados.beneficios.push(ben);
    }
    if (ben.prorrogacaoTexto) b.dados.situacao = b.dados.situacao ?? null;
    finalizarBloco(ctx, b);
  }
}

function processarLinhaCampo(
  ctx: Contexto,
  aba: Aba,
  perfil: PerfilAba,
  est: EstadoBloco,
  a: Celula,
  r: number,
  coluna: number,
): void {
  const b = est.bloco;
  const ben = est.beneficio;
  const chave = ctx.incluir(b, a);
  const adm = perfil === "implantacao_administrativa";
  const vcel = aba.porRef.get(`${letraColuna(coluna + 1)}${r}`);
  const valorAoLado = lerCelulaMonetaria(vcel?.tipo === "d" ? null : vcel?.bruto);

  // Mini-bloco financeiro dentro da aba ("CLIENTE:" / "CONTRATUAIS (27%):" com valor ao lado)
  const rot = lerRotuloFinanceiro(a.texto, valorAoLado.tipo === "valor");
  if (
    rot &&
    rot.categoria !== "total_bloco" &&
    valorAoLado.tipo === "valor" &&
    !extrairNome(rot.resto)
  ) {
    const cat = rot.categoria as CategoriaFinanceira;
    ctx.incluir(b, vcel!);
    b.dados.lancamentos.push(
      lancamento({
        categoria: cat,
        natureza: ["atrasados", "valor_cliente"].includes(cat) ? "previsto" : "devido",
        valor: valorAoLado.valor,
        percentual: rot.percentual,
        rotuloOriginal: rot.rotulo,
        celulas: [chave, k(vcel!)],
      }),
    );
    ctx.destinar(
      a,
      "campo",
      `lancamento:${cat}:rotulo`,
      "interpretado",
      { rotulo: rot.rotulo },
      b.ref,
    );
    ctx.destinar(
      vcel!,
      "campo",
      `lancamento:${cat}`,
      "interpretado",
      { valor: valorAoLado.valor },
      b.ref,
    );
    return;
  }

  const campo = lerCampo(a.texto);
  if (!campo) {
    // Valor de honorários escrito numa anotação ("*COBRAR 30% DA IMPLANTAÇÃO = R$ 1.435,43")
    const m = a.texto.match(
      /(COBRAR|HONOR[ÁA]RIOS)[^=]{0,60}IMPLANTA[^=]{0,40}=\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
    );
    if (m) {
      const valor = lerNumeroBR(m[2]!).valor;
      if (valor !== null) {
        b.dados.lancamentos.push(
          lancamento({
            categoria: adm ? "honorarios_administrativos" : "honorarios_implantacao",
            natureza: "devido",
            valor,
            valorTexto: compactar(a.texto),
            percentual: percentualNoTexto(a.texto),
            rotuloOriginal: "anotação",
            coluna: letraColuna(coluna),
            celulas: [chave],
          }),
        );
      }
    }
    // Nota (observação/histórico), com detectores
    interpretarTextoLivre(ctx, b, a, { categoriaHistorico: "observacao" });
    return;
  }
  const v = campo.valor;
  const reg = (ref: string, interpretado?: unknown) =>
    ctx.destinar(a, "campo", ref, "interpretado", interpretado, b.ref);
  registrarIdentificadores(b, v, chave);
  ben.celulas.push(chave);

  switch (campo.campo) {
    case "beneficio": {
      const { especie, codigo } = especieDe(v);
      if (ben.especie && chaveTexto(ben.especie) !== chaveTexto(especie)) {
        ben.historico.push({ campo: "Benefício", texto: v, celula: chave });
      } else {
        ben.especie = especie || null;
        ben.especieCodigo = codigo;
      }
      for (const nb of nbsNoTexto(v)) ben.nb = ben.nb ?? nb.nb;
      reg("beneficio.especie", { especie, codigo });
      break;
    }
    case "nb": {
      const nbs = nbsNoTexto(`NB: ${v}`);
      if (nbs[0]) {
        ben.nb = ben.nb ?? nbs[0].nb;
        if (!b.dados.nbs.includes(nbs[0].nb)) b.dados.nbs.push(nbs[0].nb);
      }
      reg("beneficio.nb", { nb: nbs[0]?.nb ?? null, texto: v });
      break;
    }
    case "dib":
    case "dib_judicial":
    case "dib_origem": {
      const d = dataCampo(v);
      if (campo.campo === "dib_origem") {
        ben.dibOrigemTexto = v;
      } else if (campo.campo === "dib_judicial" && ben.dib) {
        ben.historico.push({ campo: campo.chave, texto: v, celula: chave });
      } else if (!ben.dib && !ben.dibTexto) {
        ben.dib = d.data;
        ben.dibTexto = v;
        if (campo.campo === "dib_judicial")
          ben.historico.push({ campo: campo.chave, texto: v, celula: chave });
      } else {
        ben.historico.push({ campo: campo.chave, texto: v, celula: chave });
      }
      reg(`beneficio.${campo.campo}`, { data: d.data?.iso ?? d.data?.texto ?? null, texto: v });
      break;
    }
    case "dip":
    case "dip_hist": {
      const d = dataCampo(v);
      if (campo.campo === "dip" && !ben.dipTexto) {
        ben.dip = d.data;
        ben.dipTexto = v;
        const prev = v.match(/PREVIS[ÃA]O\s*([\d/]+)/i);
        if (prev && !ben.previsaoPagamentoTexto) ben.previsaoPagamentoTexto = prev[1]!;
      } else {
        ben.historico.push({ campo: campo.chave, texto: v, celula: chave });
        if (/REVIS/i.test(campo.chave))
          ben.revisaoTexto = [ben.revisaoTexto, `${campo.chave}: ${v}`].filter(Boolean).join(" | ");
      }
      reg(`beneficio.${campo.campo}`, { data: d.data?.iso ?? d.data?.texto ?? null, texto: v });
      break;
    }
    case "dcb": {
      const d = dataCampo(v);
      if (!ben.dcbTexto) {
        ben.dcb = d.data;
        ben.dcbTexto = v;
      } else ben.historico.push({ campo: campo.chave, texto: v, celula: chave });
      if (/PRORROGA/i.test(v))
        ben.prorrogacaoTexto = [ben.prorrogacaoTexto, v].filter(Boolean).join(" | ");
      if (/REABILITA/i.test(v))
        ben.historico.push({ campo: "Reabilitação", texto: v, celula: chave });
      reg("beneficio.dcb", {
        data: d.data?.iso ?? d.data?.texto ?? null,
        ausencia: ausenciaDeclarada(v),
        texto: v,
      });
      break;
    }
    case "rmi":
    case "rma": {
      const k2 = chaveTexto(campo.chave);
      const de = v.match(/^(.*?)PARA\s*:?\s*(.*)$/i);
      const alvo = de ? de[2]! : v;
      const num = primeiroNumero(alvo);
      if (de) {
        ben.historico.push({
          campo: `${campo.chave} (revisão)`,
          texto: `${campo.chave}: ${v}`,
          celula: chave,
        });
        ben.revisaoTexto = [ben.revisaoTexto, `${campo.chave}: ${v}`].filter(Boolean).join(" | ");
      }
      const ano = k2.match(/\((20\d{2})\)/);
      if (campo.campo === "rma" && ano && num !== null)
        est.rmaPorAno.push({ ano: Number(ano[1]), valor: num, texto: v });
      if (campo.campo === "rmi") {
        if (ben.rmiTexto === null) {
          ben.rmi = num;
          ben.rmiTexto = v;
        } else ben.historico.push({ campo: campo.chave, texto: v, celula: chave });
      } else if (ben.rmaTexto === null) {
        ben.rma = num;
        ben.rmaTexto = v;
      } else ben.historico.push({ campo: campo.chave, texto: v, celula: chave });
      if (/ERRAD|INCORRET|N[ÃA]O EST[ÁA] DE ACORDO|CORRET/i.test(v)) {
        ben.historico.push({ campo: campo.chave, texto: `Observação: ${v}`, celula: chave });
      }
      reg(`beneficio.${campo.campo}`, { valor: num, texto: v });
      break;
    }
    case "previsao":
      ben.previsaoPagamentoTexto = ben.previsaoPagamentoTexto
        ? `${ben.previsaoPagamentoTexto} | ${v}`
        : v;
      reg("beneficio.previsao_pagamento", { texto: v, data: primeiraData(v)?.texto ?? null });
      break;
    case "transito": {
      const d = dataCampo(v);
      if (!ben.transitoTexto) {
        ben.transito = d.data;
        ben.transitoTexto = v || null;
      }
      reg("beneficio.transito_julgado", { data: d.data?.iso ?? null, texto: v });
      break;
    }
    case "atrasados": {
      ben.atrasadosTexto = [ben.atrasadosTexto, `${campo.chave}: ${v}`].filter(Boolean).join(" | ");
      const valores = valoresMonetariosNoTexto(v).filter((x) => !x.malformado);
      const malformados = valoresMonetariosNoTexto(v).filter((x) => x.malformado);
      const tipo = /ADM/i.test(campo.chave)
        ? " (administrativo)"
        : /JUDICIAL/i.test(campo.chave)
          ? " (judicial)"
          : "";
      if (valores.length) {
        b.dados.lancamentos.push(
          lancamento({
            categoria: "atrasados",
            natureza: "informativo",
            valor: valores.length === 1 ? valores[0]!.valor : null,
            valorTexto: v,
            rotuloOriginal: campo.chave,
            coluna: letraColuna(coluna),
            observacao:
              `Atrasados${tipo}` +
              (valores.length > 1
                ? ` — ${valores.length} valores no texto; não somados automaticamente`
                : ""),
            celulas: [chave],
          }),
        );
      } else if (ausenciaDeclarada(v)) {
        b.dados.lancamentos.push(
          lancamento({
            categoria: "atrasados",
            natureza: "informativo",
            ausenciaDeclarada: ausenciaDeclarada(v),
            rotuloOriginal: campo.chave,
            celulas: [chave],
          }),
        );
      }
      if (malformados.length) {
        ctx.pendencia(b, {
          tipo: "valor_malformado",
          bloqueante: false,
          descricao: `${campo.chave}: valor com formato inválido "${malformados[0]!.original}" (${a.ref}).`,
          celulas: [chave],
        });
      }
      reg("beneficio.atrasados+lancamento:atrasados", {
        texto: v,
        valores: valores.map((x) => x.valor),
      });
      break;
    }
    case "honorarios":
    case "honorarios_valor": {
      const kchave = chaveTexto(campo.chave);
      const kv = chaveTexto(v);
      if (campo.campo === "honorarios")
        ben.honorariosRegra = [ben.honorariosRegra, v].filter(Boolean).join(" | ") || null;
      let categoria: CategoriaFinanceira = adm
        ? "honorarios_administrativos"
        : "honorarios_implantacao";
      if (
        /DA ACAO|CONTRATUAIS|ATRASADOS/.test(kchave) ||
        (campo.campo === "honorarios" &&
          /DA ACAO|DO EXITO|ACAO \(APENAS\)/.test(kv) &&
          !/IMPLANTA/.test(kv))
      ) {
        categoria = "honorarios_contratuais";
      }
      const valores = valoresMonetariosNoTexto(v).filter((x) => !x.malformado);
      const pct = percentualNoTexto(v) ?? percentualNoTexto(campo.chave);
      const qtd = quantidadeBeneficiosNoTexto(v);
      let valor: number | null = null;
      let base: string | null = null;
      const total = v.match(/=\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/);
      if (total) {
        valor = lerNumeroBR(total[1]!).valor;
      } else if (valores.length === 1) {
        valor = valores[0]!.valor;
      } else if (valores.length > 1 && pct) {
        // Par (honorário, base) coerente com o percentual
        for (const x of valores)
          for (const y of valores)
            if (
              x !== y &&
              Math.abs(x.valor - (pct / 100) * y.valor) <= Math.max(0.05, x.valor * 0.002)
            ) {
              valor = x.valor;
              base = `${pct}% de R$ ${y.valor.toFixed(2).replace(".", ",")}`;
            }
        if (valor === null) {
          ctx.pendencia(b, {
            tipo: "divergencia_percentual",
            bloqueante: false,
            descricao: `${campo.chave}: "${v}" — não foi possível identificar qual valor é o honorário (${pct}%). Informe o valor correto.`,
            celulas: [chave],
          });
        }
      } else if (valores.length > 1) {
        valor = null;
      }
      if (valor !== null && pct !== null && !base) {
        const baseTxt = valores.find((x) => Math.abs(x.valor - valor!) > 0.01);
        if (
          baseTxt &&
          Math.abs(valor - (pct / 100) * baseTxt.valor) <= Math.max(0.05, valor * 0.002)
        ) {
          base = `${pct}% de R$ ${baseTxt.valor.toFixed(2).replace(".", ",")}`;
        }
      }
      const ausencia =
        ausenciaDeclarada(v) ??
        (/N[ÃA]O COBRAMOS|N[ÃA]O H[ÁA]|N[ÃA]O TEM/i.test(v) ? compactar(v) : null);
      if (valor !== null || ausencia) {
        b.dados.lancamentos.push(
          lancamento({
            categoria,
            natureza: "devido",
            valor: valor !== null ? arred(valor) : null,
            valorTexto: v,
            percentual: pct,
            quantidadeBeneficios: qtd,
            baseCalculo: base ?? (qtd !== null ? `${qtd} benefício(s)` : null),
            ausenciaDeclarada: valor === null ? ausencia : null,
            rotuloOriginal: campo.chave,
            coluna: letraColuna(coluna),
            observacao:
              valor === null && (pct !== null || qtd !== null)
                ? "Regra de honorários sem valor calculado na planilha"
                : null,
            celulas: [chave],
          }),
        );
      }
      reg(`lancamento:${categoria}`, {
        texto: v,
        valor,
        percentual: pct,
        quantidadeBeneficios: qtd,
      });
      // Parcelamento/pagamento dentro do próprio campo
      if (/parcel|\dx|pag/i.test(v))
        interpretarTextoLivre(ctx, b, a, {
          campoLinha: campo.chave,
          categoriaLinha: categoria,
          valorLinha: valor,
        });
      break;
    }
    case "comunicacao":
    case "solicitar_dados":
    case "cobrar":
    case "obs":
    case "recebidos_cliente": {
      if (campo.campo === "comunicacao")
        ben.comunicacaoTexto = [ben.comunicacaoTexto, v].filter(Boolean).join(" | ") || null;
      const cat = {
        comunicacao: "comunicacao",
        solicitar_dados: "solicitacao_dados",
        cobrar: "cobranca",
        obs: "observacao",
        recebidos_cliente: "valores_cliente",
      }[campo.campo];
      if (v) {
        interpretarTextoLivre(ctx, b, a, { categoriaHistorico: cat, campoLinha: null });
      } else {
        reg(`historico.${cat}:vazio`, { vazio: true });
      }
      break;
    }
    case "prorrogacao":
      ben.prorrogacaoTexto = [ben.prorrogacaoTexto, v].filter(Boolean).join(" | ") || null;
      reg("beneficio.prorrogacao", { texto: v });
      break;
    case "banco":
      est.bancoTextos.push({ texto: a.texto, celula: chave });
      reg("dados_bancarios", { texto: v });
      break;
    case "cpf": {
      const cpf = cpfsNoTexto(`CPF: ${v}`)[0];
      if (cpf && !b.dados.cpfs.includes(cpf)) b.dados.cpfs.push(cpf);
      reg("cliente.cpf", { cpf: cpf ?? null, texto: v });
      break;
    }
    case "requerimento":
      ben.dataRequerimentoTexto = v;
      reg("beneficio.data_requerimento", { texto: v });
      break;
    case "concessao":
      ben.dataConcessaoTexto = v;
      reg("beneficio.data_concessao", { texto: v });
      break;
    case "a_receber": {
      const valores = valoresMonetariosNoTexto(v).filter((x) => !x.malformado);
      b.dados.lancamentos.push(
        lancamento({
          categoria: "valor_a_receber",
          natureza: "informativo",
          valor: valores.length === 1 ? valores[0]!.valor : null,
          valorTexto: v,
          rotuloOriginal: campo.chave,
          observacao: valores.length > 1 ? "Vários valores no texto; não somados" : null,
          celulas: [chave],
        }),
      );
      reg("lancamento:valor_a_receber", { texto: v });
      break;
    }
    case "processo": {
      const ps = processosNoTexto(v);
      reg("atendimento.numero_processo", { processos: ps.map((p) => p.numero), texto: v });
      break;
    }
    case "implantacao":
      ben.implantacaoTexto = [ben.implantacaoTexto, v].filter(Boolean).join(" | ") || null;
      reg("beneficio.implantacao", { texto: v });
      break;
    default:
      ctx.destinar(
        a,
        "informacao_adicional",
        `campo_nao_mapeado:${campo.chave}`,
        "interpretado",
        { chave: campo.chave, valor: v },
        b.ref,
      );
  }
}

function processarLateral(
  ctx: Contexto,
  est: EstadoBloco,
  c: Celula,
  linha: Celula | undefined,
): void {
  const b = est.bloco;
  const chave = ctx.incluir(b, c);
  const campoLinha = linha && typeof linha.bruto === "string" ? lerCampo(linha.texto) : null;
  if (c.formula) {
    ctx.destinar(
      c,
      "informacao_adicional",
      "formula_bloco",
      "interpretado",
      { formula: c.formula, armazenado: c.bruto },
      b.ref,
    );
    return;
  }
  if (typeof c.bruto === "number" || c.tipo === "d") {
    ctx.destinar(
      c,
      "informacao_adicional",
      c.tipo === "d" ? "data_lateral" : "valor_lateral",
      "interpretado",
      { valor: c.tipo === "d" ? c.data : c.bruto, linha: campoLinha?.chave ?? null },
      b.ref,
    );
    return;
  }
  const texto = c.texto;
  // "30% = R$ 2.183,10" ao lado de ATRASADOS → honorários sobre atrasados
  const pctValor = texto.match(/^\s*(\d{1,3})\s*%\s*=\s*R?\$?\s*([\d.,]+)/);
  if (pctValor && campoLinha?.campo === "atrasados") {
    const valor = lerNumeroBR(pctValor[2]!).valor;
    if (valor !== null) {
      b.dados.lancamentos.push(
        lancamento({
          categoria: "honorarios_contratuais",
          natureza: "devido",
          valor,
          valorTexto: texto.trim(),
          percentual: Number(pctValor[1]),
          baseCalculo: `${pctValor[1]}% dos atrasados`,
          rotuloOriginal: `${campoLinha.chave} (coluna lateral)`,
          coluna: letraColuna(c.coluna),
          celulas: [chave],
        }),
      );
      ctx.destinar(
        c,
        "campo",
        "lancamento:honorarios_contratuais",
        "interpretado",
        { valor },
        b.ref,
      );
      return;
    }
  }
  if (/^\s*(NB|CPF)\b/i.test(texto)) {
    registrarIdentificadores(b, texto, chave);
    ctx.destinar(
      c,
      "campo",
      /^\s*NB/i.test(texto) ? "beneficio.nb" : "cliente.cpf",
      "interpretado",
      { texto },
      b.ref,
    );
    if (/^\s*NB/i.test(texto)) {
      const nb = nbsNoTexto(texto)[0];
      if (nb && !est.beneficio.nb) est.beneficio.nb = nb.nb;
    }
    return;
  }
  if (/^\s*R\$\s*[\d.,]+\s*\(/.test(texto) && campoLinha?.campo === "atrasados") {
    // "R$ 2.911,25 (01/2025)" — valor complementar dos atrasados
    const v = valoresMonetariosNoTexto(texto)[0];
    if (v && !v.malformado) {
      b.dados.lancamentos.push(
        lancamento({
          categoria: "atrasados",
          natureza: "informativo",
          valor: v.valor,
          valorTexto: texto.trim(),
          rotuloOriginal: `${campoLinha.chave} (coluna lateral)`,
          coluna: letraColuna(c.coluna),
          versao: 2,
          principal: false,
          dataReferencia: primeiraData(texto)?.texto ?? null,
          observacao: "Valor anotado em coluna lateral; não somado",
          celulas: [chave],
        }),
      );
      ctx.destinar(
        c,
        "campo",
        "lancamento:atrasados:lateral",
        "interpretado",
        { valor: v.valor },
        b.ref,
      );
      return;
    }
  }
  const valorLinha =
    campoLinha && ["honorarios", "honorarios_valor"].includes(campoLinha.campo ?? "")
      ? (b.dados.lancamentos.filter((l) => l.celulas.includes(linha ? k(linha) : "")).pop()
          ?.valor ?? null)
      : null;
  const categoriaLinha =
    campoLinha && ["honorarios", "honorarios_valor"].includes(campoLinha.campo ?? "")
      ? (b.dados.lancamentos.filter((l) => l.celulas.includes(linha ? k(linha) : "")).pop()
          ?.categoria ?? null)
      : null;
  if (campoLinha?.campo === "dcb" || /PRORROGA/i.test(texto)) {
    est.beneficio.prorrogacaoTexto = [est.beneficio.prorrogacaoTexto, texto.trim()]
      .filter(Boolean)
      .join(" | ");
  }
  if (campoLinha?.campo === "banco" || /^\s*(AG[ÊE]NCIA|CONTA)\b/i.test(texto)) {
    est.bancoTextos.push({ texto, celula: chave });
  }
  interpretarTextoLivre(ctx, b, c, {
    lateral: true,
    campoLinha: campoLinha?.chave ?? (linha ? compactar(linha.texto).slice(0, 40) : null),
    categoriaLinha,
    valorLinha,
  });
}
