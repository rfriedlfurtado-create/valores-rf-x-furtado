/**
 * Operações de escrita (mutações) do sistema.
 *
 * Regra de segurança financeira: nenhuma função aqui une clientes
 * automaticamente. A vinculação só acontece em `confirmarCorrespondencia`,
 * que é sempre disparada por uma ação explícita do usuário.
 */

import { supabase } from "@/integrations/supabase/client";
import { chaveParRejeitado, normalizarNome, type LimiaresSimilaridade } from "./similarity";

import type { ClassificacaoEntrada, Cliente, TipoPagamento } from "./tipos";

function erro(message: string): never {
  throw new Error(message);
}

export async function atualizarCliente(
  id: string,
  campos: Partial<Pick<Cliente, "nome" | "cpf" | "observacoes" | "status">>,
): Promise<void> {
  const payload: {
    nome?: string;
    nome_normalizado?: string;
    cpf?: string | null;
    observacoes?: string | null;
    status?: string;
  } = { ...campos };
  if (campos.nome) {
    payload.nome = campos.nome.trim();
    payload.nome_normalizado = normalizarNome(campos.nome);
  }
  const { error } = await supabase.from("clientes").update(payload).eq("id", id);
  if (error) erro(error.message);
}

/** Arquivamento seguro: o histórico financeiro nunca é apagado. */
export async function arquivarCliente(id: string): Promise<void> {
  const { error } = await supabase
    .from("clientes")
    .update({ arquivado: true, status: "arquivado", deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) erro(error.message);
}

/**
 * Exclusão definitiva (hard delete) com cascata completa.
 *
 * Remove, nesta ordem, todos os dados operacionais vinculados ao cliente:
 *   1. Pagamentos
 *   2. Variações de nome confirmadas
 *   3. Correspondências onde o cliente foi identificado como já pago
 *   4. Correspondências dos registros importados vinculados ao cliente
 *   5. Registros importados vinculados ao cliente
 *   6. O próprio cadastro do cliente
 *
 * Após a exclusão, nenhuma consulta, agregação, dashboard ou relatório
 * continuará considerando o cliente — ele simplesmente deixa de existir.
 */
export async function excluirCliente(id: string): Promise<void> {
  // Uma única transação no banco (função `excluir_cliente`): ou tudo é
  // removido, ou nada é — nunca sobra pagamento/correspondência órfã.
  const { error } = await supabase.rpc("excluir_cliente", { p_cliente_id: id });
  if (error) erro(error.message);
}

export async function reativarCliente(id: string): Promise<void> {
  const { error } = await supabase
    .from("clientes")
    .update({ arquivado: false, status: "ativo", deleted_at: null })
    .eq("id", id);
  if (error) erro(error.message);
}

export interface NovoPagamento {
  cliente_id: string;
  valor: number;
  data_pagamento: string;
  tipo: TipoPagamento;
  observacao?: string | null;
  usuario_cadastro?: string | null;
  /** Processo/atendimento ao qual o pagamento pertence (opcional). */
  atendimento_id?: string | null;
  /** Implantação, Sucumbência, Atrasados... (opcional). */
  classificacao?: ClassificacaoEntrada | null;
}

/**
 * Classifica UMA entrada financeira (Contratual/Atrasados/Sucumbência).
 * Só muda a classificação daquela entrada: o valor nunca é duplicado nem
 * alterado, e as demais entradas do cliente não são tocadas.
 */
export async function classificarEntrada(
  entradaId: string,
  classificacao: ClassificacaoEntrada | null,
): Promise<void> {
  const { error } = await supabase.from("pagamentos").update({ classificacao }).eq("id", entradaId);
  if (error) erro(error.message);
}

export async function registrarPagamento(entrada: NovoPagamento): Promise<void> {
  if (!entrada.cliente_id) erro("Selecione um cliente.");
  if (!(entrada.valor > 0)) erro("Informe um valor maior que zero.");
  if (!entrada.data_pagamento) erro("Informe a data do pagamento.");

  const { error } = await supabase.from("pagamentos").insert({
    cliente_id: entrada.cliente_id,
    valor: entrada.valor,
    data_pagamento: entrada.data_pagamento,
    tipo: entrada.tipo,
    observacao: entrada.observacao?.trim() || null,
    usuario_cadastro: entrada.usuario_cadastro?.trim() || "Sistema",
    ...(entrada.atendimento_id ? { atendimento_id: entrada.atendimento_id } : {}),
    ...(entrada.classificacao ? { classificacao: entrada.classificacao } : {}),
  } as never);
  if (error) erro(error.message);
}

export async function adicionarVariacao(clienteId: string, nome: string): Promise<void> {
  const normalizado = normalizarNome(nome);
  if (!normalizado) return;
  const { error } = await supabase
    .from("variacoes_nome")
    .upsert(
      { cliente_id: clienteId, nome_variacao: nome.trim(), nome_normalizado: normalizado },
      { onConflict: "cliente_id,nome_normalizado", ignoreDuplicates: true },
    );
  if (error) erro(error.message);
}

/**
 * Confirmação manual: o nome novo passa a ser uma VARIAÇÃO do cliente
 * existente. Nenhum cliente duplicado é criado.
 */
export async function confirmarCorrespondencia(params: {
  correspondenciaId: string;
  clienteImportadoId: string;
  clienteEncontradoId: string;
  nomeImportado: string;
}): Promise<void> {
  await adicionarVariacao(params.clienteEncontradoId, params.nomeImportado);

  const [corr, imp, outras] = await Promise.all([
    supabase
      .from("correspondencias")
      .update({ status: "confirmado" })
      .eq("id", params.correspondenciaId),
    supabase
      .from("clientes_importados")
      .update({ status_analise: "confirmado", cliente_vinculado_id: params.clienteEncontradoId })
      .eq("id", params.clienteImportadoId),
    // As demais sugestões para o mesmo registro deixam de fazer sentido.
    supabase
      .from("correspondencias")
      .update({ status: "rejeitado" })
      .eq("cliente_importado_id", params.clienteImportadoId)
      .neq("id", params.correspondenciaId)
      .eq("status", "pendente"),
  ]);

  if (corr.error) erro(corr.error.message);
  if (imp.error) erro(imp.error.message);
  if (outras.error) erro(outras.error.message);
}

/** Falso positivo: o par é registrado para nunca mais ser sugerido. */
export async function rejeitarCorrespondencia(params: {
  correspondenciaId: string;
  clienteImportadoId: string;
  nomeNormalizadoImportado: string;
  nomeNormalizadoEncontrado: string;
}): Promise<void> {
  const [nome1, nome2] = chaveParRejeitado(
    params.nomeNormalizadoImportado,
    params.nomeNormalizadoEncontrado,
  );

  const rejeicao = await supabase
    .from("correspondencias_rejeitadas")
    .upsert(
      { nome_1_normalizado: nome1, nome_2_normalizado: nome2 },
      { onConflict: "nome_1_normalizado,nome_2_normalizado", ignoreDuplicates: true },
    );
  if (rejeicao.error) erro(rejeicao.error.message);

  const corr = await supabase
    .from("correspondencias")
    .update({ status: "rejeitado" })
    .eq("id", params.correspondenciaId);
  if (corr.error) erro(corr.error.message);

  const restantes = await supabase
    .from("correspondencias")
    .select("id")
    .eq("cliente_importado_id", params.clienteImportadoId)
    .eq("status", "pendente");
  if (restantes.error) erro(restantes.error.message);

  if ((restantes.data ?? []).length === 0) {
    const imp = await supabase
      .from("clientes_importados")
      .update({ status_analise: "rejeitado" })
      .eq("id", params.clienteImportadoId);
    if (imp.error) erro(imp.error.message);
  }
}

export async function adiarCorrespondencia(correspondenciaId: string, clienteImportadoId: string) {
  const corr = await supabase
    .from("correspondencias")
    .update({ status: "analisar_depois" })
    .eq("id", correspondenciaId);
  if (corr.error) erro(corr.error.message);

  const imp = await supabase
    .from("clientes_importados")
    .update({ status_analise: "analisar_depois" })
    .eq("id", clienteImportadoId);
  if (imp.error) erro(imp.error.message);
}

/**
 * Zera o sistema: remove TODOS os dados de clientes, pagamentos, importações
 * e correspondências, preservando apenas as configurações.
 *
 * Ordem respeitando FK constraints:
 *   1. correspondencias
 *   2. correspondencias_rejeitadas
 *   3. clientes_importados
 *   4. importacoes
 *   5. pagamentos
 *   6. variacoes_nome
 *   7. clientes
 */
export async function zerarSistema(): Promise<void> {
  const { error } = await supabase.rpc("zerar_sistema");
  if (error) erro(`Erro ao zerar o sistema: ${error.message}`);
}

export async function salvarLimiares(limiares: LimiaresSimilaridade): Promise<void> {
  const { error } = await supabase
    .from("configuracoes")
    .upsert({ chave: "similaridade", valor: { ...limiares } }, { onConflict: "chave" });
  if (error) erro(error.message);
}
