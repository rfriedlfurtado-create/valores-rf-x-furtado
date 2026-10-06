/** Regras dos cards VALORES RECEBIDOS (src/lib/valoresProcesso.ts). */

import { describe, expect, test } from "bun:test";

import type { ClassificacaoEntrada, Pagamento } from "@/lib/tipos";
import {
  mensagemReabertura,
  valoresDoProcesso,
  type CategoriaProcessoCfg,
} from "@/lib/valoresProcesso";

let seq = 0;
function pag(
  atendimento: string | null,
  classificacao: ClassificacaoEntrada | null,
  valor: number,
  data = "2026-10-01",
): Pagamento {
  seq += 1;
  return {
    id: `p${seq}`,
    cliente_id: "c1",
    valor,
    data_pagamento: data,
    tipo: "outro",
    observacao: null,
    usuario_cadastro: null,
    created_at: `2026-10-01T00:00:${String(seq).padStart(2, "0")}Z`,
    classificacao,
    chave_importacao: null,
    linha_importacao: null,
    atendimento_id: atendimento,
  };
}

const cfg = (
  atendimento: string,
  categoria: ClassificacaoEntrada,
  c: Partial<CategoriaProcessoCfg>,
): CategoriaProcessoCfg => ({
  atendimento_id: atendimento,
  categoria,
  total_previsto: null,
  integral_confirmado: false,
  nao_havera: false,
  ...c,
});

describe("cards por processo", () => {
  test("sem recebimento: três cards pendentes, nenhum valor", () => {
    const v = valoresDoProcesso([], [], "A");
    for (const c of ["atrasados", "implantacao", "sucumbencia"] as const) {
      expect(v.categorias[c].status).toBe("pendente");
      expect(v.categorias[c].quantidade).toBe(0);
      expect(v.categorias[c].total).toBe(0);
    }
    expect(v.podeFinalizar).toBe(false);
    expect(v.pendencias).toHaveLength(3);
  });

  test("somente o processo selecionado — nunca mistura processos do mesmo cliente", () => {
    const pags = [
      pag("A", "atrasados", 1000),
      pag("B", "atrasados", 7000),
      pag(null, "atrasados", 50),
      pag("A", "atrasados", 500, "2026-10-05"),
    ];
    const a = valoresDoProcesso(pags, [], "A");
    const b = valoresDoProcesso(pags, [], "B");
    expect(a.categorias.atrasados.total).toBe(1500);
    expect(a.categorias.atrasados.quantidade).toBe(2);
    expect(b.categorias.atrasados.total).toBe(7000);
  });

  test("vários recebimentos da mesma categoria: registros individuais e total somado", () => {
    const pags = [
      pag("A", "implantacao", 100.1),
      pag("A", "implantacao", 200.2),
      pag("A", "atrasados", 1),
    ];
    const s = valoresDoProcesso(pags, [], "A").categorias.implantacao;
    expect(s.registros.map((p) => p.valor)).toEqual([100.1, 200.2]);
    expect(s.total).toBe(300.3);
  });

  test("valor zero/vazio não é recebimento", () => {
    const s = valoresDoProcesso([pag("A", "atrasados", 0)], [], "A").categorias.atrasados;
    expect(s.quantidade).toBe(0);
    expect(s.status).toBe("pendente");
  });

  test("parcial fica pendente; com total a receber mostra saldo; ao alcançar o total vira recebido", () => {
    const c = [cfg("A", "atrasados", { total_previsto: 3000 })];
    let s = valoresDoProcesso([pag("A", "atrasados", 1000)], c, "A").categorias.atrasados;
    expect(s.status).toBe("pendente");
    expect(s.parcial).toBe(true);
    expect(s.saldo).toBe(2000);
    s = valoresDoProcesso([pag("A", "atrasados", 1000), pag("A", "atrasados", 2000)], c, "A")
      .categorias.atrasados;
    expect(s.status).toBe("recebido");
    expect(s.integralPeloTotal).toBe(true);
    expect(s.saldo).toBe(0);
  });

  test("sem total informado: só vira recebido com a confirmação de recebimento integral", () => {
    const pags = [pag("A", "implantacao", 800)];
    expect(valoresDoProcesso(pags, [], "A").categorias.implantacao.status).toBe("pendente");
    const c = [cfg("A", "implantacao", { integral_confirmado: true })];
    expect(valoresDoProcesso(pags, c, "A").categorias.implantacao.status).toBe("recebido");
    // Confirmação sem recebimento não resolve a categoria.
    expect(valoresDoProcesso([], c, "A").categorias.implantacao.status).toBe("pendente");
  });

  test("Não haverá sucumbência: resolvida sem valor; não vale para Atrasados/Implantação", () => {
    const c = [
      cfg("A", "sucumbencia", { nao_havera: true }),
      cfg("A", "atrasados", { nao_havera: true }),
    ];
    const v = valoresDoProcesso([], c, "A");
    expect(v.categorias.sucumbencia.status).toBe("nao_havera");
    expect(v.categorias.sucumbencia.total).toBe(0);
    expect(v.categorias.sucumbencia.pendencia).toBeNull();
    expect(v.categorias.atrasados.status).toBe("pendente");
  });

  test("finalização: exige os três cards resolvidos; parcial bloqueia", () => {
    const pags = [pag("A", "atrasados", 1000), pag("A", "implantacao", 500)];
    const completo = [
      cfg("A", "atrasados", { integral_confirmado: true }),
      cfg("A", "implantacao", { total_previsto: 500 }),
      cfg("A", "sucumbencia", { nao_havera: true }),
    ];
    expect(valoresDoProcesso(pags, completo, "A").podeFinalizar).toBe(true);

    const parcial = [
      cfg("A", "atrasados", { integral_confirmado: true }),
      cfg("A", "implantacao", { total_previsto: 900 }),
      cfg("A", "sucumbencia", { nao_havera: true }),
    ];
    const v = valoresDoProcesso(pags, parcial, "A");
    expect(v.podeFinalizar).toBe(false);
    expect(v.pendencias.map((p) => p.replace(/\u00a0/g, " "))).toEqual([
      "Implantação (recebimento parcial — falta confirmar o recebimento integral; saldo pendente R$ 400,00)",
    ]);
  });

  test("recebimento sem categoria fica para conferência e não entra em card", () => {
    const v = valoresDoProcesso([pag("A", null, 99)], [], "A");
    expect(v.semCategoria).toHaveLength(1);
    expect(v.categorias.atrasados.total).toBe(0);
  });

  test("mensagem de reabertura informa o processo e o que falta", () => {
    expect(
      mensagemReabertura([
        {
          atendimento_id: "A",
          numero: "123",
          pago: false,
          reaberto: true,
          pendencias: ["Atrasados (x)"],
        },
        { atendimento_id: "B", numero: "456", pago: true, reaberto: false, pendencias: [] },
      ]),
    ).toBe(
      "Processo 123 voltou para PENDENTE (CLIENTES): deixou de cumprir os requisitos de finalização. Falta: Atrasados (x).",
    );
    expect(mensagemReabertura([])).toBeNull();
  });
});
