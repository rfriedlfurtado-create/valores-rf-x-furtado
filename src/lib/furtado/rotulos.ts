/**
 * Rótulos financeiros dos blocos ("ATRASADOS:", "CONTRATUAIS (25%):"...).
 */

import type { CategoriaFinanceira } from "./modelo";
import { chaveTexto, percentualNoTexto, quantidadeBeneficiosNoTexto } from "./texto";

export type CategoriaRotulo = CategoriaFinanceira | "total_bloco";

export interface RotuloFinanceiro {
  categoria: CategoriaRotulo;
  /** Parte do rótulo antes dos dois-pontos. */
  rotulo: string;
  /** Texto depois dos dois-pontos (pode conter nome, valor, situação). */
  resto: string;
  percentual: number | null;
  baseCalculo: string | null;
  quantidadeBeneficios: number | null;
  temDoisPontos: boolean;
}

const REGRAS: [RegExp, CategoriaRotulo][] = [
  [/^ATRASADOS?\b(?!\s+DE\b)/, "atrasados"],
  [/^VALOR TOTAL\b/, "valor_total"],
  [/^(CLIENTE|AUTOR|AUTORA)\s*:/, "valor_cliente"],
  [/^CONTRATUAIS\b/, "honorarios_contratuais"],
  [/^SUCUMBENCIAIS\s+EXECUCAO\b/, "honorarios_execucao"],
  [/^SUCUMBENCIAIS\b/, "honorarios_sucumbenciais"],
  [/^EXECUCAO\b/, "honorarios_execucao"],
  [/^IMPLANTACAO\b/, "honorarios_implantacao"],
  [/^HA HONORARIOS DA IMPLANTACAO\b/, "honorarios_implantacao"],
  [/^HONORARIOS\s*-\s*TUTELA/, "honorarios_tutela"],
  [/^HONORARIOS DR\b/, "ajuste"],
  [/^VALOR REPASSE AO CLIENTE\b/, "repasse_cliente"],
  [/^TOTAL\s*:/, "total_bloco"],
];

/** Categorias cuja presença inicia um novo bloco financeiro. */
export const ABRE_BLOCO: CategoriaRotulo[] = ["atrasados", "valor_total"];
/** Ordem canônica dos rótulos dentro de um bloco. */
export const ORDEM_ROTULO: Partial<Record<CategoriaRotulo, number>> = {
  atrasados: 1,
  valor_total: 1,
  valor_cliente: 2,
  honorarios_contratuais: 3,
  honorarios_sucumbenciais: 4,
  honorarios_execucao: 5,
  honorarios_implantacao: 6,
  honorarios_tutela: 7,
};

/**
 * Reconhece um rótulo financeiro no início do texto. `temValorAoLado`
 * permite aceitar rótulos sem dois-pontos ("Honorários - tutela (27%)" com
 * valor na coluna seguinte).
 */
export function lerRotuloFinanceiro(
  texto: string,
  temValorAoLado: boolean,
): RotuloFinanceiro | null {
  if (typeof texto !== "string") return null;
  const k = chaveTexto(texto);
  for (const [re, categoria] of REGRAS) {
    if (!re.test(k)) continue;
    const idx = texto.indexOf(":");
    const temDoisPontos = idx >= 0;
    if (!temDoisPontos && !temValorAoLado) {
      // "IMPLANTAÇÃO" sozinho ainda é rótulo; frases não.
      if (k.split(" ").length > 4) return null;
    }
    const rotulo = temDoisPontos ? texto.slice(0, idx) : texto;
    const resto = temDoisPontos ? texto.slice(idx + 1).trim() : "";
    const kr = chaveTexto(rotulo + " " + resto);
    let baseCalculo: string | null = null;
    if (/VALOR FIXO/.test(kr)) baseCalculo = "valor fixo";
    const qtd = quantidadeBeneficiosNoTexto(rotulo);
    if (qtd !== null) baseCalculo = `${qtd} salário(s) de benefício`;
    if (/ATE O TRANSITO/.test(kr))
      baseCalculo = (baseCalculo ? `${baseCalculo}; ` : "") + "até o trânsito em julgado";
    return {
      categoria,
      rotulo: rotulo.trim(),
      resto,
      percentual: percentualNoTexto(rotulo) ?? percentualNoTexto(resto.length < 12 ? resto : ""),
      baseCalculo,
      quantidadeBeneficios: qtd,
      temDoisPontos,
    };
  }
  return null;
}

/** Categoria a partir do rótulo de um total geral ("CONTRATUAIS :", "TOTAL:"). */
export function categoriaDoTotal(
  rotulo: string | null,
): CategoriaFinanceira | "total_geral" | null {
  if (!rotulo) return null;
  const k = chaveTexto(rotulo);
  if (/^CONTRATUAIS/.test(k)) return "honorarios_contratuais";
  if (/^SUCUMBENCIAIS/.test(k)) return "honorarios_sucumbenciais";
  if (/^EXECUCAO/.test(k)) return "honorarios_execucao";
  if (/^IMPLANTACAO/.test(k)) return "honorarios_implantacao";
  if (/^TOTAL/.test(k)) return "total_geral";
  return null;
}
