/**
 * Formatação no padrão brasileiro.
 * Centralizado para garantir consistência visual em todo o sistema.
 */

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatBRL(value: number | string | null | undefined): string {
  const numeric = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(numeric)) return currencyFormatter.format(0);
  return currencyFormatter.format(numeric);
}

export function formatBRLCompact(value: number | null | undefined): string {
  const numeric = value ?? 0;
  if (!Number.isFinite(numeric)) return compactFormatter.format(0);
  if (Math.abs(numeric) < 10000) return currencyFormatter.format(numeric);
  return compactFormatter.format(numeric);
}

/** Converte "1.250,00" ou "1250.00" para número. */
export function parseBRL(input: string): number {
  const cleaned = input
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/** Data ISO (YYYY-MM-DD) ou timestamp -> DD/MM/AAAA */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date =
    typeof value === "string"
      ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T12:00:00`)
        : new Date(value)
      : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// Campo de valor (R$): máscara 99.999,99 — o usuário digita só os números;
// os pontos de milhar são colocados automaticamente e a vírgula separa os
// centavos. Funções puras usadas por <InputMoeda> (testadas em tests/format-moeda.test.ts).
// ---------------------------------------------------------------------------

/** Máximo de dígitos na parte inteira (o banco guarda numeric(14,2)). */
const MAX_DIGITOS_INTEIROS = 12;

function agruparMilhar(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Formata o texto enquanto o usuário digita: "1250" → "1.250",
 * "99999,9" → "99.999,9". Pontos digitados são ignorados (o sistema coloca);
 * a vírgula (ou a primeira vírgula) inicia os centavos, no máximo 2.
 */
export function mascararMoeda(texto: string): string {
  if (!texto) return "";
  const virgula = texto.indexOf(",");
  const inteiroBruto = (virgula >= 0 ? texto.slice(0, virgula) : texto).replace(/\D/g, "");
  const inteiro = inteiroBruto.replace(/^0+(?=\d)/, "").slice(0, MAX_DIGITOS_INTEIROS);
  if (virgula < 0) return inteiro ? agruparMilhar(inteiro) : "";
  const centavos = texto
    .slice(virgula + 1)
    .replace(/\D/g, "")
    .slice(0, 2);
  return `${agruparMilhar(inteiro || "0")},${centavos}`;
}

/** Ao sair do campo: completa os centavos ("9.999" → "9.999,00", "9,5" → "9,50"). */
export function completarCentavos(texto: string): string {
  const m = mascararMoeda(texto);
  if (!m) return "";
  const [inteiro, centavos = ""] = m.split(",");
  return `${inteiro},${centavos.padEnd(2, "0")}`;
}

/** Número → texto do campo ("1250.5" → "1.250,50"). */
export function valorParaCampoMoeda(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const n = typeof valor === "string" ? Number(valor) : valor;
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Texto colado (planilha, outro sistema) → texto do campo. Aceita
 * "1.250,00", "1250,5", "1250.50", "R$ 1.250,00" e "1,250.00".
 */
export function colarMoeda(texto: string): string {
  const t = texto.replace(/[^\d,.-]/g, "");
  if (!t) return "";
  const ultimaVirgula = t.lastIndexOf(",");
  const ultimoPonto = t.lastIndexOf(".");
  let n: number;
  if (ultimaVirgula > ultimoPonto) n = parseBRL(t);
  else if (ultimoPonto >= 0 && /\.\d{1,2}$/.test(t)) n = Number(t.replace(/,/g, ""));
  else n = Number(t.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? valorParaCampoMoeda(Math.abs(n)) : "";
}

/**
 * Posição do cursor após reformatar: mantém o mesmo número de dígitos (e a
 * vírgula) à esquerda do cursor, para não pular para o fim ao editar no meio.
 */
export function posicaoCursorMoeda(
  formatado: string,
  digitosAntes: number,
  depoisDaVirgula: boolean,
): number {
  let vistos = 0;
  const virgula = formatado.indexOf(",");
  for (let i = 0; i < formatado.length; i++) {
    if (vistos >= digitosAntes && (!depoisDaVirgula || virgula < 0 || i > virgula)) return i;
    if (/\d/.test(formatado[i]!)) vistos += 1;
  }
  return formatado.length;
}
