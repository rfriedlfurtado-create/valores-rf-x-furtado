/**
 * MODALIDADE "CLIENTES COM VALORES RECEBIDOS" — mapeamento e leitura da
 * planilha (funções puras, testadas em tests/importacao-recebimentos.test.ts).
 *
 * É um fluxo SEPARADO do modelo oficial de cadastro (src/lib/rf): esta
 * planilha não cria clientes nem processos — só identifica o cliente pelo
 * Reclamante (ou CPF, quando houver) e registra os valores recebidos.
 *
 * Colunas reconhecidas pelo cabeçalho (sem depender da posição):
 *   Reclamante (ÚNICA obrigatória) · CPF · Valor · Categoria/Tipo · Data ·
 *   Número do processo · Pasta · Observação
 * e também colunas por categoria — "Contratual", "Atrasados",
 * "Sucumbência" — em que cada célula com valor vira um recebimento próprio.
 *
 * Valor é OPCIONAL: linha só com o Reclamante identifica o cliente e o move
 * para JÁ PAGOS sem lançar valor; os valores podem ser lançados depois,
 * manualmente, no perfil do cliente.
 */

import * as XLSX from "xlsx";

import { normalizarCabecalho } from "@/lib/rf/campos";
import {
  cpfValido,
  interpretarDataTexto,
  interpretarNumeroTexto,
  serialExcelParaPartes,
  somenteDigitos,
  type CelulaBruta,
} from "@/lib/rf/valores";
import { normalizarTexto } from "@/lib/situacao";
import { ROTULO_CLASSIFICACAO, type ClassificacaoEntrada } from "@/lib/tipos";

export type CampoRecebimento =
  | "reclamante"
  | "cpf"
  | "valor"
  | "categoria"
  | "data"
  | "numero"
  | "pasta"
  | "observacao"
  | "valor_contratuais"
  | "valor_atrasados"
  | "valor_sucumbencia";

export interface DefinicaoCampo {
  campo: CampoRecebimento;
  rotulo: string;
  obrigatorio?: boolean;
  /** Cabeçalhos aceitos (comparados já normalizados). */
  cabecalhos: string[];
}

/** Mapeamento oficial desta modalidade (único lugar com os cabeçalhos aceitos). */
export const CAMPOS_RECEBIMENTO: DefinicaoCampo[] = [
  {
    campo: "reclamante",
    rotulo: "Reclamante",
    obrigatorio: true,
    cabecalhos: ["Reclamante", "Nome do reclamante", "Cliente", "Nome do cliente", "Nome"],
  },
  {
    campo: "cpf",
    rotulo: "CPF",
    cabecalhos: ["CPF", "CPF Reclamante", "CPF do reclamante", "CPF do cliente", "CPF/CNPJ"],
  },
  {
    campo: "valor",
    rotulo: "Valor",
    cabecalhos: [
      "Valor",
      "Valor recebido",
      "Valores recebidos",
      "Valor pago",
      "Valor R$",
      "Recebido",
      "Valor do recebimento",
      "Valor líquido",
    ],
  },
  {
    campo: "categoria",
    rotulo: "Categoria",
    cabecalhos: [
      "Categoria",
      "Tipo",
      "Tipo do valor",
      "Tipo de valor",
      "Classificação",
      "Natureza",
      "Tipo de recebimento",
      "Categoria do valor",
    ],
  },
  {
    campo: "data",
    rotulo: "Data",
    cabecalhos: [
      "Data",
      "Data do pagamento",
      "Data pagamento",
      "Data de pagamento",
      "Data do recebimento",
      "Data recebimento",
      "Data de recebimento",
      "Pago em",
      "Recebido em",
    ],
  },
  {
    campo: "numero",
    rotulo: "Número do processo",
    cabecalhos: ["Número", "Número do processo", "Processo", "Nº processo", "Nº do processo"],
  },
  { campo: "pasta", rotulo: "Pasta", cabecalhos: ["Pasta", "Código da pasta"] },
  {
    campo: "observacao",
    rotulo: "Observação",
    cabecalhos: ["Observação", "Observações", "Obs", "Descrição", "Histórico"],
  },
  {
    campo: "valor_contratuais",
    rotulo: "Valor Contratual",
    cabecalhos: ["Contratual", "Contratuais", "Honorários contratuais", "Valor contratual"],
  },
  {
    campo: "valor_atrasados",
    rotulo: "Valor Atrasados",
    cabecalhos: ["Atrasados", "Atrasado", "Valor atrasados", "Valores atrasados"],
  },
  {
    campo: "valor_sucumbencia",
    rotulo: "Valor Sucumbência",
    cabecalhos: [
      "Sucumbência",
      "Sucumbências",
      "Honorários de sucumbência",
      "Honorários sucumbenciais",
      "Valor sucumbência",
    ],
  },
];

const CATEGORIA_DA_COLUNA: Partial<Record<CampoRecebimento, ClassificacaoEntrada>> = {
  valor_contratuais: "contratuais",
  valor_atrasados: "atrasados",
  valor_sucumbencia: "sucumbencia",
};

const INDICE: Map<string, CampoRecebimento> = (() => {
  const m = new Map<string, CampoRecebimento>();
  for (const d of CAMPOS_RECEBIMENTO)
    for (const c of d.cabecalhos) {
      const k = normalizarCabecalho(c.replace(/º/g, ""));
      if (!m.has(k)) m.set(k, d.campo);
    }
  return m;
})();

export function campoDoCabecalho(cabecalho: string): CampoRecebimento | null {
  return INDICE.get(normalizarCabecalho(cabecalho.replace(/º/g, ""))) ?? null;
}

/** Texto livre → categoria oficial (null = não reconhecida / vazia). */
export function categoriaDoTexto(texto: string | null | undefined): ClassificacaoEntrada | null {
  const t = normalizarTexto(texto ?? "");
  if (!t) return null;
  if (t.includes("contrat")) return "contratuais";
  if (t.includes("atrasad") || t.includes("retroativ")) return "atrasados";
  if (t.includes("sucumb")) return "sucumbencia";
  return null;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface EntradaLida {
  valor: number;
  classificacao: ClassificacaoEntrada | null;
  /** Texto da categoria como estava na planilha. */
  categoriaTexto: string | null;
  /** Cabeçalho da coluna de onde veio o valor. */
  coluna: string;
}

export interface LinhaRecebimento {
  /** Número da linha no Excel. */
  linha: number;
  reclamante: string;
  nome_normalizado: string;
  cpf: string | null;
  cpf_digitos: string | null;
  cpf_valido: boolean;
  numero: string | null;
  numero_digitos: string | null;
  pasta: string | null;
  /** AAAA-MM-DD ou null. */
  data: string | null;
  observacao: string | null;
  /** Valores da linha (vazio = cliente recebeu, valor a lançar no perfil). */
  entradas: EntradaLida[];
  /** Conteúdo original da linha (cabeçalho → texto), guardado com cada recebimento. */
  original: Record<string, string>;
  avisos: string[];
}

export interface LinhaPendenteRecebimento {
  linha: number;
  motivo: string;
  resumo: string;
}

export interface PlanilhaRecebimentos {
  aba: string;
  cabecalhos: string[];
  colunas: Map<number, CampoRecebimento>;
  /** Colunas não reconhecidas (guardadas no conteúdo original). */
  extras: Map<number, string>;
  linhas: LinhaRecebimento[];
  /** Linhas sem Reclamante. */
  pendentes: LinhaPendenteRecebimento[];
}

export class ErroPlanilhaRecebimentos extends Error {}

function textoCelula(c: CelulaBruta | undefined): string | null {
  if (!c || c.t === "z" || c.v === undefined || c.v === null) return null;
  const t = String(c.w ?? c.v).trim();
  return t === "" ? null : t;
}

function valorCelula(c: CelulaBruta | undefined): number | null {
  if (!c || c.v === undefined || c.v === null) return null;
  if (c.t === "n" && typeof c.v === "number") return Math.round(c.v * 100) / 100;
  const t = textoCelula(c);
  if (!t) return null;
  const n = interpretarNumeroTexto(t);
  return n === null ? null : Math.round(n * 100) / 100;
}

const pad = (n: number) => String(n).padStart(2, "0");

function dataCelula(c: CelulaBruta | undefined): string | null | undefined {
  if (!c || c.v === undefined || c.v === null) return null;
  if (c.t === "n" && typeof c.v === "number") {
    if (c.v <= 0 || c.v >= 109575) return undefined;
    const p = serialExcelParaPartes(c.v);
    return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`;
  }
  const t = textoCelula(c);
  if (!t) return null;
  return interpretarDataTexto(t)?.iso ?? undefined;
}

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Lê a planilha: procura a linha de cabeçalho (com "Reclamante") nas 10 primeiras linhas de cada aba. */
export function lerPlanilhaRecebimentos(dados: ArrayBuffer | Uint8Array): PlanilhaRecebimentos {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(dados, { type: "array", cellNF: true, cellText: true, cellDates: false });
  } catch {
    throw new ErroPlanilhaRecebimentos(
      "Não foi possível ler o arquivo. Envie uma planilha Excel (.xlsx ou .xls).",
    );
  }

  for (const aba of wb.SheetNames) {
    const ws = wb.Sheets[aba];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cel = (r: number, c: number) =>
      ws[XLSX.utils.encode_cell({ r, c })] as CelulaBruta | undefined;

    for (let rCab = range.s.r; rCab <= Math.min(range.e.r, range.s.r + 9); rCab++) {
      const cabecalhos: string[] = [];
      const colunas = new Map<number, CampoRecebimento>();
      const extras = new Map<number, string>();
      const usados = new Set<CampoRecebimento>();
      for (let c = 0; c <= range.e.c; c++) {
        const cab = textoCelula(cel(rCab, c)) ?? "";
        cabecalhos.push(cab);
        if (!cab) continue;
        const campo = campoDoCabecalho(cab);
        if (campo && !usados.has(campo)) {
          colunas.set(c, campo);
          usados.add(campo);
        } else extras.set(c, cab);
      }
      // Só o Reclamante é obrigatório; colunas de valor são opcionais.
      if (!usados.has("reclamante")) continue;

      const linhas: LinhaRecebimento[] = [];
      const pendentes: LinhaPendenteRecebimento[] = [];
      for (let r = rCab + 1; r <= range.e.r; r++) {
        const original: Record<string, string> = {};
        let algum = false;
        for (let c = 0; c <= range.e.c; c++) {
          const t = textoCelula(cel(r, c));
          if (t === null) continue;
          algum = true;
          original[cabecalhos[c] || `Coluna ${XLSX.utils.encode_col(c)}`] = t;
        }
        if (!algum) continue;
        linhas.push(
          ...interpretarLinha(r + 1, colunas, cabecalhos, cel.bind(null, r), original, pendentes),
        );
      }
      return { aba, cabecalhos, colunas, extras, linhas, pendentes };
    }
  }

  throw new ErroPlanilhaRecebimentos(
    'Nenhuma aba tem a coluna "Reclamante". A planilha de clientes com valores recebidos deve ter ao menos o cabeçalho "Reclamante" (as demais colunas são opcionais).',
  );
}

function interpretarLinha(
  linha: number,
  colunas: Map<number, CampoRecebimento>,
  cabecalhos: string[],
  cel: (c: number) => CelulaBruta | undefined,
  original: Record<string, string>,
  pendentes: LinhaPendenteRecebimento[],
): LinhaRecebimento[] {
  const avisos: string[] = [];
  const col = (campo: CampoRecebimento) => [...colunas.entries()].find(([, c]) => c === campo)?.[0];
  const texto = (campo: CampoRecebimento) => {
    const i = col(campo);
    return i === undefined ? null : textoCelula(cel(i));
  };

  const reclamante = texto("reclamante") ?? "";
  const categoriaTexto = texto("categoria");
  const categoria = categoriaDoTexto(categoriaTexto);
  if (categoriaTexto && !categoria)
    avisos.push(
      `Categoria "${categoriaTexto}" não reconhecida — escolha Contratual, Atrasados ou Sucumbência.`,
    );

  const entradas: EntradaLida[] = [];
  for (const [i, campo] of colunas) {
    const daColuna = CATEGORIA_DA_COLUNA[campo];
    if (campo !== "valor" && !daColuna) continue;
    const c = cel(i);
    const bruto = textoCelula(c);
    if (bruto === null) continue;
    const v = valorCelula(c);
    const nomeCol = cabecalhos[i] ?? campo;
    if (v === null) {
      avisos.push(`${nomeCol}: "${bruto}" não é um valor numérico (ignorado).`);
      continue;
    }
    if (v <= 0) {
      avisos.push(`${nomeCol}: ${brl(v)} não é um valor recebido (ignorado).`);
      continue;
    }
    entradas.push({
      valor: v,
      classificacao: daColuna ?? categoria,
      categoriaTexto: daColuna ? ROTULO_CLASSIFICACAO[daColuna] : categoriaTexto,
      coluna: nomeCol,
    });
  }

  let data: string | null = null;
  const iData = col("data");
  if (iData !== undefined) {
    const d = dataCelula(cel(iData));
    if (d === undefined) avisos.push(`Data "${textoCelula(cel(iData))}" não reconhecida.`);
    else data = d;
  }

  const cpf = texto("cpf");
  const cpfDigitos = somenteDigitos(cpf) || null;
  const numero = texto("numero");

  const resumo = [reclamante, cpf && `CPF ${cpf}`, entradas.map((e) => brl(e.valor)).join(" + ")]
    .filter(Boolean)
    .join(" · ");

  if (!reclamante.trim()) {
    pendentes.push({
      linha,
      motivo: "Reclamante não preenchido.",
      resumo: resumo || "Linha com outros dados",
    });
    return [];
  }
  // Sem valor: a linha continua válida (cliente vai para JÁ PAGOS; valores
  // são lançados depois, manualmente, no perfil).

  return [
    {
      linha,
      reclamante: reclamante.trim(),
      nome_normalizado: normalizarTexto(reclamante),
      cpf,
      cpf_digitos: cpfDigitos,
      cpf_valido: cpfValido(cpfDigitos),
      numero,
      numero_digitos: somenteDigitos(numero) || null,
      pasta: texto("pasta"),
      data,
      observacao: texto("observacao"),
      entradas,
      original,
      avisos,
    },
  ];
}

// ---------------------------------------------------------------------------
// Modelo vazio para download
// ---------------------------------------------------------------------------

export const ARQUIVO_MODELO_RECEBIMENTOS = "/modelos/modelo-clientes-valores-recebidos.xlsx";
export const CABECALHOS_MODELO_RECEBIMENTOS = [
  "Reclamante",
  "CPF",
  "Valor",
  "Categoria",
  "Data",
  "Número",
  "Pasta",
  "Observação",
];
