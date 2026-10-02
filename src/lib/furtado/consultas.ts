/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda sem tipos gerados (types.ts) */
/**
 * Consultas (TanStack Query) das novas entidades: lotes de importação,
 * perfil completo do cliente, processos/atendimentos, cobranças, parcelas,
 * lançamentos e vínculos por escritório.
 */

import { queryOptions } from "@tanstack/react-query";

import { db } from "./persistencia";
import type { CategoriaFinanceira, EscritorioOrigem } from "./modelo";

function falha(msg: string): never {
  throw new Error(msg);
}

async function todos<T>(
  tabela: string,
  colunas: string,
  filtro?: (q: any) => any,
  ordem?: [string, boolean],
): Promise<T[]> {
  const out: T[] = [];
  const passo = 1000;
  for (let de = 0; ; de += passo) {
    let q = db
      .from(tabela)
      .select(colunas)
      .range(de, de + passo - 1);
    if (filtro) q = filtro(q);
    if (ordem) q = q.order(ordem[0], { ascending: ordem[1] });
    const { data, error } = await q;
    if (error) falha(`${tabela}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < passo) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tipos de linha
// ---------------------------------------------------------------------------

export interface Atendimento {
  id: string;
  cliente_id: string;
  escritorio: EscritorioOrigem;
  numero_processo: string | null;
  processo_digitos: string | null;
  tribunal: string | null;
  natureza: "judicial" | "administrativo" | null;
  servico: string | null;
  beneficio: string | null;
  situacao: string | null;
  observacoes: string | null;
  parceria: string | null;
  origens: string[];
  lote_id: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface Beneficio {
  id: string;
  cliente_id: string;
  atendimento_id: string | null;
  especie: string | null;
  especie_codigo: string | null;
  nb: string | null;
  nb_digitos: string | null;
  dib: string | null;
  dib_texto: string | null;
  dib_origem_texto: string | null;
  dip: string | null;
  dip_texto: string | null;
  dcb: string | null;
  dcb_texto: string | null;
  rmi: number | null;
  rmi_texto: string | null;
  rma: number | null;
  rma_texto: string | null;
  previsao_pagamento_texto: string | null;
  transito_julgado: string | null;
  transito_texto: string | null;
  data_requerimento_texto: string | null;
  data_concessao_texto: string | null;
  prorrogacao_texto: string | null;
  revisao_texto: string | null;
  implantacao_texto: string | null;
  atrasados_texto: string | null;
  honorarios_regra: string | null;
  comunicacao_texto: string | null;
  historico: { campo: string; texto: string; celula: string }[];
  origens: string[];
  escritorio: string | null;
}

export interface Lancamento {
  id: string;
  cliente_id: string;
  atendimento_id: string | null;
  categoria: CategoriaFinanceira;
  natureza: "previsto" | "devido" | "informativo" | "recebido";
  valor: number | null;
  valor_texto: string | null;
  percentual: number | null;
  base_calculo: string | null;
  quantidade_beneficios: number | null;
  ausencia_declarada: string | null;
  rotulo_original: string | null;
  versao: number;
  coluna: string | null;
  data_referencia_texto: string | null;
  situacao_texto: string | null;
  observacao: string | null;
  origens: string[];
  pagamento_id: string | null;
  escritorio: string | null;
  lote_id: string | null;
}

export interface Requisicao {
  id: string;
  cliente_id: string;
  atendimento_id: string | null;
  tipo: "rpv" | "precatorio" | "ted" | "alvara" | "nao_definido";
  numero_processo: string | null;
  expedicao_texto: string | null;
  ano_previsto: number | null;
  previsao_texto: string | null;
  valor: number | null;
  valor_texto: string | null;
  tipo_valor: string | null;
  conta_indicada: string | null;
  titular: string | null;
  situacao: string | null;
  situacao_texto: string | null;
  data_texto: string | null;
  retificacao: string | null;
  venda: boolean;
  observacoes: string | null;
  origens: string[];
  escritorio: string | null;
}

export interface Acordo {
  id: string;
  cliente_id: string;
  atendimento_id: string | null;
  numero_processo: string | null;
  aceitacao: string | null;
  aceitacao_texto: string | null;
  percentual: number | null;
  beneficio: string | null;
  dib: string | null;
  dib_texto: string | null;
  dip: string | null;
  dip_texto: string | null;
  dcb: string | null;
  dcb_texto: string | null;
  dcb_prazo_dias: number | null;
  sucumbencia_percentual: number | null;
  sucumbencia_texto: string | null;
  de_acordo_laudo: string | null;
  prorrogacao: string | null;
  reabilitacao: string | null;
  observacoes: string | null;
  origens: string[];
}

export interface Parcela {
  id: string;
  cobranca_id: string;
  cliente_id: string;
  numero: number;
  valor: number;
  vencimento: string | null;
  vencimento_texto: string | null;
  situacao: "aberta" | "paga" | "paga_parcial";
  valor_pago: number;
  deleted_at: string | null;
}

export interface Cobranca {
  id: string;
  cliente_id: string;
  atendimento_id: string | null;
  escritorio: EscritorioOrigem;
  descricao: string | null;
  valor_contratado: number | null;
  entrada: number | null;
  quantidade_parcelas: number | null;
  valor_parcela: number | null;
  vencimento_inicial: string | null;
  vencimento_texto: string | null;
  situacao: "pendente" | "parcial" | "quitada" | "a_confirmar";
  responsavel: string | null;
  prestacao_contas: string | null;
  historico: string | null;
  divergencia: string | null;
  completar: string | null;
  origens: string[];
  deleted_at: string | null;
  created_at: string;
}

export interface DadoBancario {
  id: string;
  cliente_id: string;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  operacao: string | null;
  tipo_conta: string | null;
  titular: string | null;
  cpf_titular: string | null;
  texto_original: string;
  consistente: boolean;
  observacao: string | null;
  origens: string[];
}

export interface Representante {
  id: string;
  cliente_id: string;
  nome: string | null;
  relacao: string | null;
  texto_original: string;
  origens: string[];
}

export interface HistoricoCliente {
  id: string;
  cliente_id: string;
  atendimento_id: string | null;
  categoria: string;
  texto: string;
  aba: string | null;
  celulas: string | null;
  data_texto: string | null;
  lote_id: string | null;
  created_at: string;
}

export interface VinculoEscritorio {
  id: string;
  cliente_id: string;
  escritorio: "furtado" | "ricardo_friedl";
  lote_id: string | null;
  importacao_id: string | null;
  created_at: string;
}

export interface LoteImportacao {
  id: string;
  escritorio: "furtado" | "ricardo_friedl";
  modelo: string;
  arquivo_nome: string;
  arquivo_hash: string | null;
  arquivo_tamanho: number | null;
  arquivo_path: string | null;
  status:
    | "gravando"
    | "gravado_com_pendencias"
    | "concluido"
    | "falhou"
    | "desfeito"
    | "desfeito_parcial";
  etapa: string | null;
  progresso: number;
  total_pessoas: number;
  pessoas_aplicadas: number;
  resumo: Record<string, any>;
  totais: any[];
  abas: any[];
  erro: string | null;
  created_at: string;
  concluido_em: string | null;
  desfeito_em: string | null;
}

export interface PessoaLote {
  id: string;
  ref: string;
  nome: string;
  nome_normalizado: string;
  acao: "criar" | "vincular" | "pendente" | "ignorar";
  cliente_id: string | null;
  status: "pendente" | "aplicado" | "desfeito" | "ignorado";
  motivo: string | null;
  candidatos: {
    clienteId: string;
    nome: string;
    percentual: number;
    motivo: string;
    escritorio: string | null;
  }[];
  resumo: Record<string, any> | null;
  blocos: string[] | null;
  correspondencia: string | null;
  sugestao: string | null;
}

export interface PendenciaLote {
  id: string;
  lote_id: string;
  pessoa_ref: string | null;
  bloco_ref: string | null;
  tipo: string;
  bloqueante: boolean;
  descricao: string;
  celulas: string[];
  dados: Record<string, any>;
  status: "aberta" | "resolvida" | "ignorada";
  resolucao: Record<string, any> | null;
  created_at: string;
}

export interface CelulaLote {
  id: string;
  lote_id: string;
  aba: string;
  celula: string;
  linha: number;
  coluna: number;
  valor_original: string | null;
  tipo: string | null;
  formula: string | null;
  resultado_armazenado: string | null;
  resultado_recalculado: string | null;
  formato: string | null;
  metadados: Record<string, any>;
  bloco_ref: string | null;
  cliente_id: string | null;
  valor_interpretado: any;
  destino: string;
  destino_ref: string | null;
  situacao: string;
}

export interface BlocoLote {
  id: string;
  lote_id: string;
  ref: string;
  aba: string;
  intervalo: string | null;
  tipo: string;
  nome_original: string | null;
  nome_detectado: string | null;
  pessoa_ref: string | null;
  cliente_id: string | null;
  status: string;
  dados: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

export const vinculosEscritorioQuery = () =>
  queryOptions({
    queryKey: ["vinculos_escritorio"],
    queryFn: () => todos<VinculoEscritorio>("cliente_escritorios", "*"),
    staleTime: 30_000,
  });

export const atendimentosQuery = () =>
  queryOptions({
    queryKey: ["atendimentos"],
    queryFn: () => todos<Atendimento>("atendimentos", "*", (q) => q.is("deleted_at", null)),
    staleTime: 30_000,
  });

export const beneficiosTodosQuery = () =>
  queryOptions({
    queryKey: ["beneficios"],
    queryFn: () =>
      todos<
        Pick<
          Beneficio,
          "id" | "cliente_id" | "atendimento_id" | "nb" | "nb_digitos" | "especie" | "escritorio"
        >
      >("beneficios", "id,cliente_id,atendimento_id,nb,nb_digitos,especie,escritorio", (q) =>
        q.is("deleted_at", null),
      ),
    staleTime: 30_000,
  });

export const lancamentosQuery = () =>
  queryOptions({
    queryKey: ["lancamentos"],
    queryFn: () =>
      todos<Lancamento>("lancamentos_financeiros", "*", (q) => q.is("deleted_at", null)),
    staleTime: 30_000,
  });

export const cobrancasQuery = () =>
  queryOptions({
    queryKey: ["cobrancas"],
    queryFn: async () => {
      const [cobrancas, parcelas] = await Promise.all([
        todos<Cobranca>("cobrancas", "*", (q) => q.is("deleted_at", null)),
        todos<Parcela>("parcelas", "*", (q) => q.is("deleted_at", null)),
      ]);
      return { cobrancas, parcelas };
    },
    staleTime: 30_000,
  });

export const requisicoesQuery = () =>
  queryOptions({
    queryKey: ["requisicoes"],
    queryFn: () => todos<Requisicao>("requisicoes", "*", (q) => q.is("deleted_at", null)),
    staleTime: 30_000,
  });

export interface PerfilCompleto {
  atendimentos: Atendimento[];
  beneficios: Beneficio[];
  lancamentos: Lancamento[];
  requisicoes: Requisicao[];
  acordos: Acordo[];
  cobrancas: Cobranca[];
  parcelas: Parcela[];
  recebimentoParcelas: { pagamento_id: string; parcela_id: string; valor: number }[];
  bancarios: DadoBancario[];
  representantes: Representante[];
  historico: HistoricoCliente[];
  vinculos: VinculoEscritorio[];
  blocos: BlocoLote[];
  lotes: Pick<LoteImportacao, "id" | "arquivo_nome" | "created_at" | "escritorio" | "status">[];
  pendencias: PendenciaLote[];
}

export const perfilCompletoQuery = (clienteId: string) =>
  queryOptions({
    queryKey: ["perfil_completo", clienteId],
    queryFn: async (): Promise<PerfilCompleto> => {
      const doCliente = (t: string, sel = "*") =>
        todos<any>(t, sel, (q) => {
          let x = q.eq("cliente_id", clienteId);
          if (!["cliente_escritorios", "import_blocos", "recebimento_parcelas"].includes(t))
            x = x.is("deleted_at", null);
          return x;
        });
      const [
        atendimentos,
        beneficios,
        lancamentos,
        requisicoes,
        acordos,
        cobrancas,
        parcelas,
        bancarios,
        representantes,
        historico,
        vinculos,
        blocos,
      ] = await Promise.all([
        doCliente("atendimentos"),
        doCliente("beneficios"),
        doCliente("lancamentos_financeiros"),
        doCliente("requisicoes"),
        doCliente("acordos"),
        doCliente("cobrancas"),
        doCliente("parcelas"),
        doCliente("dados_bancarios"),
        doCliente("representantes"),
        doCliente("historico_cliente"),
        doCliente("cliente_escritorios"),
        doCliente("import_blocos"),
      ]);
      const idsParcelas = (parcelas as Parcela[]).map((p) => p.id);
      const recebimentoParcelas = idsParcelas.length
        ? await todos<{ pagamento_id: string; parcela_id: string; valor: number }>(
            "recebimento_parcelas",
            "pagamento_id,parcela_id,valor",
            (q) => q.in("parcela_id", idsParcelas),
          )
        : [];
      const pessoas = await todos<{ lote_id: string; ref: string }>(
        "import_pessoas",
        "lote_id,ref",
        (q) => q.eq("cliente_id", clienteId).eq("status", "aplicado"),
      );
      const pendencias: PendenciaLote[] = [];
      for (const loteId of [...new Set(pessoas.map((p) => p.lote_id))]) {
        const refs = pessoas.filter((p) => p.lote_id === loteId).map((p) => p.ref);
        pendencias.push(
          ...(await todos<PendenciaLote>("import_pendencias", "*", (q) =>
            q.eq("lote_id", loteId).in("pessoa_ref", refs).eq("status", "aberta"),
          )),
        );
      }
      const idsLotes = [
        ...new Set([
          ...(blocos as BlocoLote[]).map((b) => b.lote_id),
          ...pessoas.map((p) => p.lote_id),
        ]),
      ];
      const lotes = idsLotes.length
        ? await todos<PerfilCompleto["lotes"][number]>(
            "import_lotes",
            "id,arquivo_nome,created_at,escritorio,status",
            (q) => q.in("id", idsLotes),
          )
        : [];
      return {
        atendimentos,
        beneficios,
        lancamentos,
        requisicoes,
        acordos,
        cobrancas,
        parcelas,
        recebimentoParcelas,
        bancarios,
        representantes,
        historico: (historico as HistoricoCliente[]).sort(
          (a, b) =>
            (a.aba ?? "").localeCompare(b.aba ?? "") || a.created_at.localeCompare(b.created_at),
        ),
        vinculos,
        blocos,
        lotes,
        pendencias,
      };
    },
    staleTime: 15_000,
  });

export const celulasDoClienteQuery = (clienteId: string) =>
  queryOptions({
    queryKey: ["celulas_cliente", clienteId],
    queryFn: () =>
      todos<CelulaLote>("import_celulas", "*", (q) => q.eq("cliente_id", clienteId), [
        "linha",
        true,
      ]),
    staleTime: 60_000,
  });

export const lotesQuery = () =>
  queryOptions({
    queryKey: ["import_lotes"],
    queryFn: () => todos<LoteImportacao>("import_lotes", "*", undefined, ["created_at", false]),
    staleTime: 10_000,
  });

export const loteQuery = (loteId: string) =>
  queryOptions({
    queryKey: ["import_lote", loteId],
    queryFn: async () => {
      const { data, error } = await db.from("import_lotes").select("*").eq("id", loteId).single();
      if (error) falha(error.message);
      const [pessoas, pendencias, blocos] = await Promise.all([
        todos<PessoaLote>(
          "import_pessoas",
          "id,ref,nome,nome_normalizado,acao,cliente_id,status,motivo,candidatos,resumo:payload->resumo,blocos:payload->blocos,correspondencia:payload->>correspondencia,sugestao:payload->>sugestao",
          (q) => q.eq("lote_id", loteId),
          ["nome", true],
        ),
        todos<PendenciaLote>("import_pendencias", "*", (q) => q.eq("lote_id", loteId), [
          "created_at",
          true,
        ]),
        todos<BlocoLote>("import_blocos", "*", (q) => q.eq("lote_id", loteId)),
      ]);
      return { lote: data as LoteImportacao, pessoas, pendencias, blocos };
    },
    staleTime: 5_000,
  });

export const celulasDoLoteQuery = (
  loteId: string,
  filtro: { aba?: string; destino?: string; busca?: string; pagina: number },
) =>
  queryOptions({
    queryKey: ["import_celulas", loteId, filtro],
    queryFn: async () => {
      const tamanho = 200;
      let q = db
        .from("import_celulas")
        .select("*", { count: "exact" })
        .eq("lote_id", loteId)
        .order("aba", { ascending: true })
        .order("linha", { ascending: true })
        .order("coluna", { ascending: true })
        .range(filtro.pagina * tamanho, filtro.pagina * tamanho + tamanho - 1);
      if (filtro.aba) q = q.eq("aba", filtro.aba);
      if (filtro.destino) q = q.eq("destino", filtro.destino);
      if (filtro.busca)
        q = q.or(
          `valor_original.ilike.%${filtro.busca.replace(/[%,()]/g, " ")}%,celula.eq.${filtro.busca.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`,
        );
      const { data, error, count } = await q;
      if (error) falha(error.message);
      return { celulas: (data ?? []) as CelulaLote[], total: count ?? 0, tamanho };
    },
    staleTime: 30_000,
  });

/** Chaves revalidadas por qualquer evento de domínio (somadas às de dados.ts). */
export const CHAVES_FURTADO = [
  ["vinculos_escritorio"],
  ["atendimentos"],
  ["beneficios"],
  ["lancamentos"],
  ["cobrancas"],
  ["requisicoes"],
  ["perfil_completo"],
  ["celulas_cliente"],
  ["import_lotes"],
  ["import_lote"],
  ["import_celulas"],
] as const;
