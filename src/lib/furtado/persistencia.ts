/**
 * Acesso ao banco para as tabelas criadas pela importação Furtado
 * (atendimentos, benefícios, lançamentos, cobranças, parcelas, lotes etc.).
 *
 * As funções de gravação, retomada, resolução e desfazimento de lotes foram
 * removidas junto com os modelos antigos de importação. As tabelas, os dados e
 * as funções do banco permanecem intactos; aqui fica apenas o cliente usado
 * pelas consultas de leitura (`consultas.ts`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

/** Cliente sem tipagem gerada (tabelas novas ainda não estão em types.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as SupabaseClient<any>;
