/**
 * Gravação do lote Furtado no banco (Supabase), em ETAPAS com progresso,
 * retomada sem duplicação e desfazimento por lote.
 *
 *   1. registra o lote          4. blocos e células (rastreabilidade)
 *   2. preserva o arquivo       5. aplica as pessoas prontas (transação por grupo)
 *   3. pessoas e pendências     6. conclui (status calculado no banco)
 *
 * Cada etapa é idempotente (chaves únicas + ON CONFLICT), então retomar um
 * lote interrompido nunca duplica dados.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

import { analisarBinarioFurtado } from "./analise";
import {
  abasDoLote,
  linhasBlocos,
  linhasCelulas,
  linhasPendencias,
  linhasPessoas,
  resumoDoLote,
} from "./lote";
import { MODELO_FURTADO, type AnaliseFurtado, type EstrategiaAba } from "./modelo";
import type { PlanilhaLida } from "./planilha";
import type { BaseFurtado, PlanoFurtado, RegistroExistente } from "./planejador";

/** Cliente sem tipagem gerada (tabelas novas ainda não estão em types.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as unknown as SupabaseClient<any>;

function falha(msg: string): never {
  throw new Error(msg);
}

async function lerTudo<T>(tabela: string, colunas: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  const passo = 1000;
  for (let de = 0; ; de += passo) {
    let q = db
      .from(tabela)
      .select(colunas)
      .range(de, de + passo - 1);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) falha(`${tabela}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < passo) break;
  }
  return out;
}

/** Base atual para identificar clientes, evitar duplicidades e apontar conflitos. */
export async function carregarBaseFurtado(): Promise<BaseFurtado> {
  const [clientes, variacoes, vinculos, processos, nbs, rejeicoes] = await Promise.all([
    lerTudo<BaseFurtado["clientes"][number]>(
      "clientes",
      "id,nome,nome_normalizado,cpf,numero_processo,escritorio_origem",
      (q) => q.is("deleted_at", null),
    ),
    lerTudo<BaseFurtado["variacoes"][number]>("variacoes_nome", "cliente_id,nome_normalizado"),
    lerTudo<{ cliente_id: string }>("cliente_escritorios", "cliente_id", (q) =>
      q.eq("escritorio", "furtado"),
    ),
    lerTudo<BaseFurtado["processos"][number]>("atendimentos", "cliente_id,processo_digitos", (q) =>
      q.not("processo_digitos", "is", null).is("deleted_at", null),
    ),
    lerTudo<BaseFurtado["nbs"][number]>("beneficios", "cliente_id,nb_digitos", (q) =>
      q.not("nb_digitos", "is", null).is("deleted_at", null),
    ),
    lerTudo<{ nome_1_normalizado: string; nome_2_normalizado: string }>(
      "correspondencias_rejeitadas",
      "nome_1_normalizado,nome_2_normalizado",
    ),
  ]);
  const comparar: [string, string][] = [
    ["atendimentos", "id,chave_origem"],
    ["beneficios", "id,chave_origem,dib,dip,dcb,rmi,rma,nb"],
    ["lancamentos_financeiros", "id,chave_origem,valor"],
    ["requisicoes", "id,chave_origem,ano_previsto,situacao,valor"],
    ["acordos", "id,chave_origem,aceitacao,percentual,dib,dip,dcb,sucumbencia_percentual"],
    ["cobrancas", "id,chave_origem"],
    ["dados_bancarios", "id,chave_origem"],
    ["representantes", "id,chave_origem"],
    ["historico_cliente", "id,chave_origem"],
  ];
  const existentes: RegistroExistente[] = [];
  const listas = await Promise.all(
    comparar.map(([t, c]) =>
      lerTudo<Record<string, unknown>>(t, c, (q) => q.is("deleted_at", null)),
    ),
  );
  comparar.forEach(([t], i) => {
    for (const r of listas[i]!)
      existentes.push({
        tabela: t,
        id: String(r["id"]),
        chave_origem: String(r["chave_origem"]),
        campos: r,
      });
  });
  return {
    clientes,
    variacoes,
    vinculosFurtado: vinculos.map((v) => v.cliente_id),
    processos,
    nbs,
    rejeicoes,
    existentes,
  };
}

export async function hashArquivo(arquivo: Blob): Promise<string> {
  const buf = await arquivo.arrayBuffer();
  const dig = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface LoteExistente {
  id: string;
  created_at: string;
  status: string;
  arquivo_nome: string;
}

export async function lotesComMesmoArquivo(hash: string): Promise<LoteExistente[]> {
  const { data, error } = await db
    .from("import_lotes")
    .select("id,created_at,status,arquivo_nome")
    .eq("arquivo_hash", hash)
    .not("status", "in", "(desfeito,desfeito_parcial)")
    .order("created_at", { ascending: false });
  if (error) falha(error.message);
  return (data ?? []) as LoteExistente[];
}

export interface Progresso {
  etapa: string;
  atual: number;
  total: number;
}

async function emLotes<T>(
  itens: T[],
  tamanho: number,
  fn: (parte: T[]) => Promise<void>,
  aoAvancar?: (n: number) => void,
) {
  for (let i = 0; i < itens.length; i += tamanho) {
    await fn(itens.slice(i, i + tamanho));
    aoAvancar?.(Math.min(i + tamanho, itens.length));
  }
}

async function inserirIgnorando(tabela: string, linhas: object[], conflito: string): Promise<void> {
  const { error } = await db
    .from(tabela)
    .upsert(linhas, { onConflict: conflito, ignoreDuplicates: true });
  if (error) falha(`${tabela}: ${error.message}`);
}

async function atualizarLote(id: string, campos: Record<string, unknown>) {
  const { error } = await db.from("import_lotes").update(campos).eq("id", id);
  if (error) falha(error.message);
}

function caminhoArquivo(loteId: string, nome: string): string {
  const seguro = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\-]+/g, "_");
  return `furtado/${loteId}/${seguro}`;
}

/** Aplica no banco as pessoas prontas, em grupos transacionais. */
export async function aplicarPessoas(
  loteId: string,
  refs: string[],
  onProgresso?: (p: Progresso) => void,
): Promise<void> {
  const tamanho = 8;
  for (let i = 0; i < refs.length; i += tamanho) {
    const { error } = await db.rpc("aplicar_pessoas_lote", {
      p_lote: loteId,
      p_refs: refs.slice(i, i + tamanho),
    });
    if (error)
      falha(
        `Falha ao gravar clientes (${i + 1}–${Math.min(i + tamanho, refs.length)}): ${error.message}`,
      );
    onProgresso?.({
      etapa: "Gravando clientes e informações",
      atual: Math.min(i + tamanho, refs.length),
      total: refs.length,
    });
    await atualizarLote(loteId, {
      progresso: Math.round((Math.min(i + tamanho, refs.length) / Math.max(1, refs.length)) * 100),
    });
  }
}

async function finalizarLote(loteId: string): Promise<void> {
  const [{ count: pendentes }, { count: abertas }] = await Promise.all([
    db
      .from("import_pessoas")
      .select("id", { count: "exact", head: true })
      .eq("lote_id", loteId)
      .eq("status", "pendente"),
    db
      .from("import_pendencias")
      .select("id", { count: "exact", head: true })
      .eq("lote_id", loteId)
      .eq("status", "aberta"),
  ]);
  await atualizarLote(loteId, {
    etapa: "concluido",
    progresso: 100,
    concluido_em: new Date().toISOString(),
    status: (pendentes ?? 0) + (abertas ?? 0) > 0 ? "gravado_com_pendencias" : "concluido",
    erro: null,
  });
}

/** Grava blocos e células (idempotente). */
async function gravarRastreabilidade(
  loteId: string,
  planilha: PlanilhaLida,
  analise: AnaliseFurtado,
  plano: PlanoFurtado,
  onProgresso?: (p: Progresso) => void,
): Promise<void> {
  const blocos = linhasBlocos(loteId, analise, plano);
  await emLotes(blocos, 300, (parte) => inserirIgnorando("import_blocos", parte, "lote_id,ref"));
  const celulas = linhasCelulas(loteId, planilha, analise);
  await emLotes(
    celulas,
    500,
    (parte) => inserirIgnorando("import_celulas", parte, "lote_id,aba,celula"),
    (n) =>
      onProgresso?.({ etapa: "Preservando células da planilha", atual: n, total: celulas.length }),
  );
}

export interface ResultadoGravacao {
  loteId: string;
  aplicadas: number;
  pendentes: number;
}

/**
 * Executa a importação revisada. Pessoas não prontas (associação incerta,
 * conflitos bloqueantes) ficam no lote como pendentes — nada desaparece.
 */
export async function gravarLoteFurtado(params: {
  arquivo: File;
  planilha: PlanilhaLida;
  analise: AnaliseFurtado;
  plano: PlanoFurtado;
  estrategias?: Record<string, EstrategiaAba>;
  onProgresso?: (p: Progresso) => void;
}): Promise<ResultadoGravacao> {
  const { arquivo, planilha, analise, plano, onProgresso } = params;
  onProgresso?.({ etapa: "Registrando o lote", atual: 0, total: 1 });
  const hash = await hashArquivo(arquivo);
  const { data: lote, error } = await db
    .from("import_lotes")
    .insert({
      escritorio: "furtado",
      modelo: MODELO_FURTADO,
      arquivo_nome: arquivo.name,
      arquivo_hash: hash,
      arquivo_tamanho: arquivo.size,
      status: "gravando",
      etapa: "arquivo",
      total_pessoas: plano.pessoas.length,
      resumo: { ...resumoDoLote(analise, plano), estrategias: params.estrategias ?? {} },
      totais: analise.totais,
      abas: abasDoLote(analise),
    })
    .select("id")
    .single();
  if (error || !lote) falha(`Não foi possível registrar o lote: ${error?.message}`);
  const loteId = (lote as { id: string }).id;

  try {
    // 2. Arquivo original preservado
    onProgresso?.({ etapa: "Preservando o arquivo original", atual: 0, total: 1 });
    const caminho = caminhoArquivo(loteId, arquivo.name);
    const up = await supabase.storage
      .from("importacoes")
      .upload(
        caminho,
        arquivo,
        arquivo.type ? { upsert: true, contentType: arquivo.type } : { upsert: true },
      );
    if (up.error) falha(`Não foi possível guardar o arquivo original: ${up.error.message}`);
    await atualizarLote(loteId, { arquivo_path: caminho, etapa: "pessoas" });

    // 3. Pessoas (com o plano completo) e pendências
    onProgresso?.({ etapa: "Registrando pessoas e pendências", atual: 0, total: 1 });
    await emLotes(linhasPessoas(loteId, plano), 40, (parte) =>
      inserirIgnorando("import_pessoas", parte, "lote_id,ref"),
    );
    await emLotes(linhasPendencias(loteId, plano), 300, async (parte) => {
      const { error: e } = await db.from("import_pendencias").insert(parte);
      if (e) falha(`import_pendencias: ${e.message}`);
    });
    await atualizarLote(loteId, { etapa: "celulas" });

    // 4. Blocos e células
    await gravarRastreabilidade(loteId, planilha, analise, plano, onProgresso);
    await atualizarLote(loteId, { etapa: "aplicacao" });
    await db.rpc("preparar_lote_importacao", { p_lote: loteId });

    // 5. Aplicação
    const refs = plano.pessoas
      .filter((p) => p.pronta && (p.acao === "criar" || p.acao === "vincular"))
      .map((p) => p.ref);
    await aplicarPessoas(loteId, refs, onProgresso);

    // 6. Conclusão
    await finalizarLote(loteId);
    return { loteId, aplicadas: refs.length, pendentes: plano.pessoas.length - refs.length };
  } catch (e) {
    await atualizarLote(loteId, { status: "falhou", erro: (e as Error).message }).catch(
      () => undefined,
    );
    throw e;
  }
}

/**
 * Retoma um lote interrompido: refaz a análise do arquivo preservado (o
 * resultado é determinístico), completa células/blocos que faltarem e aplica
 * as pessoas prontas que ainda não foram gravadas. Nada é duplicado.
 */
export async function retomarLote(
  loteId: string,
  onProgresso?: (p: Progresso) => void,
): Promise<void> {
  const { data: lote, error } = await db.from("import_lotes").select("*").eq("id", loteId).single();
  if (error || !lote) falha("Lote não encontrado.");
  const l = lote as {
    arquivo_path: string | null;
    etapa: string | null;
    resumo: { estrategias?: Record<string, EstrategiaAba> };
  };
  if (!l.arquivo_path)
    falha(
      "O arquivo original deste lote não foi preservado; desfaça o lote e importe o arquivo novamente.",
    );
  if (l.etapa === "arquivo" || l.etapa === "pessoas") {
    falha(
      "O lote foi interrompido antes de registrar as decisões da revisão. Desfaça este lote (nada foi gravado nos cadastros) e importe o arquivo novamente.",
    );
  }
  await atualizarLote(loteId, { status: "gravando", erro: null });
  try {
    if (l.etapa !== "aplicacao" && l.etapa !== "concluido") {
      onProgresso?.({ etapa: "Lendo o arquivo preservado", atual: 0, total: 1 });
      const arq = await supabase.storage.from("importacoes").download(l.arquivo_path);
      if (arq.error || !arq.data)
        falha(`Não foi possível ler o arquivo preservado: ${arq.error?.message}`);
      const { planilha, analise } = analisarBinarioFurtado(
        new Uint8Array(await arq.data.arrayBuffer()),
        l.resumo?.estrategias ? { estrategias: l.resumo.estrategias } : {},
      );
      const pessoas = await lerTudo<{ ref: string; payload: { blocos?: string[] } }>(
        "import_pessoas",
        "ref,payload",
        (q) => q.eq("lote_id", loteId),
      );
      const plano = {
        pessoas: pessoas.map((p) => ({ ref: p.ref, blocos: p.payload?.blocos ?? [] })),
      } as unknown as PlanoFurtado;
      await gravarRastreabilidade(loteId, planilha, analise, plano, onProgresso);
      await atualizarLote(loteId, { etapa: "aplicacao" });
    }
    await db.rpc("preparar_lote_importacao", { p_lote: loteId });
    const prontas = await lerTudo<{ ref: string }>("import_pessoas", "ref", (q) =>
      q.eq("lote_id", loteId).eq("status", "pendente").in("acao", ["criar", "vincular"]),
    );
    await aplicarPessoas(
      loteId,
      prontas.map((p) => p.ref),
      onProgresso,
    );
    await finalizarLote(loteId);
  } catch (e) {
    await atualizarLote(loteId, { status: "falhou", erro: (e as Error).message }).catch(
      () => undefined,
    );
    throw e;
  }
}

/** Resolve a associação de uma pessoa pendente e a grava. */
export async function resolverPessoa(params: {
  loteId: string;
  ref: string;
  acao: "criar" | "vincular" | "ignorar";
  clienteId?: string | null;
  nome?: string | null;
  nomeNormalizado?: string | null;
}): Promise<void> {
  const campos: Record<string, unknown> = {
    acao: params.acao,
    cliente_id: params.acao === "vincular" ? params.clienteId : null,
  };
  if (params.acao === "ignorar") campos["status"] = "ignorado";
  if (params.nome && params.nomeNormalizado) {
    campos["nome"] = params.nome;
    campos["nome_normalizado"] = params.nomeNormalizado;
  }
  const { error } = await db
    .from("import_pessoas")
    .update(campos)
    .eq("lote_id", params.loteId)
    .eq("ref", params.ref)
    .eq("status", "pendente");
  if (error) falha(error.message);
  if (params.acao !== "ignorar") {
    const { error: e2 } = await db.rpc("aplicar_pessoas_lote", {
      p_lote: params.loteId,
      p_refs: [params.ref],
    });
    if (e2) falha(e2.message);
  }
  // Pendências bloqueantes desta pessoa ficam resolvidas pela decisão.
  await db
    .from("import_pendencias")
    .update({
      status: "resolvida",
      resolvido_em: new Date().toISOString(),
      resolucao: {
        acao: params.acao,
        cliente_id: params.clienteId ?? null,
        nome: params.nome ?? null,
      },
    })
    .eq("lote_id", params.loteId)
    .eq("pessoa_ref", params.ref)
    .eq("bloqueante", true)
    .eq("status", "aberta");
  await finalizarLote(params.loteId);
}

export async function resolverPendencia(
  id: string,
  status: "resolvida" | "ignorada",
  observacao: string | null,
  loteId: string,
): Promise<void> {
  const { error } = await db
    .from("import_pendencias")
    .update({
      status,
      resolvido_em: new Date().toISOString(),
      resolucao: { acao: status === "resolvida" ? "revisada" : "ignorada", observacao },
    })
    .eq("id", id);
  if (error) falha(error.message);
  await finalizarLote(loteId);
}

export async function substituirCampoImportado(params: {
  tabela: string;
  registroId: string;
  campo: string;
  valor: unknown;
  pendenciaId: string;
  loteId: string;
}): Promise<void> {
  const { error } = await db.rpc("atualizar_campo_importado", {
    p_tabela: params.tabela,
    p_id: params.registroId,
    p_campo: params.campo,
    p_valor: params.valor,
    p_pendencia: params.pendenciaId,
  });
  if (error) falha(error.message);
  await finalizarLote(params.loteId);
}

export async function registrarRecebimentoImportado(params: {
  clienteId: string;
  valor: number;
  data: string;
  classificacao: string | null;
  observacao: string | null;
  lancamentoId?: string | null;
  atendimentoId?: string | null;
  distribuicao?: { parcela_id: string; valor: number }[];
  pendenciaId?: string | null;
  loteId?: string | null;
}): Promise<void> {
  const { error } = await db.rpc("registrar_recebimento_importado", {
    p_cliente: params.clienteId,
    p_valor: params.valor,
    p_data: params.data,
    p_classificacao: params.classificacao,
    p_observacao: params.observacao,
    p_lancamento: params.lancamentoId ?? null,
    p_atendimento: params.atendimentoId ?? null,
    p_distribuicao: params.distribuicao ?? [],
    p_pendencia: params.pendenciaId ?? null,
  });
  if (error) falha(error.message);
  if (params.loteId) await finalizarLote(params.loteId);
}

export async function desfazerLote(
  loteId: string,
): Promise<{ removidos: number; revertidos: number; preservados: unknown[] }> {
  const { data, error } = await db.rpc("desfazer_lote", { p_lote: loteId });
  if (error) falha(error.message);
  return data as { removidos: number; revertidos: number; preservados: unknown[] };
}

export async function mesclarAtendimentos(origem: string, destino: string): Promise<void> {
  const { error } = await db.rpc("mesclar_atendimentos", { p_origem: origem, p_destino: destino });
  if (error) falha(error.message);
}

export async function urlArquivoOriginal(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from("importacoes").createSignedUrl(caminho, 300);
  if (error || !data) falha(`Arquivo indisponível: ${error?.message}`);
  return data.signedUrl;
}
