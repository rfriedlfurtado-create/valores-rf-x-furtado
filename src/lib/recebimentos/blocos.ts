/**
 * Modelo "VALORES PRI EXECUÇÃO" (planilha em BLOCOS) — leitura pura, sem
 * banco (testada em tests/importacao-blocos.test.ts).
 *
 * A planilha não é uma tabela: cada cliente é um bloco de linhas com rótulos
 * ("ATRASADOS:", "CONTRATUAIS (30%):", "BENEFÍCIO:", "HONORÁRIOS DA
 * IMPLANTAÇÃO = …"), valores ao lado (ou dentro do próprio texto), versões
 * atualizadas em colunas à direita e observações livres. Três abas:
 *   - RPV E PRECATÓRIO        → ATRASADOS (contratuais sobre atrasados) e SUCUMBÊNCIA
 *   - IMPLANTAÇÃO JUDICIAL    → CONTRATUAL (implantação), origem judicial
 *   - IMPLANTAÇÃO ADMINISTRATIVA → CONTRATUAL (implantação), origem administrativa (INSS)
 *
 * Regras centrais:
 *  - Valor bruto, valor do autor, RMI/RMA, bases de cálculo e totais NÃO são
 *    honorários recebidos: ficam como informação complementar.
 *  - Só é "recebido" o que tem confirmação expressa NA MESMA LINHA do valor
 *    ("PAGO", "QUITADO", "já recebemos"…) ou um pagamento com valor informado
 *    ("pagou … R$ 566,00"). O resto é previsto: a receber / não confirmado.
 *  - Versões do mesmo valor na mesma linha: usa a última atualização e guarda
 *    as demais (sempre para conferência). Nunca soma versões.
 *  - Fórmulas de soma e totais gerais são ignorados (constam no relatório).
 *  - Toda célula preenchida termina em um bloco ou na lista de ignorados.
 */

import * as XLSX from "xlsx";

import { cpfValido, serialExcelParaPartes, somenteDigitos } from "@/lib/rf/valores";
import { normalizarTexto } from "@/lib/situacao";
import type { ClassificacaoEntrada } from "@/lib/tipos";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type AbaBlocos = "rpv" | "judicial" | "administrativa";

export const ROTULO_ABA: Record<AbaBlocos, string> = {
  rpv: "RPV E PRECATÓRIO",
  judicial: "IMPLANTAÇÃO JUDICIAL",
  administrativa: "IMPLANTAÇÃO ADMINISTRATIVA",
};

export type OrigemLancamento = "judicial" | "administrativo";

export type SituacaoLancamento =
  | "recebido"
  | "parcial"
  | "a_receber"
  | "nao_confirmado"
  | "nao_havera_cobranca"
  | "nao_havera_sucumbencia";

export const ROTULO_SITUACAO_LANCAMENTO: Record<SituacaoLancamento, string> = {
  recebido: "Recebido",
  parcial: "Parcialmente recebido",
  a_receber: "A receber",
  nao_confirmado: "Recebimento não confirmado",
  nao_havera_cobranca: "Não haverá cobrança",
  nao_havera_sucumbencia: "Não haverá sucumbência",
};

export type NaturezaLancamento =
  | "contratuais_atrasados"
  | "honorarios_acao"
  | "honorarios_atrasados_adm"
  | "sucumbencia"
  | "sucumbencia_execucao"
  | "execucao"
  | "implantacao"
  | "tutela"
  | "outro";

export const ROTULO_NATUREZA: Record<NaturezaLancamento, string> = {
  contratuais_atrasados: "Honorários contratuais sobre atrasados",
  honorarios_acao: "Honorários da ação",
  honorarios_atrasados_adm: "Honorários sobre atrasados administrativos",
  sucumbencia: "Honorários sucumbenciais",
  sucumbencia_execucao: "Sucumbência da execução",
  execucao: "Execução (natureza a conferir)",
  implantacao: "Honorários da implantação",
  tutela: "Honorários da tutela antecipada",
  outro: "Outro",
};

export interface VersaoValor {
  celula: string;
  valor: number;
}

export interface LancamentoBloco {
  /** Identificador estável dentro do arquivo: aba:linha:índice. */
  id: string;
  /** Card de destino (null = natureza não identificada → conferência). */
  categoria: ClassificacaoEntrada | null;
  natureza: NaturezaLancamento;
  /** Rótulo como está na planilha. */
  rotulo: string;
  descricao: string;
  origem: OrigemLancamento;
  /** RPV, Precatório, INSS, pagamento pelo cliente… */
  canal: string | null;
  destinatario: "escritorio" | "cliente";
  /** Valor do lançamento (honorário previsto ou recebido). null = sem valor. */
  valor: number | null;
  /** Parte efetivamente recebida (parcelas confirmadas). */
  valorRecebido: number | null;
  dataRecebimento: string | null;
  competencia: string | null;
  parcela: string | null;
  percentual: string | null;
  situacao: SituacaoLancamento;
  /** Versões do mesmo valor (a usada é `valor`). */
  versoes: VersaoValor[];
  /** Textos da mesma linha (observações aplicadas a este lançamento). */
  observacoes: string[];
  celulas: string;
  linha: number;
  conferencia: string[];
}

export interface InfoComplementar {
  rotulo: string;
  valor: number | null;
  texto: string | null;
  celula: string;
}

export interface NotaBloco {
  celula: string;
  texto: string;
}

export interface BlocoLido {
  id: string;
  aba: AbaBlocos;
  abaNome: string;
  coluna: string;
  linhaInicial: number;
  linhaFinal: number;
  nomeOriginal: string | null;
  nome: string | null;
  nomeNormalizado: string | null;
  cpf: string | null;
  cpfValido: boolean;
  tribunal: string | null;
  processo: string | null;
  processoDigitos: string | null;
  nb: string | null;
  especie: string | null;
  /** Dados do benefício (DIB, DIP, DCB, RMI, RMA, trânsito, dados bancários…). */
  beneficio: Record<string, string>;
  complementares: InfoComplementar[];
  lancamentos: LancamentoBloco[];
  notas: NotaBloco[];
  naoHaveraSucumbencia: boolean;
  conferencia: string[];
  /** Motivo quando o bloco não gera cliente (modelo vazio, sem dados…). */
  ignorado: string | null;
}

export interface CelulaIgnorada {
  aba: string;
  celula: string;
  texto: string;
  motivo: string;
}

export interface ResumoAba {
  aba: AbaBlocos;
  nome: string;
  blocos: number;
  blocosIgnorados: number;
  celulasPreenchidas: number;
}

export interface LeituraBlocos {
  abas: ResumoAba[];
  blocos: BlocoLido[];
  ignoradas: CelulaIgnorada[];
  /** Duplicidades entre abas/linhas evitadas na leitura. */
  duplicidades: { lancamento: string; igualA: string; motivo: string }[];
}

export class ErroPlanilhaBlocos extends Error {}

// ---------------------------------------------------------------------------
// Texto e valores
// ---------------------------------------------------------------------------

/** Minúsculas, sem acentos, espaços simples (mantém pontuação). */
export function simplificar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, " ")
    .trim();
}

/** Nome da aba → tipo (ignora espaços extras e acentos). */
export function tipoDaAba(nome: string): AbaBlocos | null {
  const t = simplificar(nome)
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^rpv e precatorios?$/.test(t)) return "rpv";
  if (/^implantacao judicial$/.test(t)) return "judicial";
  if (/^implantacao administrativa$/.test(t)) return "administrativa";
  return null;
}

/** O arquivo é deste modelo quando tem ao menos duas das três abas. */
export function ehModeloBlocos(nomesAbas: readonly string[]): boolean {
  return new Set(nomesAbas.map(tipoDaAba).filter(Boolean)).size >= 2;
}

const RE_MOEDA_BR = /(?:R\$\s*)?(-?\d{1,3}(?:\.\d{3})+,\d{1,2}|-?\d+,\d{1,2})(?!\d)/g;
const RE_MOEDA_SUSPEITA = /\b\d+(?:\.\d+)+,\d{2}\b|\b\d{1,3}(?:\.\d{3})*\.\d{2}\b(?![.,]\d)/;

/** Valores monetários em um texto ("R$ 1.234,56", "1.234,56", "456,24"). */
export function valoresNoTexto(texto: string): { valor: number; inicio: number; bruto: string }[] {
  const out: { valor: number; inicio: number; bruto: string }[] = [];
  for (const m of texto.matchAll(RE_MOEDA_BR)) {
    const bruto = m[1]!;
    const n = Number(bruto.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n))
      out.push({ valor: Math.round(n * 100) / 100, inicio: m.index ?? 0, bruto });
  }
  return out;
}

/** Número digitado de forma inconsistente ("64.1035,59", "4.774.32"). */
export function valorInconsistente(texto: string): string | null {
  for (const m of texto.matchAll(/\d[\d.]*,\d{2}\b|\b\d{1,3}(?:\.\d{3})*\.\d{2}\b/g)) {
    const s = m[0];
    if (s.includes(",")) {
      const inteiro = s.split(",")[0]!;
      if (inteiro.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(inteiro)) return s;
    } else if (/^\d{1,3}(\.\d{3})+\.\d{2}$/.test(s)) return s;
  }
  return RE_MOEDA_SUSPEITA.test(texto) && /\d\.\d{3}\.\d{2}(?!\d)/.test(texto)
    ? (texto.match(/\d[\d.]*\.\d{2}(?!\d)/)?.[0] ?? null)
    : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Data (dd/mm/aaaa, dd/mm/aa ou mm/aaaa) mencionada em um texto. */
export function dataNoTexto(texto: string): string | null {
  const m = texto.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    const ano = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const mes = Number(m[2]);
    const dia = Number(m[1]);
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && ano > 1990 && ano < 2100)
      return `${ano}-${pad(mes)}-${pad(dia)}`;
  }
  return null;
}

export function competenciaNoTexto(texto: string): string | null {
  const m = texto.match(/\b(\d{2})\/(\d{4})\b/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function percentualDoRotulo(texto: string): string | null {
  const t = simplificar(texto);
  const p = t.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (p) return `${p[1]!.replace(",", ".")}%`;
  if (/valor fixo/.test(t)) return "valor fixo";
  const sb = t.match(/(\d+|um|uma|dois|tres)\s+(salarios?|beneficios?)(?: de beneficio)?/);
  if (sb) return sb[0];
  if (/salario (de )?beneficio/.test(t)) return "1 salário de benefício";
  return null;
}

// ---------------------------------------------------------------------------
// Situação de recebimento a partir das observações DA MESMA LINHA
// ---------------------------------------------------------------------------

const RE_NAO_RECEBIDO =
  /(a ser(em)? recebid|a ser(em)? pag|serao pag|sera pag|a serem pag|vai receber|ira receber|irao receber|iriamos cobrar|nao cobramos|ainda nao cobr|vamos descontar|devemos descontar|descontar dos|ainda nao (foi )?pag|nao pag|nao foi pag|nao recebe(u|mos)|inadimplente|vai pagar|ira pagar|vao pagar|vai acertar|ira acertar|ficou de (pagar|acertar)|a receber|iremos cobrar|vamos cobrar|temos que cobrar|ira cobrar|vai cobrar|devemos cobrar|cobrar (o )?cliente|pendente|aguardando|ainda nao|em discussao|averiguar|verificar)/;
const RE_RECEBIDO =
  /(\bpag[oa]s?\b|\bpago!|quitad[oa]s?|ja pagou|ja recebemos|ja foi pago|ja foram pagos|\brecebid[oa]s?\b|pagou)/;
const RE_PARCIAL = /(parcelad|pagando|parcela|\d+\s*x\b|parcelou)/;
const RE_NAO_HAVERA =
  /(nao tem\b|nao ha\b|nao havera|nao consta no contrato|nao ha previsao|nao cobramos|nao iremos cobrar|nao vamos cobrar|nao sera (possivel )?cobrad|nao sera possivel cobrar)/;

export interface LeituraSituacao {
  situacao: SituacaoLancamento | null;
  valorRecebido: number | null;
  data: string | null;
  parcela: string | null;
  motivo: string | null;
}

const RE_RECEBIDO_NOTA =
  /(pagou|quitad|ja (foi|foram) pag|ja pagou|\bpago!|pagos p\/ ?escritorio|ja recebemos)/;

const numeroBR = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Parcelamento ("3X 701,24", "12x430,70", "4x R$ 1.229,49") e parcelas pagas. */
export function parcelamentoNoTexto(
  t: string,
): { vezes: number; valor: number | null; pagas: number | null } | null {
  const m = t.match(/(\d{1,2})\s*x\s*(?:de\s*)?(?:r\$\s*)?\(?(\d{1,3}(?:\.\d{3})*,\d{2})?/);
  if (!m || !/parcel|\d\s*x\s*\(?r?\$?\s*\d/.test(t)) return null;
  const ordinais: [RegExp, number][] = [
    [/(pagou|paga|pago)\s+(a\s+)?(1[aª]|primeira|uma)(?![a-z0-9])/, 1],
    [/(pagou|paga)\s+(a\s+)?(2[aª]|segunda)(?![a-z0-9])/, 2],
    [/(pagou|paga)\s+(a\s+)?(3[aª]|terceira)(?![a-z0-9])/, 3],
    [/pagou\s+(\d+)\s+parcelas?/, -1],
  ];
  let pagas: number | null = null;
  for (const [re, n] of ordinais) {
    const x = t.match(re);
    if (x) {
      pagas = n === -1 ? Number(x[1]) : n;
      break;
    }
  }
  if (/(pagou|paga) (a )?ultima|quitad/.test(t)) pagas = Number(m[1]);
  return { vezes: Number(m[1]), valor: m[2] ? numeroBR(m[2]) : null, pagas };
}

/** Interpreta observações aplicáveis a UM lançamento (`nota` = linha própria do bloco, regra mais estrita). */
export function situacaoDasObservacoes(textos: readonly string[], nota = false): LeituraSituacao {
  // "30% do valor recebido", "valor líquido recebido", "valores recebidos via tutela":
  // referem-se ao benefício do cliente, não a honorários pagos ao escritório.
  const t = simplificar(textos.join(" | "))
    .replace(/(d[oa]s?|sobre o|no|ao) valor(es)? (liquidos? |totais? )?recebid[oa]s?/g, " base ")
    .replace(
      /valor(es)? (liquidos? |totais? )?recebid[oa]s?( via tutela| no adm\w*| pelo cliente)?/g,
      " base ",
    )
    .replace(/(descontad[oa]s?|descontar|abatid[oa]) (o |os )?valor(es)? pagos?/g, " base ");
  const vazio: LeituraSituacao = {
    situacao: null,
    valorRecebido: null,
    data: null,
    parcela: null,
    motivo: null,
  };
  if (!t) return vazio;
  const parc = parcelamentoNoTexto(t);
  const parcelaTxt = parc
    ? `${parc.vezes}x${parc.valor !== null ? ` de ${parc.valor.toFixed(2).replace(".", ",")}` : ""}${parc.pagas !== null ? ` (${parc.pagas} paga${parc.pagas > 1 ? "s" : ""})` : ""}`
    : null;

  // Parcelamento com parcelas pagas informadas.
  if (parc && parc.pagas !== null) {
    const todas = parc.pagas >= parc.vezes;
    return {
      situacao: todas ? "recebido" : "parcial",
      valorRecebido:
        parc.valor !== null && !todas ? Math.round(parc.valor * parc.pagas * 100) / 100 : null,
      data: dataNoTexto(t),
      parcela: parcelaTxt,
      motivo: todas ? "Todas as parcelas pagas." : `${parc.pagas} de ${parc.vezes} parcelas pagas.`,
    };
  }

  // "pagou … R$ 1.794,10" / "pagou 1 parcela … R$ 566,00": valor recebido explícito.
  const pagouValor = t.match(/pagou[^|]*?(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/);
  if (pagouValor && !/nao pag|ainda nao/.test(t.slice(0, pagouValor.index ?? 0) + pagouValor[0])) {
    const v = numeroBR(pagouValor[1]!);
    const total = /(restante|falta|faltam|parcela|parcelas|descontar|apenas)/.test(t);
    return {
      situacao: total ? "parcial" : "recebido",
      valorRecebido: v,
      data: dataNoTexto(t),
      parcela: parcelaTxt,
      motivo: "Pagamento com valor informado na observação.",
    };
  }
  if (RE_NAO_RECEBIDO.test(t) && !/ok - pago|pago -ok|- pago|pago ok|ja pagou|quitad/.test(t))
    return {
      ...vazio,
      situacao: RE_PARCIAL.test(t) && /pagando/.test(t) ? "parcial" : "a_receber",
      parcela: parcelaTxt,
      motivo: "Observação indica pendência.",
    };
  if (nota ? RE_RECEBIDO_NOTA.test(t) : RE_RECEBIDO.test(t)) {
    if (/pagando|parcelad/.test(t))
      return {
        ...vazio,
        situacao: "parcial",
        parcela: parcelaTxt,
        motivo: "Pagamento parcelado em andamento.",
      };
    return {
      ...vazio,
      situacao: "recebido",
      data: dataNoTexto(t),
      parcela: parcelaTxt,
      motivo: "Observação confirma o recebimento.",
    };
  }
  if (RE_NAO_HAVERA.test(t))
    return {
      ...vazio,
      situacao: "nao_havera_cobranca",
      motivo: "Observação indica que não haverá cobrança.",
    };
  if (/pedido de ted|fiz pedido|cliente comunicado|ja esta recebendo|ja recebe/.test(t))
    return {
      ...vazio,
      situacao: "nao_confirmado",
      motivo: "Providência informada, sem confirmação de recebimento.",
    };
  return vazio;
}

// ---------------------------------------------------------------------------
// Nome, CPF, processo, NB
// ---------------------------------------------------------------------------

const RE_TRIBUNAL =
  /\b(TJ[A-Z]{2}|TRF\s?\d|JF[A-Z]{2}|JEF|E-SAJ|ESAJ|TJ|STJ|INSS|RJ|SP|SC|PR|RS)\b/gi;

const PALAVRAS_NAO_NOME = new Set([
  "cliente",
  "autor",
  "atrasados",
  "contratuais",
  "sucumbenciais",
  "execucao",
  "implantacao",
  "beneficio",
  "honorarios",
  "valor",
  "total",
  "obs",
  "nao",
  "ha",
  "acao",
  "pensao",
  "pago",
  "cobrar",
  "conforme",
  "verificar",
  "precatorio",
  "rpv",
  "atualizado",
  "atualizados",
  "tutela",
  "processo",
  "dados",
  "bancarios",
  "concessao",
  "somente",
  "apenas",
  "sera",
  "ira",
  "vai",
  "iremos",
  "devemos",
  "cobrei",
  "recebe",
  "recebeu",
  "contrato",
  "vendeu",
  "abrimos",
  "encaminhei",
  "solicitamos",
  "indicamos",
  "indiquei",
  "juntado",
  "juntada",
  "previsao",
  "calculo",
  "acordo",
  "dib",
  "dip",
  "der",
  "desde",
  "ate",
  "ja",
  "esta",
  "recebendo",
  "mes",
  "no",
  "na",
  "valores",
  "recebeu",
  "prescricao",
  "cobramos",
  "cobrar",
  "falei",
  "verifiquei",
  "lu",
  "colega",
  "obs",
]);

export interface NomeExtraido {
  nome: string | null;
  original: string | null;
  cpf: string | null;
  tribunal: string | null;
}

/** Separa nome, CPF e tribunal de um texto ("NOME - TJRS", "Nome   CPF: 000…"). */
export function extrairNome(texto: string): NomeExtraido {
  let t = texto
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cpfM = t.match(/cpf\s*(?:n[º°o]\.?)?\s*:?\s*([\d.\-/]{11,18})/i);
  const cpf = cpfM ? cpfM[1]!.trim() : null;
  if (cpfM) t = (t.slice(0, cpfM.index) + t.slice((cpfM.index ?? 0) + cpfM[0].length)).trim();
  t = t
    .replace(/^(cliente|autor|atrasados)\s*:\s*/i, "")
    .replace(/\bcpf\b\s*(n[º°o]\.?)?\s*:?/gi, " ");
  const tribunais: string[] = [];
  // Qualificadores: "2ª CONCESSÃO", "1ª", "- TUTELA".
  t = t.replace(/\b\d+\s*[ªºa°]\s*(concess\S*|presta\S*|tutela|vez)?/gi, (m) => {
    tribunais.push(m.trim());
    return " ";
  });
  t = t.replace(/\((?:[^)]*)\)/g, (m) => {
    const dentro = m.replace(/[()]/g, "").trim();
    if (linhaSoTribunal(dentro)) tribunais.push(dentro);
    return " ";
  });
  if (/\d{2,}/.test(t.replace(RE_TRIBUNAL, " ")))
    return {
      nome: null,
      original: null,
      cpf: cpf && somenteDigitos(cpf).length === 11 ? cpf : null,
      tribunal: null,
    };
  // Segmentos após " - " que não são nome (tribunal, TUTELA, observações curtas).
  const partes = t.split(/\s+-\s+/);
  const nomeParte = partes.shift() ?? "";
  for (const p of partes)
    if (linhaSoTribunal(p) || /^tutela$/i.test(p.trim())) tribunais.push(p.trim());
  let nome = nomeParte.replace(RE_TRIBUNAL, (m) => {
    tribunais.push(m);
    return " ";
  });
  nome = nome
    .replace(/\b\d+(ª|º|a|o)?\b/g, " ")
    .replace(/[^A-Za-zÀ-ÿ'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const palavras = nome.split(" ").filter(Boolean);
  const ok =
    palavras.length >= 2 &&
    palavras.length <= 8 &&
    palavras.every((p) => p.length >= 1) &&
    !palavras.some((p) => PALAVRAS_NAO_NOME.has(normalizarTexto(p)));
  return {
    nome: ok ? palavras.join(" ") : null,
    original: ok ? texto.replace(/\s+/g, " ").trim() : null,
    cpf: cpf && somenteDigitos(cpf).length === 11 ? cpf : null,
    tribunal: tribunais.filter(Boolean).join(" · ") || null,
  };
}

/** Número de processo (CNJ) em um texto. */
export function processoNoTexto(texto: string): string | null {
  const m =
    texto.match(/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/) ?? texto.match(/(?<!\d)\d{20}(?!\d)/);
  return m ? m[0] : null;
}

export function nbNoTexto(texto: string): string | null {
  const m = texto.match(/\bNB\s*:?\s*(\d[\d.-]{8,14}\d)/i);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------
// Grade de células
// ---------------------------------------------------------------------------

interface Celula {
  ref: string;
  r: number;
  c: number;
  texto: string | null;
  numero: number | null;
  /** Data do Excel (AAAA-MM-DD). */
  data: string | null;
  formula: boolean;
}

function lerCelula(ws: XLSX.WorkSheet, r: number, c: number): Celula | null {
  const ref = XLSX.utils.encode_cell({ r, c });
  const cel = ws[ref] as (XLSX.CellObject & { f?: string }) | undefined;
  if (!cel || cel.v === undefined || cel.v === null) return null;
  const formula = Boolean(cel.f);
  if (cel.t === "n" && typeof cel.v === "number") {
    const z = String(cel.z ?? "");
    if (/[dy]/i.test(z) && !/[#0]/.test(z)) {
      const p = serialExcelParaPartes(cel.v);
      return {
        ref,
        r,
        c,
        texto: null,
        numero: null,
        data: `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`,
        formula,
      };
    }
    // Ano isolado (2024, 2027…) é informação, não valor.
    if (Number.isInteger(cel.v) && cel.v >= 1990 && cel.v <= 2100 && !/[#0]/.test(z))
      return { ref, r, c, texto: String(cel.v), numero: null, data: null, formula };
    return { ref, r, c, texto: null, numero: Math.round(cel.v * 100) / 100, data: null, formula };
  }
  const texto = String(cel.w ?? cel.v)
    .replace(/\u00a0/g, " ")
    .trim();
  if (!texto) return null;
  return { ref, r, c, texto, numero: null, data: null, formula };
}

interface Linha {
  r: number;
  /** Célula do rótulo (primeira preenchida da faixa). */
  rotulo: Celula | null;
  /** Demais células da linha na faixa. */
  resto: Celula[];
}

// ---------------------------------------------------------------------------
// Classificação das linhas
// ---------------------------------------------------------------------------

type TipoRotulo =
  | "valor_total"
  | "atrasados"
  | "autor"
  | "contratuais"
  | "sucumbenciais"
  | "sucumb_execucao"
  | "execucao"
  | "implantacao"
  | "tutela"
  | "total"
  | "repasse"
  | "honorarios"
  | "beneficio"
  | "processo"
  | "info"
  | "cliente_nome";

const INFO_BENEFICIO: [RegExp, string][] = [
  [/^nb\b/, "NB"],
  [/^dib\b/, "DIB"],
  [/^dip\b/, "DIP"],
  [/^dcb\b/, "DCB"],
  [/^rmi\b/, "RMI"],
  [/^rma\b/, "RMA"],
  [/^transito/, "Trânsito em julgado"],
  [/^previsao/, "Previsão de pagamento"],
  [/^dados bancarios/, "Dados bancários"],
  [/^comunicar/, "Comunicar cliente"],
  [/^cobrar cliente/, "Cobrar cliente"],
  [/^solicitar dados/, "Solicitar dados"],
  [/^forma de pagamento/, "Forma de pagamento"],
  [/^pedir prorrogacao/, "Pedir prorrogação"],
  [/^valores a receber/, "Valores a receber (benefício)"],
  [/^atrasados (adm|judicial)/, "Atrasados"],
  [/^data do requerimento/, "Data do requerimento"],
];

function tipoDoRotulo(texto: string, aba: AbaBlocos): { tipo: TipoRotulo; chave?: string } | null {
  const t = simplificar(texto);
  if (/^valor total\b/.test(t)) return { tipo: "valor_total" };
  if (/^valor repasse/.test(t)) return { tipo: "repasse" };
  if (/^total\s*:/.test(t)) return { tipo: "total" };
  if (/^sucumbenciais?\s+(da\s+)?execucao/.test(t)) return { tipo: "sucumb_execucao" };
  if (/^sucumbenciais?\b/.test(t)) return { tipo: "sucumbenciais" };
  if (/^execucao\b/.test(t)) return { tipo: "execucao" };
  if (/^contratuais?\b/.test(t)) return { tipo: "contratuais" };
  if (/^implantacao\s*:/.test(t) || /^implantacao\s*\(/.test(t)) return { tipo: "implantacao" };
  if (
    /^(ha )?honorarios (da|de) implantacao|^honorarios implantacao|^valor honorarios (da )?implantacao|^valor implantacao|^ha honorarios da implantacao/.test(
      t,
    )
  )
    return { tipo: "implantacao" };
  if (/^honorarios\s*-?\s*tutela/.test(t)) return { tipo: "tutela" };
  if (/^(valor )?honorarios da acao|^valor honorarios da acao/.test(t))
    return { tipo: "honorarios", chave: "acao" };
  if (/^honorarios atrasados/.test(t)) return { tipo: "honorarios", chave: "atrasados" };
  if (/^(valor )?honorarios\b/.test(t)) return { tipo: "honorarios", chave: "geral" };
  if (/^beneficio\b/.test(t)) return { tipo: "beneficio" };
  if (/^processo\b/.test(t)) return { tipo: "processo" };
  if (/^atrasados\b/.test(t)) {
    if (aba !== "rpv" && /^atrasados (adm|judicial)/.test(t))
      return { tipo: "info", chave: "Atrasados" };
    return { tipo: "atrasados" };
  }
  if (/^autor\b/.test(t)) return { tipo: "autor" };
  if (/^cliente\s*:/.test(t)) return { tipo: "cliente_nome" };
  for (const [re, chave] of INFO_BENEFICIO) if (re.test(t)) return { tipo: "info", chave };
  return null;
}

// ---------------------------------------------------------------------------
// Leitura principal
// ---------------------------------------------------------------------------

export function lerPlanilhaBlocos(dados: ArrayBuffer | Uint8Array): LeituraBlocos {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(dados, { type: "array", cellNF: true, cellText: true, cellFormula: true });
  } catch {
    throw new ErroPlanilhaBlocos(
      "Não foi possível ler o arquivo. Envie uma planilha Excel (.xlsx).",
    );
  }
  return lerWorkbookBlocos(wb);
}

export function lerWorkbookBlocos(wb: XLSX.WorkBook): LeituraBlocos {
  const abas: ResumoAba[] = [];
  const blocos: BlocoLido[] = [];
  const ignoradas: CelulaIgnorada[] = [];
  for (const nome of wb.SheetNames) {
    const aba = tipoDaAba(nome);
    const ws = wb.Sheets[nome];
    if (!aba || !ws || !ws["!ref"]) continue;
    const r = lerAba(ws, aba, nome.trim());
    abas.push({
      aba,
      nome: nome.trim(),
      blocos: r.blocos.filter((b) => !b.ignorado).length,
      blocosIgnorados: r.blocos.filter((b) => b.ignorado).length,
      celulasPreenchidas: r.preenchidas,
    });
    blocos.push(...r.blocos);
    ignoradas.push(...r.ignoradas);
  }
  if (!abas.length)
    throw new ErroPlanilhaBlocos(
      'Nenhuma das abas "RPV E PRECATÓRIO", "IMPLANTAÇÃO JUDICIAL" ou "IMPLANTAÇÃO ADMINISTRATIVA" foi encontrada.',
    );
  const duplicidades = removerDuplicidades(blocos);
  return { abas, blocos, ignoradas, duplicidades };
}

function lerAba(ws: XLSX.WorkSheet, aba: AbaBlocos, abaNome: string) {
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  const grade = new Map<string, Celula>();
  let preenchidas = 0;
  for (let r = range.s.r; r <= range.e.r; r++)
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cel = lerCelula(ws, r, c);
      if (cel) {
        grade.set(`${r}:${c}`, cel);
        preenchidas++;
      }
    }
  const ignoradas: CelulaIgnorada[] = [];
  const usadas = new Set<string>();
  const marcar = (cel: Celula) => usadas.add(`${cel.r}:${cel.c}`);
  const ignorar = (cel: Celula, motivo: string) => {
    if (usadas.has(`${cel.r}:${cel.c}`)) return;
    marcar(cel);
    ignoradas.push({
      aba: abaNome,
      celula: cel.ref,
      texto: cel.texto ?? (cel.numero !== null ? String(cel.numero) : (cel.data ?? "")),
      motivo,
    });
  };

  // Totais gerais da aba: rótulo em coluna à direita seguido de fórmula SUM.
  for (const cel of grade.values())
    if (cel.formula) {
      ignorar(cel, "Fórmula de soma/total (não vira pagamento)");
      // Rótulo do total geral ao lado ("CONTRATUAIS :" | =SUM(...)) e o ano do quadro.
      const esq = grade.get(`${cel.r}:${cel.c - 1}`);
      if (esq?.texto && cel.c - 1 > range.s.c + 2)
        ignorar(esq, "Rótulo de total geral da planilha");
    }
  for (const cel of grade.values()) {
    const abaixo = grade.get(`${cel.r + 1}:${cel.c + 1}`);
    if (
      cel.c > range.s.c + 2 &&
      cel.texto &&
      /^\d{4}$/.test(cel.texto) &&
      abaixo?.formula === false &&
      grade.get(`${cel.r + 1}:${cel.c}`)?.texto
    )
      ignorar(cel, "Ano do quadro de totais");
  }

  // Faixas paralelas: colunas (além da A) onde começa outro bloco "CLIENTE:" com dados de benefício.
  const faixas: { c: number; r0: number; r1: number }[] = [];
  for (const cel of grade.values()) {
    if (cel.c === range.s.c || !cel.texto || !/^cliente\s*:/i.test(cel.texto)) continue;
    let r1 = cel.r;
    let rotulos = 0;
    while (grade.get(`${r1 + 1}:${cel.c}`)) {
      r1++;
      const t = grade.get(`${r1}:${cel.c}`)!.texto ?? "";
      if (/^(benef|dib|dip|rmi|rma|nb|atrasados|honor|valor)/i.test(simplificar(t))) rotulos++;
    }
    if (rotulos >= 2) faixas.push({ c: cel.c, r0: cel.r, r1 });
  }

  const blocos: BlocoLido[] = [];
  const reservadas = new Set<string>();
  const montarLinhas = (
    c0: number,
    r0: number,
    r1: number,
    cMax: (r: number) => number,
  ): Linha[] => {
    const linhas: Linha[] = [];
    for (let r = r0; r <= r1; r++) {
      const celulas: Celula[] = [];
      for (let c = c0; c <= cMax(r); c++) {
        const cel = grade.get(`${r}:${c}`);
        if (cel && !usadas.has(`${r}:${c}`) && !reservadas.has(`${r}:${c}`)) celulas.push(cel);
      }
      if (!celulas.length) {
        linhas.push({ r, rotulo: null, resto: [] });
        continue;
      }
      const [primeira, ...resto] = celulas;
      linhas.push(
        primeira!.c === c0 && primeira!.texto
          ? { r, rotulo: primeira!, resto }
          : { r, rotulo: null, resto: celulas },
      );
    }
    return linhas;
  };

  for (const f of faixas) {
    const linhas = montarLinhas(f.c, f.r0, f.r1, () => range.e.c);
    for (const l of linhas)
      for (const cel of [l.rotulo, ...l.resto]) if (cel) reservadas.add(`${cel.r}:${cel.c}`);
    blocos.push(...segmentar(linhas, aba, abaNome, XLSX.utils.encode_col(f.c), ignorar, marcar));
  }
  const principais = montarLinhas(range.s.c, range.s.r, range.e.r, (r) => {
    const f = faixas.find((x) => r >= x.r0 && r <= x.r1);
    return f ? f.c - 1 : range.e.c;
  });
  blocos.push(
    ...segmentar(principais, aba, abaNome, XLSX.utils.encode_col(range.s.c), ignorar, marcar),
  );

  // Qualquer célula preenchida não usada vai para o relatório.
  for (const cel of grade.values())
    if (!usadas.has(`${cel.r}:${cel.c}`)) ignorar(cel, "Célula fora de bloco identificado");

  return { blocos, ignoradas, preenchidas };
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

interface BlocoEmMontagem {
  linhas: Linha[];
  temValores: boolean;
  temNome: boolean;
  temBeneficio: boolean;
}

const ABRE_BLOCO: TipoRotulo[] = ["valor_total", "atrasados"];
const DE_VALOR: TipoRotulo[] = [
  "valor_total",
  "atrasados",
  "autor",
  "contratuais",
  "sucumbenciais",
  "sucumb_execucao",
  "execucao",
  "implantacao",
];

function linhaSoTribunal(texto: string): boolean {
  const t = texto.replace(RE_TRIBUNAL, " ").replace(/[-()\s]/g, "");
  return t.length === 0;
}

function ehNomeSolto(texto: string): boolean {
  const t = texto.replace(/[\r\n]+/g, " ").trim();
  if (t.length > 90 || /[!?:]$/.test(t) || /\.\.\./.test(t)) return false;
  if (/:/.test(t) && !/cpf\s*:/i.test(t)) return false;
  const e = extrairNome(t);
  if (!e.nome) return false;
  // Nome em maiúsculas (ou "Nome Próprio") — notas costumam ter verbos e minúsculas.
  const letras = e.nome.replace(/[^A-Za-zÀ-ÿ]/g, "");
  const maiusculas = letras.replace(/[^A-ZÀ-Þ]/g, "").length / Math.max(1, letras.length);
  const capitalizado = e.nome
    .split(" ")
    .filter((p) => p.length > 3)
    .every((p) => /^[A-ZÀ-Þ]/.test(p));
  return maiusculas > 0.8 || capitalizado;
}

function segmentar(
  linhas: Linha[],
  aba: AbaBlocos,
  abaNome: string,
  coluna: string,
  ignorar: (c: Celula, motivo: string) => void,
  marcar: (c: Celula) => void,
): BlocoLido[] {
  const montados: BlocoEmMontagem[] = [];
  let atual: BlocoEmMontagem | null = null;
  let pendentesTribunal: Linha[] = [];
  const novo = () => {
    atual = { linhas: [], temValores: false, temNome: false, temBeneficio: false };
    montados.push(atual);
    if (pendentesTribunal.length) {
      atual.linhas.push(...pendentesTribunal);
      pendentesTribunal = [];
    }
    return atual;
  };

  for (const l of linhas) {
    if (!l.rotulo && !l.resto.length) {
      atual = null; // linha em branco: encerra o bloco
      continue;
    }
    if (!l.rotulo) {
      // Linha sem rótulo: valores soltos (somas) ou observação deslocada.
      const textos = l.resto.filter((c) => c.texto && !c.formula);
      if (!textos.length) {
        for (const c of l.resto) ignorar(c, "Valor sem rótulo (soma ou cálculo auxiliar)");
        continue;
      }
      (atual ?? novo()).linhas.push(l);
      continue;
    }
    const texto = l.rotulo.texto ?? "";
    // Separadores: ano isolado, título de seção.
    if (/^\d{4}$/.test(texto.trim())) {
      ignorar(l.rotulo, "Separador (ano)");
      for (const c of l.resto) ignorar(c, "Separador (ano)");
      continue;
    }
    const tipo = tipoDoRotulo(texto, aba);
    const temNumero =
      l.resto.some((c) => c.numero !== null && !c.formula) || valoresNoTexto(texto).length > 0;
    let b: BlocoEmMontagem | null = atual;

    if (linhaSoTribunal(texto) && !tipo) {
      pendentesTribunal.push(l);
      continue;
    }
    if (tipo && ABRE_BLOCO.includes(tipo.tipo)) {
      if (!b || b.temValores) b = novo();
    } else if (tipo?.tipo === "cliente_nome") {
      const nomeAqui = extrairNome(texto).nome;
      // Outro nome em bloco que já tem nome = novo cliente; "CLIENTE: NOME" sem valor
      // logo após "ATRASADOS:" continua sendo o mesmo bloco.
      if (!b || (nomeAqui && b.temNome)) b = novo();
    } else if (tipo?.tipo === "beneficio") {
      if (!b || b.temBeneficio) b = novo();
    } else if (!tipo && ehNomeSolto(texto)) {
      const comValor = temNumero;
      if (comValor && b && b.temValores && !b.temNome) {
        // "ELIA NUNES | 9.636,06" na posição do valor do autor.
      } else if (!b || b.temNome || b.temValores || b.temBeneficio) b = novo();
    } else if (!b) b = novo();

    b = b ?? novo();
    if (pendentesTribunal.length) {
      b.linhas.push(...pendentesTribunal);
      pendentesTribunal = [];
    }
    b.linhas.push(l);
    if (tipo && DE_VALOR.includes(tipo.tipo)) b.temValores = true;
    if (tipo?.tipo === "beneficio") b.temBeneficio = true;
    if (
      (tipo?.tipo === "cliente_nome" || tipo?.tipo === "atrasados" || tipo?.tipo === "autor") &&
      extrairNome(texto).nome
    )
      b.temNome = true;
    if (!tipo && ehNomeSolto(texto)) b.temNome = true;
    atual = b;
  }
  for (const l of pendentesTribunal)
    for (const c of [l.rotulo, ...l.resto]) if (c) ignorar(c, "Tribunal sem bloco");

  return montados.map((m, i) => interpretarBloco(m, aba, abaNome, coluna, i, ignorar, marcar));
}

// ---------------------------------------------------------------------------
// Interpretação de um bloco
// ---------------------------------------------------------------------------

function escolherVersao(
  rotuloValores: { valor: number; celula: string }[],
  numeros: Celula[],
): { valor: number | null; versoes: VersaoValor[]; ambiguo: boolean } {
  const todos: VersaoValor[] = [
    ...rotuloValores.map((v) => ({ celula: v.celula, valor: v.valor })),
    ...numeros
      .filter((c) => c.numero !== null && !c.formula)
      .map((c) => ({ celula: c.ref, valor: c.numero! })),
  ];
  if (!todos.length) return { valor: null, versoes: [], ambiguo: false };
  const base = todos.find((v) => v.valor !== 0) ?? todos[0]!;
  if (todos.length === 1) return { valor: base.valor, versoes: [], ambiguo: false };
  // Última versão de mesma ordem de grandeza (descarta diferenças e somas).
  const compativeis = todos.filter(
    (v) => base.valor === 0 || (v.valor >= base.valor * 0.6 && v.valor <= base.valor * 1.6),
  );
  const escolhido = compativeis[compativeis.length - 1] ?? base;
  return {
    valor: escolhido.valor,
    versoes: todos.filter((v) => v !== escolhido),
    ambiguo: true,
  };
}

function interpretarBloco(
  m: BlocoEmMontagem,
  aba: AbaBlocos,
  abaNome: string,
  coluna: string,
  indice: number,
  ignorar: (c: Celula, motivo: string) => void,
  marcar: (c: Celula) => void,
): BlocoLido {
  const linhasNum = m.linhas.map((l) => l.r + 1);
  const bloco: BlocoLido = {
    id: `${aba}:${coluna}${linhasNum[0] ?? 0}:${indice}`,
    aba,
    abaNome,
    coluna,
    linhaInicial: Math.min(...linhasNum),
    linhaFinal: Math.max(...linhasNum),
    nomeOriginal: null,
    nome: null,
    nomeNormalizado: null,
    cpf: null,
    cpfValido: false,
    tribunal: null,
    processo: null,
    processoDigitos: null,
    nb: null,
    especie: null,
    beneficio: {},
    complementares: [],
    lancamentos: [],
    notas: [],
    naoHaveraSucumbencia: false,
    conferencia: [],
    ignorado: null,
  };
  const origem: OrigemLancamento = aba === "administrativa" ? "administrativo" : "judicial";
  const textoBloco = simplificar(
    m.linhas
      .flatMap((l) => [l.rotulo?.texto ?? "", ...l.resto.map((c) => c.texto ?? "")])
      .join(" "),
  );
  const canalPadrao =
    aba === "rpv"
      ? /precat/.test(textoBloco)
        ? "Precatório"
        : /\brpv\b/.test(textoBloco)
          ? "RPV"
          : "RPV/Precatório"
      : "Pagamento pelo cliente";
  const tribunais: string[] = [];

  const definirNome = (texto: string, forcar = false) => {
    const e = extrairNome(texto);
    if (e.tribunal) tribunais.push(e.tribunal);
    if (e.cpf && !bloco.cpf) {
      bloco.cpf = e.cpf;
      bloco.cpfValido = cpfValido(somenteDigitos(e.cpf));
    }
    if (!e.nome) return;
    if (!bloco.nome || forcar) {
      bloco.nome = e.nome;
      bloco.nomeOriginal = e.original;
      bloco.nomeNormalizado = normalizarTexto(e.nome);
    } else if (normalizarTexto(e.nome) !== bloco.nomeNormalizado) {
      bloco.conferencia.push(`Dois nomes no mesmo bloco: "${bloco.nome}" e "${e.nome}".`);
    }
  };

  const textosDaLinha = (l: Linha) =>
    l.resto.filter((c) => c.texto && !c.formula).map((c) => c.texto!);
  const celulasRef = (l: Linha) =>
    [l.rotulo, ...l.resto]
      .filter(Boolean)
      .map((c) => c!.ref)
      .join(", ");

  const lancar = (
    l: Linha,
    categoria: ClassificacaoEntrada | null,
    natureza: NaturezaLancamento,
    valores: { valor: number | null; versoes: VersaoValor[]; ambiguo: boolean },
    extra: Partial<LancamentoBloco> = {},
  ) => {
    const rotulo = (l.rotulo?.texto ?? "").replace(/\s+/g, " ").trim();
    const obs = [...textosDaLinha(l)];
    // Texto após o valor no próprio rótulo ("SUCUMBENCIAIS (10%): NÃO TEM").
    const resto = rotulo
      .split(/[:=]/)
      .slice(1)
      .join(" ")
      .replace(RE_MOEDA_BR, " ")
      .replace(/r\$/gi, " ")
      .replace(/[()*]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (resto && /[a-zA-Z]{3,}/.test(resto) && !extrairNome(resto).nome) obs.unshift(resto);
    const sit = situacaoDasObservacoes(obs);
    const conferencia: string[] = [];
    if (valores.ambiguo)
      conferencia.push(
        `Linha com ${valores.versoes.length + 1} valores: usado o mais recente (${fmt(valores.valor)}); confira as versões.`,
      );
    if (categoria === null) conferencia.push("Natureza do valor não identificada com segurança.");
    const inconsistente = valorInconsistente(
      [rotulo, ...obs, ...l.resto.map((c) => c.texto ?? "")].join(" "),
    );
    if (inconsistente)
      conferencia.push(`Valor digitado de forma inconsistente: "${inconsistente}".`);

    let situacao: SituacaoLancamento = sit.situacao ?? "a_receber";
    if (sit.situacao === "nao_havera_cobranca" && natureza.startsWith("sucumbencia"))
      situacao = "nao_havera_sucumbencia";
    if (!sit.situacao && /fiz pedido|pedido de ted/.test(simplificar(obs.join(" "))))
      situacao = "nao_confirmado";
    let valorRecebido: number | null = null;
    if (situacao === "recebido") valorRecebido = sit.valorRecebido ?? valores.valor;
    if (situacao === "parcial") valorRecebido = sit.valorRecebido;
    if (situacao === "recebido" && valores.valor === null && sit.valorRecebido === null) {
      situacao = "nao_confirmado";
      conferencia.push("Observação de pagamento sem valor identificado.");
    }
    bloco.lancamentos.push({
      id: `${aba}:${l.r + 1}:${bloco.lancamentos.length}`,
      categoria,
      natureza,
      rotulo,
      descricao: ROTULO_NATUREZA[natureza],
      origem,
      canal: canalPadrao,
      destinatario: "escritorio",
      valor: valores.valor,
      valorRecebido,
      dataRecebimento: sit.data,
      competencia: competenciaNoTexto(obs.join(" ")),
      parcela: sit.parcela,
      percentual: percentualDoRotulo(rotulo),
      situacao,
      versoes: valores.versoes,
      observacoes: obs,
      celulas: celulasRef(l),
      linha: l.r + 1,
      conferencia,
      ...extra,
    });
  };

  const valoresDaLinha = (l: Linha) => {
    const texto = l.rotulo?.texto ?? "";
    const noRotulo = valoresNoTexto(texto).map((v) => ({ valor: v.valor, celula: l.rotulo!.ref }));
    return escolherVersao(noRotulo, l.resto);
  };

  for (const l of m.linhas) {
    if (!l.rotulo) {
      for (const c of l.resto) if (c.texto) bloco.notas.push({ celula: c.ref, texto: c.texto });
      continue;
    }
    const texto = l.rotulo.texto ?? "";
    const tipo = tipoDoRotulo(texto, aba);
    const t = simplificar(texto);

    if (!tipo) {
      if (linhaSoTribunal(texto)) {
        tribunais.push(texto.trim());
        continue;
      }
      if (ehNomeSolto(texto)) {
        definirNome(texto);
        const v = valoresDaLinha(l);
        if (v.valor !== null)
          bloco.complementares.push({
            rotulo: "Valor do autor",
            valor: v.valor,
            texto: null,
            celula: l.rotulo.ref,
          });
        for (const c of l.resto) if (c.texto) bloco.notas.push({ celula: c.ref, texto: c.texto });
        continue;
      }
      // Observação livre (pode trazer processo, NB, CPF).
      bloco.notas.push({ celula: l.rotulo.ref, texto });
      for (const c of l.resto)
        if (c.texto) bloco.notas.push({ celula: c.ref, texto: c.texto });
        else if (c.numero !== null && !c.formula)
          bloco.complementares.push({
            rotulo: `Valor ao lado de observação`,
            valor: c.numero,
            texto: null,
            celula: c.ref,
          });
      continue;
    }

    switch (tipo.tipo) {
      case "cliente_nome":
      case "autor": {
        definirNome(texto);
        const v = valoresDaLinha(l);
        if (v.valor !== null)
          bloco.complementares.push({
            rotulo: "Valor destinado ao autor",
            valor: v.valor,
            texto: v.versoes.length
              ? `outras versões: ${v.versoes.map((x) => fmt(x.valor)).join(", ")}`
              : null,
            celula: celulasRef(l),
          });
        for (const c of l.resto) if (c.texto) bloco.notas.push({ celula: c.ref, texto: c.texto });
        break;
      }
      case "valor_total":
      case "atrasados": {
        definirNome(texto);
        const v = valoresDaLinha(l);
        if (aba !== "rpv" && v.valor === null) {
          bloco.beneficio["Atrasados"] = texto.split(":").slice(1).join(":").trim();
          break;
        }
        if (v.valor === null) {
          const resto = texto.split(":").slice(1).join(":").trim();
          if (resto && !extrairNome(texto).nome) bloco.beneficio["Atrasados"] = resto;
          for (const c of l.resto) if (c.texto) bloco.notas.push({ celula: c.ref, texto: c.texto });
          break;
        }
        bloco.complementares.push({
          rotulo: "Valor bruto dos atrasados",
          valor: v.valor,
          texto: v.versoes.length
            ? `outras versões: ${v.versoes.map((x) => fmt(x.valor)).join(", ")}`
            : null,
          celula: celulasRef(l),
        });
        for (const c of l.resto) if (c.texto) bloco.notas.push({ celula: c.ref, texto: c.texto });
        break;
      }
      case "repasse":
      case "total": {
        const v = valoresDaLinha(l);
        bloco.complementares.push({
          rotulo:
            tipo.tipo === "total"
              ? "Total da planilha (subtotal — não somado)"
              : "Repasse ao cliente",
          valor: v.valor,
          texto: null,
          celula: celulasRef(l),
        });
        break;
      }
      case "contratuais": {
        const v = valoresDaLinha(l);
        if (v.valor === null || v.valor === 0) {
          registrarSemValor(l, "atrasados", "contratuais_atrasados");
          break;
        }
        lancar(l, "atrasados", "contratuais_atrasados", v);
        break;
      }
      case "sucumbenciais":
      case "sucumb_execucao": {
        const natureza = tipo.tipo === "sucumb_execucao" ? "sucumbencia_execucao" : "sucumbencia";
        const v = valoresDaLinha(l);
        if (v.valor === null || v.valor === 0) {
          registrarSemValor(l, "sucumbencia", natureza);
          break;
        }
        lancar(l, "sucumbencia", natureza, v);
        break;
      }
      case "execucao": {
        const v = valoresDaLinha(l);
        if (v.valor === null || v.valor === 0) {
          registrarSemValor(l, null, "execucao");
          break;
        }
        lancar(l, null, "execucao", v);
        break;
      }
      case "implantacao":
      case "tutela": {
        const natureza = tipo.tipo === "tutela" ? "tutela" : "implantacao";
        const v = aba === "rpv" ? valoresDaLinha(l) : valorDeHonorario(texto, l);
        if (v.valor === null || v.valor === 0) {
          registrarSemValor(l, "implantacao", natureza);
          break;
        }
        lancar(
          l,
          "implantacao",
          natureza,
          v,
          aba === "rpv" ? { canal: "Pagamento pelo cliente" } : {},
        );
        break;
      }
      case "honorarios": {
        const v = valorDeHonorario(texto, l);
        const cat: ClassificacaoEntrada =
          tipo.chave === "geral" && aba !== "rpv" ? "implantacao" : "atrasados";
        const natureza: NaturezaLancamento =
          tipo.chave === "acao"
            ? "honorarios_acao"
            : tipo.chave === "atrasados"
              ? aba === "administrativa"
                ? "honorarios_atrasados_adm"
                : "contratuais_atrasados"
              : "implantacao";
        // "3 benefícios (4.863,00) + 30% (3.600,00) = R$ 8.463,00": separa os componentes.
        const comp = t.match(
          /(\d+|um|uma|1)\s*\(?\w*\)?\s*(?:beneficios?|ben|salarios?[- ]?(?:de )?(?:beneficio|minimo)?)[^(]*\((?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})\)\s*\+\s*(\d+)\s*%\s*\((?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})\)/,
        );
        if (comp && aba !== "rpv") {
          const vImpl = numeroBR(comp[2]!);
          const vPct = numeroBR(comp[4]!);
          const aviso = `Separado do total composto "${texto.replace(/\s+/g, " ").trim().slice(0, 120)}".`;
          lancar(l, "implantacao", "implantacao", { valor: vImpl, versoes: [], ambiguo: false });
          bloco.lancamentos[bloco.lancamentos.length - 1]!.conferencia.push(aviso);
          lancar(
            l,
            "atrasados",
            aba === "administrativa" ? "honorarios_atrasados_adm" : "honorarios_acao",
            { valor: vPct, versoes: [], ambiguo: false },
            { percentual: `${comp[3]}%` },
          );
          const ult = bloco.lancamentos[bloco.lancamentos.length - 1]!;
          ult.id += "b";
          ult.conferencia.push(aviso);
          if (
            v.valor !== null &&
            Math.abs(v.valor - vImpl - vPct) > 1 &&
            Math.abs(v.valor - vImpl) > 1
          )
            bloco.conferencia.push(
              `Total de honorários ${fmt(v.valor)} difere da soma dos componentes (${fmt(vImpl + vPct)}).`,
            );
          break;
        }
        if (/implantacao\s*\+\s*atrasados|total (devido )?dos? honorarios/.test(t)) {
          bloco.complementares.push({
            rotulo: "Total composto de honorários (não somado)",
            valor: v.valor,
            texto,
            celula: celulasRef(l),
          });
          break;
        }
        if (v.valor === null || v.valor === 0) {
          // "HONORÁRIOS: somente 30%" — regra de cobrança, não valor.
          if (RE_NAO_HAVERA.test(t)) registrarSemValor(l, cat, natureza);
          else
            bloco.beneficio[tipo.chave === "acao" ? "Honorários da ação" : "Honorários (regra)"] =
              texto.split(/[:=]/).slice(1).join(":").trim();
          break;
        }
        lancar(l, tipo.chave === "geral" && aba === "rpv" ? null : cat, natureza, v);
        break;
      }
      case "beneficio": {
        const valor = texto.split(":").slice(1).join(":").trim();
        bloco.especie = valor.replace(/\bNB\b.*$/i, "").trim() || null;
        bloco.beneficio["Benefício"] = valor;
        const nb = nbNoTexto(texto);
        if (nb) bloco.nb = nb;
        for (const c of l.resto) if (c.texto) bloco.notas.push({ celula: c.ref, texto: c.texto });
        break;
      }
      case "processo": {
        const p = processoNoTexto(texto.replace(/\s/g, ""));
        if (p) bloco.processo = p;
        else bloco.beneficio["Processo"] = texto;
        break;
      }
      case "info": {
        const chave = tipo.chave ?? "Info";
        const valor = texto.split(/:/).slice(1).join(":").trim();
        bloco.beneficio[chave] = [bloco.beneficio[chave], valor].filter(Boolean).join(" | ");
        const nb = nbNoTexto(texto);
        if (nb) bloco.nb = bloco.nb ?? nb;
        const cpf = texto.match(/cpf\s*:?\s*([\d.-]{11,14})/i);
        if (cpf && !bloco.cpf) {
          bloco.cpf = cpf[1]!;
          bloco.cpfValido = cpfValido(somenteDigitos(cpf[1]!));
        }
        for (const c of l.resto)
          if (c.texto) bloco.notas.push({ celula: c.ref, texto: c.texto });
          else if (c.numero !== null && !c.formula)
            bloco.complementares.push({
              rotulo: chave,
              valor: c.numero,
              texto: null,
              celula: c.ref,
            });
        break;
      }
    }
  }

  function registrarSemValor(
    l: Linha,
    categoria: ClassificacaoEntrada | null,
    natureza: NaturezaLancamento,
  ) {
    const rotulo = (l.rotulo?.texto ?? "").trim();
    const obs = [rotulo.split(":").slice(1).join(":").trim(), ...textosDaLinha(l)].filter(Boolean);
    const sit = situacaoDasObservacoes(obs);
    const t = simplificar(obs.join(" "));
    // Indicação EXPRESSA (campo vazio ou zero não autoriza).
    if (RE_NAO_HAVERA.test(t)) {
      if (natureza.startsWith("sucumbencia")) bloco.naoHaveraSucumbencia = true;
      bloco.lancamentos.push({
        id: `${aba}:${l.r + 1}:${bloco.lancamentos.length}`,
        categoria,
        natureza,
        rotulo,
        descricao: ROTULO_NATUREZA[natureza],
        origem,
        canal: null,
        destinatario: "escritorio",
        valor: null,
        valorRecebido: null,
        dataRecebimento: null,
        competencia: null,
        parcela: null,
        percentual: percentualDoRotulo(rotulo),
        situacao: natureza.startsWith("sucumbencia")
          ? "nao_havera_sucumbencia"
          : "nao_havera_cobranca",
        versoes: [],
        observacoes: obs,
        celulas: celulasRef(l),
        linha: l.r + 1,
        conferencia: [],
      });
      return;
    }
    if (obs.length && sit.situacao)
      bloco.notas.push({ celula: celulasRef(l), texto: `${rotulo} ${obs.join(" | ")}`.trim() });
    else if (obs.length)
      bloco.notas.push({ celula: celulasRef(l), texto: `${rotulo} ${obs.join(" | ")}`.trim() });
  }

  // Processo, NB e CPF citados em observações.
  for (const n of bloco.notas) {
    if (!bloco.processo) {
      const p = processoNoTexto(n.texto);
      if (p) bloco.processo = p;
    }
    if (!bloco.nb) bloco.nb = nbNoTexto(n.texto);
  }
  bloco.processoDigitos = bloco.processo ? somenteDigitos(bloco.processo) : null;
  bloco.tribunal = [...new Set(tribunais.map((x) => x.trim()).filter(Boolean))].join(" · ") || null;

  // Observação de pagamento em linha própria ("pagou 1 parcela em 04/09/2024 - R$ 566,00"):
  // aplica-se somente se o bloco tiver UM lançamento de implantação.
  const comValor = bloco.lancamentos.filter((x) => x.valor !== null);
  const notasPagamento = bloco.notas.filter((n) => {
    const s = situacaoDasObservacoes([n.texto], true);
    return s.situacao === "recebido" || s.situacao === "parcial";
  });
  if (notasPagamento.length) {
    const alvo = comValor.filter((x) => x.categoria === "implantacao");
    if (aba !== "rpv" && alvo.length === 1) {
      const lanc = alvo[0]!;
      const antes = lanc.situacao;
      const leituras = notasPagamento.map((n) => situacaoDasObservacoes([n.texto], true).situacao);
      if (new Set([antes === "a_receber" ? null : antes, ...leituras].filter(Boolean)).size > 1)
        lanc.conferencia.push(
          `Informações de pagamento conflitantes (${[lanc.celulas, ...notasPagamento.map((n) => n.celula)].join(", ")}): confira o valor recebido.`,
        );
      for (const n of notasPagamento) {
        const s = situacaoDasObservacoes([n.texto], true);
        lanc.observacoes.push(`${n.texto} (${n.celula})`);
        lanc.celulas += `, ${n.celula}`;
        if (
          s.valorRecebido !== null &&
          /parcela|faltam|restante|apenas/.test(simplificar(n.texto))
        ) {
          lanc.situacao = "parcial";
          lanc.valorRecebido =
            Math.round(((lanc.valorRecebido ?? 0) + s.valorRecebido) * 100) / 100;
          lanc.dataRecebimento = s.data ?? lanc.dataRecebimento;
        } else if (
          s.valorRecebido !== null &&
          lanc.valor !== null &&
          s.valorRecebido >= lanc.valor
        ) {
          lanc.situacao = "recebido";
          lanc.valorRecebido = lanc.valor;
          lanc.dataRecebimento = s.data;
        } else if (
          s.situacao === "recebido" &&
          s.valorRecebido === null &&
          /quitad|ja (foi|foram) pag|ja pagou|(pagou|paga) (a )?ultima/.test(simplificar(n.texto))
        ) {
          lanc.situacao = "recebido";
          lanc.valorRecebido = lanc.valor;
          lanc.dataRecebimento = s.data ?? lanc.dataRecebimento;
        } else if (s.situacao === "parcial" && s.valorRecebido !== null) {
          lanc.situacao = "parcial";
          lanc.valorRecebido = s.valorRecebido;
          lanc.parcela = s.parcela;
          lanc.dataRecebimento = s.data ?? lanc.dataRecebimento;
        } else {
          lanc.conferencia.push(
            `Observação de pagamento no bloco: "${n.texto.slice(0, 120)}" — confirme o valor recebido.`,
          );
          if (lanc.situacao === "a_receber") lanc.situacao = "nao_confirmado";
        }
      }
    } else {
      bloco.conferencia.push(
        `Observação de pagamento sem lançamento definido: ${notasPagamento.map((n) => n.celula).join(", ")}.`,
      );
    }
  }
  // Composição ("3 x 3.484,15 (salário)") que reproduz outro lançamento: não é novo valor.
  for (const x of [...bloco.lancamentos]) {
    const partes = [
      ...simplificar(x.rotulo).matchAll(/(\d{1,2})\s*x\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g),
    ];
    if (!partes.length) continue;
    const soma =
      Math.round(partes.reduce((a, p) => a + Number(p[1]) * numeroBR(p[2]!), 0) * 100) / 100;
    const igual = bloco.lancamentos.find(
      (o) => o !== x && o.valor !== null && Math.abs(o.valor - soma) < 1,
    );
    if (igual) {
      bloco.lancamentos = bloco.lancamentos.filter((o) => o !== x);
      bloco.complementares.push({
        rotulo: `Composição de ${igual.celulas}`,
        valor: soma,
        texto: x.rotulo,
        celula: x.celulas,
      });
    }
  }
  // Mesmo valor e categoria repetidos no bloco (ex.: "VALOR HONORÁRIOS" e "Valor honorários contratuais").
  const vistosNoBloco = new Set<string>();
  bloco.lancamentos = bloco.lancamentos.filter((x) => {
    if (x.valor === null) return true;
    const k = `${x.categoria}|${Math.round(x.valor * 100)}`;
    if (vistosNoBloco.has(k)) {
      bloco.complementares.push({
        rotulo: "Mesmo valor repetido no bloco (não somado)",
        valor: x.valor,
        texto: x.rotulo,
        celula: x.celulas,
      });
      return false;
    }
    vistosNoBloco.add(k);
    return true;
  });
  const impl = bloco.lancamentos.filter((x) => x.categoria === "implantacao" && x.valor !== null);
  if (impl.length > 1)
    for (const x of impl)
      x.conferencia.push(
        `O bloco tem ${impl.length} valores de honorários de implantação — confirme se são cobranças distintas.`,
      );
  for (const c of bloco.complementares) {
    const ruim = c.texto ? valorInconsistente(c.texto) : null;
    if (ruim)
      bloco.conferencia.push(`Valor digitado de forma inconsistente em ${c.celula}: "${ruim}".`);
  }
  for (const l of m.linhas) {
    const txt = [l.rotulo?.texto ?? "", ...l.resto.map((c) => c.texto ?? "")].join(" ");
    const ruim = valorInconsistente(txt);
    if (ruim && !bloco.lancamentos.some((x) => x.linha === l.r + 1))
      bloco.conferencia.push(
        `Valor digitado de forma inconsistente na linha ${l.r + 1}: "${ruim}".`,
      );
  }

  // Parcial: saldo pendente fica no lançamento (valor - recebido).
  for (const x of bloco.lancamentos) {
    if (
      x.situacao === "parcial" &&
      x.valorRecebido !== null &&
      x.valor !== null &&
      x.valorRecebido >= x.valor
    ) {
      x.situacao = "recebido";
      x.valorRecebido = x.valor;
    }
    if (x.situacao === "recebido" && x.valorRecebido === null) x.situacao = "nao_confirmado";
  }

  // Ignorado: modelo vazio / sem dados de cliente.
  const temConteudo =
    bloco.lancamentos.length ||
    bloco.complementares.some((c) => c.valor !== null && c.valor !== 0) ||
    Object.values(bloco.beneficio).some((v) => v && v.trim());
  if (!bloco.nome && !temConteudo)
    bloco.ignorado = bloco.notas.length ? "Observação sem cliente identificado" : "Modelo vazio";
  else if (!bloco.nome) bloco.conferencia.push("Cliente não identificado no bloco.");
  else if (!temConteudo && !bloco.notas.length) bloco.ignorado = "Nome sem nenhuma informação";
  // Toda célula do bloco é registrada: usada pelo bloco ou ignorada (com motivo).
  for (const l of m.linhas)
    for (const c of [l.rotulo, ...l.resto])
      if (c) {
        if (bloco.ignorado) ignorar(c, bloco.ignorado);
        else marcar(c);
      }
  return bloco;
}

/** Valor de honorário em uma linha de texto das abas de implantação. */
function valorDeHonorario(
  texto: string,
  l: Linha,
): { valor: number | null; versoes: VersaoValor[]; ambiguo: boolean } {
  const t = texto.replace(/\s+/g, " ");
  const numeros = l.resto.filter((c) => c.numero !== null && !c.formula);
  const nums = valoresNoTexto(t);
  if (!nums.length) return escolherVersao([], numeros);
  const s = simplificar(t);
  // "30% = 4.003,82" / "30% 2.991,86" → valor logo após o percentual.
  const aposPct = s.match(/\d+\s*%\s*=?\s*(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/);
  if (aposPct) {
    const v = Number(aposPct[1]!.replace(/\./g, "").replace(",", "."));
    return {
      valor: v,
      versoes: nums
        .filter((n) => n.valor !== v)
        .map((n) => ({ celula: l.rotulo!.ref, valor: n.valor })),
      ambiguo: nums.length > 1,
    };
  }
  // "(VALOR TOTAL R$ 1.977,00)" quando não há valor após o percentual.
  const total = s.match(/valor total r\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/);
  if (total) {
    const v = Number(total[1]!.replace(/\./g, "").replace(",", "."));
    return {
      valor: v,
      versoes: nums
        .filter((n) => n.valor !== v)
        .map((n) => ({ celula: l.rotulo!.ref, valor: n.valor })),
      ambiguo: nums.length > 1,
    };
  }
  // "= 3 benefícios = 5.037,15" / "R$ 7.342,38 = 3 BENEFÍCIOS" / "(R$ 3.205,08)": primeiro valor com R$, senão o último.
  const comRS = t.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/);
  const escolhido = comRS
    ? Number(comRS[1]!.replace(/\./g, "").replace(",", "."))
    : nums[nums.length - 1]!.valor;
  return {
    valor: escolhido,
    versoes: nums
      .filter((n) => n.valor !== escolhido)
      .map((n) => ({ celula: l.rotulo!.ref, valor: n.valor })),
    ambiguo: nums.length > 1,
  };
}

function fmt(v: number | null): string {
  return v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------------
// Duplicidades na leitura (mesmo cliente, mesma categoria, mesmo valor)
// ---------------------------------------------------------------------------

function removerDuplicidades(blocos: BlocoLido[]) {
  const vistos = new Map<string, LancamentoBloco>();
  const dups: LeituraBlocos["duplicidades"] = [];
  // Abas de implantação primeiro: a implantação citada na aba RPV é conferida contra elas.
  const peso: Record<AbaBlocos, number> = { judicial: 0, administrativa: 1, rpv: 2 };
  const ordem = [...blocos].sort((a, b) => peso[a.aba] - peso[b.aba]);
  for (const b of ordem) {
    if (b.ignorado || !b.nomeNormalizado) continue;
    b.lancamentos = b.lancamentos.filter((x) => {
      if (x.valor === null || x.categoria === null) return true;
      const k = `${b.nomeNormalizado}|${x.categoria}|${Math.round(x.valor * 100)}`;
      const anterior = vistos.get(k);
      if (
        anterior &&
        (anterior.id.split(":")[0] !== x.id.split(":")[0] || anterior.natureza === x.natureza)
      ) {
        if (anterior.id === x.id) return true;
        dups.push({
          lancamento: `${ROTULO_ABA[b.aba]} ${x.celulas}`,
          igualA: `${ROTULO_ABA[anterior.id.split(":")[0] as AbaBlocos]} ${anterior.celulas}`,
          motivo: `Mesmo cliente, mesma categoria e mesmo valor (${fmt(x.valor)}).`,
        });
        // Preserva a informação de pagamento da outra aba.
        if (x.situacao === "recebido" && anterior.situacao !== "recebido") {
          anterior.situacao = "recebido";
          anterior.valorRecebido = anterior.valor;
          anterior.observacoes.push(...x.observacoes);
        }
        return false;
      }
      vistos.set(k, x);
      return true;
    });
  }
  return dups;
}
