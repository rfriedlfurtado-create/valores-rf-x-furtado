/**
 * Leitura de arquivos de importação (planilhas e Word), compartilhada por
 * todos os importadores do sistema (clientes novos, pagamentos, etc).
 *
 * Centralizado aqui para nunca duplicar a lógica de parsing entre os
 * diferentes fluxos de importação — cada importador só decide o que fazer
 * com os registros já extraídos.
 */

import * as mammoth from "mammoth";
import * as XLSX from "xlsx";

import { parseBRL } from "./format";

export type CampoBase = "nome" | "cpf" | "valor" | "data" | "ignorar";

export const ROTULO_CAMPO_BASE: Record<CampoBase, string> = {
  nome: "Nome",
  cpf: "CPF",
  valor: "Valor",
  data: "Data",
  ignorar: "Ignorar",
};

/** Tenta adivinhar o campo (nome/cpf/valor/data) a partir do texto do cabeçalho. */
export function adivinharCampoBase(cabecalho: string): CampoBase {
  const h = cabecalho.toLowerCase();
  if (/nome|cliente|parte|autor/.test(h)) return "nome";
  if (/cpf/.test(h)) return "cpf";
  if (/valor|montante|quantia|r\$/.test(h)) return "valor";
  if (/data/.test(h)) return "data";
  return "ignorar";
}

/** Converte uma célula de data (Date do xlsx, serial ou texto) para YYYY-MM-DD. */
export function parseDataCell(valor: unknown): string | null {
  if (valor == null || valor === "") return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return valor.toISOString().slice(0, 10);
  }
  const texto = String(valor).trim();
  const br = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (br && br[1] && br[2] && br[3]) {
    return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  return null;
}

export interface LinhaLivre {
  nome: string;
  cpf: string | null;
  valor: number | null;
  data: string | null;
}

/** Extrai os parágrafos não-vazios de um .docx como texto puro. */
export async function lerDocx(arquivo: File): Promise<string[]> {
  const buffer = await arquivo.arrayBuffer();
  const resultado = await mammoth.extractRawText({ arrayBuffer: buffer });
  return resultado.value
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0);
}

/**
 * Interpreta uma linha de texto livre (sem colunas definidas) tentando
 * reconhecer CPF, valor em reais e data no meio do texto, sobrando o
 * nome. Heurística — menos confiável que planilha, por isso o usuário
 * sempre revisa a prévia antes de importar.
 */
export function interpretarLinhaLivre(linhaOriginal: string): LinhaLivre {
  let sobra = linhaOriginal;

  let cpf: string | null = null;
  const matchCpf = sobra.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);
  if (matchCpf?.[1]) {
    cpf = matchCpf[1];
    sobra = sobra.replace(matchCpf[0], " ");
  }

  let data: string | null = null;
  const matchData = sobra.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/);
  if (matchData?.[1]) {
    data = parseDataCell(matchData[1]);
    sobra = sobra.replace(matchData[0], " ");
  }

  let valor: number | null = null;
  const matchValor =
    sobra.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i) ??
    sobra.match(/\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/);
  if (matchValor?.[1]) {
    valor = parseBRL(matchValor[1]) || null;
    sobra = sobra.replace(matchValor[0], " ");
  }

  const nome = sobra
    .replace(/\bCPF\b:?/gi, " ")
    .replace(/[-–—:;|]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { nome, cpf, valor, data };
}

/** Gera e baixa uma planilha-modelo (.xlsx) com as colunas aceitas na importação. */
export function gerarModelo(nomeArquivo: string, linhas: (string | number)[][]) {
  const planilha = XLSX.utils.aoa_to_sheet(linhas);
  planilha["!cols"] = linhas[0]?.map(() => ({ wch: 20 })) ?? [];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Dados");
  XLSX.writeFile(workbook, nomeArquivo);
}

export interface PlanilhaLida {
  cabecalhos: string[];
  linhas: unknown[][];
  temCabecalho: boolean;
}

/** Lê a planilha inteira (todas as colunas), sem aplicar mapeamento ainda. */
export async function lerPlanilha(arquivo: File): Promise<PlanilhaLida> {
  const buffer = await arquivo.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const planilha = workbook.Sheets[workbook.SheetNames[0]!];
  if (!planilha) return { cabecalhos: [], linhas: [], temCabecalho: false };
  return montarPlanilhaLida(
    XLSX.utils.sheet_to_json<unknown[]>(planilha, { header: 1, blankrows: false }),
    { tipo: "auto" },
  );
}

/** Relê o mesmo workbook forçando se a primeira linha é ou não cabeçalho (troca manual do usuário). */
export async function relerComCabecalho(
  arquivo: File,
  usaCabecalho: boolean,
): Promise<PlanilhaLida> {
  const buffer = await arquivo.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const folha = workbook.Sheets[workbook.SheetNames[0]!];
  const todasLinhas = folha
    ? XLSX.utils.sheet_to_json<unknown[]>(folha, { header: 1, blankrows: false })
    : [];
  return montarPlanilhaLida(todasLinhas, { tipo: "forcado", valor: usaCabecalho });
}

type ModoCabecalho = { tipo: "auto" } | { tipo: "forcado"; valor: boolean };

function montarPlanilhaLida(todasLinhas: unknown[][], modo: ModoCabecalho): PlanilhaLida {
  const linhasComConteudo = todasLinhas.filter(
    (linha) => Array.isArray(linha) && linha.some((c) => c != null && String(c).trim() !== ""),
  );
  if (linhasComConteudo.length === 0) return { cabecalhos: [], linhas: [], temCabecalho: false };

  const numColunas = Math.max(1, ...linhasComConteudo.map((l) => l.length));
  const primeira = linhasComConteudo[0]!;

  let temCabecalho: boolean;
  if (modo.tipo === "forcado") {
    temCabecalho = modo.valor;
  } else {
    const primeiraEhTexto = primeira.every((c) => c == null || typeof c !== "number");
    const restoTemNumero = linhasComConteudo
      .slice(1)
      .some((l) => l.some((c) => typeof c === "number" || c instanceof Date));
    temCabecalho = primeiraEhTexto && restoTemNumero;
  }

  const cabecalhos = Array.from({ length: numColunas }, (_, i) =>
    temCabecalho ? String(primeira[i] ?? `Coluna ${i + 1}`).trim() : `Coluna ${i + 1}`,
  );
  const linhas = temCabecalho ? linhasComConteudo.slice(1) : linhasComConteudo;

  return { cabecalhos, linhas, temCabecalho };
}
