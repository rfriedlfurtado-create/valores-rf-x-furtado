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
