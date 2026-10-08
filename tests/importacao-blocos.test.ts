/**
 * Modelo em BLOCOS ("VALORES PRI EXECUÇÃO") — leitura das três abas.
 * Dados fictícios (nunca versionar planilhas reais: repositório público).
 */

import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import {
  ehModeloBlocos,
  extrairNome,
  lerPlanilhaBlocos,
  situacaoDasObservacoes,
  tipoDaAba,
  valorInconsistente,
  type BlocoLido,
} from "@/lib/recebimentos/blocos";
import {
  analisarBlocos,
  aplicarDecisoes,
  montarItensBlocos,
  resumirBlocos,
} from "@/lib/recebimentos/blocosImportacao";

type Celula = string | number | null | { f: string; v?: number };

function aba(linhas: Celula[][]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(
    linhas.map((l) => l.map((c) => (c && typeof c === "object" ? null : c))),
  );
  linhas.forEach((l, r) =>
    l.forEach((c, col) => {
      if (c && typeof c === "object")
        ws[XLSX.utils.encode_cell({ r, c: col })] = { t: "n", v: c.v ?? 0, f: c.f };
    }),
  );
  return ws;
}

function arquivo(abas: Record<string, Celula[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [nome, linhas] of Object.entries(abas))
    XLSX.utils.book_append_sheet(wb, aba(linhas), nome);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

const RPV: Celula[][] = [
  ["CLIENTE: ALBERTO FICTICIO SOUZA - TJRS"],
  ["VALOR TOTAL: R$ 10.000,00"],
  ["AUTOR: 7.000,00"],
  ["CONTRATUAIS (30%): 3.000,00", null, "AINDA NÃO PAGO"],
  ["SUCUMBENCIAIS (10%): 1.000,00", null, "TED - PAGO -OK"],
  [],
  ["BEATRIZ EXEMPLO LIMA", "TJSC"],
  ["ATRASADOS:", 20000, 22000, "atualizado"],
  ["CLIENTE:", 15000, 16500],
  ["CONTRATUAIS (25%):", 5000, 5500],
  ["SUCUMBENCIAIS (10%): NÃO TEM", 0],
  ["EXECUÇÃO (10%):", 300],
  ["IMPLANTAÇÃO:", 1200, "já foi pago!!!"],
  [null, { f: "SUM(B9:B11)", v: 20300 }],
  ["ATRASADOS:", 8000],
  ["CLIENTE: CARLOS MODELO PEREIRA", 6000],
  ["CONTRATUAIS (25%):", 2000],
  ["SUCUMBENCIAIS (10%):", 800, "Fiz pedido de TED"],
  ["IMPLANTAÇÃO:", 900, "VAI PAGAR EM 3X"],
  ["ATRASADOS:"],
  ["CLIENTE:"],
  ["CONTRATUAIS (30%):"],
  ["SUCUMBENCIAIS (10%):"],
  ["IMPLANTAÇÃO:"],
];

const JUDICIAL: Celula[][] = [
  ["CLIENTE: BEATRIZ EXEMPLO LIMA"],
  ["Processo nº 5000001-11.2024.8.21.0001"],
  ["BENEFÍCIO: 94 - AUXÍLIO-ACIDENTE           NB: 123.456.789-0"],
  ["DIB: 10/03/2022"],
  ["RMI: 1.000,00"],
  ["VALOR HONORÁRIOS: R$ 1.200,00"],
  [],
  [
    "DANIELA TESTE ROCHA   CPF: 529.982.247-25",
    null,
    null,
    null,
    null,
    "CLIENTE: EDUARDO PARALELO NUNES",
  ],
  ["BENEFÍCIO: 31 - AUXÍLIO-DOENÇA", null, null, null, null, "BENEFÍCIO: AUX. ACIDENTE"],
  ["DIB: 01/01/2024", null, null, null, null, "DIB: 13/06/2017"],
  [
    "HONORÁRIOS: R$ 2.103,72*",
    "parcelou em 3X 701,24 - já pagou a 1ª em dezembro (12/12/2024)",
    null,
    null,
    null,
    "Valor implantação: R$ 456,24*",
  ],
  [
    "ATRASADOS: DIB ATÉ 30/04/2024",
    null,
    null,
    null,
    null,
    "COMUNICAR CLIENTE: já recebeu e já cobrei",
  ],
];

const ADM: Celula[][] = [
  [],
  ["Cliente: Fernanda Simulada Alves"],
  ["BENEFÍCIO: 31 - AUXÍLIO-DOENÇA  NB: 717.000.000-1"],
  ["HONORÁRIOS: 3 benefícios (4.554,00) + 30% (2.183,10) = 6.737,10"],
  ["HONORÁRIOS ADM: R$ 1.302,88 - 30% do valor recebido R$ 4.342,93"],
  [],
  ["CLIENTE: GUSTAVO FICTO SILVA"],
  ["BENEFÍCIO: 41 - APOSENTADORIA POR IDADE"],
  ["HONORÁRIOS: 1 BENEFÍCIO ADM (R$ 4.678,62)"],
  [
    "CLIENTE VAI PAGAR EM 3X (1.559,54), SENDO A PRIMEIRA EM 15/09",
    null,
    null,
    null,
    null,
    null,
    null,
    "pagou última em 13/11",
  ],
];

const ARQ = arquivo({
  " RPV E PRECATORIO": RPV,
  "IMPLANTAÇÃO JUDICIAL": JUDICIAL,
  "IMPLANTAÇÃO ADMINISTRATIVA": ADM,
});
const L = lerPlanilhaBlocos(ARQ);
const bloco = (nome: string, aba?: string): BlocoLido =>
  L.blocos.find((b) => b.nome === nome && (!aba || b.aba === aba))!;

describe("abas e formato", () => {
  test("reconhece as abas sem depender de espaços e acentos", () => {
    expect(tipoDaAba(" RPV E PRECATORIO")).toBe("rpv");
    expect(tipoDaAba("RPV  E  PRECATÓRIO")).toBe("rpv");
    expect(tipoDaAba("IMPLANTACAO JUDICIAL")).toBe("judicial");
    expect(tipoDaAba("Implantação Administrativa ")).toBe("administrativa");
    expect(ehModeloBlocos(["Plan1", "IMPLANTAÇÃO JUDICIAL", "RPV E PRECATÓRIO"])).toBe(true);
    expect(ehModeloBlocos(["Valores"])).toBe(false);
  });

  test("conta blocos por aba e ignora modelo vazio e somas", () => {
    expect(L.abas.map((a) => [a.aba, a.blocos])).toEqual([
      ["rpv", 3],
      ["judicial", 3],
      ["administrativa", 2],
    ]);
    expect(L.ignoradas.some((i) => i.motivo.startsWith("Fórmula"))).toBe(true);
    expect(L.ignoradas.some((i) => i.motivo === "Modelo vazio")).toBe(true);
  });
});

describe("RPV E PRECATÓRIO", () => {
  test("bruto e autor são complementares; contratuais vão para ATRASADOS; sucumbência separada", () => {
    const b = bloco("ALBERTO FICTICIO SOUZA");
    expect(b.tribunal).toContain("TJRS");
    expect(b.complementares.map((c) => [c.rotulo, c.valor])).toEqual([
      ["Valor bruto dos atrasados", 10000],
      ["Valor destinado ao autor", 7000],
    ]);
    const [contr, suc] = b.lancamentos;
    expect([contr!.categoria, contr!.valor, contr!.situacao, contr!.percentual]).toEqual([
      "atrasados",
      3000,
      "a_receber",
      "30%",
    ]);
    expect([suc!.categoria, suc!.valor, suc!.situacao, suc!.valorRecebido]).toEqual([
      "sucumbencia",
      1000,
      "recebido",
      1000,
    ]);
  });

  test("versões: usa a mais recente e marca para conferência; nunca soma", () => {
    const b = bloco("BEATRIZ EXEMPLO LIMA", "rpv");
    const contr = b.lancamentos.find((x) => x.natureza === "contratuais_atrasados")!;
    expect(contr.valor).toBe(5500);
    expect(contr.versoes.map((v) => v.valor)).toEqual([5000]);
    expect(contr.conferencia.join(" ")).toContain("usado o mais recente");
  });

  test("'NÃO TEM' na sucumbência = Não haverá sucumbência; EXECUÇÃO isolada vai para conferência", () => {
    const b = bloco("BEATRIZ EXEMPLO LIMA", "rpv");
    expect(b.naoHaveraSucumbencia).toBe(true);
    const exec = b.lancamentos.find((x) => x.natureza === "execucao")!;
    expect(exec.categoria).toBeNull();
    expect(exec.conferencia.join(" ")).toContain("Natureza");
  });

  test("CLIENTE: NOME na 2ª linha do bloco; pedido de TED não confirma; parcelamento futuro é a receber", () => {
    const b = bloco("CARLOS MODELO PEREIRA");
    expect(b.complementares.find((c) => c.rotulo === "Valor destinado ao autor")?.valor).toBe(6000);
    expect(b.lancamentos.find((x) => x.categoria === "sucumbencia")!.situacao).toBe(
      "nao_confirmado",
    );
    const impl = b.lancamentos.find((x) => x.categoria === "implantacao")!;
    expect([impl.situacao, impl.valorRecebido]).toEqual(["a_receber", null]);
  });

  test("implantação repetida na IMPLANTAÇÃO JUDICIAL não é contada duas vezes", () => {
    expect(
      bloco("BEATRIZ EXEMPLO LIMA", "rpv").lancamentos.some((x) => x.categoria === "implantacao"),
    ).toBe(false);
    const jud = bloco("BEATRIZ EXEMPLO LIMA", "judicial").lancamentos.find(
      (x) => x.categoria === "implantacao",
    )!;
    expect(jud.valor).toBe(1200);
    // A confirmação "já foi pago" da outra aba é preservada.
    expect(jud.situacao).toBe("recebido");
    expect(L.duplicidades).toHaveLength(1);
  });
});

describe("IMPLANTAÇÃO JUDICIAL / ADMINISTRATIVA", () => {
  test("processo, NB, espécie e dados do benefício", () => {
    const b = bloco("BEATRIZ EXEMPLO LIMA", "judicial");
    expect(b.processoDigitos).toBe("50000011120248210001");
    expect(b.nb).toBe("123.456.789-0");
    expect(b.especie).toContain("94 - AUXÍLIO-ACIDENTE");
    expect(b.beneficio.DIB).toBe("10/03/2022");
    expect(b.beneficio.RMI).toBe("1.000,00");
  });

  test("nome com CPF; parcela confirmada conta só ela", () => {
    const b = bloco("DANIELA TESTE ROCHA");
    expect(b.cpf).toBe("529.982.247-25");
    expect(b.cpfValido).toBe(true);
    const x = b.lancamentos[0]!;
    expect([x.categoria, x.origem, x.valor, x.situacao, x.valorRecebido]).toEqual([
      "implantacao",
      "judicial",
      2103.72,
      "parcial",
      701.24,
    ]);
  });

  test("bloco paralelo em outra coluna não se mistura", () => {
    const e = bloco("EDUARDO PARALELO NUNES");
    expect(e.coluna).toBe("F");
    expect(e.lancamentos.map((x) => x.valor)).toEqual([456.24]);
    expect(bloco("DANIELA TESTE ROCHA").lancamentos.map((x) => x.valor)).toEqual([2103.72]);
  });

  test("administrativa: total composto separado; base 'valor recebido' não é recebimento", () => {
    const b = bloco("Fernanda Simulada Alves");
    expect(b.lancamentos.map((x) => [x.categoria, x.natureza, x.valor, x.origem])).toEqual([
      ["implantacao", "implantacao", 4554, "administrativo"],
      ["atrasados", "honorarios_atrasados_adm", 2183.1, "administrativo"],
      ["implantacao", "implantacao", 1302.88, "administrativo"],
    ]);
    expect(b.lancamentos.every((x) => x.situacao === "a_receber")).toBe(true);
  });

  test("observação 'pagou última' em linha própria quita o único honorário do bloco", () => {
    const x = bloco("GUSTAVO FICTO SILVA").lancamentos[0]!;
    expect([x.valor, x.situacao, x.valorRecebido]).toEqual([4678.62, "recebido", 4678.62]);
  });
});

describe("funções auxiliares", () => {
  test("nome, CPF e tribunal", () => {
    expect(extrairNome("ATRASADOS: DIEGO FULANO (JEF)")).toMatchObject({
      nome: "DIEGO FULANO",
      tribunal: "JEF",
    });
    expect(extrairNome("ATRASADOS: DIB ATÉ 31/03/2024").nome).toBeNull();
    expect(extrairNome("CLIENTE JÁ ESTÁ RECEBENDO B94 DESDE 01/11/2023").nome).toBeNull();
    expect(extrairNome("Cliente: Ana Teste 2ª CONCESSÃO").nome).toBe("Ana Teste");
  });

  test("situação pelas observações", () => {
    expect(situacaoDasObservacoes(["PAGO OK"]).situacao).toBe("recebido");
    expect(situacaoDasObservacoes(["AINDA NÃO PAGO"]).situacao).toBe("a_receber");
    expect(situacaoDasObservacoes(["iremos cobrar"]).situacao).toBe("a_receber");
    expect(situacaoDasObservacoes(["cliente comunicado"]).situacao).toBe("nao_confirmado");
    expect(situacaoDasObservacoes(["Serão pagos no judicial os valores de 01/2024"]).situacao).toBe(
      "a_receber",
    );
    expect(situacaoDasObservacoes(["30% do valor recebido R$ 9.000,00"]).situacao).toBeNull();
    expect(
      situacaoDasObservacoes([
        "pagou em 08/09/2025 apenas o valor de R$ 1.794,10 - o restante vamos descontar",
      ]),
    ).toMatchObject({
      situacao: "parcial",
      valorRecebido: 1794.1,
    });
  });

  test("valor digitado de forma inconsistente", () => {
    expect(valorInconsistente("AUTOR: 64.1035,59")).toBe("64.1035,59");
    expect(valorInconsistente("4.774.32")).toBe("4.774.32");
    expect(valorInconsistente("R$ 1.234,56")).toBeNull();
  });
});

describe("identificação e itens para o banco", () => {
  const clientes = [
    { id: "c-beatriz", nome: "Beatriz Exemplo Lima", cpf: null, status: "ativo", deleted_at: null },
    { id: "c-carlos", nome: "Carlos Modelo Pereyra", cpf: null, status: "pago", deleted_at: null },
    {
      id: "c-daniela",
      nome: "Daniela T. Rocha",
      cpf: "529.982.247-25",
      status: "ativo",
      deleted_at: null,
    },
  ];
  const processos = [
    { id: "p-b1", cliente_id: "c-beatriz", numero_digitos: "50000011120248210001", pasta: null },
    { id: "p-b2", cliente_id: "c-beatriz", numero_digitos: "99999999999999999999", pasta: null },
    { id: "p-d1", cliente_id: "c-daniela", numero_digitos: "11111111111111111111", pasta: null },
  ];
  const an = analisarBlocos(L, clientes, [], processos);
  const de = (nome: string, aba?: string) =>
    an.find((a) => a.bloco.nome === nome && (!aba || a.bloco.aba === aba))!;

  test("nome idêntico e CPF identificam; nome parecido fica pendente; inexistente vira novo", () => {
    expect(de("BEATRIZ EXEMPLO LIMA", "judicial").cliente).toMatchObject({
      acao: "existente",
      id: "c-beatriz",
    });
    expect(de("DANIELA TESTE ROCHA").cliente).toMatchObject({
      acao: "existente",
      id: "c-daniela",
      via: "cpf",
    });
    expect(de("CARLOS MODELO PEREIRA").cliente.acao).toBe("pendente");
    expect(de("CARLOS MODELO PEREIRA").sugestoes[0]).toMatchObject({ id: "c-carlos" });
    expect(de("ALBERTO FICTICIO SOUZA").cliente.acao).toBe("novo");
  });

  test("processo pelo número; sem número com vários processos → nenhum (pendência)", () => {
    expect(de("BEATRIZ EXEMPLO LIMA", "judicial").processo).toMatchObject({
      acao: "existente",
      id: "p-b1",
    });
    expect(de("BEATRIZ EXEMPLO LIMA", "rpv").processo.acao).toBe("nenhum");
    expect(de("DANIELA TESTE ROCHA").processo).toMatchObject({
      acao: "existente",
      id: "p-d1",
      via: "único processo do cliente",
    });
  });

  test("itens: recebido vira recebimento, parcial divide, pendente vira previsto; pendente de decisão fica de fora", () => {
    const itens = montarItensBlocos(an);
    expect(itens.some((i) => i.bloco === de("CARLOS MODELO PEREIRA").bloco.id)).toBe(false);
    const alberto = itens.find((i) => i.bloco === de("ALBERTO FICTICIO SOUZA").bloco.id)!;
    expect(alberto.cliente).toMatchObject({ acao: "novo", nome: "ALBERTO FICTICIO SOUZA" });
    expect(alberto.recebimentos.map((r) => [r.categoria, r.valor])).toEqual([
      ["sucumbencia", 1000],
    ]);
    expect(alberto.previstos.map((r) => [r.categoria, r.valor, r.situacao])).toEqual([
      ["atrasados", 3000, "a_receber"],
    ]);
    const daniela = itens.find((i) => i.bloco === de("DANIELA TESTE ROCHA").bloco.id)!;
    expect(daniela.recebimentos.map((r) => r.valor)).toEqual([701.24]);
    expect(daniela.previstos.map((r) => [r.valor, r.valor_recebido, r.situacao])).toEqual([
      [2103.72, 701.24, "parcial"],
    ]);
  });

  test("chaves estáveis: reler o mesmo arquivo gera as mesmas chaves", () => {
    const a1 = montarItensBlocos(an).flatMap((i) =>
      [...i.recebimentos, ...i.previstos].map((x) => x.chave),
    );
    const an2 = analisarBlocos(lerPlanilhaBlocos(ARQ), clientes, [], processos);
    const a2 = montarItensBlocos(an2).flatMap((i) =>
      [...i.recebimentos, ...i.previstos].map((x) => x.chave),
    );
    expect(a2).toEqual(a1);
    const prev = montarItensBlocos(an).flatMap((i) =>
      i.previstos.map((x) => `${JSON.stringify(i.cliente)}|${x.chave}`),
    );
    const rec = montarItensBlocos(an).flatMap((i) =>
      i.recebimentos.map((x) => `${JSON.stringify(i.cliente)}|${x.chave}`),
    );
    expect(new Set(prev).size).toBe(prev.length);
    expect(new Set(rec).size).toBe(rec.length);
  });

  test("decisão do usuário: vincular o bloco pendente ao cliente sugerido", () => {
    const d = aplicarDecisoes(
      an,
      new Map([[de("CARLOS MODELO PEREIRA").bloco.id, { cliente: "c-carlos" }]]),
      processos,
    );
    const c = d.find((a) => a.bloco.nome === "CARLOS MODELO PEREIRA")!;
    expect(c.cliente).toMatchObject({ acao: "existente", id: "c-carlos" });
    expect(montarItensBlocos(d).some((i) => i.bloco === c.bloco.id)).toBe(true);
  });

  test("resumo: totais separam recebido e previsto por categoria e origem", () => {
    const r = resumirBlocos(L, an);
    expect(r.totais["sucumbencia|judicial"]?.recebido).toBe(1000);
    expect(r.totais["atrasados|judicial"]?.previsto).toBeGreaterThan(0);
    expect(r.pendentes).toBe(1);
  });
});
