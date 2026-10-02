/**
 * Recalculo CONTROLADO de fórmulas simples (SUM, referências, + - * /).
 *
 * Não executa macros, não acessa vínculos externos e não altera a planilha.
 * O resultado recalculado é sempre exibido ao lado do resultado armazenado
 * no arquivo; quando a fórmula não é suportada, isso é informado.
 */

import * as XLSX from "xlsx";

import type { Aba, Celula } from "./planilha";

export interface ResultadoFormula {
  suportada: boolean;
  valor: number | string | null;
  erro: string | null;
  referencias: string[];
}

type Token =
  | { t: "num"; v: number }
  | { t: "ref"; v: string }
  | { t: "range"; v: string }
  | { t: "func"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "," }
  | { t: "err"; v: string }
  | { t: "str"; v: string };

function tokenizar(f: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const s = f.replace(/^=/, "");
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (s.startsWith("#REF!", i)) {
      out.push({ t: "err", v: "#REF!" });
      i += 5;
      continue;
    }
    if (ch === '"') {
      const fim = s.indexOf('"', i + 1);
      out.push({ t: "str", v: s.slice(i + 1, fim < 0 ? s.length : fim) });
      i = fim < 0 ? s.length : fim + 1;
      continue;
    }
    const range = /^\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+/.exec(s.slice(i));
    if (range) {
      out.push({ t: "range", v: range[0].replace(/\$/g, "") });
      i += range[0].length;
      continue;
    }
    const func = /^[A-Z][A-Z0-9.]*(?=\()/.exec(s.slice(i));
    if (func) {
      out.push({ t: "func", v: func[0] });
      i += func[0].length;
      continue;
    }
    const ref = /^\$?[A-Z]{1,3}\$?\d+/.exec(s.slice(i));
    if (ref) {
      out.push({ t: "ref", v: ref[0].replace(/\$/g, "") });
      i += ref[0].length;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    if ("+-*/".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(") out.push({ t: "(" });
    else if (ch === ")") out.push({ t: ")" });
    else if (ch === "," || ch === ";") out.push({ t: "," });
    else throw new Error(`não suportado: '${s.slice(i, i + 10)}'`);
    i++;
  }
  return out;
}

export function referenciasDaFormula(formula: string): string[] {
  try {
    const refs: string[] = [];
    for (const tk of tokenizar(formula)) {
      if (tk.t === "ref") refs.push(tk.v);
      if (tk.t === "range") {
        const r = XLSX.utils.decode_range(tk.v);
        for (let l = r.s.r; l <= r.e.r; l++)
          for (let c = r.s.c; c <= r.e.c; c++) refs.push(XLSX.utils.encode_cell({ r: l, c }));
      }
    }
    return refs;
  } catch {
    return [];
  }
}

export function recalcular(
  aba: Aba,
  celula: Celula,
  pilha: Set<string> = new Set(),
): ResultadoFormula {
  if (!celula.formula) return { suportada: false, valor: null, erro: null, referencias: [] };
  if (/\[\d+\]|!/.test(celula.formula.replace(/#REF!/g, ""))) {
    return {
      suportada: false,
      valor: null,
      erro: "vínculo externo ou outra aba (não recalculado)",
      referencias: [],
    };
  }
  let tokens: Token[];
  try {
    tokens = tokenizar(celula.formula);
  } catch (e) {
    return { suportada: false, valor: null, erro: (e as Error).message, referencias: [] };
  }
  const referencias = referenciasDaFormula(celula.formula);
  pilha.add(celula.ref);
  let pos = 0;
  let erro: string | null = null;

  const valorRef = (ref: string, ignorarTexto: boolean): number | string => {
    const alvo = aba.porRef.get(ref);
    if (!alvo) return 0;
    if (alvo.formula) {
      if (pilha.has(ref)) {
        erro = "referência circular";
        return 0;
      }
      const r = recalcular(aba, alvo, new Set(pilha));
      if (r.erro) erro = r.erro;
      return r.valor ?? 0;
    }
    if (typeof alvo.bruto === "number") return alvo.bruto;
    if (ignorarTexto) return 0;
    return alvo.texto;
  };

  const expr = (): number | string => {
    let v = termo();
    while (tokens[pos]?.t === "op" && "+-".includes((tokens[pos] as { v: string }).v)) {
      const op = (tokens[pos++] as { v: string }).v;
      const d = termo();
      v = op === "+" ? Number(v) + Number(d) : Number(v) - Number(d);
    }
    return v;
  };
  const termo = (): number | string => {
    let v = fator();
    while (tokens[pos]?.t === "op" && "*/".includes((tokens[pos] as { v: string }).v)) {
      const op = (tokens[pos++] as { v: string }).v;
      const d = fator();
      v =
        op === "*"
          ? Number(v) * Number(d)
          : Number(d) === 0
            ? ((erro = "#DIV/0!"), 0)
            : Number(v) / Number(d);
    }
    return v;
  };
  const fator = (): number | string => {
    const tk = tokens[pos++];
    if (!tk) throw new Error("fórmula incompleta");
    if (tk.t === "num") return tk.v;
    if (tk.t === "str") return tk.v;
    if (tk.t === "err") {
      erro = tk.v;
      return 0;
    }
    if (tk.t === "op" && tk.v === "-") return -Number(fator());
    if (tk.t === "ref") return valorRef(tk.v, false);
    if (tk.t === "(") {
      const v = expr();
      pos++; // )
      return v;
    }
    if (tk.t === "func") {
      if (tk.v !== "SUM") throw new Error(`função ${tk.v} não suportada`);
      pos++; // (
      let soma = 0;
      while (tokens[pos] && tokens[pos]!.t !== ")") {
        const a = tokens[pos]!;
        if (a.t === ",") {
          pos++;
          continue;
        }
        if (a.t === "range") {
          pos++;
          const r = XLSX.utils.decode_range(a.v);
          for (let l = r.s.r; l <= r.e.r; l++)
            for (let c = r.s.c; c <= r.e.c; c++) {
              const v = valorRef(XLSX.utils.encode_cell({ r: l, c }), true);
              soma += typeof v === "number" ? v : 0;
            }
          continue;
        }
        if (a.t === "ref") {
          pos++;
          const v = valorRef(a.v, true);
          soma += typeof v === "number" ? v : 0;
          continue;
        }
        if (a.t === "err") {
          pos++;
          erro = a.v;
          continue;
        }
        const v = expr();
        soma += Number(v) || 0;
      }
      pos++; // )
      return soma;
    }
    throw new Error("token inesperado");
  };

  try {
    const v = expr();
    if (erro) return { suportada: true, valor: null, erro, referencias };
    return {
      suportada: true,
      valor: typeof v === "number" ? Math.round(v * 100) / 100 : v,
      erro: null,
      referencias,
    };
  } catch (e) {
    return { suportada: false, valor: null, erro: (e as Error).message, referencias };
  }
}
