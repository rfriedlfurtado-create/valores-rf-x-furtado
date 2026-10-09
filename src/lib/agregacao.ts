/**
 * Agregação pura da base — separada de dados.ts (que fala com o Supabase)
 * para poder ser testada isoladamente. Única origem de CLIENTES, JÁ PAGOS
 * e dos indicadores.
 */

import {
  calcularIndicadores,
  entradasDosPagos,
  estaEmTramitacao,
  estaPago,
  type Indicadores,
} from "./situacao";
import { resumirRepasse } from "./repasse";
import type { Cliente, ClienteComTotais, Pagamento, ProcessoResumo } from "./tipos";

function numero(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : (valor as number);
  return Number.isFinite(n) ? n : 0;
}

export interface BaseAgregada {
  /** Clientes vigentes (não excluídos), já com totais financeiros. */
  clientes: ClienteComTotais[];
  porId: Map<string, ClienteComTotais>;
  pagamentosPorCliente: Map<string, Pagamento[]>;
  /** Página CLIENTES (exclusiva). */
  emTramitacao: ClienteComTotais[];
  /** Página JÁ PAGOS: cliente Ricardo Friedl com recebimento confirmado. */
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
  processosBrutos: ProcessoResumo[] = [],
): BaseAgregada {
  // Excluídos/arquivados nunca entram em nenhuma visão ou métrica.
  const clientes = clientesBrutos.filter((c) => !c.deleted_at);
  const idsVigentes = new Set(clientes.map((c) => c.id));

  const pagamentos = pagamentosBrutos
    .map((p) => ({ ...p, valor: numero(p.valor), classificacao: p.classificacao ?? null }))
    .filter((p) => idsVigentes.has(p.cliente_id));

  const pagamentosPorCliente = new Map<string, Pagamento[]>();
  for (const pagamento of pagamentos) {
    const lista = pagamentosPorCliente.get(pagamento.cliente_id) ?? [];
    lista.push(pagamento);
    pagamentosPorCliente.set(pagamento.cliente_id, lista);
  }

  // Ordem estável das entradas no perfil: data, momento do registro e linha do arquivo.
  for (const lista of pagamentosPorCliente.values()) {
    lista.sort(
      (a, b) =>
        a.data_pagamento.localeCompare(b.data_pagamento) ||
        a.created_at.localeCompare(b.created_at) ||
        (a.linha_importacao ?? 0) - (b.linha_importacao ?? 0) ||
        a.id.localeCompare(b.id),
    );
  }

  const processosPorCliente = new Map<string, ProcessoResumo[]>();
  for (const p of processosBrutos) {
    if (!idsVigentes.has(p.cliente_id)) continue;
    processosPorCliente.set(p.cliente_id, [...(processosPorCliente.get(p.cliente_id) ?? []), p]);
  }

  const comTotais: ClienteComTotais[] = clientes.map((cliente) => {
    const lista = pagamentosPorCliente.get(cliente.id) ?? [];
    const datas = lista.map((p) => p.data_pagamento).sort();
    const processos = processosPorCliente.get(cliente.id) ?? [];
    const dosPagos = entradasDosPagos({ ...cliente, processos }, lista);
    const repasse = resumirRepasse(lista);
    return {
      ...cliente,
      processos,
      totalRecebidoPagos: dosPagos.reduce((soma, p) => soma + p.valor, 0),
      quantidadePagamentosPagos: dosPagos.length,
      // JÁ PAGOS: data do recebimento confirmado mais recente.
      pagoEm: dosPagos.length ? (datas[datas.length - 1] ?? null) : null,
      totalRecebido: lista.reduce((soma, p) => soma + p.valor, 0),
      quantidadePagamentos: lista.length,
      ultimoPagamento: datas.length ? datas[datas.length - 1]! : null,
      primeiroPagamento: datas.length ? datas[0]! : null,
      totalRecebidoElegivel: repasse.recebido,
      totalRepasse: repasse.repasse,
    };
  });

  const indicadores = calcularIndicadores(comTotais, pagamentosPorCliente, agora);

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
