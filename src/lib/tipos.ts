/** Tipos de domínio compartilhados pelo sistema. */

import type { Classificacao } from "./similarity";

export type StatusCliente = "ativo" | "inativo" | "arquivado";

export type TipoPagamento = "pix" | "transferencia" | "dinheiro" | "cheque" | "boleto" | "outro";

export type StatusCorrespondencia = "pendente" | "confirmado" | "rejeitado" | "analisar_depois";

export type StatusAnalise =
  | "pendente"
  | "sem_correspondencia"
  | "ja_pago"
  | "confirmado"
  | "rejeitado"
  | "analisar_depois";

export interface Cliente {
  id: string;
  nome: string;
  nome_normalizado: string;
  cpf: string | null;
  observacoes: string | null;
  status: StatusCliente;
  origem_importacao: string | null;
  data_importacao: string | null;
  arquivado: boolean;
  created_at: string;
  updated_at: string;
}

export interface Pagamento {
  id: string;
  cliente_id: string;
  valor: number;
  data_pagamento: string;
  tipo: TipoPagamento;
  observacao: string | null;
  usuario_cadastro: string | null;
  created_at: string;
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
}

export interface ClienteImportado {
  id: string;
  importacao_id: string;
  nome_original: string;
  nome_normalizado: string;
  cliente_vinculado_id: string | null;
  status_analise: StatusAnalise;
  created_at: string;
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
export interface ClienteComTotais extends Cliente {
  totalRecebido: number;
  quantidadePagamentos: number;
  ultimoPagamento: string | null;
  primeiroPagamento: string | null;
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
