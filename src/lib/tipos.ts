/** Tipos de domínio compartilhados pelo sistema. */

import type { Classificacao } from "./similarity";

export type StatusCliente = "ativo" | "inativo" | "arquivado" | "pago";

export type TipoPagamento = "pix" | "transferencia" | "dinheiro" | "cheque" | "boleto" | "outro";

export type StatusCorrespondencia = "pendente" | "confirmado" | "rejeitado" | "analisar_depois";

export type StatusAnalise =
  "pendente" | "sem_correspondencia" | "ja_pago" | "confirmado" | "rejeitado" | "analisar_depois";

export interface Cliente {
  id: string;
  nome: string;
  nome_normalizado: string;
  cpf: string | null;
  numero_processo: string | null;
  observacoes: string | null;
  status: StatusCliente;
  origem_importacao: string | null;
  data_importacao: string | null;
  /** Escritório que originou o cadastro ('a_confirmar' quando não comprovado). */
  escritorio_origem: "furtado" | "ricardo_friedl" | "a_confirmar";
  /** Identificado como cliente do Ricardo Friedl (importação CLIENTES RICARDO FRIEDL). */
  cliente_rf?: boolean;
  /** Campos do modelo oficial (ex.: cpf_cnpj = coluna "CPF" da planilha). */
  dados_rf?: { cpf_cnpj?: string | null; [chave: string]: unknown } | null;
  arquivado: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Categoria de um VALOR RECEBIDO (cada entrada tem a sua). Padrão único do
 * sistema: ATRASADOS, CONTRATUAL (valor interno 'implantacao' — a implantação é a
 * natureza do lançamento) e SUCUMBÊNCIA. Gravada em
 * `pagamentos.classificacao` (migração 20261006120000_valores_recebidos_por_categoria.sql).
 * `null` = ainda não classificada (fica para conferência).
 */
export type ClassificacaoEntrada = "atrasados" | "implantacao" | "sucumbencia";

export const CLASSIFICACOES_ENTRADA: { value: ClassificacaoEntrada; label: string }[] = [
  { value: "atrasados", label: "Atrasados" },
  { value: "implantacao", label: "Contratual" },
  { value: "sucumbencia", label: "Sucumbência" },
];

export const ROTULO_CLASSIFICACAO: Record<ClassificacaoEntrada, string> = {
  atrasados: "Atrasados",
  implantacao: "Contratual",
  sucumbencia: "Sucumbência",
};

/** Entrada financeira: um registro individual de valor vinculado ao cliente. */
export interface Pagamento {
  id: string;
  cliente_id: string;
  valor: number;
  data_pagamento: string;
  tipo: TipoPagamento;
  observacao: string | null;
  usuario_cadastro: string | null;
  created_at: string;
  classificacao: ClassificacaoEntrada | null;
  /** Chave anti-reimportação (só para entradas vindas do Modelo Documento). */
  chave_importacao: string | null;
  /** Linha do arquivo de origem (rastreabilidade/ordem). */
  linha_importacao: number | null;
  atendimento_id?: string | null;
  /** Escritório do recebimento (quando conhecido). */
  escritorio?: string | null;
  /** Importação que registrou o valor (null = lançamento manual). */
  importacao_id?: string | null;
  /** Conteúdo original da linha importada (arquivo, linha, colunas). */
  dados_origem?: Record<string, unknown> | null;
  /** Judicial (processo judicial) ou administrativo (INSS). */
  origem?: "judicial" | "administrativo" | null;
  /** RPV, Precatório, INSS, pagamento pelo cliente… */
  canal?: string | null;
  /** Quem recebeu: escritório (padrão) ou cliente. */
  destinatario?: "escritorio" | "cliente" | null;
  /** Natureza: implantação, contratuais sobre atrasados, sucumbência da execução… */
  natureza?: string | null;
  descricao?: string | null;
  competencia?: string | null;
  parcela?: string | null;
  percentual?: string | null;
  /** Aba e células de origem (importação em blocos). */
  aba?: string | null;
  celulas?: string | null;
  /** false = data não informada na planilha (usada a data da importação). */
  data_informada?: boolean | null;
  conferencia?: string | null;
}

export interface VariacaoNome {
  id: string;
  cliente_id: string;
  nome_variacao: string;
  nome_normalizado: string;
  created_at: string;
}

export interface Importacao {
  id: string;
  nome_importacao: string;
  origem_arquivo: string | null;
  tipo_origem: "arquivo" | "manual";
  quantidade_clientes: number;
  quantidade_correspondencias: number;
  quantidade_ja_pagos: number;
  quantidade_possiveis: number;
  created_at: string;
  escritorio?: string | null;
  modelo?: string | null;
}

export interface ClienteImportado {
  id: string;
  importacao_id: string;
  nome_original: string;
  nome_normalizado: string;
  cliente_vinculado_id: string | null;
  status_analise: StatusAnalise;
  created_at: string;
  cpf_original: string | null;
  valor_original: number | null;
  data_original: string | null;
}

export interface Correspondencia {
  id: string;
  cliente_importado_id: string;
  cliente_encontrado_id: string;
  percentual_similaridade: number;
  classificacao: Classificacao;
  status: StatusCorrespondencia;
  possui_pagamento: boolean;
  created_at: string;
}

/** Cliente com os totais financeiros já agregados. */
/**
 * Processo (atendimento) do cliente com a sua PRÓPRIA situação de pagamento.
 * O pagamento é marcado por processo: um cliente pode ter processos pagos
 * (JÁ PAGOS) e não pagos (CLIENTES) ao mesmo tempo, num único cadastro.
 */
export interface ProcessoResumo {
  id: string;
  cliente_id: string;
  numero: string | null;
  /** 'judicial' | 'administrativo' | null (não informada). */
  natureza?: string | null;
  tipo_acao: string | null;
  pago: boolean;
  pago_em: string | null;
}

export interface ClienteComTotais extends Cliente {
  /** Processos vigentes do cliente (vazio = cliente sem processo). */
  processos: ProcessoResumo[];
  /** Soma dos valores dos processos PAGOS (ou de tudo, se o cliente não tem processo e está pago). */
  totalRecebidoPagos: number;
  quantidadePagamentosPagos: number;
  /** Data mais recente em que um processo foi marcado como pago. */
  pagoEm: string | null;
  totalRecebido: number;
  quantidadePagamentos: number;
  ultimoPagamento: string | null;
  primeiroPagamento: string | null;
  /** Valores efetivamente recebidos pelo Furtado (base do repasse). */
  totalRecebidoElegivel: number;
  /** Repasse Ricardo Friedl (5 %) = soma dos repasses de cada entrada (src/lib/repasse.ts). */
  totalRepasse: number;
}

/** Linha pronta para exibição nas tabelas de correspondência. */
export interface CorrespondenciaDetalhada {
  correspondencia: Correspondencia;
  importado: ClienteImportado;
  importacao: Importacao | null;
  clienteEncontrado: ClienteComTotais;
}

export const TIPOS_PAGAMENTO: { value: TipoPagamento; label: string }[] = [
  { value: "pix", label: "PIX" },
  { value: "transferencia", label: "Transferência" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "cheque", label: "Cheque" },
  { value: "boleto", label: "Boleto" },
  { value: "outro", label: "Outro" },
];

export const ROTULO_TIPO_PAGAMENTO: Record<TipoPagamento, string> = {
  pix: "PIX",
  transferencia: "Transferência",
  dinheiro: "Dinheiro",
  cheque: "Cheque",
  boleto: "Boleto",
  outro: "Outro",
};
