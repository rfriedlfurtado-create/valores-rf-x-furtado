/**
 * Número do processo — regras puras (sem banco).
 *
 * - JUDICIAL: numeração única do CNJ (Res. CNJ 65/2008),
 *   NNNNNNN-DD.AAAA.J.TR.OOOO — 20 dígitos, com dígito verificador (módulo 97).
 * - ADMINISTRATIVO: número do protocolo, requerimento ou procedimento
 *   (texto livre: INSS, NB, protocolo etc.).
 *
 * Cada processo do cliente tem o seu próprio número e a sua natureza
 * (coluna `atendimentos.natureza`).
 */

export type NaturezaProcesso = "judicial" | "administrativo";

export const NATUREZAS_PROCESSO: readonly NaturezaProcesso[] = ["judicial", "administrativo"];

export const ROTULO_NATUREZA: Record<NaturezaProcesso, string> = {
  judicial: "Judicial",
  administrativo: "Administrativo",
};

/** Tamanho máximo aceito para o número administrativo. */
export const MAX_NUMERO_ADMINISTRATIVO = 80;

const MASCARA_CNJ = "0000000-00.0000.0.00.0000";

export function digitosDe(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\D/g, "");
}

/** Resto de uma sequência de dígitos (qualquer tamanho) por 97. */
function mod97(digitos: string): number {
  let resto = 0;
  for (const c of digitos) resto = (resto * 10 + Number(c)) % 97;
  return resto;
}

/** Dígito verificador CNJ calculado a partir dos demais 18 dígitos. */
export function digitoVerificadorCNJ(digitos20: string): string {
  const n = digitos20.slice(0, 7);
  const resto = digitos20.slice(9); // AAAA J TR OOOO
  const dv = 98 - mod97(`${n}${resto}00`);
  return String(dv).padStart(2, "0");
}

/** 20 dígitos → NNNNNNN-DD.AAAA.J.TR.OOOO. */
export function formatarCNJ(digitos20: string): string {
  const d = digitos20;
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
}

/** Aplica a máscara CNJ enquanto o usuário digita (até 20 dígitos). */
export function mascararCNJ(texto: string): string {
  const d = digitosDe(texto).slice(0, 20);
  let out = "";
  let i = 0;
  for (const m of MASCARA_CNJ) {
    if (i >= d.length) break;
    if (m === "0") out += d[i++];
    else out += m;
  }
  return out;
}

export function ehNumeroCNJ(texto: string | null | undefined): boolean {
  const d = digitosDe(texto);
  return d.length === 20 && digitoVerificadorCNJ(d) === d.slice(7, 9);
}

/**
 * Natureza efetiva: a gravada; sem ela, número no padrão CNJ é judicial.
 * Sem natureza nem número CNJ → null (não informada).
 */
export function naturezaDoProcesso(
  natureza: string | null | undefined,
  numero: string | null | undefined,
): NaturezaProcesso | null {
  if (natureza === "judicial" || natureza === "administrativo") return natureza;
  if (ehNumeroCNJ(numero)) return "judicial";
  return null;
}

export type ResultadoNumero = { ok: true; valor: string | null } | { ok: false; erro: string };

/**
 * Valida e normaliza o número digitado conforme a natureza.
 * Vazio é permitido (processo fica "Sem número").
 */
export function normalizarNumeroProcesso(
  natureza: NaturezaProcesso,
  texto: string | null | undefined,
): ResultadoNumero {
  const bruto = (texto ?? "").trim().replace(/\s+/g, " ");
  if (!bruto) return { ok: true, valor: null };

  if (natureza === "judicial") {
    if (/[a-z]/i.test(bruto))
      return {
        ok: false,
        erro: "Processo judicial: informe somente a numeração CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO).",
      };
    const d = digitosDe(bruto);
    if (d.length !== 20)
      return {
        ok: false,
        erro: `Processo judicial: a numeração CNJ tem 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO); foram informados ${d.length}.`,
      };
    const esperado = digitoVerificadorCNJ(d);
    if (esperado !== d.slice(7, 9))
      return {
        ok: false,
        erro: `Número CNJ inválido: o dígito verificador deveria ser ${esperado}, não ${d.slice(7, 9)}. Confira o número.`,
      };
    return { ok: true, valor: formatarCNJ(d) };
  }

  if (bruto.length > MAX_NUMERO_ADMINISTRATIVO)
    return {
      ok: false,
      erro: `Número administrativo muito longo (máximo de ${MAX_NUMERO_ADMINISTRATIVO} caracteres).`,
    };
  if (!/\d/.test(bruto))
    return {
      ok: false,
      erro: "Informe o número do protocolo, requerimento ou procedimento (deve conter ao menos um número).",
    };
  return { ok: true, valor: bruto };
}
