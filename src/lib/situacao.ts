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

import { ROTULO_CLASSIFICACAO, type ClassificacaoEntrada, type StatusCliente } from "./tipos";

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

// ---------------------------------------------------------------------------
// Pagamento POR PROCESSO
// ---------------------------------------------------------------------------
//
// Cada processo (atendimento) tem a sua situação (`atendimentos.pago`).
// O cliente aparece:
//   * em CLIENTES  se tiver ao menos um processo NÃO pago;
//   * em JÁ PAGOS  se tiver ao menos um processo PAGO;
// podendo estar nas duas visões ao mesmo tempo, sempre com o MESMO cadastro.
// Cliente sem processo segue a situação do próprio cadastro (status).

export interface ProcessoMinimo {
  id: string;
  pago: boolean;
}

interface ClienteComProcessos extends ClienteMinimo {
  processos?: readonly ProcessoMinimo[];
}

/** Processos exibidos em cada visão. */
export function processosDaVisao<P extends ProcessoMinimo>(
  processos: readonly P[],
  visao: "clientes" | "pagos",
): P[] {
  return processos.filter((p) => (visao === "pagos" ? p.pago : !p.pago));
}

export function estaEmTramitacao(c: ClienteComProcessos): boolean {
  if (situacaoDoCliente(c) === "ARQUIVADO") return false;
  if (c.processos?.length) return c.processos.some((p) => !p.pago);
  return situacaoDoCliente(c) === "EM_TRAMITACAO";
}

export function estaPago(c: ClienteComProcessos): boolean {
  if (situacaoDoCliente(c) === "ARQUIVADO") return false;
  if (c.processos?.length) return c.processos.some((p) => p.pago);
  return situacaoDoCliente(c) === "PAGO";
}

/**
 * Entradas que pertencem à visão JÁ PAGOS: as dos processos pagos (cliente
 * com processos) ou todas (cliente sem processo e pago). Valores de processos
 * diferentes nunca se misturam.
 */
export function entradasDosPagos<E extends EntradaMinima>(
  c: ClienteComProcessos,
  entradas: readonly E[],
): E[] {
  if (c.processos?.length) {
    const pagos = new Set(c.processos.filter((p) => p.pago).map((p) => p.id));
    return entradas.filter((e) => e.atendimento_id && pagos.has(e.atendimento_id));
  }
  return situacaoDoCliente(c) === "PAGO" ? [...entradas] : [];
}
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
 * Filtro de pesquisa único: nome, variações confirmadas, CPF (só dígitos),
 * número do processo (do cadastro e dos atendimentos) e NB dos benefícios.
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
  identificadoresPorCliente?: Map<string, string[]>,
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
    if ((identificadoresPorCliente?.get(cliente.id) ?? []).some((d) => d.includes(digitos)))
      return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Indicadores — calculados uma única vez, a partir da mesma lista
// ---------------------------------------------------------------------------

/** Entrada financeira mínima para cálculos (uma linha de `pagamentos`). */
export interface EntradaMinima {
  valor: number;
  classificacao: ClassificacaoEntrada | null;
  /** Processo ao qual o valor pertence (null = sem processo). */
  atendimento_id?: string | null;
}

export type GrupoClassificacao = ClassificacaoEntrada | "sem_classificacao";

export const GRUPOS_CLASSIFICACAO: GrupoClassificacao[] = [
  "contratuais",
  "atrasados",
  "sucumbencia",
  "sem_classificacao",
];

export const ROTULO_GRUPO: Record<GrupoClassificacao, string> = {
  ...ROTULO_CLASSIFICACAO,
  sem_classificacao: "Sem classificação",
};

/** Frase exibida no perfil: "Existem 3 valores registrados para este cliente." */
export function fraseQuantidadeEntradas(quantidade: number, alvo = "este cliente"): string {
  if (quantidade === 0) return `Nenhum valor registrado para ${alvo}.`;
  if (quantidade === 1) return `Existe 1 valor registrado para ${alvo}.`;
  return `Existem ${quantidade} valores registrados para ${alvo}.`;
}

export interface ResumoEntradas {
  quantidade: number;
  total: number;
  porClassificacao: Record<GrupoClassificacao, { quantidade: number; valor: number }>;
}

/**
 * Resumo de um conjunto de entradas. Usado tanto no perfil do cliente
 * quanto nos indicadores globais — a mesma conta em todos os lugares.
 * Cada entrada é somada uma única vez, na sua própria classificação.
 */
export function resumirEntradas(entradas: readonly EntradaMinima[]): ResumoEntradas {
  const porClassificacao = Object.fromEntries(
    GRUPOS_CLASSIFICACAO.map((g) => [g, { quantidade: 0, valor: 0 }]),
  ) as ResumoEntradas["porClassificacao"];
  let total = 0;
  for (const e of entradas) {
    // Valor fora das 3 categorias oficiais (dado antigo) conta como "sem classificação".
    const grupo =
      porClassificacao[(e.classificacao ?? "sem_classificacao") as GrupoClassificacao] ??
      porClassificacao.sem_classificacao;
    grupo.quantidade += 1;
    grupo.valor = arredondar(grupo.valor + e.valor);
    total = arredondar(total + e.valor);
  }
  return { quantidade: entradas.length, total, porClassificacao };
}

export interface Indicadores {
  /** Clientes vigentes (cada cliente conta uma vez, mesmo com processos nas duas visões). */
  totalClientes: number;
  /** Clientes com ao menos um processo em tramitação. */
  emTramitacao: number;
  /** Clientes com ao menos um processo pago. */
  jaPagos: number;
  /** Processos pagos / em tramitação (clientes sem processo contam como 1). */
  processosPagos: number;
  processosEmTramitacao: number;
  /** % de clientes vigentes que já pagaram (0–100). */
  percentualPagos: number;
  /** Soma dos valores efetivamente registrados (clientes vigentes). */
  valorRecebido: number;
  quantidadePagamentos: number;
  /** Clientes em JÁ PAGOS sem nenhum valor registrado nos processos pagos. */
  pagosSemValor: number;
  /** Soma dos valores registrados nos processos pagos. */
  valorRecebidoDePagos: number;
  /** Clientes vigentes importados no mês corrente. */
  importadosNoMes: number;
  /** Valores por categoria (Contratual/Atrasados/Sucumbência/sem). */
  entradas: ResumoEntradas;
  /** Clientes com mais de uma entrada financeira. */
  clientesComVariasEntradas: number;
}

export function calcularIndicadores(
  clientes: (ClienteComProcessos & {
    id: string;
    data_importacao: string | null;
  })[],
  entradasPorCliente: Map<string, readonly EntradaMinima[]>,
  agora: Date = new Date(),
): Indicadores {
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  let emTramitacao = 0;
  let jaPagos = 0;
  let totalClientes = 0;
  let processosPagos = 0;
  let processosEmTramitacao = 0;
  let valorRecebido = 0;
  let quantidadePagamentos = 0;
  let pagosSemValor = 0;
  let valorRecebidoDePagos = 0;
  let importadosNoMes = 0;
  let clientesComVariasEntradas = 0;
  const todasEntradas: EntradaMinima[] = [];

  for (const cliente of clientes) {
    const situacao = situacaoDoCliente(cliente);
    if (situacao === "ARQUIVADO") continue;
    const valores = entradasPorCliente.get(cliente.id) ?? [];
    const soma = valores.reduce((s, e) => s + e.valor, 0);
    todasEntradas.push(...valores);
    if (valores.length > 1) clientesComVariasEntradas += 1;
    valorRecebido += soma;
    quantidadePagamentos += valores.length;
    totalClientes += 1;
    if (estaPago(cliente)) {
      jaPagos += 1;
      const dosPagos = entradasDosPagos(cliente, valores);
      valorRecebidoDePagos += dosPagos.reduce((s, e) => s + e.valor, 0);
      if (dosPagos.length === 0) pagosSemValor += 1;
    }
    if (estaEmTramitacao(cliente)) emTramitacao += 1;
    if (cliente.processos?.length) {
      for (const p of cliente.processos) {
        if (p.pago) processosPagos += 1;
        else processosEmTramitacao += 1;
      }
    } else if (situacao === "PAGO") processosPagos += 1;
    else processosEmTramitacao += 1;
    if (cliente.data_importacao && new Date(cliente.data_importacao) >= inicioMes) {
      importadosNoMes += 1;
    }
  }

  return {
    totalClientes,
    emTramitacao,
    jaPagos,
    processosPagos,
    processosEmTramitacao,
    percentualPagos: totalClientes ? (jaPagos / totalClientes) * 100 : 0,
    valorRecebido: arredondar(valorRecebido),
    quantidadePagamentos,
    pagosSemValor,
    valorRecebidoDePagos: arredondar(valorRecebidoDePagos),
    importadosNoMes,
    entradas: resumirEntradas(todasEntradas),
    clientesComVariasEntradas,
  };
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}
