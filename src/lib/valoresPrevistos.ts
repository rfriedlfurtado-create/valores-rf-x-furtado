/* eslint-disable @typescript-eslint/no-explicit-any -- tabela nova ainda sem tipos gerados (types.ts) */
/**
 * VALORES PREVISTOS: valores a receber, parcelas futuras, recebimentos não
 * confirmados e indicações de "não haverá" — separados dos valores recebidos
 * (nunca entram no TOTAL RECEBIDO). Ao receber, viram um pagamento.
 */

import { queryOptions } from "@tanstack/react-query";

import { db } from "@/lib/furtado/persistencia";
import type { ClassificacaoEntrada } from "@/lib/tipos";
import type { SituacaoProcessoBanco } from "@/lib/valoresProcesso";

export type SituacaoPrevisto =
  | "a_receber"
  | "parcial"
  | "nao_confirmado"
  | "nao_havera_cobranca"
  | "nao_havera_sucumbencia"
  | "recebido"
  | "cancelado";

export const ROTULO_SITUACAO_PREVISTO: Record<SituacaoPrevisto, string> = {
  a_receber: "A receber",
  parcial: "Parcialmente recebido",
  nao_confirmado: "Recebimento não confirmado",
  nao_havera_cobranca: "Não haverá cobrança",
  nao_havera_sucumbencia: "Não haverá sucumbência",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

/** Situações que representam valor pendente (contam como "a receber"). */
export const SITUACOES_PENDENTES: SituacaoPrevisto[] = ["a_receber", "parcial", "nao_confirmado"];

export interface ValorPrevisto {
  id: string;
  cliente_id: string;
  atendimento_id: string | null;
  categoria: ClassificacaoEntrada | null;
  natureza: string | null;
  descricao: string | null;
  origem: "judicial" | "administrativo" | null;
  canal: string | null;
  destinatario: "escritorio" | "cliente";
  valor: number | null;
  valor_recebido: number;
  situacao: SituacaoPrevisto;
  percentual: string | null;
  competencia: string | null;
  parcela: string | null;
  data_referencia: string | null;
  observacao: string | null;
  aba: string | null;
  celulas: string | null;
  conferencia: string | null;
  created_at: string;
  updated_at: string;
}

/** Saldo ainda a receber de um valor previsto pendente. */
export function saldoPrevisto(
  v: Pick<ValorPrevisto, "valor" | "valor_recebido" | "situacao">,
): number {
  if (!SITUACOES_PENDENTES.includes(v.situacao) || v.valor === null) return 0;
  return Math.max(0, Math.round((Number(v.valor) - Number(v.valor_recebido ?? 0)) * 100) / 100);
}

function normalizar(v: any): ValorPrevisto {
  return {
    ...v,
    valor: v.valor === null ? null : Number(v.valor),
    valor_recebido: Number(v.valor_recebido ?? 0),
  };
}

export const valoresPrevistosQuery = () =>
  queryOptions({
    queryKey: ["valores_previstos", "todos"],
    queryFn: async (): Promise<ValorPrevisto[]> => {
      const out: ValorPrevisto[] = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await db
          .from("valores_previstos")
          .select("*")
          .order("created_at")
          .range(de, de + 999);
        if (error) throw new Error(error.message);
        out.push(...((data ?? []) as any[]).map(normalizar));
        if ((data ?? []).length < 1000) return out;
      }
    },
    staleTime: 15_000,
  });

export const previstosDoClienteQuery = (clienteId: string) =>
  queryOptions({
    queryKey: ["valores_previstos", "cliente", clienteId],
    queryFn: async (): Promise<ValorPrevisto[]> => {
      const { data, error } = await db
        .from("valores_previstos")
        .select("*")
        .eq("cliente_id", clienteId)
        .order("created_at");
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map(normalizar);
    },
    staleTime: 15_000,
  });

/** Registra o recebimento (total ou parcela) de um valor previsto — cria o pagamento. */
export async function receberValorPrevisto(
  id: string,
  valor: number,
  data: string,
  quitado: boolean,
): Promise<SituacaoProcessoBanco[]> {
  const { data: r, error } = await db.rpc("receber_valor_previsto", {
    p_id: id,
    p_valor: valor,
    p_data: data,
    p_quitado: quitado,
  });
  if (error) throw new Error(error.message);
  return ((r as any)?.processos ?? []) as SituacaoProcessoBanco[];
}

/** Altera situação/valor/processo de um valor previsto (edição manual). */
export async function alterarValorPrevisto(
  id: string,
  campos: Partial<
    Pick<ValorPrevisto, "situacao" | "valor" | "atendimento_id" | "categoria" | "observacao">
  >,
): Promise<void> {
  const { error } = await db
    .from("valores_previstos")
    .update(campos as any)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
