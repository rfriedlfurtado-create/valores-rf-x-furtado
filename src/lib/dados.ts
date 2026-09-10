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
import type {
  Cliente,
  ClienteComTotais,
  ClienteImportado,
  Correspondencia,
  CorrespondenciaDetalhada,
  Importacao,
  Pagamento,
  VariacaoNome,
} from "./tipos";

function assertOk<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T;
}

function numero(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : (valor as number);
  return Number.isFinite(n) ? n : 0;
}

export interface BaseAgregada {
  clientes: ClienteComTotais[];
  porId: Map<string, ClienteComTotais>;
  pagamentosPorCliente: Map<string, Pagamento[]>;
  totalPago: number;
  totalPagamentos: number;
}

async function carregarBase(): Promise<BaseAgregada> {
  const [clientesRes, pagamentosRes] = await Promise.all([
    supabase.from("clientes").select("*").order("nome", { ascending: true }),
    supabase.from("pagamentos").select("*").order("data_pagamento", { ascending: false }),
  ]);

  const clientes = assertOk(clientesRes) as unknown as Cliente[];
  const pagamentosBrutos = assertOk(pagamentosRes) as unknown as Pagamento[];

  const pagamentos = pagamentosBrutos.map((p) => ({ ...p, valor: numero(p.valor) }));
  const pagamentosPorCliente = new Map<string, Pagamento[]>();
  for (const pagamento of pagamentos) {
    const lista = pagamentosPorCliente.get(pagamento.cliente_id) ?? [];
    lista.push(pagamento);
    pagamentosPorCliente.set(pagamento.cliente_id, lista);
  }

  const comTotais: ClienteComTotais[] = clientes.map((cliente) => {
    const lista = pagamentosPorCliente.get(cliente.id) ?? [];
    const datas = lista.map((p) => p.data_pagamento).sort();
    return {
      ...cliente,
      totalRecebido: lista.reduce((soma, p) => soma + p.valor, 0),
      quantidadePagamentos: lista.length,
      ultimoPagamento: datas.length ? datas[datas.length - 1]! : null,
      primeiroPagamento: datas.length ? datas[0]! : null,
    };
  });

  return {
    clientes: comTotais,
    porId: new Map(comTotais.map((c) => [c.id, c])),
    pagamentosPorCliente,
    totalPago: pagamentos.reduce((soma, p) => soma + p.valor, 0),
    totalPagamentos: pagamentos.length,
  };
}

export const baseQuery = () =>
  queryOptions({
    queryKey: ["base"],
    queryFn: carregarBase,
    staleTime: 30_000,
  });

export const pagamentosQuery = () =>
  queryOptions({
    queryKey: ["pagamentos"],
    queryFn: async () => {
      const res = await supabase
        .from("pagamentos")
        .select("*")
        .order("data_pagamento", { ascending: false });
      return (assertOk(res) as unknown as Pagamento[]).map((p) => ({ ...p, valor: numero(p.valor) }));
    },
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

export const CHAVES_PARA_INVALIDAR = [
  ["base"],
  ["pagamentos"],
  ["variacoes"],
  ["importacoes"],
  ["clientes_importados"],
  ["correspondencias"],
  ["rejeicoes"],
] as const;
