import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { atendimentosQuery, beneficiosTodosQuery } from "@/lib/furtado/consultas";

/**
 * Identificadores (dígitos de processos e NB) por cliente, usados na busca
 * única de Clientes/Já pagos/Processos: pesquisar por nome, processo ou NB.
 */
export function useIdentificadoresPorCliente(): Map<string, string[]> {
  const atendimentos = useQuery(atendimentosQuery());
  const beneficios = useQuery(beneficiosTodosQuery());
  return useMemo(() => {
    const mapa = new Map<string, string[]>();
    const add = (id: string, v: string | null | undefined) => {
      const d = (v ?? "").replace(/\D/g, "");
      if (!d) return;
      mapa.set(id, [...(mapa.get(id) ?? []), d]);
    };
    for (const a of atendimentos.data ?? [])
      add(a.cliente_id, a.processo_digitos ?? a.numero_processo);
    for (const b of beneficios.data ?? []) add(b.cliente_id, b.nb_digitos ?? b.nb);
    return mapa;
  }, [atendimentos.data, beneficios.data]);
}
