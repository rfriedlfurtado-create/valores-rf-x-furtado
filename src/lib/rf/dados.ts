/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda sem tipos gerados (types.ts) */
/**
 * Acesso ao banco do modelo Ricardo Friedl: importação (prévia/gravação),
 * perfil do cliente, edição de campos e revisões.
 */

import { queryOptions } from "@tanstack/react-query";

import { db } from "@/lib/furtado/persistencia";
import { normalizarTexto } from "@/lib/situacao";
import type { Pagamento } from "@/lib/tipos";

import type { ChaveCampo } from "./campos";

/** Valores do modelo (formato canônico, sempre texto). */
export type DadosRF = { [K in ChaveCampo]?: string };
import type { LinhaPayload } from "./planilha";
import { somenteDigitos } from "./valores";

function falha(msg: string): never {
  throw new Error(msg);
}

// ---------------------------------------------------------------------------
// Importação
// ---------------------------------------------------------------------------

export type StatusClienteLinha =
  "novo" | "mesmo_arquivo" | "existente" | "ja_importado" | "repetida";
export type StatusRegistroLinha =
  "novo" | "agrupado" | "ja_importado" | "repetida" | "sem_registro";

export interface ConflitoLinha {
  chave: string;
  entidade: "cliente" | "registro";
  campo: string;
  atual: string;
  novo: string;
  substituido: boolean;
}

export interface ResultadoLinha {
  linha: number;
  nome: string;
  cliente: StatusClienteLinha;
  cliente_id: string;
  registro: StatusRegistroLinha;
  atendimento_id: string | null;
  revisao: string | null;
  linha_original?: number;
  duplicidades: { id: string; nome: string; cpf: string | null }[];
  complementos: string[];
  conflitos: ConflitoLinha[];
}

export interface ResultadoImportacao {
  importacao_id: string | null;
  linhas: ResultadoLinha[];
  simulacao: boolean;
}

/** Quantidade de linhas por chamada (cada chamada é uma transação no banco). */
export const LINHAS_POR_LOTE = 250;
/** Acima disto a prévia também é feita em partes. */
const LIMITE_PREVIA_UNICA = 1500;

async function chamar(
  linhas: LinhaPayload[],
  arquivo: string,
  aba: string,
  simular: boolean,
  substituir: string[],
  importacaoId: string | null,
): Promise<ResultadoImportacao> {
  const { data, error } = await db.rpc("aplicar_importacao_rf", {
    p_linhas: linhas,
    p_arquivo: arquivo,
    p_aba: aba,
    p_simular: simular,
    p_substituir: substituir,
    p_importacao_id: importacaoId,
  });
  if (error) falha(error.message);
  return data as ResultadoImportacao;
}

function partes<T>(lista: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
}

/** Prévia: executa as mesmas regras da gravação e desfaz tudo no banco. */
export async function simularImportacao(
  linhas: LinhaPayload[],
  arquivo: string,
  aba: string,
): Promise<ResultadoLinha[]> {
  if (linhas.length === 0) return [];
  const blocos =
    linhas.length > LIMITE_PREVIA_UNICA ? partes(linhas, LIMITE_PREVIA_UNICA) : [linhas];
  const out: ResultadoLinha[] = [];
  for (const bloco of blocos) {
    const r = await chamar(bloco, arquivo, aba, true, [], null);
    out.push(...r.linhas);
  }
  return out;
}

/**
 * Gravação definitiva, em partes sequenciais (cada parte é atômica). Como a
 * importação é idempotente (chave da linha), repetir após uma falha nunca
 * duplica registros.
 */
export async function gravarImportacao(
  linhas: LinhaPayload[],
  arquivo: string,
  aba: string,
  substituir: string[],
  aoProgredir?: (feitas: number, total: number) => void,
): Promise<{ importacaoId: string | null; linhas: ResultadoLinha[] }> {
  let importacaoId: string | null = null;
  const out: ResultadoLinha[] = [];
  for (const bloco of partes(linhas, LINHAS_POR_LOTE)) {
    const r = await chamar(bloco, arquivo, aba, false, substituir, importacaoId);
    importacaoId = r.importacao_id;
    out.push(...r.linhas);
    aoProgredir?.(out.length, linhas.length);
  }
  return { importacaoId, linhas: out };
}

export interface ResumoImportacao {
  totalLinhas: number;
  linhasVazias: number;
  clientesNovos: number;
  clientesExistentes: number;
  registrosNovos: number;
  registrosAgrupados: number;
  linhasJaImportadas: number;
  linhasRepetidas: number;
  complementos: number;
  conflitos: number;
  duplicidades: number;
  revisoesAssociacao: number;
  avisos: number;
  pendentes: number;
}

export function resumir(
  resultado: ResultadoLinha[],
  extras: { totalLinhas: number; linhasVazias: number; avisos: number; pendentes: number },
): ResumoImportacao {
  const novos = new Set<string>();
  const existentes = new Set<string>();
  let registrosNovos = 0,
    registrosAgrupados = 0,
    jaImportadas = 0,
    repetidas = 0,
    complementos = 0,
    conflitos = 0,
    duplicidades = 0,
    revisoes = 0;
  for (const l of resultado) {
    if (l.cliente === "novo") novos.add(l.cliente_id);
    if (l.cliente === "existente") existentes.add(l.cliente_id);
    if (l.cliente === "ja_importado") jaImportadas += 1;
    if (l.cliente === "repetida") repetidas += 1;
    if (l.registro === "novo") registrosNovos += 1;
    if (l.registro === "agrupado") registrosAgrupados += 1;
    complementos += l.complementos?.length ?? 0;
    conflitos += l.conflitos?.length ?? 0;
    if ((l.duplicidades?.length ?? 0) > 0) duplicidades += 1;
    if (l.revisao) revisoes += 1;
  }
  for (const id of novos) existentes.delete(id);
  return {
    totalLinhas: extras.totalLinhas,
    linhasVazias: extras.linhasVazias,
    clientesNovos: novos.size,
    clientesExistentes: existentes.size,
    registrosNovos,
    registrosAgrupados,
    linhasJaImportadas: jaImportadas,
    linhasRepetidas: repetidas,
    complementos,
    conflitos,
    duplicidades,
    revisoesAssociacao: revisoes,
    avisos: extras.avisos,
    pendentes: extras.pendentes,
  };
}

/** Grava o resumo final no histórico de importações. */
export async function registrarResumo(
  importacaoId: string,
  resumo: ResumoImportacao,
): Promise<void> {
  const { error } = await db
    .from("importacoes")
    .update({
      resumo,
      quantidade_clientes: resumo.totalLinhas,
      quantidade_possiveis: resumo.duplicidades,
      quantidade_correspondencias: resumo.clientesExistentes,
    })
    .eq("id", importacaoId);
  if (error) falha(error.message);
}

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export interface ClienteRF {
  id: string;
  nome: string;
  nome_normalizado: string;
  cpf: string | null;
  cpf_digitos: string | null;
  status: string;
  escritorio_origem: string;
  origem_importacao: string | null;
  data_importacao: string | null;
  dados_rf: DadosRF;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface RegistroRF {
  id: string;
  cliente_id: string;
  escritorio: string;
  modelo: string | null;
  numero_processo: string | null;
  servico: string | null;
  situacao: string | null;
  dados_rf: DadosRF;
  informacoes_adicionais: Record<string, string>;
  revisao_motivo: string | null;
  /** Situação de pagamento DESTE processo (JÁ PAGOS quando true). */
  pago: boolean;
  pago_em: string | null;
  origens: { arquivo?: string; aba?: string; linha?: number }[] | unknown[];
  created_at: string;
  updated_at: string;
}

export interface LinhaOrigem {
  id: string;
  cliente_id: string;
  atendimento_id: string | null;
  importacao_id: string | null;
  arquivo_nome: string | null;
  aba: string | null;
  linha: number;
  chave_linha: string;
  valores: Record<string, string>;
  extras: Record<string, string>;
  avisos: string[];
  created_at: string;
}

export interface RevisaoRF {
  id: string;
  tipo: "divergencia" | "duplicidade" | "associacao";
  cliente_id: string;
  atendimento_id: string | null;
  outro_cliente_id: string | null;
  entidade: "cliente" | "registro" | null;
  campo: string | null;
  valor_atual: string | null;
  valor_novo: string | null;
  descricao: string | null;
  origem: { arquivo?: string; aba?: string; linha?: number };
  status: "aberta" | "aplicada" | "mantida" | "descartada";
  created_at: string;
}

export interface HistoricoRF {
  id: string;
  atendimento_id: string | null;
  categoria: string;
  texto: string;
  aba: string | null;
  celulas: string | null;
  created_at: string;
}

export interface PerfilRF {
  cliente: ClienteRF;
  registros: RegistroRF[];
  linhas: LinhaOrigem[];
  revisoes: RevisaoRF[];
  historico: HistoricoRF[];
  pagamentos: Pagamento[];
  outrosClientes: Map<string, { id: string; nome: string; cpf: string | null }>;
  importacoes: Map<
    string,
    { id: string; nome_importacao: string; origem_arquivo: string | null; created_at: string }
  >;
}

/**
 * Valores do registro para exibição. Registros antigos (sem dados do modelo)
 * mostram o que já estava cadastrado nas colunas próprias.
 */
export function dadosDoRegistro(r: RegistroRF): DadosRF {
  const d = { ...(r.dados_rf ?? {}) };
  if (!d.numero && r.numero_processo) d.numero = r.numero_processo;
  if (!d.tipo_acao && r.servico) d.tipo_acao = r.servico;
  if (!d.situacao && r.situacao) d.situacao = r.situacao;
  return d;
}

export const perfilRFQuery = (clienteId: string) =>
  queryOptions({
    queryKey: ["perfil_rf", clienteId],
    queryFn: async (): Promise<PerfilRF | null> => {
      const cli = await db.from("clientes").select("*").eq("id", clienteId).maybeSingle();
      if (cli.error) falha(cli.error.message);
      if (!cli.data) return null;
      const [registros, linhas, revisoes, historico, pagamentos] = await Promise.all([
        db
          .from("atendimentos")
          .select("*")
          .eq("cliente_id", clienteId)
          .is("deleted_at", null)
          .order("created_at"),
        db.from("registro_linhas").select("*").eq("cliente_id", clienteId).order("linha"),
        db.from("revisoes_rf").select("*").eq("cliente_id", clienteId).order("created_at"),
        db
          .from("historico_cliente")
          .select("id,atendimento_id,categoria,texto,aba,celulas,created_at")
          .eq("cliente_id", clienteId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        db.from("pagamentos").select("*").eq("cliente_id", clienteId).order("data_pagamento"),
      ]);
      for (const r of [registros, linhas, revisoes, historico, pagamentos])
        if (r.error) falha(r.error.message);

      const revs = (revisoes.data ?? []) as RevisaoRF[];
      const lins = (linhas.data ?? []) as LinhaOrigem[];
      const outrosIds = [
        ...new Set(revs.map((r) => r.outro_cliente_id).filter(Boolean)),
      ] as string[];
      const impIds = [...new Set(lins.map((l) => l.importacao_id).filter(Boolean))] as string[];
      const [outros, imps] = await Promise.all([
        outrosIds.length
          ? db.from("clientes").select("id,nome,cpf").in("id", outrosIds)
          : Promise.resolve({ data: [], error: null }),
        impIds.length
          ? db
              .from("importacoes")
              .select("id,nome_importacao,origem_arquivo,created_at")
              .in("id", impIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (outros.error) falha(outros.error.message);
      if (imps.error) falha(imps.error.message);

      return {
        cliente: { ...(cli.data as any), dados_rf: (cli.data as any).dados_rf ?? {} } as ClienteRF,
        registros: (registros.data ?? []) as RegistroRF[],
        linhas: lins,
        revisoes: revs,
        historico: (historico.data ?? []) as HistoricoRF[],
        pagamentos: ((pagamentos.data ?? []) as Pagamento[]).map((p) => ({
          ...p,
          valor: Number(p.valor),
        })),
        outrosClientes: new Map(((outros.data ?? []) as any[]).map((o) => [o.id, o])),
        importacoes: new Map(((imps.data ?? []) as any[]).map((i) => [i.id, i])),
      };
    },
    staleTime: 15_000,
  });

export const CHAVES_RF = [["perfil_rf"]] as const;

// ---------------------------------------------------------------------------
// Edição e revisões
// ---------------------------------------------------------------------------

export async function editarCampo(params: {
  entidade: "cliente" | "registro" | "adicional";
  id: string;
  campo: ChaveCampo | string;
  valor: string | null;
  /** Para número/tipo: dados atuais do registro (recalcula a chave de reconhecimento). */
  registro?: DadosRF;
}): Promise<void> {
  const extra: { nome_normalizado?: string; numero_digitos?: string; tipo_norm?: string } = {};
  if (params.campo === "nome" && params.valor)
    extra.nome_normalizado = normalizarTexto(params.valor);
  if (
    params.entidade === "registro" &&
    (params.campo === "numero" || params.campo === "tipo_acao")
  ) {
    const numero = params.campo === "numero" ? params.valor : params.registro?.numero;
    const tipo = params.campo === "tipo_acao" ? params.valor : params.registro?.tipo_acao;
    extra.numero_digitos = somenteDigitos(numero);
    extra.tipo_norm = tipo ? normalizarTexto(tipo) : "";
  }
  const { error } = await db.rpc("editar_campo_rf", {
    p_entidade: params.entidade,
    p_id: params.id,
    p_campo: params.campo,
    p_valor: params.valor,
    p_extra: extra,
    p_motivo: "edição manual no perfil",
  });
  if (error) falha(error.message);
}

export async function resolverRevisao(
  revisao: RevisaoRF,
  acao: "aplicar" | "manter" | "revisado",
): Promise<void> {
  const extra: { nome_normalizado?: string } = {};
  if (acao === "aplicar" && revisao.campo === "nome" && revisao.valor_novo)
    extra.nome_normalizado = normalizarTexto(revisao.valor_novo);
  const { error } = await db.rpc("resolver_revisao_rf", {
    p_id: revisao.id,
    p_acao: acao,
    p_extra: extra,
  });
  if (error) falha(error.message);
}
