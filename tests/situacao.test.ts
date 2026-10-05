/**
 * Testes unitários da fonte única de situação/indicadores.
 * Rodar: bun test
 */
import { describe, expect, test } from "bun:test";

import { agregarBase } from "@/lib/agregacao";
import {
  calcularIndicadores,
  correspondeBusca,
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

describe("pagamento por processo", () => {
  const proc = (id: string, cliente_id: string, pago: boolean) => ({
    id,
    cliente_id,
    numero: id,
    tipo_acao: null,
    pago,
    pago_em: pago ? "2026-10-01T00:00:00Z" : null,
  });

  test("cliente com processos pagos e não pagos aparece nas duas visões (mesmo cadastro)", () => {
    const misto = cliente({ nome: "Misto" });
    const soPago = cliente({ nome: "Só pago", status: "pago" });
    const semProcesso = cliente({ nome: "Sem processo" });
    const pagos = [
      { ...pagamento(misto.id, 1000), atendimento_id: "m1" },
      { ...pagamento(misto.id, 300), atendimento_id: "m2" },
    ];
    const base = agregarBase([misto, soPago, semProcesso], pagos, new Date(), [
      proc("m1", misto.id, true),
      proc("m2", misto.id, false),
      proc("s1", soPago.id, true),
    ]);

    expect(base.emTramitacao.map((c) => c.id).sort()).toEqual([misto.id, semProcesso.id].sort());
    expect(base.jaPagos.map((c) => c.id).sort()).toEqual([misto.id, soPago.id].sort());
    // O mesmo objeto de cliente nas duas visões (nenhuma cópia).
    expect(base.emTramitacao.find((c) => c.id === misto.id)).toBe(base.porId.get(misto.id));

    // JÁ PAGOS soma só os valores dos processos pagos — não mistura.
    const m = base.porId.get(misto.id)!;
    expect(m.totalRecebidoPagos).toBe(1000);
    expect(m.totalRecebido).toBe(1300);
    expect(m.pagoEm).toBe("2026-10-01T00:00:00Z");

    expect(base.indicadores).toMatchObject({
      totalClientes: 3,
      emTramitacao: 2,
      jaPagos: 2,
      processosPagos: 2,
      processosEmTramitacao: 2,
      valorRecebidoDePagos: 1000,
      pagosSemValor: 1,
    });
  });

  test("valor sem processo não entra nos totais dos processos pagos", () => {
    const c = cliente({ nome: "Ana" });
    const base = agregarBase([c], [{ ...pagamento(c.id, 50), atendimento_id: null }], new Date(), [
      proc("a1", c.id, true),
    ]);
    expect(base.porId.get(c.id)!.totalRecebidoPagos).toBe(0);
  });
});
