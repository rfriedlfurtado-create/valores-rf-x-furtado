/**
 * Detectores de informações dentro de textos livres: pagamentos,
 * parcelamentos, requisições (RPV/precatório/TED), parcerias e situação de
 * cobranças. Sempre conservadores: o que não for claro vira pendência.
 */

import type {
  CategoriaFinanceira,
  CobrancaRascunho,
  PagamentoIdentificado,
  RequisicaoRascunho,
} from "./modelo";
import { requisicaoVazia } from "./modelo";
import {
  anoNoTexto,
  arred,
  centavos,
  chaveTexto,
  compactar,
  datasNoTexto,
  isoDe,
  lerNumeroBR,
  primeiraData,
  valoresMonetariosNoTexto,
  type DataLida,
} from "./texto";

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------

const RE_PAGAMENTO =
  /\b(pag[oa]u?|pagos|pagamento efetuado|quitad[oa]s?|quitou|transferiu|tranferiu|acertou|j[áa] recebemos|recebemos|enviou comprovante|prestac[ãa]o\s*-?\s*ok|ted\s*-\s*pago)\b/i;
const RE_NAO_PAGAMENTO =
  /(n[ãa]o\s+(foi\s+)?(pag|quit|acert)|ainda n[ãa]o|ir[áa] pagar|vai pagar|ficou de (pagar|acertar)|pagar[áa]|pagando|a pagar|para pagar|deve(m)?\s|devemos|inadimplente|vai acertar|ir[áa] acertar|acertar com|pagar quando|pagar com|quando forem pagos|vou confirmar|n[ãa]o pagou|pediu para (parcelar|acertar)|ser[ãa]o pag|ser[áa] pag|a ser pag|serem pag|ser pag|est[áa] recebendo|j[áa] recebe\b|v[ãa]o ser pag)/i;

export function detectarPagamento(
  texto: string,
  celula: string,
  contexto: { valor?: number | null; categoria?: CategoriaFinanceira | null } = {},
): PagamentoIdentificado | null {
  if (!RE_PAGAMENTO.test(texto)) return null;
  // "PAGO 06/2026" em linha de atrasados é situação da requisição (crédito do cliente).
  if (
    contexto.categoria &&
    ["atrasados", "valor_total", "valor_cliente"].includes(contexto.categoria)
  ) {
    return null;
  }
  const partes = texto.split(/[.;]\s+/);
  const trecho = partes.find((p) => RE_PAGAMENTO.test(p)) ?? texto;
  if (RE_NAO_PAGAMENTO.test(trecho) && !/j[áa]\s+(foi\s+)?pag|pagou|quitad|quitou/i.test(trecho))
    return null;
  const valores = valoresMonetariosNoTexto(trecho).filter((v) => !v.malformado);
  const data = datasNoTexto(trecho).find((d) => d.precisao !== "ano") ?? null;
  const valor = valores[0]?.valor ?? contexto.valor ?? null;
  const indefinido = !data || data.precisao !== "dia" || valor === null || !contexto.categoria;
  return {
    texto: compactar(trecho),
    celula,
    valor: valor !== null ? arred(valor) : null,
    data,
    categoria: contexto.categoria ?? null,
    indefinido,
  };
}

// ---------------------------------------------------------------------------
// Parcelamentos
// ---------------------------------------------------------------------------

export interface ParcelamentoLido {
  quantidade: number | null;
  valorParcela: number | null;
  entrada: number | null;
  total: number | null;
  vencimentoInicial: DataLida | null;
  diaFixoMensal: number | null;
  parcelasPagas: number | null;
  texto: string;
}

const RE_CONTEXTO_PARCELA =
  /parcel|pagar|pagou|paga\b|vezes|dividi|divido|\d\s*x\s*\d|em\s+\d{1,2}\s*x/i;

function numBR(s: string): number | null {
  const v = lerNumeroBR(s.replace(/^R\$\s*/i, "")).valor;
  return v === null ? null : arred(v);
}

export function lerParcelamento(texto: string): ParcelamentoLido | null {
  const t = texto.replace(/\s+/g, " ");
  if (!RE_CONTEXTO_PARCELA.test(t)) return null;
  let quantidade: number | null = null;
  let valorParcela: number | null = null;
  const NUM = "(\\d{1,3}(?:\\.\\d{3})*,\\d{2})";
  const padroes: RegExp[] = [
    new RegExp(`em\\s*(\\d{1,2})\\s*x\\s*\\(?\\s*(?:de\\s*)?(?:R\\$\\s*)?${NUM}`, "i"),
    new RegExp(`(\\d{1,2})\\s*x\\s*(?:de\\s*)?(?:R\\$\\s*)?${NUM}`, "i"),
    new RegExp(`(\\d{1,2})\\s*parcelas?\\s*(?:mensais\\s*)?de\\s*(?:R\\$\\s*)?${NUM}`, "i"),
    new RegExp(`divid[oi]\\s*em\\s*(\\d{1,2})\\s*x\\s*(?:R\\$\\s*)?${NUM}`, "i"),
  ];
  for (const re of padroes) {
    const m = t.match(re);
    if (m) {
      quantidade = Number(m[1]);
      valorParcela = numBR(m[2]!);
      break;
    }
  }
  if (quantidade === null) {
    const q = t.match(/em\s*(\d{1,2})\s*x\b/i) ?? t.match(/em\s*(\d{1,2})\s*vezes/i);
    const v = t.match(new RegExp(`valor da parcela\\s*(?:de\\s*)?(?:R\\$\\s*)?${NUM}`, "i"));
    if (
      q &&
      !/em at[ée]\s*\d/i.test(t.slice(Math.max(0, (q.index ?? 0) - 6), (q.index ?? 0) + 2))
    ) {
      quantidade = Number(q[1]);
    }
    if (v) valorParcela = numBR(v[1]!);
  }
  const entradaM =
    t.match(new RegExp(`entrada\\s*(?:de\\s*)?(?:R\\$\\s*)?${NUM}`, "i")) ??
    t.match(new RegExp(`pagamento\\s*(?:de\\s*)?(?:R\\$\\s*)?${NUM}\\s*no\\s*pix`, "i"));
  const entrada = entradaM ? numBR(entradaM[1]!) : null;
  const totalM = t.match(new RegExp(`valor total\\s*(?:de\\s*)?(?:R\\$\\s*)?${NUM}`, "i"));
  const total = totalM ? numBR(totalM[1]!) : null;

  let vencimentoInicial: DataLida | null = null;
  const venc = t.match(
    /(?:primeira|primeiro pagamento|1[ªa]\s*parcela|a partir de|sendo a primeira em|come[çc]a[r]?\s*(?:o pagamento\s*)?(?:em|dia))[^.]{0,30}?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
  );
  if (venc) vencimentoInicial = primeiraData(venc[1]!);
  const dia = t.match(/todo dia (\d{1,2}) de cada m[êe]s/i);
  const pagas = t.match(/pagou\s*(\d{1,2})\s*parcelas?/i);

  if (quantidade === null && valorParcela === null && entrada === null) return null;
  return {
    quantidade,
    valorParcela,
    entrada,
    total,
    vencimentoInicial,
    diaFixoMensal: dia ? Number(dia[1]) : null,
    parcelasPagas: pagas ? Number(pagas[1]) : null,
    texto: compactar(texto),
  };
}

/**
 * Monta a cobrança a partir de um parcelamento. Parcelas só são criadas se
 * os dados forem suficientes e consistentes; caso contrário, a cobrança
 * registra a divergência e o que falta completar.
 */
export function montarCobranca(params: {
  descricao: string;
  parcelamento: ParcelamentoLido | null;
  valorContratado: number | null;
  textos: string[];
  celulas: string[];
}): CobrancaRascunho {
  const p = params.parcelamento;
  const contratado = p?.total ?? params.valorContratado ?? null;
  const textoTodo = params.textos.join(" | ");
  const cob: CobrancaRascunho = {
    descricao: params.descricao,
    valorContratado: contratado,
    entrada: p?.entrada ?? null,
    quantidadeParcelas: p?.quantidade ?? null,
    valorParcela: p?.valorParcela ?? null,
    vencimentoInicial: p?.vencimentoInicial?.iso ?? null,
    vencimentoTexto: p?.vencimentoInicial?.texto ?? null,
    situacao: situacaoCobranca(textoTodo),
    responsavel: responsavelCobranca(textoTodo),
    prestacaoContas: prestacaoDeContas(textoTodo),
    historico: textoTodo,
    divergencia: null,
    completar: null,
    parcelas: [],
    celulas: params.celulas,
  };
  const faltas: string[] = [];
  if (p) {
    if (p.quantidade === null) faltas.push("quantidade de parcelas");
    if (p.valorParcela === null) faltas.push("valor das parcelas");
    if (!p.vencimentoInicial) faltas.push("vencimentos");
    if (contratado === null) faltas.push("valor contratado");
    if (p.quantidade !== null && p.valorParcela !== null) {
      const somaParcelas = centavos(p.quantidade * p.valorParcela) + centavos(p.entrada ?? 0);
      if (contratado !== null && somaParcelas !== centavos(contratado)) {
        const dif = (somaParcelas - centavos(contratado)) / 100;
        cob.divergencia =
          `Total ${fmt(contratado)} ≠ ${p.entrada ? `entrada ${fmt(p.entrada)} + ` : ""}` +
          `${p.quantidade} × ${fmt(p.valorParcela)} = ${fmt(somaParcelas / 100)} (diferença ${fmt(dif)}).`;
      } else {
        // Dados suficientes e consistentes: cria as parcelas.
        const venc = p.vencimentoInicial;
        for (let n = 1; n <= p.quantidade; n++) {
          let vencimento: string | null = null;
          let vencimentoTexto: string | null = null;
          if (venc && venc.precisao === "dia" && venc.ano && venc.mes && venc.dia) {
            if (n === 1) {
              vencimento = venc.iso;
            } else if (p.diaFixoMensal) {
              const mesAbs = venc.mes - 1 + (n - 1);
              const ano = venc.ano + Math.floor(mesAbs / 12);
              const mes = (mesAbs % 12) + 1;
              vencimento = isoDe(ano, mes, Math.min(p.diaFixoMensal, 28));
              if (p.diaFixoMensal > 28)
                vencimentoTexto = `dia ${p.diaFixoMensal} (ajuste de mês curto)`;
            } else {
              vencimentoTexto = `após ${venc.texto} (vencimento não informado)`;
            }
          } else if (n === 1 && venc) {
            vencimentoTexto = venc.texto;
          }
          cob.parcelas.push({ numero: n, valor: p.valorParcela, vencimento, vencimentoTexto });
        }
      }
    }
  } else if (contratado === null) {
    faltas.push("valor contratado");
  }
  if (faltas.length) cob.completar = faltas.join(", ");
  return cob;
}

function fmt(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

export function situacaoCobranca(texto: string): CobrancaRascunho["situacao"] {
  const t = chaveTexto(texto);
  const falta = /\b(FALTA|FALTAM|RESTANTE|AINDA NAO|NAO ACERTOU|DEVE AINDA|PENDENTE)\b/.test(t);
  const pago =
    /\b(PAGOU|PAGO|QUITAD|QUITOU|ENVIOU COMPROVANTE|PRESTACAO\s*-?\s*OK|JA PAGOU)\b/.test(t);
  const aCobrar =
    /\b(TEMOS QUE COBRAR|COBRAR CLIENTE|VAI AO BANCO|VAI SACAR|NAO ACERTOU|INADIMPLENTE|IRA PAGAR|VAI PAGAR)\b/.test(
      t,
    );
  if (pago && falta) return "parcial";
  if (pago && !aCobrar) return "quitada";
  if (falta || aCobrar) return "pendente";
  return "a_confirmar";
}

export function prestacaoDeContas(texto: string): string | null {
  const t = chaveTexto(texto);
  if (/NAO TEM PRESTACAO DE CONTAS/.test(t)) return "não há prestação de contas";
  if (/PRESTACAO\s*-?\s*OK|PRESTACAO DE CONTAS OK|FEZ PRESTACAO DE CONTAS/.test(t))
    return "concluída";
  if (/DEVO FAZER PRESTAC|FAZER PRESTAC|AGENDAR PRAZO DE PRESTACAO|FALTA PASSAR O VALOR/.test(t))
    return "pendente";
  return null;
}

function responsavelCobranca(texto: string): string | null {
  const m = texto.match(/\b(Monique|Moni|Rafa|Leila|Ju|Matheus|Neri|Nerissa)\b/i);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------
// Requisições (RPV, precatório, TED, alvará)
// ---------------------------------------------------------------------------

export function sinaisRequisicao(texto: string): boolean {
  return /PRECAT|\bRPV\b|EXPEDID|AINDA N[ÃA]O FOI EXPEDIDO|^\s*PAGO\s+\d{2}\/\d{4}|VENDEU|RETIFICA|PEDIDO DE TED|\bTED\b|ALVAR[ÁA]|EXERC[ÍI]CIO DE 20\d{2}|or[çc]amento/i.test(
    texto,
  );
}

/** Atualiza (ou cria) a requisição de um bloco com as informações do texto. */
export function aplicarTextoRequisicao(
  req: RequisicaoRascunho | null,
  texto: string,
  celula: string,
  categoria: CategoriaFinanceira | null,
): RequisicaoRascunho | null {
  if (!sinaisRequisicao(texto)) return req;
  const r = req ?? requisicaoVazia();
  const t = chaveTexto(texto);
  if (/PRECAT/.test(t)) r.tipo = "precatorio";
  else if (/\bRPV\b/.test(t) && r.tipo !== "precatorio") r.tipo = "rpv";
  else if (/ALVARA/.test(t) && r.tipo === "nao_definido") r.tipo = "alvara";
  if (/PRECAT|EXERCICIO DE|ORCAMENTO|P\/\s*20\d{2}|PARA O PAGAMENTO EM/.test(t)) {
    const ano = anoNoTexto(texto);
    if (ano && !r.anoPrevisto) r.anoPrevisto = ano;
  }
  if (/AINDA NAO FOI EXPEDIDO/.test(t)) r.situacao = "nao_expedido";
  if (/EXPEDID/.test(t) && !/AINDA NAO FOI EXPEDIDO/.test(t)) {
    r.situacao = r.situacao === "pago" ? r.situacao : "expedido";
    r.expedicaoTexto = compactar(texto);
  }
  if (/PREVISAO|\(\s*90 DIAS\s*\)|90 DIAS/.test(t)) r.previsaoTexto = compactar(texto);
  const pago = t.match(/^PAGO\s+(\d{2}\/\d{4})/);
  if (pago && (!categoria || ["atrasados", "valor_total", "valor_cliente"].includes(categoria))) {
    r.situacao = "pago";
    r.dataTexto = pago[1]!;
  }
  if (/VENDEU/.test(t)) {
    r.venda = true;
    r.situacao = r.situacao ?? "vendido";
  }
  if (/RETIFICA/.test(t)) r.retificacao = compactar(texto);
  if (/PEDIDO DE TED|FIZ PEDIDO DE TED/.test(t)) r.situacao = r.situacao ?? "ted_solicitado";
  r.situacaoTexto = r.situacaoTexto ? `${r.situacaoTexto} | ${compactar(texto)}` : compactar(texto);
  if (!r.celulas.includes(celula)) r.celulas.push(celula);
  return r;
}

// ---------------------------------------------------------------------------
// Parcerias / repasses (sem calcular nada: só preserva)
// ---------------------------------------------------------------------------

export function detectarParceria(texto: string): boolean {
  return /PARA N[ÓO]S|OUTRO ADVOGAD|PARCERIA|REPASSE AO|COLEGA .{0,20}(ACERTOU|COBROU)|DR\.?\s*(F[ÚU]LVIO|CL[ÁA]UDIO)|CONTRATO DO DR|FERNANDA LIMA/i.test(
    texto,
  );
}

// ---------------------------------------------------------------------------
// Conta indicada em pedidos de TED
// ---------------------------------------------------------------------------

export function contaIndicada(texto: string): string | null {
  const t = chaveTexto(texto);
  if (
    /AMBAS AS CONTAS|INDIQUEI AMBAS|CONTA DO CLIENTE E (A )?NOSSA|CLIENTE E DO ESCRITORIO/.test(t)
  )
    return "cliente e escritório";
  if (/CONTA (FISICA )?DO DR\.? ?FULVIO|CONTA FISICA DO DR/.test(t)) return "conta do Dr. Fúlvio";
  if (/CONTA DO(S)? ESCRITORIO|DADOS BANCARIOS DO ESCRITORIO|CONTA DO ESCRITORIO/.test(t))
    return "escritório";
  if (/CONTA DA? CLIENTE|CONTA DO CLIENTE/.test(t)) return "cliente";
  return null;
}

export function tipoValorTED(texto: string): string | null {
  const t = chaveTexto(texto);
  const tipos: string[] = [];
  if (/ATRASADOS/.test(t)) tipos.push("atrasados");
  if (/CONTRATUAIS/.test(t)) tipos.push("contratuais");
  if (/SUCUMBENCIAIS/.test(t)) tipos.push("sucumbenciais");
  if (/EXECUCAO/.test(t)) tipos.push("execução");
  if (/AMBOS VALORES/.test(t)) tipos.push("ambos os valores");
  return tipos.length ? tipos.join(" + ") : null;
}
