/**
 * Relatório de honorários: Escritório × Ricardo Friedl.
 * Rodar: bun test
 */
import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { agregarBase } from "@/lib/agregacao";
import { htmlRelatorio, planilhaRelatorio } from "@/lib/exportarRelatorio";
import {
  dadosGrafico,
  documentoRelatorio,
  filtrarLinhas,
  intervaloDoPeriodo,
  lerConfigs,
  montarLinhas,
  normalizarConfig,
  porCategoria,
  porCliente,
  serie,
  tiposPermitidos,
  totalizar,
  type ConfigGrafico,
  type FiltroRelatorio,
} from "@/lib/relatorioHonorarios";
import { paraCentavos } from "@/lib/repasse";
import type { Cliente, Pagamento, ProcessoResumo } from "@/lib/tipos";

const HOJE = new Date(2026, 9, 9); // 09/10/2026

function cliente(id: string, nome: string, extra: Partial<Cliente> = {}): Cliente {
  return {
    id,
    nome,
    nome_normalizado: nome.toLowerCase(),
    cpf: null,
    numero_processo: null,
    observacoes: null,
    status: "ativo",
    origem_importacao: null,
    data_importacao: null,
    escritorio_origem: "a_confirmar",
    arquivado: false,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}
let seq = 0;
function pag(
  clienteId: string,
  valor: number | string,
  classificacao: Pagamento["classificacao"],
  data: string,
  atendimento_id: string | null = null,
  extra: Partial<Pagamento> = {},
): Pagamento {
  seq += 1;
  return {
    id: `p${String(seq).padStart(3, "0")}`,
    cliente_id: clienteId,
    valor: valor as number,
    data_pagamento: data,
    tipo: "pix",
    observacao: null,
    usuario_cadastro: null,
    created_at: `${data}T00:00:00Z`,
    classificacao,
    chave_importacao: null,
    linha_importacao: null,
    atendimento_id,
    ...extra,
  };
}
const proc = (id: string, cliente_id: string, numero: string): ProcessoResumo => ({
  id,
  cliente_id,
  numero,
  tipo_acao: "BPC/LOAS",
  pago: false,
  pago_em: null,
});

function cenario(pagamentos: Pagamento[]) {
  const base = agregarBase(
    [cliente("joao", "João da Silva", { cliente_rf: true }), cliente("maria", "Maria Souza")],
    pagamentos,
    HOJE,
    [
      proc("A", "joao", "5001234-12.2024.4.04.7100"),
      proc("B", "joao", "5009999-11.2025.4.04.7100"),
    ],
  );
  return { base, linhas: montarLinhas(base.clientes, base.pagamentosPorCliente) };
}

describe("regra: Escritório = recebido − Ricardo", () => {
  test("R$ 10.000 → Escritório 9.500 e Ricardo 500", () => {
    const { linhas } = cenario([pag("joao", 10000, "atrasados", "2026-09-10", "A")]);
    expect(totalizar(linhas)).toEqual({
      quantidade: 1,
      clientes: 1,
      recebido: 10000,
      escritorio: 9500,
      ricardo: 500,
    });
  });

  test("centavos: total = escritório + Ricardo, sempre", () => {
    const { linhas } = cenario([
      pag("joao", "0.10", "atrasados", "2026-09-10"),
      pag("joao", "333.33", "implantacao", "2026-09-10"),
      pag("maria", "1234.57", "sucumbencia", "2026-09-11"),
    ]);
    const t = totalizar(linhas);
    expect(paraCentavos(t.escritorio) + paraCentavos(t.ricardo)).toBe(paraCentavos(t.recebido));
    expect(t.ricardo).toBe(78.41); // 0,01 + 16,67 + 61,73
    for (const c of porCategoria(linhas))
      expect(paraCentavos(c.escritorio) + paraCentavos(c.ricardo)).toBe(paraCentavos(c.recebido));
  });

  test("mesmo repasse do Dashboard / perfil / JÁ PAGOS (motor central)", () => {
    const { base, linhas } = cenario([
      pag("joao", 10000, "atrasados", "2026-09-10", "A"),
      pag("joao", "1234.57", null, "2026-10-01"),
      pag("maria", 4000, "atrasados", "2026-10-01", null, { destinatario: "cliente" }),
    ]);
    const t = totalizar(linhas);
    expect(t.ricardo).toBe(base.indicadores.repasse.repasse);
    expect(t.recebido).toBe(base.indicadores.repasse.recebido);
    expect(t.escritorio).toBe(base.indicadores.repasse.escritorio);
    expect(t.ricardo).toBe(base.porId.get("joao")!.totalRepasse);
  });

  test("valor pago ao cliente e cliente excluído não entram", () => {
    const base = agregarBase(
      [cliente("a", "A"), cliente("b", "B", { deleted_at: "2026-09-01" })],
      [
        pag("a", 1000, "atrasados", "2026-09-01", null, { destinatario: "cliente" }),
        pag("a", 2000, "atrasados", "2026-09-01"),
        pag("b", 5000, "atrasados", "2026-09-01"),
      ],
    );
    const t = totalizar(montarLinhas(base.clientes, base.pagamentosPorCliente));
    expect(t.recebido).toBe(2000);
  });
});

describe("múltiplos recebimentos e categorias", () => {
  const { linhas } = cenario([
    pag("joao", 10000, "atrasados", "2026-09-05", "A"),
    pag("joao", 2000, "implantacao", "2026-09-10", "A"),
    pag("joao", 3000, "sucumbencia", "2026-08-20", "A"),
    pag("joao", 20000, "atrasados", "2026-10-01", "B"),
    pag("maria", 1000, "implantacao", "2026-01-15"),
  ]);

  test("separação por categoria", () => {
    const cats = Object.fromEntries(porCategoria(linhas).map((c) => [c.categoria, c]));
    expect(cats.atrasados).toMatchObject({
      recebido: 30000,
      escritorio: 28500,
      ricardo: 1500,
      quantidade: 2,
      clientes: 1,
    });
    expect(cats.implantacao).toMatchObject({
      recebido: 3000,
      escritorio: 2850,
      ricardo: 150,
      quantidade: 2,
      clientes: 2,
    });
    expect(cats.sucumbencia).toMatchObject({ recebido: 3000, ricardo: 150 });
    expect(cats.sem_classificacao).toBeUndefined();
  });

  test("cliente → processos separados; consolidado soma os processos", () => {
    const joao = porCliente(linhas).find((c) => c.clienteId === "joao")!;
    expect(joao.totais).toMatchObject({ recebido: 35000, escritorio: 33250, ricardo: 1750 });
    const a = joao.processos.find((p) => p.processoId === "A")!;
    const b = joao.processos.find((p) => p.processoId === "B")!;
    expect(a.totais).toMatchObject({ recebido: 15000, escritorio: 14250, ricardo: 750 });
    expect(b.totais).toMatchObject({ recebido: 20000, ricardo: 1000 });
    expect(a.linhas.every((l) => l.processoId === "A")).toBe(true);
  });

  test("alteração de valor recalcula Escritório e Ricardo", () => {
    const antes = cenario([pag("joao", 10000, "atrasados", "2026-09-05")]).linhas;
    const depois = cenario([pag("joao", 12000, "atrasados", "2026-09-05")]).linhas;
    expect(totalizar(antes)).toMatchObject({ escritorio: 9500, ricardo: 500 });
    expect(totalizar(depois)).toMatchObject({ escritorio: 11400, ricardo: 600 });
  });

  test("exclusão remove de todos os totais", () => {
    const sem = linhas.filter((l) => l.recebidoC !== 2000000);
    expect(totalizar(sem).recebido).toBe(totalizar(linhas).recebido - 20000);
    expect(
      porCliente(sem)
        .find((c) => c.clienteId === "joao")!
        .processos.some((p) => p.processoId === "B"),
    ).toBe(false);
  });

  test("alteração de categoria só move o valor entre categorias", () => {
    const a = cenario([pag("joao", 10000, "atrasados", "2026-09-05")]).linhas;
    const b = cenario([pag("joao", 10000, "sucumbencia", "2026-09-05")]).linhas;
    expect(totalizar(a)).toEqual(totalizar(b));
    const catA = Object.fromEntries(porCategoria(a).map((c) => [c.categoria, c.recebido]));
    const catB = Object.fromEntries(porCategoria(b).map((c) => [c.categoria, c.recebido]));
    expect([catA.atrasados, catA.sucumbencia]).toEqual([10000, 0]);
    expect([catB.atrasados, catB.sucumbencia]).toEqual([0, 10000]);
  });
});

describe("filtros — o mesmo universo para cards, gráficos e tabela", () => {
  const { linhas } = cenario([
    pag("joao", 10000, "atrasados", "2026-10-05", "A"),
    pag("joao", 2000, "implantacao", "2026-09-10", "A"),
    pag("joao", 20000, "atrasados", "2026-10-01", "B"),
    pag("maria", 1000, "implantacao", "2025-12-15"),
    pag("maria", 500, "sucumbencia", "2026-10-09"),
  ]);

  test("períodos rápidos", () => {
    expect(intervaloDoPeriodo({ periodo: "hoje" }, HOJE)).toEqual({
      de: "2026-10-09",
      ate: "2026-10-09",
    });
    expect(intervaloDoPeriodo({ periodo: "este_mes" }, HOJE)).toEqual({
      de: "2026-10-01",
      ate: "2026-10-31",
    });
    expect(intervaloDoPeriodo({ periodo: "mes_anterior" }, HOJE)).toEqual({
      de: "2026-09-01",
      ate: "2026-09-30",
    });
    expect(intervaloDoPeriodo({ periodo: "este_ano" }, HOJE)).toEqual({
      de: "2026-01-01",
      ate: "2026-12-31",
    });
    expect(filtrarLinhas(linhas, { periodo: "hoje" }, HOJE)).toHaveLength(1);
    expect(filtrarLinhas(linhas, { periodo: "mes_anterior" }, HOJE)).toHaveLength(1);
    expect(filtrarLinhas(linhas, { periodo: "este_ano" }, HOJE)).toHaveLength(4);
    expect(
      filtrarLinhas(
        linhas,
        { periodo: "personalizado", de: "2025-12-01", ate: "2025-12-31" },
        HOJE,
      ),
    ).toHaveLength(1);
  });

  test("cliente (sem acento), processo (dígitos) e categoria", () => {
    expect(filtrarLinhas(linhas, { periodo: "tudo", cliente: "joao" }, HOJE)).toHaveLength(3);
    expect(filtrarLinhas(linhas, { periodo: "tudo", processo: "5009999" }, HOJE)).toHaveLength(1);
    expect(filtrarLinhas(linhas, { periodo: "tudo", processo: "5009999-11" }, HOJE)).toHaveLength(
      1,
    );
    expect(
      filtrarLinhas(linhas, { periodo: "tudo", categorias: ["implantacao", "sucumbencia"] }, HOJE),
    ).toHaveLength(3);
  });

  test("cards, gráfico mensal, categorias, clientes e exportação fecham com o mesmo total", () => {
    const f: FiltroRelatorio = { periodo: "este_ano", categorias: ["atrasados", "implantacao"] };
    const fl = filtrarLinhas(linhas, f, HOJE);
    const t = totalizar(fl);
    const soma = (xs: number[]) => xs.reduce((s, x) => s + paraCentavos(x), 0) / 100;
    expect(soma(serie(fl, "mes").map((p) => p.ricardo))).toBe(t.ricardo);
    expect(soma(serie(fl, "mes").map((p) => p.recebido))).toBe(t.recebido);
    expect(soma(porCategoria(fl).map((c) => c.escritorio))).toBe(t.escritorio);
    expect(soma(porCliente(fl).map((c) => c.totais.ricardo))).toBe(t.ricardo);
    const doc = documentoRelatorio(fl, f, HOJE);
    expect(doc.totais).toEqual(t);
    expect(soma(doc.detalhamento.map((d) => d.ricardo))).toBe(t.ricardo);
  });

  test("evolução mensal sem buracos entre o primeiro e o último mês", () => {
    const s = serie(linhas, "mes");
    expect(s.map((p) => p.chave)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(s[1]!.recebido).toBe(0);
  });
});

describe("gráficos personalizados — só visualização", () => {
  const { linhas } = cenario([
    pag("joao", 10000, "atrasados", "2026-10-05", "A"),
    pag("maria", 1000, "implantacao", "2025-12-15"),
  ]);

  test("combinações sem sentido são corrigidas", () => {
    expect(tiposPermitidos("mes", "ricardo")).toEqual(["barras", "linhas"]);
    expect(tiposPermitidos("categoria", "ricardo")).toEqual(["barras", "rosca"]);
    expect(tiposPermitidos("categoria", "clientes")).toEqual(["barras"]);
    const c: ConfigGrafico = {
      id: "x",
      metrica: "recebido",
      agrupamento: "cliente",
      categoria: "todas",
      tipo: "linhas",
    };
    expect(normalizarConfig(c).tipo).toBe("barras");
  });

  test("editar a configuração não altera os dados financeiros", () => {
    const copia = JSON.stringify(linhas);
    const t = totalizar(linhas);
    const c: ConfigGrafico = {
      id: "x",
      metrica: "ricardo",
      agrupamento: "mes",
      categoria: "todas",
      tipo: "linhas",
    };
    dadosGrafico(linhas, c);
    dadosGrafico(linhas, { ...c, agrupamento: "categoria", tipo: "rosca", categoria: "atrasados" });
    expect(JSON.stringify(linhas)).toBe(copia);
    expect(totalizar(linhas)).toEqual(t);
    const soCat = dadosGrafico(linhas, { ...c, categoria: "atrasados", agrupamento: "categoria" });
    expect(soCat.pontos.reduce((s, p) => s + p.ricardo, 0)).toBe(500);
  });

  test("configuração salva inválida é descartada (nunca dados)", () => {
    expect(
      lerConfigs({
        graficos: [
          { id: "1", metrica: "ricardo", agrupamento: "mes", categoria: "todas", tipo: "rosca" },
          { id: "2", metrica: "hack", agrupamento: "mes", categoria: "todas", tipo: "barras" },
          {
            id: "3",
            metrica: "recebido",
            agrupamento: "ano",
            categoria: "todas",
            tipo: "barras",
            valor: 999,
          },
        ],
      }),
    ).toEqual([
      { id: "1", metrica: "ricardo", agrupamento: "mes", categoria: "todas", tipo: "barras" },
      { id: "3", metrica: "recebido", agrupamento: "ano", categoria: "todas", tipo: "barras" },
    ]);
    expect(lerConfigs(null)).toEqual([]);
  });

  test("agrupamento por cliente limita barras e soma no 'Outros'", () => {
    const muitos = agregarBase(
      Array.from({ length: 15 }, (_, i) => cliente(`c${i}`, `Cliente ${i}`)),
      Array.from({ length: 15 }, (_, i) => pag(`c${i}`, 100 * (i + 1), "atrasados", "2026-09-01")),
    );
    const ls = montarLinhas(muitos.clientes, muitos.pagamentosPorCliente);
    const s = serie(ls, "cliente");
    expect(s).toHaveLength(10);
    expect(s[9]!.rotulo).toContain("Outros");
    expect(s.reduce((a, p) => a + paraCentavos(p.recebido), 0) / 100).toBe(totalizar(ls).recebido);
  });
});

describe("exportação", () => {
  const { linhas } = cenario([
    pag("joao", 10000, "atrasados", "2026-09-05", "A"),
    pag("maria", "1234.57", "implantacao", "2026-09-10"),
  ]);
  const f: FiltroRelatorio = {
    periodo: "personalizado",
    de: "2026-09-01",
    ate: "2026-09-30",
    cliente: "",
  };
  const doc = documentoRelatorio(linhas, f, HOJE);

  test("Excel: totais iguais aos exibidos", () => {
    const wb = XLSX.read(XLSX.write(planilhaRelatorio(doc), { type: "buffer", bookType: "xlsx" }));
    const det = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Detalhamento!, {
      header: 1,
    });
    const total = det[det.length - 1]!;
    expect(total.slice(4)).toEqual([11234.57, 10672.84, 561.73]);
    const t = totalizar(linhas);
    expect([t.recebido, t.escritorio, t.ricardo]).toEqual([11234.57, 10672.84, 561.73]);
    const res = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Resumo!, { header: 1 });
    expect(res.find((r) => r[0] === "Total recebido")![1]).toBe(11234.57);
    expect(res.find((r) => String(r[0]).startsWith("Repasse Ricardo"))![1]).toBe(561.73);
    expect(res.find((r) => r[0] === "Período")![1]).toBe("01/09/2026 a 30/09/2026");
  });

  test("PDF (HTML de impressão) traz período, totais e detalhamento", () => {
    const html = htmlRelatorio(doc);
    expect(html).toContain("RELATÓRIO DE HONORÁRIOS");
    expect(html).toContain("01/09/2026 a 30/09/2026");
    expect(html.replace(/\u00a0/g, " ")).toContain("R$ 561,73");
    expect(html).toContain("João da Silva");
    expect(html).toContain("5001234-12.2024.4.04.7100");
  });
});
