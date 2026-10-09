/**
 * Repasse Ricardo Friedl — 5 % de todo valor efetivamente recebido pelo Furtado.
 * Rodar: bun test
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { agregarBase } from "@/lib/agregacao";
import {
  aplicarPercentualCentavos,
  noPeriodo,
  paraCentavos,
  REGRA_REPASSE,
  repasseDaEntrada,
  repassePorProcesso,
  repasseDoValor,
  resumirRepasse,
  SEM_PROCESSO_REPASSE,
  type EntradaRepasse,
} from "@/lib/repasse";
import type { Cliente, Pagamento } from "@/lib/tipos";

const e = (
  valor: number | string,
  classificacao: EntradaRepasse["classificacao"] = null,
  extra: Partial<EntradaRepasse> = {},
): EntradaRepasse => ({ valor, classificacao, ...extra });

describe("regra oficial", () => {
  test("percentual único de 5 %", () => {
    expect(REGRA_REPASSE.percentual).toBe(5);
    expect(repasseDoValor(1000)).toBe(50);
    expect(repasseDoValor(10000)).toBe(500);
    expect(repasseDoValor(25000)).toBe(1250);
  });

  test("categoria não altera o percentual", () => {
    for (const c of ["implantacao", "atrasados", "sucumbencia", null] as const) {
      expect(repasseDaEntrada(e(10000, c))).toBe(500);
    }
  });

  test("migração do banco grava a mesma regra (percentual e versão)", () => {
    const sql = readFileSync(
      join(import.meta.dir, "..", "supabase/migrations/20261009180000_repasse_ricardo_friedl.sql"),
      "utf8",
    );
    const m = /VALUES\s*\(\s*(\d+)\s*,\s*([\d.]+)\s*,/.exec(
      sql.slice(sql.indexOf("INSERT INTO public.regras_repasse")),
    );
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(REGRA_REPASSE.versao);
    expect(Number(m![2])).toBe(REGRA_REPASSE.percentual);
  });
});

describe("precisão monetária (centavos inteiros)", () => {
  test("converte valores do banco sem erro de ponto flutuante", () => {
    expect(paraCentavos("1234.56")).toBe(123456);
    expect(paraCentavos("0.29")).toBe(29);
    expect(paraCentavos(0.29)).toBe(29);
    expect(paraCentavos(1.005)).toBe(101);
    expect(paraCentavos("10")).toBe(1000);
    expect(paraCentavos(null)).toBe(0);
  });

  test("arredondamento meio-centavo para cima (igual ao round() do Postgres)", () => {
    // 5 % de 0,10 = 0,005 → 0,01 ; de 0,09 = 0,0045 → 0,00 ; de 0,30 = 0,015 → 0,02
    expect(aplicarPercentualCentavos(10, 5)).toBe(1);
    expect(aplicarPercentualCentavos(9, 5)).toBe(0);
    expect(aplicarPercentualCentavos(30, 5)).toBe(2);
    expect(repasseDoValor("1234.57")).toBe(61.73); // 61,7285
    expect(repasseDoValor("333.33")).toBe(16.67); // 16,6665
    expect(repasseDoValor("0.01")).toBe(0);
  });

  test("valores com centavos somam sem resíduo", () => {
    const r = resumirRepasse([e("0.10"), e("0.20"), e("0.30")]);
    expect(r.recebido).toBe(0.6);
    expect(r.repasse).toBe(0.04); // 0,01 + 0,01 + 0,02
  });
});

describe("cálculo por entrada, categoria e cliente", () => {
  test("exemplo João da Silva", () => {
    const r = resumirRepasse([
      e(10000, "atrasados"),
      e(2000, "implantacao"),
      e(3000, "sucumbencia"),
    ]);
    expect(r.recebido).toBe(15000);
    expect(r.repasse).toBe(750);
    expect(r.porCategoria.atrasados).toEqual({
      quantidade: 1,
      recebido: 10000,
      repasse: 500,
      escritorio: 9500,
    });
    expect(r.porCategoria.implantacao).toEqual({
      quantidade: 1,
      recebido: 2000,
      repasse: 100,
      escritorio: 1900,
    });
    expect(r.porCategoria.sucumbencia).toEqual({
      quantidade: 1,
      recebido: 3000,
      repasse: 150,
      escritorio: 2850,
    });
  });

  test("múltiplos recebimentos: total = soma dos repasses, sem dupla incidência", () => {
    const r = resumirRepasse([e(5000), e(8000), e(2000)]);
    expect(r.recebido).toBe(15000);
    expect(r.repasse).toBe(750);
    expect(r.quantidade).toBe(3);
  });

  test("valor pago ao cliente e valor zero não entram (não recebidos pelo Furtado)", () => {
    const r = resumirRepasse([
      e(10000, "atrasados"),
      e(4000, "atrasados", { destinatario: "cliente" }),
      e(0, "sucumbencia"),
    ]);
    expect(r.recebido).toBe(10000);
    expect(r.repasse).toBe(500);
    expect(r.ignoradas).toBe(2);
  });
});

describe("alteração, reclassificação e exclusão recalculam", () => {
  test("alteração de valor 10.000 → 12.000", () => {
    expect(resumirRepasse([e(10000)]).repasse).toBe(500);
    expect(resumirRepasse([e(12000)]).repasse).toBe(600);
  });

  test("reclassificação só redistribui categorias", () => {
    const antes = resumirRepasse([e(10000, "atrasados"), e(1000, "implantacao")]);
    const depois = resumirRepasse([e(10000, "sucumbencia"), e(1000, "implantacao")]);
    expect(antes.repasse).toBe(depois.repasse);
    expect(antes.porCategoria.atrasados.repasse).toBe(500);
    expect(depois.porCategoria.atrasados.repasse).toBe(0);
    expect(depois.porCategoria.sucumbencia.repasse).toBe(500);
  });

  test("exclusão retira o repasse da entrada", () => {
    const lista = [e(10000), e(5000)];
    expect(resumirRepasse(lista).repasse).toBe(750);
    expect(resumirRepasse(lista.slice(0, 1)).repasse).toBe(500);
  });
});

describe("por processo", () => {
  test("não mistura processos; total do cliente = soma dos processos", () => {
    const lista = [
      e(10000, "atrasados", { atendimento_id: "A" }),
      e(20000, "implantacao", { atendimento_id: "B" }),
      e(100, null),
    ];
    const m = repassePorProcesso(lista);
    expect(m.get("A")!.repasse).toBe(500);
    expect(m.get("B")!.repasse).toBe(1000);
    expect(m.get(SEM_PROCESSO_REPASSE)!.repasse).toBe(5);
    expect(resumirRepasse(lista).repasse).toBe(1505);
  });
});

describe("período", () => {
  test("limites inclusivos", () => {
    expect(noPeriodo("2026-09-01", "2026-09-01", "2026-09-30")).toBe(true);
    expect(noPeriodo("2026-09-30", "2026-09-01", "2026-09-30")).toBe(true);
    expect(noPeriodo("2026-10-01", "2026-09-01", "2026-09-30")).toBe(false);
    expect(noPeriodo("2026-08-31", "2026-09-01", null)).toBe(false);
    expect(noPeriodo("2026-08-31", null, null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integração com a agregação (perfil, JÁ PAGOS, Dashboard usam a mesma base)
// ---------------------------------------------------------------------------

function cliente(id: string, extra: Partial<Cliente> = {}): Cliente {
  return {
    id,
    nome: id,
    nome_normalizado: id,
    cpf: null,
    numero_processo: null,
    observacoes: null,
    status: "ativo",
    origem_importacao: null,
    data_importacao: null,
    escritorio_origem: "a_confirmar",
    arquivado: false,
    deleted_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...extra,
  };
}
let seq = 0;
function pag(clienteId: string, valor: number | string, extra: Partial<Pagamento> = {}): Pagamento {
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
    classificacao: null,
    chave_importacao: null,
    linha_importacao: null,
    ...extra,
  };
}

describe("agregarBase", () => {
  test("cliente, JÁ PAGOS e indicadores com o mesmo repasse", () => {
    const base = agregarBase(
      [cliente("joao", { status: "pago", cliente_rf: true }), cliente("maria")],
      [
        pag("joao", "10000.00", { classificacao: "atrasados" }),
        pag("joao", "2000.00", { classificacao: "implantacao" }),
        pag("joao", "3000.00", { classificacao: "sucumbencia" }),
        pag("maria", "1234.57"),
        pag("maria", "500.00", { destinatario: "cliente" }),
      ],
    );
    const joao = base.porId.get("joao")!;
    expect(joao.totalRepasse).toBe(750);
    expect(base.jaPagos[0]!.totalRepasse).toBe(750);
    expect(base.porId.get("maria")!.totalRepasse).toBe(61.73);
    expect(base.indicadores.repasse.recebido).toBe(16234.57);
    expect(base.indicadores.repasse.repasse).toBe(811.73);
    // Total geral = soma dos clientes (sem dupla incidência)
    const soma = base.clientes.reduce((s, c) => s + paraCentavos(c.totalRepasse), 0);
    expect(soma / 100).toBe(base.indicadores.repasse.repasse);
  });

  test("reimportação deduplicada (mesma chave) não duplica o repasse", () => {
    // A base nunca recebe duas linhas com a mesma chave (índice único no banco);
    // a agregação conta exatamente as linhas existentes.
    const unico = agregarBase([cliente("x")], [pag("x", 10000, { chave_importacao: "k1" })]);
    expect(unico.indicadores.repasse.repasse).toBe(500);
    expect(unico.indicadores.repasse.recebido).toBe(10000);
  });

  test("cliente excluído não entra no total", () => {
    const base = agregarBase(
      [cliente("a"), cliente("b", { deleted_at: "2026-09-20T00:00:00Z" })],
      [pag("a", 1000), pag("b", 1000)],
    );
    expect(base.indicadores.repasse.repasse).toBe(50);
  });
});
