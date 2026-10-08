/**
 * Camada de acesso a dados.
 *
 * Todas as leituras passam por `queryOptions` do TanStack Query para
 * garantir cache consistente entre as páginas. Os totais financeiros são
 * agregados aqui, num único ponto, para que dashboard, perfil e tabelas
 * mostrem sempre o mesmo número.
 */

import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LIMIARES_PADRAO, type LimiaresSimilaridade } from "./similarity";
import { agregarBase, type BaseAgregada } from "./agregacao";
import { CHAVES_FURTADO } from "./furtado/consultas";
import { db } from "./furtado/persistencia";
import { CHAVES_RF } from "./rf/dados";
import type {
  Cliente,
  ClienteImportado,
  Correspondencia,
  CorrespondenciaDetalhada,
  Importacao,
  Pagamento,
  ProcessoResumo,
  VariacaoNome,
} from "./tipos";

function assertOk<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T;
}

export { agregarBase, type BaseAgregada };

function numero(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : (valor as number);
  return Number.isFinite(n) ? n : 0;
}

/** Lê todas as páginas de uma consulta (o PostgREST devolve no máximo 1000 linhas por vez). */
async function todasAsLinhas<T>(
  consulta: (
    de: number,
    ate: number,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < 1000) return out;
  }
}

interface AtendimentoBruto {
  id: string;
  cliente_id: string;
  numero_processo: string | null;
  servico: string | null;
  pago: boolean | null;
  pago_em: string | null;
  dados_rf: { numero?: string; tipo_acao?: string } | null;
}

async function carregarBase(): Promise<BaseAgregada> {
  const [clientesRes, pagamentosRes, atendimentos] = await Promise.all([
    supabase.from("clientes").select("*").is("deleted_at", null).order("nome", { ascending: true }),
    supabase.from("pagamentos").select("*").order("data_pagamento", { ascending: false }),
    todasAsLinhas<AtendimentoBruto>((de, ate) =>
      db
        .from("atendimentos")
        .select("id,cliente_id,numero_processo,servico,pago,pago_em,dados_rf")
        .is("deleted_at", null)
        .order("created_at")
        .order("id")
        .range(de, ate),
    ),
  ]);

  const processos: ProcessoResumo[] = atendimentos.map((a) => ({
    id: a.id,
    cliente_id: a.cliente_id,
    numero: a.dados_rf?.numero || a.numero_processo || null,
    tipo_acao: a.dados_rf?.tipo_acao || a.servico || null,
    pago: Boolean(a.pago),
    pago_em: a.pago_em,
  }));

  return agregarBase(
    assertOk(clientesRes) as unknown as Cliente[],
    assertOk(pagamentosRes) as unknown as Pagamento[],
    new Date(),
    processos,
  );
}

export const baseQuery = () =>
  queryOptions({
    queryKey: ["base"],
    queryFn: carregarBase,
    staleTime: 30_000,
  });

export const variacoesQuery = () =>
  queryOptions({
    queryKey: ["variacoes"],
    queryFn: async () => {
      const res = await supabase.from("variacoes_nome").select("*");
      return assertOk(res) as unknown as VariacaoNome[];
    },
    staleTime: 60_000,
  });

export const importacoesQuery = () =>
  queryOptions({
    queryKey: ["importacoes"],
    queryFn: async () => {
      const res = await supabase
        .from("importacoes")
        .select("*")
        .order("created_at", { ascending: false });
      return assertOk(res) as unknown as Importacao[];
    },
    staleTime: 30_000,
  });

export const clientesImportadosQuery = () =>
  queryOptions({
    queryKey: ["clientes_importados"],
    queryFn: async () => {
      const res = await supabase
        .from("clientes_importados")
        .select("*")
        .order("created_at", { ascending: false });
      return assertOk(res) as unknown as ClienteImportado[];
    },
    staleTime: 30_000,
  });

export const correspondenciasQuery = () =>
  queryOptions({
    queryKey: ["correspondencias"],
    queryFn: async () => {
      const res = await supabase
        .from("correspondencias")
        .select("*")
        .order("percentual_similaridade", { ascending: false });
      return (assertOk(res) as unknown as Correspondencia[]).map((c) => ({
        ...c,
        percentual_similaridade: numero(c.percentual_similaridade),
      }));
    },
    staleTime: 15_000,
  });

export const rejeicoesQuery = () =>
  queryOptions({
    queryKey: ["rejeicoes"],
    queryFn: async () => {
      const res = await supabase.from("correspondencias_rejeitadas").select("*");
      return assertOk(res) as unknown as {
        id: string;
        nome_1_normalizado: string;
        nome_2_normalizado: string;
        data_rejeicao: string;
      }[];
    },
    staleTime: 60_000,
  });

export const configuracoesQuery = () =>
  queryOptions({
    queryKey: ["configuracoes"],
    queryFn: async (): Promise<LimiaresSimilaridade> => {
      const res = await supabase
        .from("configuracoes")
        .select("*")
        .eq("chave", "similaridade")
        .maybeSingle();
      if (res.error) throw new Error(res.error.message);
      const valor = res.data?.valor as Partial<LimiaresSimilaridade> | undefined;
      return { ...LIMIARES_PADRAO, ...(valor ?? {}) };
    },
    staleTime: 60_000,
  });

/** Junta correspondências + registros importados + clientes num único objeto. */
export function montarCorrespondencias(
  correspondencias: Correspondencia[],
  importados: ClienteImportado[],
  importacoes: Importacao[],
  base: BaseAgregada,
): CorrespondenciaDetalhada[] {
  const importadosPorId = new Map(importados.map((i) => [i.id, i]));
  const importacoesPorId = new Map(importacoes.map((i) => [i.id, i]));

  return correspondencias
    .map((correspondencia) => {
      const importado = importadosPorId.get(correspondencia.cliente_importado_id);
      const clienteEncontrado = base.porId.get(correspondencia.cliente_encontrado_id);
      if (!importado || !clienteEncontrado) return null;
      return {
        correspondencia,
        importado,
        importacao: importacoesPorId.get(importado.importacao_id) ?? null,
        clienteEncontrado,
      } satisfies CorrespondenciaDetalhada;
    })
    .filter((item): item is CorrespondenciaDetalhada => item !== null);
}

/**
 * Todas as consultas de dados de domínio. Qualquer evento de domínio
 * revalida estas chaves (ver `sincronizacao.ts`).
 */
export const CHAVES_DOMINIO = [
  ["base"],
  ["variacoes"],
  ["importacoes"],
  ["clientes_importados"],
  ["correspondencias"],
  ["rejeicoes"],
  ["valores_previstos"],
  ...CHAVES_FURTADO,
  ...CHAVES_RF,
] as const;
