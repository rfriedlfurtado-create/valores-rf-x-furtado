/**
 * Agregação pura da base — separada de dados.ts (que fala com o Supabase)
 * para poder ser testada isoladamente. Única origem de CLIENTES, JÁ PAGOS
 * e dos indicadores.
 */

import { calcularIndicadores, estaEmTramitacao, estaPago, type Indicadores } from "./situacao";
import type { Cliente, ClienteComTotais, Pagamento } from "./tipos";

function numero(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : (valor as number);
  return Number.isFinite(n) ? n : 0;
}

export interface BaseAgregada {
  /** Clientes vigentes (não excluídos), já com totais financeiros. */
  clientes: ClienteComTotais[];
  porId: Map<string, ClienteComTotais>;
  pagamentosPorCliente: Map<string, Pagamento[]>;
  /** Visão CLIENTES: situação EM_TRAMITACAO. */
  emTramitacao: ClienteComTotais[];
  /** Visão JÁ PAGOS: situação PAGO. */
  jaPagos: ClienteComTotais[];
  /** Indicadores do sistema (Dashboard, cabeçalhos, históricos). */
  indicadores: Indicadores;
  /** Atalhos mantidos por compatibilidade = indicadores.valorRecebido / quantidadePagamentos. */
  totalPago: number;
  totalPagamentos: number;
}

/**
 * Agregação PURA: recebe as linhas cruas do banco e produz todas as visões
 * derivadas. É o único lugar que decide o que aparece em CLIENTES, em
 * JÁ PAGOS e nos indicadores — todas as páginas leem daqui.
 */
export function agregarBase(
  clientesBrutos: Cliente[],
  pagamentosBrutos: Pagamento[],
  agora: Date = new Date(),
): BaseAgregada {
  // Excluídos/arquivados nunca entram em nenhuma visão ou métrica.
  const clientes = clientesBrutos.filter((c) => !c.deleted_at);
  const idsVigentes = new Set(clientes.map((c) => c.id));

  const pagamentos = pagamentosBrutos
    .map((p) => ({ ...p, valor: numero(p.valor) }))
    .filter((p) => idsVigentes.has(p.cliente_id));

  const pagamentosPorCliente = new Map<string, Pagamento[]>();
  for (const pagamento of pagamentos) {
    const lista = pagamentosPorCliente.get(pagamento.cliente_id) ?? [];
    lista.push(pagamento);
    pagamentosPorCliente.set(pagamento.cliente_id, lista);
  }

  const comTotais: ClienteComTotais[] = clientes.map((cliente) => {
    const lista = pagamentosPorCliente.get(cliente.id) ?? [];
    const datas = lista.map((p) => p.data_pagamento).sort();
    return {
      ...cliente,
      totalRecebido: lista.reduce((soma, p) => soma + p.valor, 0),
      quantidadePagamentos: lista.length,
      ultimoPagamento: datas.length ? datas[datas.length - 1]! : null,
      primeiroPagamento: datas.length ? datas[0]! : null,
    };
  });

  const indicadores = calcularIndicadores(
    comTotais,
    new Map([...pagamentosPorCliente].map(([id, lista]) => [id, lista.map((p) => p.valor)])),
    agora,
  );

  return {
    clientes: comTotais,
    porId: new Map(comTotais.map((c) => [c.id, c])),
    pagamentosPorCliente,
    emTramitacao: comTotais.filter(estaEmTramitacao),
    jaPagos: comTotais.filter(estaPago),
    indicadores,
    totalPago: indicadores.valorRecebido,
    totalPagamentos: indicadores.quantidadePagamentos,
  };
}
