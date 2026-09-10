/**
 * Operações de escrita (mutações) do sistema.
 *
 * Regra de segurança financeira: nenhuma função aqui une clientes
 * automaticamente. A vinculação só acontece em `confirmarCorrespondencia`,
 * que é sempre disparada por uma ação explícita do usuário.
 */

import { supabase } from "@/integrations/supabase/client";
import { chaveParRejeitado, compararNomes, normalizarNome, type LimiaresSimilaridade } from "./similarity";
import type { Cliente, ClienteComTotais, TipoPagamento } from "./tipos";

function erro(message: string): never {
  throw new Error(message);
}

export interface NovoCliente {
  nome: string;
  cpf?: string | null;
  observacoes?: string | null;
  origem_importacao?: string | null;
  data_importacao?: string | null;
}

export async function criarCliente(entrada: NovoCliente): Promise<Cliente> {
  const nome = entrada.nome.trim();
  if (!nome) erro("Informe o nome do cliente.");

  const { data, error } = await supabase
    .from("clientes")
    .insert({
      nome,
      nome_normalizado: normalizarNome(nome),
      cpf: entrada.cpf?.trim() || null,
      observacoes: entrada.observacoes?.trim() || null,
      origem_importacao: entrada.origem_importacao ?? null,
      data_importacao: entrada.data_importacao ?? null,
    })
    .select()
    .single();

  if (error) erro(error.message);
  return data as unknown as Cliente;
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

export async function salvarLimiares(limiares: LimiaresSimilaridade): Promise<void> {
  const { error } = await supabase
    .from("configuracoes")
    .upsert({ chave: "similaridade", valor: { ...limiares } }, { onConflict: "chave" });
  if (error) erro(error.message);
}

// ---------------------------------------------------------------------------
// Importação + comparação automática
// ---------------------------------------------------------------------------

export interface ResultadoImportacao {
  importacaoId: string;
  totalNomes: number;
  novosClientes: number;
  correspondencias: number;
  jaPagos: number;
  possiveis: number;
}

interface CandidatoBase {
  clienteId: string;
  nomeNormalizado: string;
  possuiPagamento: boolean;
}

/**
 * Importa uma lista de nomes e compara cada um com toda a base histórica
 * (nomes principais + variações já confirmadas).
 *
 * Importante: um nome parecido gera SEMPRE um alerta, nunca uma união.
 * Cada nome novo entra como um cliente próprio; a união depende de
 * confirmação manual na tela de correspondências.
 */
export async function importarNomes(params: {
  nomes: string[];
  nomeImportacao: string;
  origemArquivo: string | null;
  tipoOrigem: "arquivo" | "manual";
  base: ClienteComTotais[];
  variacoes: { cliente_id: string; nome_normalizado: string }[];
  rejeicoes: { nome_1_normalizado: string; nome_2_normalizado: string }[];
  limiares: LimiaresSimilaridade;
}): Promise<ResultadoImportacao> {
  const nomes = params.nomes.map((n) => n.trim()).filter((n) => n.length > 0);
  if (nomes.length === 0) erro("Nenhum nome válido encontrado.");

  const agora = new Date().toISOString();

  const importacaoRes = await supabase
    .from("importacoes")
    .insert({
      nome_importacao: params.nomeImportacao,
      origem_arquivo: params.origemArquivo,
      tipo_origem: params.tipoOrigem,
      quantidade_clientes: nomes.length,
    })
    .select()
    .single();
  if (importacaoRes.error) erro(importacaoRes.error.message);
  const importacaoId = (importacaoRes.data as { id: string }).id;

  // Base de comparação: nome principal + variações confirmadas.
  const pagamentosPorCliente = new Map(
    params.base.map((c) => [c.id, c.quantidadePagamentos > 0] as const),
  );
  const candidatos: CandidatoBase[] = [
    ...params.base.map((c) => ({
      clienteId: c.id,
      nomeNormalizado: c.nome_normalizado,
      possuiPagamento: c.quantidadePagamentos > 0,
    })),
    ...params.variacoes.map((v) => ({
      clienteId: v.cliente_id,
      nomeNormalizado: v.nome_normalizado,
      possuiPagamento: pagamentosPorCliente.get(v.cliente_id) ?? false,
    })),
  ];

  const rejeitados = new Set(
    params.rejeicoes.map((r) => `${r.nome_1_normalizado}|${r.nome_2_normalizado}`),
  );

  let totalCorrespondencias = 0;
  let totalJaPagos = 0;
  let totalPossiveis = 0;

  for (const nome of nomes) {
    const normalizado = normalizarNome(nome);

    // 1) O nome entra como cliente próprio da nova listagem.
    const clienteRes = await supabase
      .from("clientes")
      .insert({
        nome,
        nome_normalizado: normalizado,
        origem_importacao: params.nomeImportacao,
        data_importacao: agora,
      })
      .select()
      .single();
    if (clienteRes.error) erro(clienteRes.error.message);
    const novoClienteId = (clienteRes.data as { id: string }).id;

    // 2) Comparação com toda a base histórica.
    const melhoresPorCliente = new Map<
      string,
      { percentual: number; classificacao: string; possuiPagamento: boolean }
    >();

    for (const candidato of candidatos) {
      if (candidato.clienteId === novoClienteId) continue;
      const [n1, n2] = chaveParRejeitado(normalizado, candidato.nomeNormalizado);
      if (rejeitados.has(`${n1}|${n2}`)) continue;

      const resultado = compararNomes(normalizado, candidato.nomeNormalizado, params.limiares);
      if (!resultado.classificacao || resultado.percentual < params.limiares.minimo) continue;

      const anterior = melhoresPorCliente.get(candidato.clienteId);
      if (!anterior || resultado.percentual > anterior.percentual) {
        melhoresPorCliente.set(candidato.clienteId, {
          percentual: resultado.percentual,
          classificacao: resultado.classificacao,
          possuiPagamento: candidato.possuiPagamento,
        });
      }
    }

    const temJaPago = [...melhoresPorCliente.values()].some((m) => m.possuiPagamento);
    const statusAnalise =
      melhoresPorCliente.size === 0 ? "sem_correspondencia" : temJaPago ? "ja_pago" : "pendente";

    const importadoRes = await supabase
      .from("clientes_importados")
      .insert({
        importacao_id: importacaoId,
        nome_original: nome,
        nome_normalizado: normalizado,
        cliente_vinculado_id: novoClienteId,
        status_analise: statusAnalise,
      })
      .select()
      .single();
    if (importadoRes.error) erro(importadoRes.error.message);
    const importadoId = (importadoRes.data as { id: string }).id;

    if (melhoresPorCliente.size > 0) {
      const linhas = [...melhoresPorCliente.entries()].map(([clienteId, dados]) => ({
        cliente_importado_id: importadoId,
        cliente_encontrado_id: clienteId,
        percentual_similaridade: dados.percentual,
        classificacao: dados.classificacao,
        possui_pagamento: dados.possuiPagamento,
      }));
      const corrRes = await supabase.from("correspondencias").insert(linhas);
      if (corrRes.error) erro(corrRes.error.message);

      totalCorrespondencias += linhas.length;
      if (temJaPago) totalJaPagos += 1;
      totalPossiveis += linhas.filter((l) => l.classificacao === "possivel").length;
    }

    // O novo cliente também passa a ser candidato para os próximos nomes da lista.
    candidatos.push({ clienteId: novoClienteId, nomeNormalizado: normalizado, possuiPagamento: false });
  }

  const atualizacao = await supabase
    .from("importacoes")
    .update({
      quantidade_correspondencias: totalCorrespondencias,
      quantidade_ja_pagos: totalJaPagos,
      quantidade_possiveis: totalPossiveis,
    })
    .eq("id", importacaoId);
  if (atualizacao.error) erro(atualizacao.error.message);

  return {
    importacaoId,
    totalNomes: nomes.length,
    novosClientes: nomes.length,
    correspondencias: totalCorrespondencias,
    jaPagos: totalJaPagos,
    possiveis: totalPossiveis,
  };
}
