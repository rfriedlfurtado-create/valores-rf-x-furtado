/**
 * Testes unitários da fonte única de situação/indicadores.
 * Rodar: bun test
 */
import { describe, expect, test } from "bun:test";

import { agregarBase } from "@/lib/agregacao";
import {
  calcularIndicadores,
  correspondeBusca,
  motivoDaPagina,
  processosDaVisao,
  SITUACAO_POR_STATUS,
  situacaoDoCliente,
} from "@/lib/situacao";
import type { Cliente, Pagamento } from "@/lib/tipos";

let seq = 0;
function cliente(parcial: Partial<Cliente> & { nome: string }): Cliente {
  seq += 1;
  return {
    id: `c${seq}`,
    nome_normalizado: parcial.nome.toLowerCase(),
    cpf: null,
    numero_processo: null,
    observacoes: null,
    status: "ativo",
    origem_importacao: null,
    data_importacao: null,
    arquivado: false,
    deleted_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...parcial,
  };
}
function pagamento(clienteId: string, valor: number | string): Pagamento {
  seq += 1;
  return {
    id: `p${seq}`,
    cliente_id: clienteId,
    valor: valor as number,
    data_pagamento: "2026-09-10",
    tipo: "pix",
    observacao: null,
    usuario_cadastro: null,
    created_at: "2026-09-10T00:00:00Z",
  };
}

describe("situação oficial", () => {
  test("mapeia todos os status aceitos pelo banco", () => {
    expect(Object.keys(SITUACAO_POR_STATUS).sort()).toEqual(
      ["arquivado", "ativo", "inativo", "pago"].sort(),
    );
    expect(situacaoDoCliente({ status: "ativo" })).toBe("EM_TRAMITACAO");
    expect(situacaoDoCliente({ status: "pago" })).toBe("PAGO");
    expect(situacaoDoCliente({ status: "pago", deleted_at: "2026-01-01" })).toBe("ARQUIVADO");
  });
});

describe("agregarBase — uma lista, várias visões", () => {
  test("Clientes e Já Pagos são partições disjuntas da mesma base", () => {
    const a = cliente({ nome: "Ana" });
    const b = cliente({ nome: "Bruno", status: "pago" });
    const c = cliente({ nome: "Carla", status: "pago" });
    const excluido = cliente({ nome: "Zé", status: "pago", deleted_at: "2026-09-01" });
    const base = agregarBase(
      [a, b, c, excluido],
      [pagamento(b.id, "1500.50"), pagamento(excluido.id, 999)],
    );

    const idsTramitacao = base.emTramitacao.map((x) => x.id);
    const idsPagos = base.jaPagos.map((x) => x.id);
    expect(idsTramitacao).toEqual([a.id]);
    expect(idsPagos.sort()).toEqual([b.id, c.id].sort());
    expect(idsTramitacao.some((id) => idsPagos.includes(id))).toBe(false);

    // Excluído não aparece em nenhuma visão nem métrica.
    expect(base.porId.has(excluido.id)).toBe(false);
    expect(base.indicadores.valorRecebido).toBe(1500.5);
    expect(base.indicadores.quantidadePagamentos).toBe(1);

    // Pago sem valor continua pago; valor não é inventado.
    expect(base.indicadores.jaPagos).toBe(2);
    expect(base.indicadores.pagosSemValor).toBe(1);
    expect(base.porId.get(c.id)!.totalRecebido).toBe(0);

    expect(base.indicadores.totalClientes).toBe(3);
    expect(Math.round(base.indicadores.percentualPagos)).toBe(67);
    // Atalhos de compatibilidade apontam para o mesmo número.
    expect(base.totalPago).toBe(base.indicadores.valorRecebido);
  });

  test("importados no mês usam a data de importação", () => {
    const agora = new Date("2026-09-30T12:00:00Z");
    const ind = calcularIndicadores(
      [
        { id: "1", status: "ativo", data_importacao: "2026-09-02T10:00:00Z" },
        { id: "2", status: "pago", data_importacao: "2026-08-31T10:00:00Z" },
        { id: "3", status: "ativo", data_importacao: null },
      ],
      new Map(),
      agora,
    );
    expect(ind.importadosNoMes).toBe(1);
  });
});

describe("busca única", () => {
  const c = {
    id: "x",
    nome_normalizado: "joao da silva",
    cpf: "123.456.789-00",
    numero_processo: "5001234-11.2025.4.04.7100",
  };
  test("nome sem acento/maiúsculas, variação, CPF e processo", () => {
    expect(correspondeBusca(c, "JOÃO")).toBe(true);
    expect(correspondeBusca(c, "joaozinho", new Map([["x", ["joaozinho"]]]))).toBe(true);
    expect(correspondeBusca(c, "123456")).toBe(true);
    expect(correspondeBusca(c, "5001234")).toBe(true);
    expect(correspondeBusca(c, "maria")).toBe(false);
    expect(correspondeBusca(c, "")).toBe(true);
  });
});

describe("páginas exclusivas CLIENTES / JÁ PAGOS (cliente RF + recebimento)", () => {
  const proc = (id: string, cliente_id: string, pago: boolean) => ({
    id,
    cliente_id,
    numero: id,
    tipo_acao: null,
    pago,
    pago_em: pago ? "2026-10-01T00:00:00Z" : null,
  });

  test("cada cliente fica em uma única página, definida por clientes.status", () => {
    // status 'pago' é gravado pelo banco só para cliente RF com recebimento confirmado.
    const pago = cliente({ nome: "RF com recebimento", status: "pago" });
    const rfSemRecebimento = cliente({ nome: "RF sem recebimento" });
    const soValores = cliente({ nome: "Só valores" });
    const base = agregarBase(
      [pago, rfSemRecebimento, soValores],
      [
        { ...pagamento(pago.id, 1000), atendimento_id: "p1" },
        { ...pagamento(pago.id, 300), atendimento_id: "p2" },
        { ...pagamento(soValores.id, 50), atendimento_id: null },
      ],
      new Date(),
      [
        proc("p1", pago.id, true),
        proc("p2", pago.id, false),
        proc("r1", rfSemRecebimento.id, true),
      ],
    );

    expect(base.jaPagos.map((c) => c.id)).toEqual([pago.id]);
    expect(base.emTramitacao.map((c) => c.id).sort()).toEqual(
      [rfSemRecebimento.id, soValores.id].sort(),
    );
    // Processo finalizado (pago) não move o cliente de página.
    expect(base.jaPagos.some((c) => c.id === rfSemRecebimento.id)).toBe(false);

    // Em JÁ PAGOS todos os processos e valores do cliente aparecem (não mistura páginas).
    const p = base.porId.get(pago.id)!;
    expect(processosDaVisao(p.processos, "pagos").map((x) => x.id)).toEqual(["p1", "p2"]);
    expect(p.totalRecebidoPagos).toBe(1300);
    expect(base.porId.get(soValores.id)!.totalRecebidoPagos).toBe(0);

    expect(base.indicadores).toMatchObject({ totalClientes: 3, emTramitacao: 2, jaPagos: 1 });
  });

  test("motivo da página explica as duas condições", () => {
    expect(motivoDaPagina({ status: "pago", cliente_rf: true, temRecebimento: true })).toMatch(
      /recebimento confirmado/,
    );
    expect(motivoDaPagina({ status: "ativo", cliente_rf: false, temRecebimento: true })).toMatch(
      /não está identificado como cliente Ricardo Friedl/,
    );
    expect(motivoDaPagina({ status: "ativo", cliente_rf: true, temRecebimento: false })).toMatch(
      /sem recebimento confirmado/,
    );
  });
});
