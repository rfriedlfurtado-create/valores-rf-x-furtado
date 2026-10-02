/**
 * Leitura INTEGRAL do arquivo Excel: todas as abas, todas as células com
 * conteúdo (inclusive em linhas/colunas ocultas), fórmulas, resultados
 * armazenados, formatos, células mescladas, comentários e cores.
 *
 * Nada é descartado aqui; a interpretação acontece depois.
 */

import * as XLSX from "xlsx";

import { isoDe, type DataLida } from "./texto";

export type TipoCelula = "n" | "s" | "b" | "d" | "e";

export interface Celula {
  aba: string;
  ref: string;
  linha: number; // 1-based
  coluna: number; // 1-based
  tipo: TipoCelula;
  /** Valor bruto armazenado (número, texto, booleano). */
  bruto: string | number | boolean;
  /** Conteúdo original como texto (texto exato; números em notação JS). */
  texto: string;
  /** Texto exibido pelo Excel, quando disponível. */
  exibido: string | null;
  formula: string | null;
  formato: string | null;
  data: DataLida | null;
  cor: string | null;
  oculta: boolean;
  mesclada: string | null;
  comentario: string | null;
}

export interface Aba {
  nome: string;
  indice: number;
  celulas: Celula[];
  porRef: Map<string, Celula>;
  maxLinha: number;
  maxColuna: number;
  mescladas: string[];
  linhasOcultas: number[];
  colunasOcultas: number[];
}

export interface PlanilhaLida {
  abas: Aba[];
}

export function letraColuna(coluna: number): string {
  return XLSX.utils.encode_col(coluna - 1);
}

export function refDe(linha: number, coluna: number): string {
  return `${letraColuna(coluna)}${linha}`;
}

function corDaCelula(cel: XLSX.CellObject): string | null {
  const s = (cel as { s?: { patternType?: string; fgColor?: { rgb?: string; theme?: number } } }).s;
  if (!s || !s.patternType || s.patternType === "none") return null;
  const rgb = s.fgColor?.rgb;
  if (rgb) return rgb.length === 8 ? rgb.slice(2) : rgb;
  if (s.fgColor?.theme !== undefined) return `tema:${s.fgColor.theme}`;
  return null;
}

function formatoTemDia(formato: string): boolean {
  return /d/i.test(formato.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, ""));
}

function formatoTemAno(formato: string): boolean {
  return /y/i.test(formato.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, ""));
}

/** Converte serial do Excel em data, respeitando a precisão do formato exibido. */
function dataDoSerial(serial: number, formato: string): DataLida | null {
  const p = XLSX.SSF.parse_date_code(serial);
  if (!p || !p.y) return null;
  const temDia = formatoTemDia(formato);
  const temAno = formatoTemAno(formato);
  if (!temDia) {
    return {
      iso: null,
      texto: `${String(p.m).padStart(2, "0")}/${p.y}`,
      precisao: "mes",
      ano: p.y,
      mes: p.m,
      dia: null,
    };
  }
  return {
    iso: isoDe(p.y, p.m, p.d),
    texto: `${String(p.d).padStart(2, "0")}/${String(p.m).padStart(2, "0")}/${p.y}`,
    precisao: temAno ? "dia" : "dia",
    ano: p.y,
    mes: p.m,
    dia: p.d,
  };
}

export function lerWorkbook(workbook: XLSX.WorkBook): PlanilhaLida {
  const abas: Aba[] = [];
  workbook.SheetNames.forEach((nome, indice) => {
    const ws = workbook.Sheets[nome];
    if (!ws) return;
    const merges = (ws["!merges"] ?? []).map((m) => XLSX.utils.encode_range(m));
    const mergeDe = new Map<string, string>();
    for (const m of ws["!merges"] ?? []) {
      const nomeRange = XLSX.utils.encode_range(m);
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++)
          mergeDe.set(XLSX.utils.encode_cell({ r, c }), nomeRange);
      }
    }
    const linhasOcultas = (ws["!rows"] ?? [])
      .map((r, i) => (r && (r as { hidden?: boolean }).hidden ? i + 1 : 0))
      .filter(Boolean);
    const colunasOcultas = (ws["!cols"] ?? [])
      .map((c, i) => (c && (c as { hidden?: boolean }).hidden ? i + 1 : 0))
      .filter(Boolean);

    const celulas: Celula[] = [];
    let maxLinha = 0;
    let maxColuna = 0;
    for (const chave of Object.keys(ws)) {
      if (chave.startsWith("!")) continue;
      const cel = ws[chave] as XLSX.CellObject;
      if (!cel) continue;
      const temFormula = typeof cel.f === "string" && cel.f.length > 0;
      const vazio =
        (cel.v === undefined ||
          cel.v === null ||
          (typeof cel.v === "string" && cel.v.trim() === "")) &&
        !temFormula;
      if (vazio) continue;
      const { r, c } = XLSX.utils.decode_cell(chave);
      const linha = r + 1;
      const coluna = c + 1;
      const formato = typeof cel.z === "string" ? cel.z : null;
      let tipo: TipoCelula = cel.t === "n" ? "n" : cel.t === "b" ? "b" : cel.t === "e" ? "e" : "s";
      let data: DataLida | null = null;
      if (cel.t === "n" && formato && XLSX.SSF.is_date(formato) && typeof cel.v === "number") {
        data = dataDoSerial(cel.v, formato);
        if (data) tipo = "d";
      }
      const bruto = (cel.v ?? (cel.t === "e" ? String(cel.w ?? "#ERRO") : "")) as
        string | number | boolean;
      const comentarios = (cel as { c?: { a?: string; t?: string }[] }).c;
      celulas.push({
        aba: nome,
        ref: chave,
        linha,
        coluna,
        tipo,
        bruto,
        texto: typeof bruto === "string" ? bruto : String(bruto),
        exibido: typeof cel.w === "string" ? cel.w : null,
        formula: temFormula ? `=${cel.f}` : null,
        formato,
        data,
        cor: corDaCelula(cel),
        oculta: linhasOcultas.includes(linha) || colunasOcultas.includes(coluna),
        mesclada: mergeDe.get(chave) ?? null,
        comentario: comentarios?.length
          ? comentarios.map((x) => `${x.a ? `${x.a}: ` : ""}${x.t ?? ""}`).join("\n")
          : null,
      });
      maxLinha = Math.max(maxLinha, linha);
      maxColuna = Math.max(maxColuna, coluna);
    }
    celulas.sort((a, b) => a.linha - b.linha || a.coluna - b.coluna);
    abas.push({
      nome,
      indice,
      celulas,
      porRef: new Map(celulas.map((x) => [x.ref, x])),
      maxLinha,
      maxColuna,
      mescladas: merges,
      linhasOcultas,
      colunasOcultas,
    });
  });
  return { abas };
}

/** Opções de leitura usadas no navegador e nos testes (mesmo resultado). */
export const OPCOES_LEITURA: XLSX.ParsingOptions = {
  cellFormula: true,
  cellStyles: true,
  cellNF: true,
  cellDates: false,
  cellText: true,
  sheetStubs: false,
};

export function lerArquivoBinario(dados: ArrayBuffer | Uint8Array): PlanilhaLida {
  const wb = XLSX.read(dados, { type: "array", ...OPCOES_LEITURA });
  return lerWorkbook(wb);
}

/** Linhas da aba indexadas por número (só as que têm conteúdo). */
export function linhasDaAba(aba: Aba): Map<number, Celula[]> {
  const mapa = new Map<number, Celula[]>();
  for (const c of aba.celulas) {
    const lista = mapa.get(c.linha) ?? [];
    lista.push(c);
    mapa.set(c.linha, lista);
  }
  return mapa;
}
