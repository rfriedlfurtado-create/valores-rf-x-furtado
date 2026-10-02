/**
 * Estratégias por LINHA:
 *  - "tabela_cabecalho": tabela com cabeçalho (ACORDOS); colunas sem
 *    cabeçalho viram observações.
 *  - "linhas_registro": um registro por linha, sem esquema fixo de colunas
 *    (pedido de TED, COBRAR CLIENTES - OK). Cada célula é interpretada pelo
 *    conteúdo, não pela posição.
 */

import { interpretarTextoLivre, lancamento, registrarIdentificadores } from "./comum";
import { Contexto, k } from "./contexto";
import { contaIndicada, lerParcelamento, montarCobranca, tipoValorTED } from "./detectores";
import { finalizarBloco } from "./estrategiaVertical";
import { letraColuna, linhasDaAba, type Aba, type Celula } from "./planilha";
import {
  beneficioVazio,
  requisicaoVazia,
  type AcordoRascunho,
  type Bloco,
  type PerfilAba,
} from "./modelo";
import { lerRotuloFinanceiro } from "./rotulos";
import {
  ausenciaDeclarada,
  chaveTexto,
  compactar,
  extrairNome,
  lerCelulaMonetaria,
  lerDadosBancarios,
  lerNumeroBR,
  percentualNoTexto,
  prazoEmDias,
  primeiraData,
  processosNoTexto,
  valoresMonetariosNoTexto,
  type DataLida,
  type NomeExtraido,
} from "./texto";

// ---------------------------------------------------------------------------
// Tabela com cabeçalho
// ---------------------------------------------------------------------------

type ColunaTabela =
  | "processo"
  | "nome"
  | "acordo"
  | "dib"
  | "dip"
  | "dcb"
  | "sucumbencias"
  | "beneficio"
  | "prorrogacao"
  | "laudo"
  | "outra";

function colunaDoCabecalho(texto: string): ColunaTabela {
  const t = chaveTexto(texto);
  if (/PROCESSO/.test(t)) return "processo";
  if (/^(NOME|CLIENTE)/.test(t)) return "nome";
  if (/LAUDO/.test(t)) return "laudo";
  if (/ACORDO/.test(t)) return "acordo";
  if (/^DIB/.test(t)) return "dib";
  if (/^DIP/.test(t)) return "dip";
  if (/^DCB/.test(t)) return "dcb";
  if (/SUCUMB/.test(t)) return "sucumbencias";
  if (/BENEFICIO/.test(t)) return "beneficio";
  if (/PRORROGA/.test(t)) return "prorrogacao";
  return "outra";
}

function dataOuTexto(c: Celula | undefined): { data: DataLida | null; texto: string | null } {
  if (!c) return { data: null, texto: null };
  if (c.tipo === "d") return { data: c.data, texto: c.data?.texto ?? c.texto };
  return { data: primeiraData(c.texto), texto: c.texto.trim() };
}

export function analisarTabela(aba: Aba, perfil: PerfilAba, ctx: Contexto): void {
  const linhas = linhasDaAba(aba);
  let linhaCab = 0;
  for (const [r, cels] of [...linhas.entries()].sort((a, b) => a[0] - b[0])) {
    const textos = cels.filter((c) => typeof c.bruto === "string");
    const conhecidos = textos.filter((c) => colunaDoCabecalho(c.texto) !== "outra");
    if (textos.length >= 3 && conhecidos.length >= 2) {
      linhaCab = r;
      break;
    }
  }
  if (!linhaCab) {
    analisarLinhasRegistro(aba, perfil, ctx);
    return;
  }
  const mapa = new Map<number, { tipo: ColunaTabela; cabecalho: string }>();
  for (const c of linhas.get(linhaCab) ?? []) {
    mapa.set(c.coluna, { tipo: colunaDoCabecalho(c.texto), cabecalho: c.texto.trim() });
    ctx.destinar(c, "resumo_arquivo", "cabecalho_tabela", "elemento_arquivo", {
      coluna: c.texto.trim(),
    });
  }
  for (const c of aba.celulas.filter((x) => x.linha > linhaCab)) {
    if (!mapa.has(c.coluna))
      mapa.set(c.coluna, {
        tipo: "outra",
        cabecalho: `Coluna ${letraColuna(c.coluna)} (sem cabeçalho)`,
      });
  }
  for (let r = linhaCab + 1; r <= aba.maxLinha; r++) {
    const cels = (linhas.get(r) ?? []).filter((c) => !ctx.reservadas.has(k(c)));
    if (!cels.length) continue;
    const porTipo = (t: ColunaTabela) => cels.find((c) => mapa.get(c.coluna)?.tipo === t);
    const celNome = porTipo("nome");
    const nome = celNome ? extrairNome(celNome.texto) : null;
    const bloco = ctx.novoBloco({
      aba,
      perfil,
      tipo: nome ? "linha_tabela" : "sem_identificacao",
      linhaInicio: r,
      colunaBase: 1,
      nome,
      celulaNome: celNome ? k(celNome) : null,
    });
    bloco.dados.natureza = "judicial";
    bloco.dados.servico = perfil === "acordos" ? "Acordo INSS" : null;
    const acordo: AcordoRascunho = {
      numeroProcesso: null,
      aceitacao: null,
      aceitacaoTexto: null,
      percentual: null,
      beneficio: null,
      dib: null,
      dibTexto: null,
      dip: null,
      dipTexto: null,
      dcb: null,
      dcbTexto: null,
      dcbPrazoDias: null,
      sucumbenciaPercentual: null,
      sucumbenciaTexto: null,
      deAcordoLaudo: null,
      prorrogacao: null,
      reabilitacao: null,
      observacoes: null,
      celulas: [],
    };
    const obs: string[] = [];
    for (const c of cels) {
      const chave = ctx.incluir(bloco, c);
      acordo.celulas.push(chave);
      const col = mapa.get(c.coluna)!;
      const ref = (campo: string, interp?: unknown) =>
        ctx.destinar(c, "campo", campo, "interpretado", interp, bloco.ref);
      switch (col.tipo) {
        case "processo": {
          registrarIdentificadores(bloco, c.texto, chave);
          acordo.numeroProcesso = processosNoTexto(c.texto)[0]?.numero ?? c.texto.trim();
          ref("atendimento.numero_processo", { processo: acordo.numeroProcesso });
          break;
        }
        case "nome":
          if (nome) ref("cliente.nome", { nome: nome.nome });
          else
            ctx.destinar(c, "pendencia_revisao", "cliente.nome", "pendente", undefined, bloco.ref);
          break;
        case "acordo": {
          const t = chaveTexto(c.texto);
          acordo.aceitacaoTexto = c.texto.trim();
          acordo.aceitacao = /^SIM\b/.test(t) ? "sim" : /^NAO\b/.test(t) ? "nao" : null;
          acordo.percentual = percentualNoTexto(c.texto);
          ref("acordo.aceitacao+percentual", {
            aceitacao: acordo.aceitacao,
            percentual: acordo.percentual,
          });
          break;
        }
        case "dib":
        case "dip":
        case "dcb": {
          const d = dataOuTexto(c);
          const prazo = c.tipo === "d" ? null : prazoEmDias(c.texto);
          if (col.tipo === "dib") {
            acordo.dib = d.data;
            acordo.dibTexto = d.texto;
          } else if (col.tipo === "dip") {
            acordo.dip = d.data;
            acordo.dipTexto = d.texto;
          } else {
            acordo.dcb = prazo !== null ? null : d.data;
            acordo.dcbTexto = d.texto;
            acordo.dcbPrazoDias = prazo;
          }
          ref(`acordo.${col.tipo}`, {
            data: d.data?.iso ?? null,
            texto: d.texto,
            ausencia: c.tipo === "d" ? null : ausenciaDeclarada(c.texto),
            prazoDias: prazo,
          });
          break;
        }
        case "sucumbencias": {
          if (typeof c.bruto === "number") {
            const pct = c.formato?.includes("%") || c.bruto < 1 ? c.bruto * 100 : c.bruto;
            acordo.sucumbenciaPercentual = Math.round(pct * 10000) / 10000;
            acordo.sucumbenciaTexto = c.exibido ?? String(c.bruto);
          } else {
            acordo.sucumbenciaTexto = c.texto.trim();
            acordo.sucumbenciaPercentual = percentualNoTexto(c.texto);
          }
          ref("acordo.sucumbencia", {
            percentual: acordo.sucumbenciaPercentual,
            texto: acordo.sucumbenciaTexto,
          });
          break;
        }
        case "beneficio":
          acordo.beneficio = c.texto.trim();
          ref("acordo.beneficio", { beneficio: acordo.beneficio });
          break;
        case "prorrogacao":
          acordo.prorrogacao = c.texto.trim();
          ref("acordo.prorrogacao", { texto: acordo.prorrogacao });
          break;
        case "laudo":
          acordo.deAcordoLaudo = c.texto.trim();
          ref("acordo.de_acordo_laudo", { texto: acordo.deAcordoLaudo, formula: c.formula });
          break;
        default: {
          const t = chaveTexto(c.texto);
          if (/^(S|C)\/\s*REABILITACAO|REABILITACAO/.test(t)) {
            acordo.reabilitacao = c.texto.trim();
            ref("acordo.reabilitacao", { texto: acordo.reabilitacao });
          } else {
            obs.push(`${col.cabecalho}: ${c.texto.trim()}`);
            interpretarTextoLivre(ctx, bloco, c, {
              lateral: true,
              campoLinha: col.cabecalho,
              categoriaHistorico: "observacao",
            });
          }
        }
      }
    }
    if (perfil === "acordos") {
      acordo.observacoes = obs.length ? obs.join(" | ") : null;
      bloco.dados.acordos.push(acordo);
      if (acordo.beneficio || acordo.dib) {
        const ben = beneficioVazio();
        ben.especie = acordo.beneficio;
        ben.especieCodigo = acordo.beneficio?.match(/(\d{2})/)?.[1] ?? null;
        ben.dib = acordo.dib;
        ben.dibTexto = acordo.dibTexto;
        ben.dip = acordo.dip;
        ben.dipTexto = acordo.dipTexto;
        ben.dcb = acordo.dcb;
        ben.dcbTexto = acordo.dcbTexto;
        ben.prorrogacaoTexto = acordo.prorrogacao;
        ben.celulas = [...acordo.celulas];
        bloco.dados.beneficios.push(ben);
      }
    }
    finalizarBloco(ctx, bloco);
  }
}

// ---------------------------------------------------------------------------
// Um registro por linha, sem esquema fixo
// ---------------------------------------------------------------------------

function nomeDaLinha(cels: Celula[]): { nome: NomeExtraido; celula: Celula } | null {
  for (const c of cels.sort((a, b) => a.coluna - b.coluna)) {
    if (typeof c.bruto !== "string") continue;
    let texto = c.texto;
    if (
      /^\s*N[º°o]?\s*(do\s+)?processo/i.test(texto) ||
      (processosNoTexto(texto).length && texto.replace(/[\d.\-\s()]/g, "").length < 15)
    )
      continue;
    texto = texto.replace(/^\s*Nome da Parte\s*:\s*/i, "CLIENTE: ");
    const n = extrairNome(texto.replace(/^\s*\t+/, ""), { permitirIncompleto: true });
    if (n) return { nome: n, celula: c };
  }
  return null;
}

export function analisarLinhasRegistro(aba: Aba, perfil: PerfilAba, ctx: Contexto): void {
  const linhas = linhasDaAba(aba);
  let agrupamento: { texto: string; celula: string } | null = null;
  for (let r = 1; r <= aba.maxLinha; r++) {
    const cels = (linhas.get(r) ?? []).filter((c) => !ctx.reservadas.has(k(c)));
    if (!cels.length) continue;
    const achado = nomeDaLinha(cels);
    const textoLinha = cels
      .map((c) => (c.tipo === "d" ? (c.data?.texto ?? c.texto) : c.texto))
      .join(" | ");
    if (!achado) {
      const soTexto =
        cels.length === 1 &&
        typeof cels[0]!.bruto === "string" &&
        !processosNoTexto(textoLinha).length;
      if (soTexto) {
        // Título/agrupamento ("recebidos em julho que não foram para o relatório")
        agrupamento = { texto: cels[0]!.texto.trim(), celula: k(cels[0]!) };
        ctx.destinar(cels[0]!, "resumo_arquivo", "agrupamento", "elemento_arquivo", {
          agrupamento: agrupamento.texto,
        });
        continue;
      }
    }
    // Agrupamento vale para as linhas seguintes que começam por data.
    if (agrupamento && !(cels.find((c) => c.coluna === 1)?.tipo === "d")) agrupamento = null;

    const bloco = ctx.novoBloco({
      aba,
      perfil,
      tipo: achado ? "linha_tabela" : "sem_identificacao",
      linhaInicio: r,
      colunaBase: 1,
      nome: achado?.nome ?? null,
      celulaNome: achado ? k(achado.celula) : null,
    });
    bloco.dados.natureza = perfil === "pedido_ted" ? "judicial" : null;
    bloco.dados.servico =
      perfil === "pedido_ted"
        ? "Pedido de TED / levantamento"
        : perfil === "cobrancas"
          ? "Cobrança de honorários"
          : null;
    if (agrupamento) {
      bloco.dados.historico.push({
        categoria: "agrupamento",
        texto: `Agrupamento: ${agrupamento.texto}`,
        dataTexto: null,
        celulas: [agrupamento.celula],
      });
    }
    registrarIdentificadores(bloco, textoLinha, k(cels[0]!));

    const req = perfil === "pedido_ted" ? requisicaoVazia("ted") : null;
    const valores: { valor: number; celula: string; rotulo: string | null }[] = [];
    let rotuloFinanceiro: ReturnType<typeof lerRotuloFinanceiro> = null;

    for (const c of cels.sort((a, b) => a.coluna - b.coluna)) {
      const chave = ctx.incluir(bloco, c);
      if (achado && c === achado.celula) {
        ctx.destinar(
          c,
          "campo",
          "cliente.nome",
          "interpretado",
          { nome: achado.nome.nome, complemento: achado.nome.complemento },
          bloco.ref,
        );
        if (achado.nome.complemento) {
          bloco.dados.historico.push({
            categoria: "observacao",
            texto: achado.nome.complemento,
            dataTexto: null,
            celulas: [chave],
          });
          for (const v of valoresMonetariosNoTexto(achado.nome.complemento).filter(
            (x) => !x.malformado,
          )) {
            valores.push({ valor: v.valor, celula: chave, rotulo: null });
          }
          // Representantes citados junto ao nome (curadora, sucessor...)
          if (achado.nome.papel) {
            const resto = achado.nome.complemento.replace(/[()]/g, " ").trim();
            const outro = resto.replace(new RegExp(achado.nome.papel, "i"), "").trim();
            bloco.dados.representantes.push({
              nome: outro && extrairNome(outro) ? extrairNome(outro)!.nome : null,
              relacao: achado.nome.papel.toLowerCase(),
              textoOriginal: achado.nome.original,
              celulas: [chave],
            });
          }
        }
        continue;
      }
      if (c.tipo === "d") {
        if (req) req.dataTexto = c.data?.texto ?? null;
        ctx.destinar(
          c,
          "campo",
          req ? "requisicao.data" : "registro.data",
          "interpretado",
          { data: c.data },
          bloco.ref,
        );
        continue;
      }
      if (typeof c.bruto === "number") {
        valores.push({ valor: c.bruto, celula: chave, rotulo: rotuloFinanceiro?.rotulo ?? null });
        ctx.destinar(
          c,
          "campo",
          req
            ? "requisicao.valor"
            : rotuloFinanceiro
              ? `lancamento:${rotuloFinanceiro.categoria}`
              : "cobranca.valor",
          "interpretado",
          { valor: c.bruto },
          bloco.ref,
        );
        continue;
      }
      const texto = c.texto;
      // Pares "Chave:valor" (ex.: linha com dados de TED do TRF4)
      const par = texto.match(
        /^\s*(Número Processo TRF4|Banco|Ag[êe]ncia|Conta|Valor|CPF\/CNPJ)\s*:\s*(.+)$/i,
      );
      if (par) {
        const kp = chaveTexto(par[1]!);
        if (kp.startsWith("VALOR")) {
          const v = valoresMonetariosNoTexto(par[2]!)[0];
          if (v && !v.malformado) valores.push({ valor: v.valor, celula: chave, rotulo: "Valor" });
          ctx.destinar(
            c,
            "campo",
            "requisicao.valor",
            "interpretado",
            { valor: v?.valor ?? null },
            bloco.ref,
          );
        } else if (kp.startsWith("NUMERO PROCESSO")) {
          registrarIdentificadores(bloco, texto, chave);
          ctx.destinar(
            c,
            "campo",
            "atendimento.numero_processo",
            "interpretado",
            { texto: par[2] },
            bloco.ref,
          );
        } else {
          ctx.destinar(
            c,
            "campo",
            kp.startsWith("CPF") ? "dados_bancarios.cpf_titular" : "dados_bancarios",
            "interpretado",
            { texto: par[2] },
            bloco.ref,
          );
        }
        continue;
      }
      const processos = processosNoTexto(texto);
      if (
        processos.length &&
        texto.replace(/N[º°o]?\s*(do\s+)?processo|n[º°]/gi, "").replace(/[\d.\-\s()]/g, "").length <
          4
      ) {
        registrarIdentificadores(bloco, texto, chave);
        if (req)
          req.numeroProcesso =
            processos[0]!.numero + (processos[0]!.sufixo ? ` ${processos[0]!.sufixo}` : "");
        ctx.destinar(
          c,
          "campo",
          "atendimento.numero_processo",
          "interpretado",
          { processo: processos[0]!.numero },
          bloco.ref,
        );
        continue;
      }
      const rot = lerRotuloFinanceiro(texto, true);
      if (rot && rot.categoria !== "total_bloco") {
        rotuloFinanceiro = rot;
        ctx.destinar(
          c,
          "campo",
          `lancamento:${rot.categoria}:rotulo`,
          "interpretado",
          { rotulo: rot.rotulo, resto: rot.resto },
          bloco.ref,
        );
        continue;
      }
      if (/^\s*(IMPLANTA[ÇC][ÃA]O|CONTRATUAIS|SUCUMBENCIAIS)\s*:?\s*$/i.test(texto)) {
        rotuloFinanceiro = lerRotuloFinanceiro(texto, true);
        ctx.destinar(c, "campo", "lancamento:rotulo", "interpretado", undefined, bloco.ref);
        continue;
      }
      // Valor monetário isolado em texto ("	19.071,43")
      const sozinho = lerCelulaMonetaria(texto);
      if (sozinho.tipo === "valor") {
        valores.push({ valor: sozinho.valor, celula: chave, rotulo: null });
        ctx.destinar(
          c,
          "campo",
          req ? "requisicao.valor" : "registro.valor",
          "interpretado",
          { valor: sozinho.valor },
          bloco.ref,
        );
        continue;
      }
      if (
        sozinho.tipo === "malformado" ||
        (/^\s*R\$\s*[\d.,]+\s*$/.test(texto) && valoresMonetariosNoTexto(texto)[0]?.malformado)
      ) {
        ctx.destinar(
          c,
          "pendencia_revisao",
          "valor_malformado",
          "pendente",
          { original: texto },
          bloco.ref,
        );
        ctx.pendencia(bloco, {
          tipo: "valor_malformado",
          bloqueante: false,
          descricao: `Valor com formato inválido na célula ${c.ref}: "${texto.trim()}". O original foi preservado.`,
          celulas: [chave],
        });
        continue;
      }
      interpretarTextoLivre(ctx, bloco, c, {
        lateral: c.coluna > (achado?.celula.coluna ?? 1),
        categoriaLinha:
          rotuloFinanceiro && rotuloFinanceiro.categoria !== "total_bloco"
            ? (rotuloFinanceiro.categoria as never)
            : null,
        valorLinha: valores[valores.length - 1]?.valor ?? null,
        categoriaHistorico: perfil === "cobrancas" ? "cobranca" : "observacao",
      });
    }

    // ---- Montagem específica por aba -------------------------------
    const textoTodo = cels.map((c) => c.texto).join(" | ");
    if (req) {
      req.contaIndicada = contaIndicada(textoTodo);
      req.tipoValor = tipoValorTED(textoTodo);
      if (valores.length === 1) req.valor = Math.round(valores[0]!.valor * 100) / 100;
      else if (valores.length > 1) {
        req.valorTexto = valores.map((v) => v.valor.toFixed(2)).join(" / ");
        req.observacoes = "Vários valores na linha; não somados automaticamente";
      }
      const t = chaveTexto(textoTodo);
      req.situacao = /INDEFERID/.test(t)
        ? "indeferido"
        : /NAO CONSEGUIMOS SACAR|NAO CONSEGUIMOS O DESTAQUE/.test(t)
          ? "pendente_levantamento"
          : /CLIENTE SACOU|SACOU (OS |TODO O )?VALOR/.test(t)
            ? "sacado_pelo_cliente"
            : /JA RECEBEMOS|FOI RECEBIDO|PAGO/.test(t)
              ? "recebido_informado"
              : "solicitado";
      req.situacaoTexto = compactar(textoTodo).slice(0, 500);
      const banc = lerDadosBancarios(textoTodo);
      if (banc && banc.agencia && banc.conta) {
        req.titular = banc.titular;
        bloco.dados.bancarios.push({
          ...banc,
          textoOriginal: compactar(textoTodo),
          celulas: cels.map(k),
        });
      }
      req.celulas = cels.map(k);
      // Informações de requisição lidas nos textos da linha são do mesmo pedido.
      for (const r2 of bloco.dados.requisicoes.splice(0)) {
        if (!r2) continue;
        req.anoPrevisto = req.anoPrevisto ?? r2.anoPrevisto;
        req.previsaoTexto = req.previsaoTexto ?? r2.previsaoTexto;
        req.retificacao = req.retificacao ?? r2.retificacao;
        req.venda = req.venda || r2.venda;
        if (r2.tipo === "precatorio" || r2.tipo === "rpv")
          req.observacoes = [req.observacoes, `Referente a ${r2.tipo.toUpperCase()}`]
            .filter(Boolean)
            .join(" | ");
      }
      bloco.dados.requisicoes.push(req);
      // Honorários ainda devidos ("deve ainda honorários - 765,06")
      const deve = textoTodo.match(
        /dev[ea]\s+(?:ainda\s+)?honor[áa]rios[^\d]{0,15}(\d{1,3}(?:\.\d{3})*,\d{2})/i,
      );
      if (deve) {
        const valor = lerNumeroBR(deve[1]!).valor;
        bloco.dados.cobrancas.push(
          montarCobranca({
            descricao: "Honorários ainda devidos (pedido de TED)",
            parcelamento: null,
            valorContratado: valor,
            textos: [textoTodo],
            celulas: cels.map(k),
          }),
        );
        bloco.dados.cobrancas[bloco.dados.cobrancas.length - 1]!.situacao = "pendente";
      }
    }
    if (perfil === "cobrancas" && achado) {
      const parc = lerParcelamento(textoTodo);
      const total =
        textoTodo.match(/valor total\s*(?:de\s*)?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i) ??
        textoTodo.match(/TOTAL:\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i) ??
        textoTodo.match(/cobrei[^|]{0,60}?R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i);
      const contratado = total
        ? lerNumeroBR(total[1]!).valor
        : valores.length === 1
          ? valores[0]!.valor
          : null;
      if (rotuloFinanceiro && valores.length && rotuloFinanceiro.categoria !== "total_bloco") {
        bloco.dados.lancamentos.push(
          lancamento({
            categoria: rotuloFinanceiro.categoria as never,
            natureza: "devido",
            valor: valores[0]!.valor,
            percentual: rotuloFinanceiro.percentual,
            rotuloOriginal: rotuloFinanceiro.rotulo,
            celulas: [valores[0]!.celula],
          }),
        );
      }
      const cob = montarCobranca({
        descricao: compactar(`Cobrança — ${achado.nome.nome}`),
        parcelamento: parc,
        valorContratado: contratado,
        textos: cels.filter((c) => c !== achado.celula).map((c) => c.texto),
        celulas: cels.map(k),
      });
      // "FALTA 1.000,00" → saldo informado
      const falta = textoTodo.match(
        /falt(?:a|ou)\s*(?:ainda\s*)?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i,
      );
      if (falta) cob.historico = `${cob.historico} | Saldo informado: ${falta[1]}`;
      bloco.dados.cobrancas.push(cob);
      if (cob.divergencia) {
        ctx.pendencia(bloco, {
          tipo: "parcelamento_divergente",
          bloqueante: false,
          descricao: `Parcelamento não confere: ${cob.divergencia} As parcelas não foram criadas; o acordo foi preservado.`,
          celulas: cels.map(k),
        });
      } else if (parc && cob.completar) {
        ctx.pendencia(bloco, {
          tipo: "parcelamento_incompleto",
          bloqueante: false,
          descricao: `Parcelamento registrado; falta completar: ${cob.completar}.`,
          celulas: cels.map(k),
        });
      }
      // Representante mencionado no texto ("deise curadora")
      const rep = textoTodo.match(/\b([A-Za-zÀ-ú]{3,})\s+(curador[a]?|sucessor[a]?)\b/i);
      if (rep && !/^(cliente|da|de|do)$/i.test(rep[1]!)) {
        bloco.dados.representantes.push({
          nome: rep[1]!,
          relacao: rep[2]!.toLowerCase(),
          textoOriginal: rep[0],
          celulas: cels.map(k),
        });
      }
    }
    finalizarBloco(ctx, bloco);
  }
}
