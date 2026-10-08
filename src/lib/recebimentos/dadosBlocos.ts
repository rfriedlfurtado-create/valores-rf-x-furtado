/* eslint-disable @typescript-eslint/no-explicit-any -- função nova ainda sem tipos gerados (types.ts) */
/**
 * Gravação do modelo em BLOCOS pela função `aplicar_importacao_blocos`
 * (prévia com rollback e gravação em lotes pequenos — limite de 3 s por
 * chamada no plano atual). Repetir após falha não duplica nada.
 */

import { db } from "@/lib/furtado/persistencia";

import type { ItemBloco } from "./blocosImportacao";

export interface ResultadoBloco {
  bloco: string;
  cliente_id: string;
  cliente_criado: boolean;
  atendimento_id: string | null;
  processo_criado: boolean;
  recebimentos: { chave: string; resultado: string; pagamento_id: string | null }[];
  previstos: { chave: string; resultado: string }[];
}

export const BLOCOS_POR_LOTE = 25;

async function chamar(
  itens: ItemBloco[],
  arquivo: string,
  simular: boolean,
  importacaoId: string | null,
): Promise<{ importacao_id: string | null; blocos: ResultadoBloco[] }> {
  const { data, error } = await db.rpc("aplicar_importacao_blocos", {
    p_itens: itens,
    p_arquivo: arquivo,
    p_simular: simular,
    p_importacao_id: importacaoId,
  });
  if (error) throw new Error(error.message);
  return data as { importacao_id: string | null; blocos: ResultadoBloco[] };
}

function partes<T>(lista: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
}

/** Prévia no banco (tudo desfeito): mostra o que já está registrado. */
export async function simularBlocos(
  itens: ItemBloco[],
  arquivo: string,
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<ResultadoBloco[]> {
  const out: ResultadoBloco[] = [];
  for (const lote of partes(itens, BLOCOS_POR_LOTE)) {
    out.push(...(await chamar(lote, arquivo, true, null)).blocos);
    aoProgredir?.(out.length, itens.length);
  }
  return out;
}

export async function gravarBlocos(
  itens: ItemBloco[],
  arquivo: string,
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<{ importacaoId: string | null; blocos: ResultadoBloco[] }> {
  let importacaoId: string | null = null;
  const out: ResultadoBloco[] = [];
  for (const lote of partes(itens, BLOCOS_POR_LOTE)) {
    const r = await chamar(lote, arquivo, false, importacaoId);
    importacaoId = r.importacao_id;
    out.push(...r.blocos);
    aoProgredir?.(out.length, itens.length);
  }
  return { importacaoId, blocos: out };
}

export async function registrarResumoBlocos(importacaoId: string, resumo: unknown): Promise<void> {
  const { error } = await db
    .from("importacoes")
    .update({ resumo } as any)
    .eq("id", importacaoId);
  if (error) throw new Error(error.message);
}
