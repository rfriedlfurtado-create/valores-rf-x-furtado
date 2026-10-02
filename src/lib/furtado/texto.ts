/**
 * Utilitários de interpretação de TEXTO da planilha Furtado.
 *
 * Tudo aqui é puro e conservador: quando a leitura é incerta, a função
 * devolve a informação de incerteza em vez de "adivinhar". O texto
 * original é sempre preservado por quem chama.
 */

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

/** Maiúsculas, sem acento, espaços simples. Usado só para comparação/rotulagem. */
export function chaveTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** Mesma normalização de nomes usada no restante do sistema (similarity.ts). */
export function normalizarNomeComparacao(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Espaços/quebras múltiplos viram um espaço; preserva o conteúdo. */
export function compactar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

export function hashTexto(texto: string): string {
  // FNV-1a 32 bits — chave estável para deduplicar textos idênticos.
  let h = 0x811c9dc5;
  const s = compactar(texto).toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Números e valores monetários
// ---------------------------------------------------------------------------

export interface NumeroLido {
  valor: number | null;
  original: string;
  /** Texto parece número mas o formato é inconsistente (ex.: "64.1035,59"). */
  malformado: boolean;
}

const RE_NUMERO_BR = /-?\d[\d.,]*\d|-?\d/g;

/**
 * Converte um número escrito em português ("1.412,00", "1412,5", "3205.08",
 * "4.774.32"). Marca como malformado quando os grupos de milhar não têm 3
 * dígitos ou há separadores ambíguos.
 */
export function lerNumeroBR(texto: string): NumeroLido {
  const original = texto;
  const t = texto.trim();
  if (!/\d/.test(t)) return { valor: null, original, malformado: false };
  const s = t.replace(/\s/g, "");
  // Formato BR completo: 1.234.567,89
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) {
    return { valor: Number(s.replace(/\./g, "").replace(",", ".")), original, malformado: false };
  }
  // 1234,56
  if (/^-?\d+,\d+$/.test(s))
    return { valor: Number(s.replace(",", ".")), original, malformado: false };
  // 1.234.567 (milhar sem decimais)
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    return { valor: Number(s.replace(/\./g, "")), original, malformado: false };
  }
  // 1234.56 (ponto decimal, uma única vez, 1-2 casas)
  if (/^-?\d+\.\d{1,2}$/.test(s)) return { valor: Number(s), original, malformado: false };
  // 1234
  if (/^-?\d+$/.test(s)) return { valor: Number(s), original, malformado: false };
  // 1,234,567.89 (formato americano)
  if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s)) {
    return { valor: Number(s.replace(/,/g, "")), original, malformado: false };
  }
  // Qualquer outra combinação de dígitos e separadores: malformado.
  return { valor: null, original, malformado: true };
}

export interface ValorMonetario {
  valor: number;
  original: string;
  inicio: number;
  fim: number;
  malformado: boolean;
}

/**
 * Encontra valores monetários dentro de um texto livre. Considera valores
 * com "R$" ou com casas decimais (",dd"). Números soltos sem decimais só
 * contam quando precedidos de "R$" (evita confundir com datas, NB, etc.).
 */
export function valoresMonetariosNoTexto(texto: string): ValorMonetario[] {
  const out: ValorMonetario[] = [];
  const re = /(R\$\s*)?(-?\d[\d.,]*\d|\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const temRS = !!m[1];
    let num = m[2]!;
    const inicio = m.index;
    let fim = m.index + m[0].length;
    // Ignora pedaços de datas (dd/mm/aaaa), processos (0000000-00.0000...) e percentuais.
    const antes = texto.slice(Math.max(0, inicio - 1), inicio);
    const depois = texto.slice(fim, fim + 2);
    if (/[\/\-]/.test(antes) && !temRS) continue;
    if (/^\s?\//.test(depois) || /^-\d/.test(depois)) continue;
    if (/^\s?%/.test(depois)) continue;
    // Remove pontuação final ("1.200,00." / "7.695,93,")
    while (/[.,]$/.test(num)) {
      num = num.slice(0, -1);
      fim -= 1;
    }
    const temDecimal = /,\d{2}$/.test(num) || /^\d{1,3}(\.\d{3})+,\d+$/.test(num);
    if (!temRS && !temDecimal) continue;
    if (/^\d{1,2}\.\d{3}\.\d{3}-?\d/.test(num)) continue; // NB/CPF
    const lido = lerNumeroBR(num);
    if (lido.valor === null && !lido.malformado) continue;
    out.push({
      valor: lido.valor ?? Number.NaN,
      original: m[0].trim(),
      inicio,
      fim,
      malformado: lido.malformado,
    });
  }
  return out;
}

/** Interpreta o conteúdo de uma célula de valor (número ou texto "R$ 1.412,00"). */
export function lerCelulaMonetaria(
  bruto: unknown,
):
  | { tipo: "valor"; valor: number; malformado: false }
  | { tipo: "malformado"; original: string }
  | { tipo: "ausencia"; texto: string }
  | { tipo: "texto"; texto: string }
  | { tipo: "vazio" } {
  if (bruto === null || bruto === undefined || bruto === "") return { tipo: "vazio" };
  if (typeof bruto === "number") {
    return Number.isFinite(bruto)
      ? { tipo: "valor", valor: arred(bruto), malformado: false }
      : { tipo: "vazio" };
  }
  const texto = String(bruto).trim();
  if (!texto) return { tipo: "vazio" };
  const aus = ausenciaDeclarada(texto);
  if (aus) return { tipo: "ausencia", texto };
  const limpo = texto
    .replace(/^R\$\s*/i, "")
    .replace(/\s*\\?-?"?R\$"?.*$/i, "")
    .trim();
  if (/^-?[\d.,\s]+$/.test(limpo)) {
    const lido = lerNumeroBR(limpo);
    if (lido.valor !== null) return { tipo: "valor", valor: arred(lido.valor), malformado: false };
    return { tipo: "malformado", original: texto };
  }
  return { tipo: "texto", texto };
}

export function arred(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function centavos(valor: number): number {
  return Math.round(valor * 100);
}

// ---------------------------------------------------------------------------
// Ausência declarada (diferente de vazio e de zero)
// ---------------------------------------------------------------------------

/** "NÃO TEM", "NÃO HÁ", "não informado", "não consta"... devolve o texto canônico. */
export function ausenciaDeclarada(texto: string): string | null {
  const k = chaveTexto(texto)
    .replace(/[.!*]+$/g, "")
    .trim();
  if (/^(NAO TEM|NAO HA|NAO INFORMADO|NAO CONSTA|NAO HOUVE|NAO TEVE|SEM VALOR|NENHUM)\b/.test(k)) {
    return k.split(" - ")[0]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Percentuais
// ---------------------------------------------------------------------------

export function percentualNoTexto(texto: string): number | null {
  const m = texto.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
  if (!m) return null;
  const v = Number(m[1]!.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** Quantidade de benefícios/salários: "3 BENEFÍCIOS", "1 SALÁRIO DE BENEFÍCIO", "2 ben", "1 S.B". */
export function quantidadeBeneficiosNoTexto(texto: string): number | null {
  const k = chaveTexto(texto);
  const m =
    k.match(
      /(\d+)\s*(BENEFICIOS?|BENEFICOS?|BEN\b|SALARIOS? DE BENEFICIO|SALARIOS? BENEFICIO|S\.?\s?B\b)/,
    ) ?? k.match(/\b(UM)\s+(BENEFICIO|SALARIO DE BENEFICIO)/);
  if (!m) return null;
  return m[1] === "UM" ? 1 : Number(m[1]);
}

// ---------------------------------------------------------------------------
// Datas (sem inventar dia quando só há mês/ano)
// ---------------------------------------------------------------------------

export type PrecisaoData = "dia" | "mes" | "ano" | "dia_mes";

export interface DataLida {
  /** Data completa ISO (somente quando o dia é conhecido). */
  iso: string | null;
  texto: string;
  precisao: PrecisaoData;
  ano: number | null;
  mes: number | null;
  dia: number | null;
}

function dataValida(a: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function anoCompleto(a: string): number {
  const n = Number(a);
  return a.length === 2 ? (n >= 70 ? 1900 + n : 2000 + n) : n;
}

export function isoDe(a: number, m: number, d: number): string {
  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Todas as datas encontradas no texto, na ordem. */
export function datasNoTexto(texto: string): DataLida[] {
  const out: DataLida[] = [];
  const usados: [number, number][] = [];
  const sobrepoe = (i: number, f: number) => usados.some(([a, b]) => i < b && f > a);
  // dd/mm/aaaa, dd.mm.aaaa, dd/mm/aa
  const reDia = /\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{4}|\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = reDia.exec(texto))) {
    const d = Number(m[1]);
    const mes = Number(m[2]);
    const a = anoCompleto(m[3]!);
    if (!dataValida(a, mes, d)) continue;
    usados.push([m.index, m.index + m[0].length]);
    out.push({ iso: isoDe(a, mes, d), texto: m[0], precisao: "dia", ano: a, mes, dia: d });
  }
  // mm/aaaa (data parcial)
  const reMes = /\b(\d{1,2})\/(\d{4})\b/g;
  while ((m = reMes.exec(texto))) {
    if (sobrepoe(m.index, m.index + m[0].length)) continue;
    const mes = Number(m[1]);
    if (mes < 1 || mes > 12) continue;
    usados.push([m.index, m.index + m[0].length]);
    out.push({ iso: null, texto: m[0], precisao: "mes", ano: Number(m[2]), mes, dia: null });
  }
  // dd/mm sem ano
  const reDiaMes = /\b(\d{1,2})\/(\d{1,2})\b(?![\/\d])/g;
  while ((m = reDiaMes.exec(texto))) {
    if (sobrepoe(m.index, m.index + m[0].length)) continue;
    const d = Number(m[1]);
    const mes = Number(m[2]);
    if (!dataValida(2024, mes, d)) continue;
    usados.push([m.index, m.index + m[0].length]);
    out.push({ iso: null, texto: m[0], precisao: "dia_mes", ano: null, mes, dia: d });
  }
  return out.sort((a, b) => texto.indexOf(a.texto) - texto.indexOf(b.texto));
}

export function primeiraData(texto: string): DataLida | null {
  return datasNoTexto(texto)[0] ?? null;
}

/** "120 dias" → 120 (prazo; NÃO é convertido em data sem base expressa). */
export function prazoEmDias(texto: string): number | null {
  const m = chaveTexto(texto).match(/^(\d{1,4})\s*DIAS\b/);
  return m ? Number(m[1]) : null;
}

/** Ano isolado (2000–2100), usado para "PRECATÓRIO 2027", "exercício de 2027". */
export function anoNoTexto(texto: string): number | null {
  const m = texto.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Identificadores (sempre texto)
// ---------------------------------------------------------------------------

export interface ProcessoLido {
  numero: string;
  digitos: string;
  original: string;
  sufixo: string | null;
}

/** Número de processo no padrão CNJ (com ou sem pontuação). */
export function processosNoTexto(texto: string): ProcessoLido[] {
  const out: ProcessoLido[] = [];
  const re = /(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})(\s*\(\d+\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const antes = texto.slice(Math.max(0, m.index - 1), m.index);
    if (/\d/.test(antes)) continue;
    const depois = texto.slice(m.index + m[0].length, m.index + m[0].length + 1);
    if (/\d/.test(depois)) continue;
    const digitos = m.slice(1, 7).join("");
    out.push({
      numero: `${m[1]}-${m[2]}.${m[3]}.${m[4]}.${m[5]}.${m[6]}`,
      digitos,
      original: m[0].trim(),
      sufixo: m[7] ? m[7].trim() : null,
    });
  }
  return out;
}

export function cpfsNoTexto(texto: string): string[] {
  const out = new Set<string>();
  const formatado = /\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = formatado.exec(texto))) out.add(`${m[1]}.${m[2]}.${m[3]}-${m[4]}`);
  const rotulado = /CPF(?:\/CNPJ)?\s*(?:n[º°o.]\s*)?:?\s*(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/gi;
  while ((m = rotulado.exec(texto))) out.add(`${m[1]}.${m[2]}.${m[3]}-${m[4]}`);
  return [...out];
}

export interface NBLido {
  nb: string;
  digitos: string;
  original: string;
}

/** NB (número de benefício, 10 dígitos): "NB: 651.113.680-2", "NB 1698040684". */
export function nbsNoTexto(texto: string): NBLido[] {
  const out: NBLido[] = [];
  const re = /\bNB\s*(?:\/\s*\d+)?\s*:?\s*((?:\d[\s.\-]?){9}\d)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) {
    const digitos = m[1]!.replace(/\D/g, "");
    if (digitos.length !== 10) continue;
    out.push({
      nb: `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`,
      digitos,
      original: m[0].trim(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tribunais e órgãos
// ---------------------------------------------------------------------------

const RE_TRIBUNAL =
  /\b(TJ[A-Z]{2}|TRF\s?-?\s?\d|JF[A-Z]{2}|JEF|TRT\s?\d{1,2}|STJ|STF|E-?SAJ|INSS)\b|\bRJ\s*-\s*Portal de servi[cç]os|\bJEF\s*-\s*[A-Z]{2}\b/gi;

export function tribunaisNoTexto(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(RE_TRIBUNAL)) {
    const t = m[0].replace(/\s+/g, " ").trim();
    const k = t.toUpperCase();
    if (k === "INSS") continue; // INSS é parte, não órgão julgador
    if (!out.some((o) => o.toUpperCase() === k)) out.push(t);
  }
  return out;
}

/** Texto composto só de tribunal/órgão ("JFRS - JEF", "JEF - SP", "TJRS"). */
export function ehSomenteTribunal(texto: string): boolean {
  const resto = texto
    .replace(RE_TRIBUNAL, " ")
    .replace(/\b(RS|SC|PR|SP|RJ|MG|E|DO|DA)\b/gi, " ")
    .replace(/[-–()\s/.]/g, "");
  return resto.length === 0 && tribunaisNoTexto(texto).length > 0;
}

// ---------------------------------------------------------------------------
// Dados bancários
// ---------------------------------------------------------------------------

const BANCOS: [RegExp, string][] = [
  [/ITA[UÚ]/i, "Itaú"],
  [/BANRISUL/i, "Banrisul"],
  [/SANTANDER/i, "Santander"],
  [/CAIXA/i, "Caixa"],
  [/BRADESCO/i, "Bradesco"],
  [/BANCO DO BRASIL|\bBB\b/i, "Banco do Brasil"],
  [/NUBANK|\bNU\b/i, "Nubank"],
  [/SICREDI/i, "Sicredi"],
  [/SICOOB/i, "Sicoob"],
  [/\bINTER\b/i, "Inter"],
  [/\bC6\b/i, "C6"],
  [/PAGBANK|PAGSEGURO/i, "PagBank"],
  [/MERCADO ?PAGO/i, "Mercado Pago"],
];

export interface DadosBancariosLidos {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  operacao: string | null;
  tipoConta: string | null;
  titular: string | null;
  cpfTitular: string | null;
  consistente: boolean;
  observacao: string | null;
}

export function lerDadosBancarios(texto: string): DadosBancariosLidos | null {
  const t = texto.replace(/\s+/g, " ");
  let banco: string | null = null;
  const codigo = t.match(/Banco\s*:?\s*(\d{3})\b(?:\s*-\s*([^|/]+?))?(?=\s*(?:Ag|$|\/|\|))/i);
  for (const [re, nome] of BANCOS) {
    if (re.test(t)) {
      banco = nome;
      break;
    }
  }
  if (!banco && codigo) banco = `${codigo[1]}${codigo[2] ? ` - ${codigo[2].trim()}` : ""}`;
  if (banco && codigo && !banco.includes(codigo[1]!)) banco = `${banco} (${codigo[1]})`;
  const agencia = t.match(/\bAg(?:[eê]ncia|\.)?\s*:?\s*(\d{3,5}(?:-\w)?)/i)?.[1] ?? null;
  const conta =
    t.match(
      /\b(?:C\/C|CC|Conta(?:\s+Corrente)?|Corrente|Poupan[çc]a)\s*:?\s*(\d[\d.\-]{3,20}\d|\d{4,})/i,
    )?.[1] ?? null;
  const operacao = t.match(/\bOp\.?\s*:?\s*(\d{3})\b/i)?.[1] ?? null;
  const tipoConta = /CONTA CORRENTE|C\/C|\bCC\b/i.test(t)
    ? "corrente"
    : /POUPAN[CÇ]A/i.test(t)
      ? "poupança"
      : null;
  const titular = t.match(/Nome da Parte\s*:?\s*([^|]+?)(?=\s*(?:CPF|\||$))/i)?.[1]?.trim() ?? null;
  const cpfTitular = cpfsNoTexto(t)[0] ?? null;
  if (!banco && !agencia && !conta) return null;
  const problemas: string[] = [];
  if (!agencia) problemas.push("agência não informada");
  if (!conta) problemas.push("conta não informada");
  if (agencia && agencia.replace(/\D/g, "").length < 3)
    problemas.push("agência com formato incomum");
  if (conta && conta.replace(/\D/g, "").length < 4) problemas.push("conta com formato incomum");
  return {
    banco,
    agencia,
    conta,
    operacao,
    tipoConta,
    titular,
    cpfTitular,
    consistente: problemas.length === 0,
    observacao: problemas.length ? problemas.join("; ") : null,
  };
}

// ---------------------------------------------------------------------------
// Nomes de pessoas
// ---------------------------------------------------------------------------

const PREFIXOS_NOME =
  /^\s*(CLIENTE|AUTOR(?:A)?|ATRASADOS?(?:\s+(?:ADM|JUDICIAL))?|NOME(?:\s+DA\s+PARTE)?)\s*:\s*/i;

/** Palavras que encerram o nome (o restante é preservado como complemento). */
const CORTE_PALAVRA =
  /\b(TJ[A-Z]{2}|TRF\d?|JF[A-Z]{2}|JEF|TRT\d*|STJ|E-?SAJ|RPV|PRECAT\w*|C[AÁ]LCULO|INSS|INDIQUE\w*|REFERENTE|VALOR\w*|SUCESSOR\w*|CURADOR\w*|REPRESENTAD\w*|PROCURADOR\w*|TUTOR\w*|GENITOR\w*|OBS\w*|VERIFICAR|NB|CPF|ADIANT\w*|PAGO|PAGOU|DEVE|TEMOS|VAI|IR[ÁA]|FIZ|SOLICIT\w*|CONTA|ACORDO|SOMENTE|APENAS|PRESTA\w*|ENVIOU|COBR\w*|CONFORME)\b/i;

/** Primeiras palavras que indicam frase/rótulo (não nome). */
const NAO_NOME_INICIO = new Set(
  (
    "ATRASADOS ATRASADO VALOR VALORES TOTAL CLIENTE AUTOR CONTRATUAIS SUCUMBENCIAIS EXECUCAO IMPLANTACAO " +
    "OBS BENEFICIO DIB DIP DCB RMI RMA HONORARIOS HONORARIO DADOS CALCULO PRECATORIO RPV ACORDO ACAO " +
    "CONFORME NAO HA JA COBREI VOU TEMOS PAGO PAGOU SOMENTE APENAS AINDA VERIFICAR VERIFIQUEI ATUALIZADO " +
    "ATUALIZADOS INDIQUEI FIZ SOLICITEI SOLICITAMOS CLIENTES ENCAMINHEI ENVIEI AGENDEI PETICIONEI RECEBE " +
    "RECEBEU RECEBIDOS RECEBIDO NESSE NESTE NO NA EM DE DO DA DOS DAS O A OS AS E OU COM SEM PARA POR " +
    "TRANSITO TRÂNSITO PREVISAO COMUNICAR SOLICITAR COBRAR AVISAR PEDIR PROCESSO NUMERO CPF NB BANCO " +
    "AGENCIA CONTA TED PEDIDO INSERIR ESTAMOS IREMOS DEVEMOS DEVE TEM HOUVE FOI SERA EXPEDIDO EXPEDIDA " +
    "SUCUMBENCIAIS: AJUIZAR CONTRATO REVISAO PRORROGACAO ATENCAO FORMA DATA JULHO AGOSTO MULTA LIMITADO " +
    "QUITADO QUITADOS DISTRIBUIDO NOSSO NOSSA OK SIM INADIMPLENTE PENSAO PRESTACAO EVENTO ESTA ESTOU " +
    "CONSTA CADASTREI ORIENTEI CONCORDAMOS ABRIMOS COLEGA LIBERADO LIBERADOS SERAO HONORARIOS: TUTELA " +
    "DR DRA RECEBIDOS RETIFICACAO VENDEU CLIENTE: RJ SP RS SC PR"
  ).split(/\s+/),
);

/** Palavras que nunca fazem parte de nomes de pessoas. */
const NAO_NOME_PALAVRA = new Set(
  (
    "VALOR VALORES CONTA BANCO PAGO PAGOS PAGAMENTO HONORARIOS HONORARIO BENEFICIO BENEFICIOS PROCESSO " +
    "ACAO ACORDO CONTRATO INSS JUDICIAL ADM ADMINISTRATIVO TUTELA RECEBIDOS RECEBEU RECEBIDO MESES PRAZO " +
    "SALARIO CALCULO CONTADORIA ATUALIZADO IMPLANTACAO ESCRITORIO PEDIDO TED DESTAQUE PROCURACAO RELATORIO " +
    "MULTA RETIFICACAO PRECATORIO RPV ATRASADOS CLIENTE CLIENTES AUTOR VERIFICAR COBRAR CONVERSAO " +
    "PRORROGACAO CONCESSAO REVISAO QUE NAO FORAM PARA POIS COMO MAS SE SERA FOI JA TEM HA OK SIM PELO PELA " +
    "WHATS LIGACAO EMAIL CUMPRIMENTO SENTENCA INDEFERIDO DEFERIDO PERICIA LAUDO AUXILIO DOENCA ACIDENTE " +
    "APOSENTADORIA LOAS SUCUMBENCIAIS CONTRATUAIS EXECUCAO TOTAL TOTAIS DADOS BANCARIOS DIB DIP DCB RMA RMI " +
    "CPF NB EM NO NA NOS NAS AO AOS COM SEM PARA POR QUE SE OS AS UM UMA ATE DESDE JA MAIS MENOS MUITO " +
    "ALEM DISSO ISSO ESSE ESSA ESTE ESTA ESTES AQUELE APARTIR PARTIR APOS ANTES DEPOIS ENTAO TAMBEM " +
    "PRESCRICAO INICIALMENTE CONCEDIDO CONCEDIDA REVISADO REVISADA IMPLANTADO IMPLANTADA APESAR " +
    "VAMOS IREMOS VOU PARCELAMOS PARCELOU INDICAMOS PEDIMOS CONVERSEI PASSEI FICOU PEDIU DER"
  ).split(/\s+/),
);

const CONECTORES = new Set([
  "DA",
  "DE",
  "DO",
  "DAS",
  "DOS",
  "E",
  "D",
  "DI",
  "DU",
  "VAN",
  "VON",
  "DEL",
  "LA",
]);

export interface NomeExtraido {
  /** Nome como aparece na planilha (sem prefixo e sem complementos). */
  nome: string;
  /** Texto completo original da célula. */
  original: string;
  prefixo: string | null;
  /** O que veio depois do nome (tribunal, observação, papel...). */
  complemento: string | null;
  tribunais: string[];
  cpf: string | null;
  /** Papel encontrado junto ao nome (SUCESSOR, CURADORA...), para revisão. */
  papel: string | null;
  /** Só um nome (ex.: "EMILY"): não identifica a pessoa com segurança. */
  incompleto: boolean;
}

const RE_PAPEL =
  /\b(SUCESSOR[AE]?S?|CURADOR[A]?|REPRESENTANTE|REPRESENTAD[OA]|PROCURADOR[A]?|TUTOR[A]?|GENITOR[A]?|DEPENDENTE|FILH[OA]|M[ÃA]E|PAI|ESPOS[OA]|MARIDO|VI[ÚU]V[OA])\b/i;

/**
 * Extrai um nome de pessoa do início de um texto, separando prefixo
 * ("CLIENTE:"), tribunal, CPF e observações. Devolve null quando o texto
 * não começa com um nome plausível.
 */
export function extrairNome(
  textoOriginal: string,
  opcoes: { permitirIncompleto?: boolean } = {},
): NomeExtraido | null {
  if (!textoOriginal || typeof textoOriginal !== "string") return null;
  const original = textoOriginal;
  let t = textoOriginal.replace(/\r/g, "");
  const pref = t.match(PREFIXOS_NOME);
  const prefixo = pref ? pref[1]!.toUpperCase() : null;
  if (pref) t = t.slice(pref[0].length);
  // Quebra de linha dentro do nome ("MARA FABIANE \nFICHER") vira espaço simples.
  t = t.replace(/[ \t]*\n[ \t]*/g, " ").replace(/\t/g, "  ");
  const cpf = cpfsNoTexto(t)[0] ?? null;
  const tribunais = tribunaisNoTexto(t);

  // Ponto de corte: primeiro separador forte.
  const cortes: number[] = [];
  const candidatos = [
    t.search(/\s[-–]\s|\s[-–]$|\s[-–](?=[A-Z])/),
    t.search(/\s{2,}/),
    t.search(/[(),;:*!?|"\[\]]/),
    t.search(/\d/),
    t.search(/R\$/),
  ];
  for (const c of candidatos) if (c >= 0) cortes.push(c);
  const pal = t.match(CORTE_PALAVRA);
  if (pal && pal.index !== undefined) cortes.push(pal.index);
  const corte = cortes.length ? Math.min(...cortes) : t.length;
  const nomeBruto = t
    .slice(0, corte)
    .replace(/[-–.\s]+$/, "")
    .trim();
  const complemento = compactar(t.slice(corte).replace(/^[\s\-–:]+/, "")) || null;

  if (!nomeBruto) return null;
  const palavras = nomeBruto.split(/\s+/);
  if (palavras.length > 8 || nomeBruto.length > 70) return null;
  const chaves = palavras.map((p) => chaveTexto(p).replace(/[^A-Z']/g, ""));
  if (chaves.some((p) => !p)) return null;
  if (NAO_NOME_INICIO.has(chaves[0]!)) return null;
  if (chaves.some((p) => NAO_NOME_PALAVRA.has(p))) return null;
  if (!palavras.every((p) => /^[A-Za-zÀ-ÖØ-öø-ÿ'’\-]+\.?$/.test(p))) return null;
  // Frases em minúsculas longas não são nomes.
  if (nomeBruto === nomeBruto.toLowerCase() && palavras.length > 3) return null;
  // Palavras de 1 letra só como conector "e".
  if (chaves.some((p) => p.length === 1 && p !== "E" && p !== "D")) return null;
  const significativas = chaves.filter((p) => !CONECTORES.has(p));
  if (significativas.length === 0) return null;
  // Nome não termina em conector ("Apesar de ter ... de").
  if (CONECTORES.has(chaves[chaves.length - 1]!) && chaves.length > 1) return null;
  // Frase em caixa de sentença: palavra significativa minúscula após inicial maiúscula.
  const primeiraMaiuscula = /^[A-ZÀ-Ö]/.test(palavras[0]!);
  if (
    primeiraMaiuscula &&
    palavras.some((p, i) => i > 0 && !CONECTORES.has(chaves[i]!) && /^[a-zà-ÿ]/.test(p))
  ) {
    return null;
  }
  // Palavra única minúscula não é nome.
  if (significativas.length === 1 && nomeBruto === nomeBruto.toLowerCase()) return null;
  if (significativas.length < 2 && !opcoes.permitirIncompleto) return null;
  // Texto longo que continua como frase após o nome (ex.: "Cliente vai...")
  const papel = (complemento ?? "").match(RE_PAPEL)?.[0] ?? null;

  return {
    nome: compactar(nomeBruto),
    original,
    prefixo,
    complemento,
    tribunais,
    cpf,
    papel: papel ? papel.toUpperCase() : null,
    incompleto: significativas.length < 2,
  };
}

/** Texto que é só prefixo de rótulo, sem nome ("CLIENTE:", "ATRASADOS:  "). */
export function restoAposPrefixo(texto: string): string {
  return texto.replace(PREFIXOS_NOME, "").trim();
}
