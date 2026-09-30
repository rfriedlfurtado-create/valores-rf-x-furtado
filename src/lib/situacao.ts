/**
 * FONTE ÚNICA das regras de situação do cliente e dos indicadores derivados.
 *
 * O banco guarda um único campo `clientes.status` (constraint
 * `clientes_status_check`: 'ativo' | 'inativo' | 'arquivado' | 'pago').
 * Toda a aplicação enxerga esse campo através da SITUAÇÃO oficial abaixo:
 *
 *      clientes.status ──► situacaoDoCliente() ──► EM_TRAMITACAO | PAGO | ARQUIVADO
 *                                                       │
 *              ┌──────────────┬──────────────┬──────────┴───────┐
 *              ▼              ▼              ▼                  ▼
 *          CLIENTES       JÁ PAGOS       DASHBOARD       buscas/filtros
 *
 * Nenhuma página filtra `status` por conta própria: todas usam as funções
 * daqui (via `agregarBase` em dados.ts). Assim não existem dois critérios
 * diferentes para "está em tramitação" ou "já pagou".
 *
 * Status de pagamento e valor financeiro são coisas diferentes: um cliente
 * PAGO sem Valor R$ continua PAGO — apenas não soma nada em "valor recebido".
 *
 * Módulo puro (sem imports de runtime do app) para poder ser testado isoladamente.
 */

import type { StatusCliente } from "./tipos";

export type Situacao = "EM_TRAMITACAO" | "PAGO" | "ARQUIVADO";

/** Mapeamento oficial banco → situação. Único lugar onde isso é decidido. */
export const SITUACAO_POR_STATUS: Record<StatusCliente, Situacao> = {
  ativo: "EM_TRAMITACAO",
  inativo: "EM_TRAMITACAO",
  pago: "PAGO",
  arquivado: "ARQUIVADO",
};

/** Status gravado no banco para cada situação (escrita). */
export const STATUS_POR_SITUACAO: Record<Situacao, StatusCliente> = {
  EM_TRAMITACAO: "ativo",
  PAGO: "pago",
  ARQUIVADO: "arquivado",
};

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  EM_TRAMITACAO: "Em tramitação",
  PAGO: "Já pago",
  ARQUIVADO: "Arquivado",
};

interface ClienteMinimo {
  status: StatusCliente | string;
  deleted_at?: string | null;
  arquivado?: boolean;
}

export function situacaoDoCliente(cliente: ClienteMinimo): Situacao {
  if (cliente.deleted_at || cliente.arquivado) return "ARQUIVADO";
  return SITUACAO_POR_STATUS[cliente.status as StatusCliente] ?? "EM_TRAMITACAO";
}

export const estaEmTramitacao = (c: ClienteMinimo) => situacaoDoCliente(c) === "EM_TRAMITACAO";
export const estaPago = (c: ClienteMinimo) => situacaoDoCliente(c) === "PAGO";
/** Cliente que participa de contagens e totais (não arquivado/excluído). */
export const estaVigente = (c: ClienteMinimo) => situacaoDoCliente(c) !== "ARQUIVADO";

// ---------------------------------------------------------------------------
// Busca — mesma regra em todas as páginas
// ---------------------------------------------------------------------------

/**
 * Normaliza texto para busca/comparação: minúsculas, sem acento, sem
 * pontuação e sem espaços duplicados. (Reexportado por similarity.ts.)
 */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filtro de pesquisa único: nome, variações confirmadas, CPF (só dígitos)
 * e número do processo.
 */
export function correspondeBusca(
  cliente: {
    id: string;
    nome_normalizado: string;
    cpf: string | null;
    numero_processo?: string | null;
  },
  termo: string,
  variacoesPorCliente?: Map<string, string[]>,
): boolean {
  const normalizado = normalizarTexto(termo);
  if (!normalizado) return true;
  if (cliente.nome_normalizado.includes(normalizado)) return true;
  if ((variacoesPorCliente?.get(cliente.id) ?? []).some((v) => v.includes(normalizado)))
    return true;
  const digitos = termo.replace(/\D/g, "");
  if (digitos.length >= 3) {
    if ((cliente.cpf ?? "").replace(/\D/g, "").includes(digitos)) return true;
    if ((cliente.numero_processo ?? "").replace(/\D/g, "").includes(digitos)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Indicadores — calculados uma única vez, a partir da mesma lista
// ---------------------------------------------------------------------------

export interface Indicadores {
  /** Clientes vigentes (em tramitação + pagos). */
  totalClientes: number;
  emTramitacao: number;
  jaPagos: number;
  /** % de clientes vigentes que já pagaram (0–100). */
  percentualPagos: number;
  /** Soma dos valores efetivamente registrados (clientes vigentes). */
  valorRecebido: number;
  quantidadePagamentos: number;
  /** Clientes PAGO sem nenhum valor registrado (Valor R$ é opcional). */
  pagosSemValor: number;
  /** Soma dos valores registrados para clientes PAGO. */
  valorRecebidoDePagos: number;
  /** Clientes vigentes importados no mês corrente. */
  importadosNoMes: number;
}

export function calcularIndicadores(
  clientes: (ClienteMinimo & {
    id: string;
    data_importacao: string | null;
  })[],
  valoresPorCliente: Map<string, number[]>,
  agora: Date = new Date(),
): Indicadores {
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  let emTramitacao = 0;
  let jaPagos = 0;
  let valorRecebido = 0;
  let quantidadePagamentos = 0;
  let pagosSemValor = 0;
  let valorRecebidoDePagos = 0;
  let importadosNoMes = 0;

  for (const cliente of clientes) {
    const situacao = situacaoDoCliente(cliente);
    if (situacao === "ARQUIVADO") continue;
    const valores = valoresPorCliente.get(cliente.id) ?? [];
    const soma = valores.reduce((s, v) => s + v, 0);
    valorRecebido += soma;
    quantidadePagamentos += valores.length;
    if (situacao === "PAGO") {
      jaPagos += 1;
      valorRecebidoDePagos += soma;
      if (valores.length === 0) pagosSemValor += 1;
    } else {
      emTramitacao += 1;
    }
    if (cliente.data_importacao && new Date(cliente.data_importacao) >= inicioMes) {
      importadosNoMes += 1;
    }
  }

  const totalClientes = emTramitacao + jaPagos;
  return {
    totalClientes,
    emTramitacao,
    jaPagos,
    percentualPagos: totalClientes ? (jaPagos / totalClientes) * 100 : 0,
    valorRecebido: arredondar(valorRecebido),
    quantidadePagamentos,
    pagosSemValor,
    valorRecebidoDePagos: arredondar(valorRecebidoDePagos),
    importadosNoMes,
  };
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}
