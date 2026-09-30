/**
 * SINCRONIZAÇÃO GLOBAL — um único mecanismo para manter todas as telas
 * alinhadas com o banco.
 *
 * Infraestrutura reaproveitada: o cache do TanStack Query (já usado por
 * todas as páginas via `useSistema`). Não há store paralela.
 *
 *   mutation concluída ──► publicarEvento(EVENTO) ──► revalida CHAVES_DOMINIO
 *                                                        │
 *   alteração no banco feita por outra aba/usuário       ▼
 *   (Supabase Realtime) ──► useSincronizacaoTempoReal ──► mesma revalidação
 *                                                        │
 *                                                        ▼
 *                       Clientes · Já Pagos · Dashboard · Históricos · Perfil
 *
 * Como TODAS as visões derivam de `agregarBase` (dados.ts), revalidar a
 * base é suficiente para que contadores, totais, percentuais, filtros e
 * listas reflitam a mudança ao mesmo tempo — sem reload da página.
 */

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";

import { CHAVES_DOMINIO } from "./dados";

/** Eventos de domínio oficiais. Não crie outro evento para a mesma finalidade. */
export const EVENTOS = {
  CLIENTE_CRIADO: "CLIENT_CREATED",
  CLIENTE_ATUALIZADO: "CLIENT_UPDATED",
  CLIENTE_MARCADO_COMO_PAGO: "CLIENT_MARKED_AS_PAID",
  CLIENTE_EXCLUIDO: "CLIENT_DELETED",
  CLIENTE_ARQUIVADO: "CLIENT_ARCHIVED",
  PAGAMENTO_REGISTRADO: "PAYMENT_REGISTERED",
  IMPORTACAO_CONCLUIDA: "IMPORT_COMPLETED",
  CORRESPONDENCIA_REVISADA: "MATCH_REVIEWED",
  SISTEMA_ZERADO: "SYSTEM_RESET",
  CONFIGURACAO_ALTERADA: "SETTINGS_CHANGED",
} as const;

export type EventoDominio = (typeof EVENTOS)[keyof typeof EVENTOS];

/**
 * Chaves afetadas por evento. Hoje todo evento de dados afeta a base
 * inteira (os indicadores dependem de clientes E pagamentos); a tabela
 * fica explícita para evoluir sem espalhar regras pelo código.
 */
const CHAVES_POR_EVENTO: Record<EventoDominio, readonly (readonly string[])[]> = {
  CLIENT_CREATED: CHAVES_DOMINIO,
  CLIENT_UPDATED: CHAVES_DOMINIO,
  CLIENT_MARKED_AS_PAID: CHAVES_DOMINIO,
  CLIENT_DELETED: CHAVES_DOMINIO,
  CLIENT_ARCHIVED: CHAVES_DOMINIO,
  PAYMENT_REGISTERED: CHAVES_DOMINIO,
  IMPORT_COMPLETED: CHAVES_DOMINIO,
  MATCH_REVIEWED: CHAVES_DOMINIO,
  SYSTEM_RESET: CHAVES_DOMINIO,
  SETTINGS_CHANGED: [["configuracoes"], ...CHAVES_DOMINIO],
};

type Ouvinte = (evento: EventoDominio) => void;
const ouvintes = new Set<Ouvinte>();

/** Permite que módulos reajam a eventos (ex.: telemetria, testes). */
export function aoEvento(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/**
 * Publica um evento de domínio: revalida as consultas afetadas e AGUARDA
 * os dados novos chegarem. Quando a promessa resolve, todas as telas já
 * estão re-renderizadas com o estado persistido.
 */
export async function publicarEvento(
  queryClient: QueryClient,
  evento: EventoDominio,
): Promise<void> {
  const chaves = CHAVES_POR_EVENTO[evento];
  await Promise.all(
    chaves.map((queryKey) =>
      // refetchType "all": atualiza inclusive páginas que não estão abertas agora.
      queryClient.invalidateQueries({ queryKey: [...queryKey], refetchType: "all" }),
    ),
  );
  for (const ouvinte of ouvintes) ouvinte(evento);
}

/** Hook de conveniência para componentes. */
export function useSincronizar() {
  const queryClient = useQueryClient();
  return useCallback((evento: EventoDominio) => publicarEvento(queryClient, evento), [queryClient]);
}

/** Tabelas cujas mudanças (de qualquer origem) disparam revalidação. */
export const TABELAS_OBSERVADAS = [
  "clientes",
  "pagamentos",
  "variacoes_nome",
  "importacoes",
  "clientes_importados",
  "correspondencias",
] as const;

/**
 * Escuta o Supabase Realtime e revalida quando o banco muda por fora desta
 * aba (outro usuário, outra aba, rotina no servidor). Agrupa rajadas de
 * eventos (ex.: importação em lote) numa única revalidação.
 */
export function useSincronizacaoTempoReal() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const agendar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void Promise.all(
          CHAVES_DOMINIO.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey: [...queryKey] }),
          ),
        );
      }, 400);
    };

    let canal = supabase.channel("sincronizacao-global");
    for (const tabela of TABELAS_OBSERVADAS) {
      canal = canal.on(
        "postgres_changes",
        { event: "*", schema: "public", table: tabela },
        agendar,
      );
    }
    canal.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(canal);
    };
  }, [queryClient]);
}
