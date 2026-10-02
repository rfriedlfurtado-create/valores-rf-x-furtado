/**
 * Leitura da planilha no modelo Ricardo Friedl e montagem das linhas que
 * serão enviadas ao banco (função `aplicar_importacao_rf`).
 *
 * Funções puras (sem acesso ao banco) — testadas em tests/importacao-rf.test.ts.
 */

import * as XLSX from "xlsx";

import { normalizarTexto } from "@/lib/situacao";

import {
  CAMPO_POR_CHAVE,
  CAMPOS_MODELO,
  mapearCabecalhos,
  type ChaveCampo,
  type MapeamentoColunas,
} from "./campos";
import { converterCelula, cpfValido, somenteDigitos, type CelulaBruta } from "./valores";

export interface LinhaLida {
  /** Número da linha no Excel (1 = cabeçalho). */
  linha: number;
  celulas: (CelulaBruta | undefined)[];
}

export interface PlanilhaLida {
  aba: string;
  abas: string[];
  mapeamento: MapeamentoColunas;
  linhas: LinhaLida[];
  /** Linhas totalmente vazias ignoradas. */
  vazias: number;
}

export class ErroPlanilha extends Error {}

function celulaVazia(c: CelulaBruta | undefined): boolean {
  if (!c || c.t === "z" || c.v === undefined || c.v === null) return true;
  return c.t === "s" && String(c.v).trim() === "";
}

/** Lê o arquivo e localiza a aba do modelo (a que tem a coluna "Reclamante" na 1ª linha). */
export function lerPlanilha(dados: ArrayBuffer | Uint8Array): PlanilhaLida {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(dados, { type: "array", cellNF: true, cellText: true, cellDates: false });
  } catch {
    throw new ErroPlanilha(
      "Não foi possível ler o arquivo. Envie uma planilha Excel (.xlsx ou .xls).",
    );
  }

  for (const aba of wb.SheetNames) {
    const ws = wb.Sheets[aba];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const linhaCab = range.s.r;
    const cabecalhos: string[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      const cel = ws[XLSX.utils.encode_cell({ r: linhaCab, c })] as CelulaBruta | undefined;
      cabecalhos.push(cel && !celulaVazia(cel) ? String(cel.w ?? cel.v) : "");
    }
    const mapeamento = mapearCabecalhos(cabecalhos);
    if (![...mapeamento.campos.values()].includes("nome")) continue;

    const linhas: LinhaLida[] = [];
    let vazias = 0;
    let vaziasPendentes = 0; // vazias no fim da planilha (só formatação) não contam
    for (let r = linhaCab + 1; r <= range.e.r; r++) {
      const celulas: (CelulaBruta | undefined)[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        celulas.push(ws[XLSX.utils.encode_cell({ r, c })] as CelulaBruta | undefined);
      }
      if (celulas.every(celulaVazia)) {
        vaziasPendentes += 1;
        continue;
      }
      vazias += vaziasPendentes;
      vaziasPendentes = 0;
      linhas.push({ linha: r + 1, celulas });
    }
    return { aba, abas: wb.SheetNames, mapeamento, linhas, vazias };
  }

  throw new ErroPlanilha(
    'Nenhuma aba tem a coluna "Reclamante" na primeira linha. A primeira linha deve conter os cabeçalhos do modelo.',
  );
}

// ---------------------------------------------------------------------------
// Interpretação das linhas
// ---------------------------------------------------------------------------

export interface AvisoLinha {
  linha: number;
  campo: string;
  mensagem: string;
}

/** Linha pronta para o banco (formato esperado por `aplicar_importacao_rf`). */
export interface LinhaPayload {
  linha: number;
  chave: string;
  nome: string;
  nome_normalizado: string;
  cpf: string | null;
  cpf_digitos: string | null;
  cpf_valido: boolean;
  cliente: Partial<Record<ChaveCampo, string>>;
  registro: Partial<Record<ChaveCampo, string>>;
  numero_digitos: string | null;
  tipo_norm: string | null;
  extras: Record<string, string>;
  valores: Record<string, string>;
  avisos: string[];
}

export interface LinhaPendente {
  linha: number;
  motivo: string;
  /** Resumo do conteúdo da linha, para o usuário reconhecer o registro. */
  resumo: string;
}

export interface ResultadoInterpretacao {
  validas: LinhaPayload[];
  pendentes: LinhaPendente[];
  avisos: AvisoLinha[];
}

/**
 * Decisão do usuário para colunas adicionais: mapear para um campo do modelo
 * (ausente no arquivo) ou manter em "Informações adicionais" (null).
 */
export type MapeamentoExtras = Map<number, ChaveCampo | null>;

/** Chave estável da linha: código da pasta (único por registro no Espaider) ou impressão digital do conteúdo. */
export function chaveDaLinha(p: Omit<LinhaPayload, "chave">): string {
  const pasta = p.registro.pasta?.trim();
  if (pasta) return `pasta:${pasta.toUpperCase()}`;
  return [
    "fp",
    p.nome_normalizado,
    p.cpf_digitos ?? "",
    p.numero_digitos ?? "",
    p.tipo_norm ?? "",
    p.registro.captado_em ?? "",
    p.registro.distribuido_em ?? "",
    normalizarTexto(p.registro.adverso ?? ""),
  ].join("|");
}

export function interpretarLinhas(
  planilha: Pick<PlanilhaLida, "mapeamento" | "linhas">,
  opcoes: { extras?: MapeamentoExtras; nomesCorrigidos?: Map<number, string> } = {},
): ResultadoInterpretacao {
  const { mapeamento } = planilha;
  const extrasMapeados = opcoes.extras ?? new Map();
  const validas: LinhaPayload[] = [];
  const pendentes: LinhaPendente[] = [];
  const avisos: AvisoLinha[] = [];

  // Colunas → campo (colunas extras mapeadas pelo usuário entram aqui).
  const colunas = new Map(mapeamento.campos);
  const colunasExtras = new Map<number, string>();
  for (const [indice, cabecalho] of mapeamento.extras) {
    const destino = extrasMapeados.get(indice);
    if (destino && ![...colunas.values()].includes(destino)) colunas.set(indice, destino);
    else colunasExtras.set(indice, cabecalho || `Coluna ${XLSX.utils.encode_col(indice)}`);
  }

  for (const lida of planilha.linhas) {
    const cliente: LinhaPayload["cliente"] = {};
    const registro: LinhaPayload["registro"] = {};
    const valores: Record<string, string> = {};
    const avisosLinha: string[] = [];
    let nome = "";
    let cpf: string | null = null;

    for (const [indice, chave] of colunas) {
      const conv = converterCelula(chave, lida.celulas[indice]);
      for (const a of conv.avisos) {
        avisosLinha.push(a);
        avisos.push({ linha: lida.linha, campo: CAMPO_POR_CHAVE.get(chave)!.rotulo, mensagem: a });
      }
      if (conv.original !== null) valores[chave] = conv.original;
      if (conv.valor === null) continue;
      if (chave === "nome") nome = conv.valor;
      else if (chave === "cpf_reclamante") cpf = conv.valor;
      else if (CAMPO_POR_CHAVE.get(chave)!.entidade === "cliente") cliente[chave] = conv.valor;
      else registro[chave] = conv.valor;
    }

    const extras: Record<string, string> = {};
    for (const [indice, cabecalho] of colunasExtras) {
      const c = lida.celulas[indice];
      if (!c || c.v === undefined || c.v === null) continue;
      const texto = String(c.w ?? c.v).trim();
      if (texto) extras[cabecalho] = texto;
    }

    const corrigido = opcoes.nomesCorrigidos?.get(lida.linha)?.trim();
    if (corrigido) nome = corrigido;

    if (!nome.trim()) {
      const partes = [
        registro.numero && `Número ${registro.numero}`,
        cpf && `CPF ${cpf}`,
        registro.tipo_acao,
        registro.pasta && `Pasta ${registro.pasta}`,
      ].filter(Boolean);
      pendentes.push({
        linha: lida.linha,
        motivo: "Reclamante (nome do cliente) não preenchido.",
        resumo: partes.join(" · ") || "Linha com outros dados preenchidos",
      });
      continue;
    }

    const cpfDigitos = somenteDigitos(cpf) || null;
    const base: Omit<LinhaPayload, "chave"> = {
      linha: lida.linha,
      nome: nome.trim(),
      nome_normalizado: normalizarTexto(nome),
      cpf,
      cpf_digitos: cpfDigitos,
      cpf_valido: cpfValido(cpfDigitos),
      cliente,
      registro,
      numero_digitos: somenteDigitos(registro.numero) || null,
      tipo_norm: registro.tipo_acao ? normalizarTexto(registro.tipo_acao) || null : null,
      extras,
      valores,
      avisos: avisosLinha,
    };
    validas.push({ ...base, chave: chaveDaLinha(base) });
  }

  return { validas, pendentes, avisos };
}

// ---------------------------------------------------------------------------
// Modelo vazio para download
// ---------------------------------------------------------------------------

export const ARQUIVO_MODELO = "/modelos/modelo-importacao-clientes-ricardo-friedl.xlsx";

/** Cabeçalhos do modelo, na ordem oficial. */
export const CABECALHOS_MODELO = CAMPOS_MODELO.map((c) => c.cabecalho);
