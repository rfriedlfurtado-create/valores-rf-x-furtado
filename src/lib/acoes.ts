/**
 * Operações de escrita (mutações) do sistema.
 *
 * Regra de segurança financeira: nenhuma função aqui une clientes
 * automaticamente. A vinculação só acontece em `confirmarCorrespondencia`,
 * que é sempre disparada por uma ação explícita do usuário.
 */

import { supabase } from "@/integrations/supabase/client";
import { chaveParRejeitado, normalizarNome, type LimiaresSimilaridade } from "./similarity";
import { todayISO } from "./format";
import {
  MARCA_PAGAMENTO_MODELO,
  statusDaSituacao,
  VERSAO_MODELO,
  type ItemPlano,
  type PlanoModelo,
} from "./modeloDocumento";
import type { Cliente, TipoPagamento } from "./tipos";

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

/** Marca o cliente como já pago — ele sai da página Clientes e aparece em Já Pagos. */
export async function marcarComoPago(id: string): Promise<void> {
  const { error } = await supabase
    .from("clientes")
    .update({ status: "pago" })
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
  // 1. Pagamentos do cliente
  const pagamentos = await supabase.from("pagamentos").delete().eq("cliente_id", id);
  if (pagamentos.error) erro(pagamentos.error.message);

  // 2. Variações de nome
  const variacoes = await supabase.from("variacoes_nome").delete().eq("cliente_id", id);
  if (variacoes.error) erro(variacoes.error.message);

  // 3. Correspondências onde este cliente foi o "encontrado" (já pago histórico)
  const corrEncontrado = await supabase
    .from("correspondencias")
    .delete()
    .eq("cliente_encontrado_id", id);
  if (corrEncontrado.error) erro(corrEncontrado.error.message);

  // 4 & 5. Registros importados vinculados + suas correspondências
  const { data: importados, error: errImportados } = await supabase
    .from("clientes_importados")
    .select("id")
    .eq("cliente_vinculado_id", id);
  if (errImportados) erro(errImportados.message);

  if (importados && importados.length > 0) {
    const ids = (importados as { id: string }[]).map((r) => r.id);
    const corrImportados = await supabase
      .from("correspondencias")
      .delete()
      .in("cliente_importado_id", ids);
    if (corrImportados.error) erro(corrImportados.error.message);

    const delImportados = await supabase
      .from("clientes_importados")
      .delete()
      .eq("cliente_vinculado_id", id);
    if (delImportados.error) erro(delImportados.error.message);
  }

  // 6. O próprio cadastro
  const cliente = await supabase.from("clientes").delete().eq("id", id);
  if (cliente.error) erro(cliente.error.message);
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
  });
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
  const tabelas = [
    "correspondencias",
    "correspondencias_rejeitadas",
    "clientes_importados",
    "importacoes",
    "pagamentos",
    "variacoes_nome",
    "clientes",
  ] as const;

  for (const tabela of tabelas) {
    // neq com valor inexistente force-deletes all rows (Supabase exige filtro)
    const { error } = await supabase.from(tabela).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) erro(`Erro ao limpar ${tabela}: ${error.message}`);
  }
}

export async function salvarLimiares(limiares: LimiaresSimilaridade): Promise<void> {
  const { error } = await supabase
    .from("configuracoes")
    .upsert({ chave: "similaridade", valor: { ...limiares } }, { onConflict: "chave" });
  if (error) erro(error.message);
}

// ---------------------------------------------------------------------------
// Importação pelo Modelo Documento (ATLAS_CLIENTES_V1)
// ---------------------------------------------------------------------------

export interface ResultadoImportacaoModelo {
  novosClientes: number;
  existentesAtualizados: number;
  semAlteracao: number;
  movidosParaJaPagos: number;
  pagamentosRegistrados: number;
  naoEncontrados: ItemPlano[];
  naoImportadosPorErro: ItemPlano[];
  falhas: { item: ItemPlano; mensagem: string }[];
}

/**
 * Executa um plano já revisado pelo usuário na pré-visualização.
 * Nunca cria cliente para linha PAGO e nunca duplica: o plano já decidiu,
 * de forma determinística, se cada linha cria, atualiza ou move.
 * Reexecutar o mesmo arquivo resulta em "sem alteração" (idempotente).
 */
export async function executarPlanoModelo(params: {
  plano: PlanoModelo;
  nomeArquivo: string;
}): Promise<ResultadoImportacaoModelo> {
  const agora = new Date().toISOString();
  const origem = `Modelo Documento ${VERSAO_MODELO} — ${params.nomeArquivo}`;
  const resultado: ResultadoImportacaoModelo = {
    novosClientes: 0,
    existentesAtualizados: 0,
    semAlteracao: 0,
    movidosParaJaPagos: 0,
    pagamentosRegistrados: 0,
    naoEncontrados: [],
    naoImportadosPorErro: [],
    falhas: [],
  };

  for (const item of params.plano.itens) {
    try {
      switch (item.acao) {
        case "erro":
          resultado.naoImportadosPorErro.push(item);
          break;
        case "nao_encontrado":
          resultado.naoEncontrados.push(item);
          break;
        case "sem_alteracao":
          resultado.semAlteracao += 1;
          break;
        case "criar": {
          const { error } = await supabase.from("clientes").insert({
            nome: item.linha.nome,
            nome_normalizado: normalizarNome(item.linha.nome),
            cpf: item.linha.cpfNormalizado ? item.linha.cpf : null,
            numero_processo: item.linha.processo,
            status: statusDaSituacao("NAO_PAGO"),
            origem_importacao: origem,
            data_importacao: agora,
          });
          if (error) erro(error.message);
          resultado.novosClientes += 1;
          break;
        }
        case "atualizar":
        case "marcar_pago": {
          if (!item.clienteId) erro("Cliente não identificado.");
          if (Object.keys(item.alteracoes).length > 0) {
            const { error } = await supabase
              .from("clientes")
              .update(item.alteracoes)
              .eq("id", item.clienteId);
            if (error) erro(error.message);
          }
          if (item.registrarValor != null) {
            const { error } = await supabase.from("pagamentos").insert({
              cliente_id: item.clienteId,
              valor: item.registrarValor,
              data_pagamento: todayISO(),
              tipo: "outro",
              observacao: MARCA_PAGAMENTO_MODELO,
              usuario_cadastro: "Modelo Documento",
            });
            if (error) erro(error.message);
            resultado.pagamentosRegistrados += 1;
          }
          if (item.alteracoes.status === "pago") resultado.movidosParaJaPagos += 1;
          else resultado.existentesAtualizados += 1;
          break;
        }
      }
    } catch (e) {
      resultado.falhas.push({
        item,
        mensagem: e instanceof Error ? e.message : "Erro desconhecido.",
      });
    }
  }

  // Histórico em Importações (rastreabilidade).
  await supabase.from("importacoes").insert({
    nome_importacao: `Modelo Documento — ${params.nomeArquivo}`,
    origem_arquivo: params.nomeArquivo,
    tipo_origem: "arquivo",
    quantidade_clientes: params.plano.resumo.total,
    quantidade_ja_pagos: resultado.movidosParaJaPagos,
  });

  return resultado;
}
