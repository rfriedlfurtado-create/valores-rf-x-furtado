import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  baseQuery,
  clientesImportadosQuery,
  configuracoesQuery,
  correspondenciasQuery,
  importacoesQuery,
  montarCorrespondencias,
  rejeicoesQuery,
  variacoesQuery,
} from "@/lib/dados";
import type { CorrespondenciaDetalhada } from "@/lib/tipos";

/**
 * Hook central: carrega a base agregada e as correspondências já
 * relacionadas, evitando que cada página repita a mesma junção.
 */
export function useSistema() {
  const base = useQuery(baseQuery());
  const correspondencias = useQuery(correspondenciasQuery());
  const importados = useQuery(clientesImportadosQuery());
  const importacoes = useQuery(importacoesQuery());
  const variacoes = useQuery(variacoesQuery());
  const rejeicoes = useQuery(rejeicoesQuery());
  const limiares = useQuery(configuracoesQuery());

  const detalhadas: CorrespondenciaDetalhada[] = useMemo(() => {
    if (!base.data || !correspondencias.data || !importados.data || !importacoes.data) return [];
    return montarCorrespondencias(
      correspondencias.data,
      importados.data,
      importacoes.data,
      base.data,
    );
  }, [base.data, correspondencias.data, importados.data, importacoes.data]);

  const carregando =
    base.isLoading ||
    correspondencias.isLoading ||
    importados.isLoading ||
    importacoes.isLoading ||
    variacoes.isLoading ||
    rejeicoes.isLoading ||
    limiares.isLoading;

  const erro =
    base.error ?? correspondencias.error ?? importados.error ?? importacoes.error ?? null;

  return {
    base: base.data,
    correspondencias: detalhadas,
    importacoes: importacoes.data ?? [],
    importados: importados.data ?? [],
    variacoes: variacoes.data ?? [],
    rejeicoes: rejeicoes.data ?? [],
    limiares: limiares.data,
    carregando,
    erro,
  };
}

/** Correspondências pendentes que apontam para clientes que já receberam valores. */
export function filtrarJaPagos(itens: CorrespondenciaDetalhada[]): CorrespondenciaDetalhada[] {
  return itens.filter(
    (item) =>
      item.clienteEncontrado.quantidadePagamentos > 0 &&
      item.correspondencia.status !== "rejeitado",
  );
}
