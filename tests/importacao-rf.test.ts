/**
 * Modelo oficial de importação "CLIENTES RF - ESPAIDER" (22 colunas): leitura,
 * mapeamento e conversões. Rodar: bun test
 */
import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { CAMPO_POR_CHAVE, CAMPOS_MODELO, CAMPOS_OFICIAIS, mapearCabecalhos } from "@/lib/rf/campos";
import { ARQUIVO_MODELO, interpretarLinhas, lerPlanilha } from "@/lib/rf/planilha";
import { resumir, type ResultadoLinha } from "@/lib/rf/dados";
import {
  converterCelula,
  converterTextoDigitado,
  cpfValido,
  extrairTelefones,
  formatarValor,
  siglaUF,
} from "@/lib/rf/valores";

/** Cabeçalho da planilha oficial "CLIENTES RF - ESPAIDER.xlsx", na ordem do arquivo. */
const CABECALHOS_ESPAIDER = [
  "Número",
  "Reclamante",
  "Adverso",
  "Tipo de Ação",
  "Celular",
  "Cidade",
  "Distribuído em",
  "Categoria",
  "Captador",
  "Captado em",
  "Valor Estimado do Processo",
  "Data inicio contrato",
  "Situação",
  "Telefone Cliente",
  "Telefone Residencial",
  "Data de nascimento cliente",
  "E-mail",
  "CPF",
  "Indicação",
  "CEP",
  "CPF Reclamante",
  "Pasta",
];

function planilha(linhas: unknown[][], formatar?: (ws: XLSX.WorkSheet) => void): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  formatar?.(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Planilha1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("modelo", () => {
  test("modelo oficial = 22 colunas da planilha CLIENTES RF - ESPAIDER, na mesma ordem", () => {
    expect(CAMPOS_OFICIAIS.map((c) => c.cabecalho)).toEqual(CABECALHOS_ESPAIDER);
    expect(new Set(CAMPOS_MODELO.map((c) => c.chave)).size).toBe(CAMPOS_MODELO.length);
    expect(CAMPOS_MODELO.filter((c) => c.obrigatorio).map((c) => c.cabecalho)).toEqual([
      "Reclamante",
    ]);
  });

  test("os 22 cabeçalhos reais são reconhecidos sem sobras nem ausências", () => {
    const m = mapearCabecalhos(CABECALHOS_ESPAIDER);
    expect(m.campos.size).toBe(22);
    expect(m.extras.size).toBe(0);
    expect(m.ausentes).toEqual([]);
    expect([...m.campos.values()].every((c) => !CAMPO_POR_CHAVE.get(c)!.legado)).toBe(true);
  });

  test("cliente x processo: cada campo na entidade certa", () => {
    const entidade = (c: string) => CAMPOS_OFICIAIS.find((x) => x.cabecalho === c)!.entidade;
    for (const c of [
      "Reclamante",
      "CPF Reclamante",
      "CPF",
      "Data de nascimento cliente",
      "Cidade",
      "CEP",
      "Celular",
      "Telefone Cliente",
      "Telefone Residencial",
      "E-mail",
    ])
      expect(entidade(c)).toBe("cliente");
    for (const c of [
      "Número",
      "Adverso",
      "Tipo de Ação",
      "Categoria",
      "Distribuído em",
      "Situação",
      "Valor Estimado do Processo",
      "Pasta",
      "Captador",
      "Captado em",
      "Data inicio contrato",
      "Indicação",
    ])
      expect(entidade(c)).toBe("registro");
  });

  test("reconhece cabeçalhos com diferenças de espaço, caixa e separadores", () => {
    const m = mapearCabecalhos([
      " número ",
      "RECLAMANTE",
      "tipo  de ação",
      "CPF/CNPJ",
      "cpf_reclamante",
      "%honorário",
      "Valor-Captação",
    ]);
    expect([...m.campos.values()]).toEqual([
      "numero",
      "nome",
      "tipo_acao",
      "cpf_cnpj",
      "cpf_reclamante",
      "perc_honorario",
      "valor_captacao",
    ]);
  });

  test("colunas do modelo anterior continuam reconhecidas (legado) e não contam como ausentes", () => {
    const m = mapearCabecalhos(["Reclamante", "Comarca", "UF Comarca", "Comarca"]);
    expect(m.ausentes).not.toContain("comarca");
    expect(m.ausentes).toContain("cidade");
    expect(m.campos.get(1)).toBe("comarca");
    expect(m.campos.get(3)).toBe("comarca_x");
  });

  test("cabeçalho desconhecido vai para Informações adicionais", () => {
    const m = mapearCabecalhos(["Reclamante", "Principal", "Observação interna"]);
    expect([...m.extras.values()]).toEqual(["Principal", "Observação interna"]);
  });
});

describe("leitura", () => {
  test("planilha só com Reclamante é importada", () => {
    const p = lerPlanilha(planilha([["Reclamante"], ["Maria da Silva"], [""], ["João Souza"]]));
    expect(p.vazias).toBe(1);
    const r = interpretarLinhas(p);
    expect(r.validas.map((l) => l.nome)).toEqual(["Maria da Silva", "João Souza"]);
    expect(r.pendentes).toEqual([]);
    expect(r.validas[0]!.cpf).toBeNull();
    expect(r.validas[0]!.chave.startsWith("fp|")).toBe(true);
  });

  test("linha com dados mas sem Reclamante fica pendente e pode ser corrigida", () => {
    const p = lerPlanilha(
      planilha([
        ["Número", "Reclamante", "Pasta"],
        ["123", "", "PRV.1"],
        ["456", "Ana", "PRV.2"],
      ]),
    );
    let r = interpretarLinhas(p);
    expect(r.pendentes).toHaveLength(1);
    expect(r.pendentes[0]!.linha).toBe(2);
    r = interpretarLinhas(p, { nomesCorrigidos: new Map([[2, "Carlos"]]) });
    expect(r.pendentes).toHaveLength(0);
    expect(r.validas.map((l) => l.chave)).toEqual(["pasta:PRV.1", "pasta:PRV.2"]);
  });

  test("preserva textos, zeros, vazios e separa cliente/registro", () => {
    const p = lerPlanilha(
      planilha([
        [
          "Número",
          "Reclamante",
          "Valor",
          "Valor Captação",
          "Salário",
          "% Honorário",
          "Requisição",
          "Situação",
          "Celular",
          "CPF Reclamante",
          "CEP",
          "Captado em",
          "Distribuído em",
        ],
        [
          "0012345-67.2024.8.21.0001",
          "Ana",
          0,
          null,
          1500.5,
          30,
          "Sem registro",
          "Encerrado",
          "51 99999-0000 esposa",
          "012.345.678-90",
          "01001-000",
          "05/06/2024 - 09:43:01",
          "14/10/2024",
        ],
      ]),
    );
    const l = interpretarLinhas(p).validas[0]!;
    expect(l.registro.numero).toBe("0012345-67.2024.8.21.0001");
    expect(l.registro.valor).toBe("0");
    expect(l.registro.valor_captacao).toBeUndefined();
    expect(l.cliente.salario).toBe("1500.5");
    expect(l.registro.perc_honorario).toBe("30");
    expect(l.registro.requisicao).toBe("Sem registro");
    expect(l.registro.situacao).toBe("Encerrado");
    expect(l.cliente.celular).toBe("51 99999-0000 esposa");
    expect(l.cpf).toBe("012.345.678-90");
    expect(l.cliente.cep).toBe("01001-000");
    expect(l.registro.captado_em).toBe("2024-06-05T09:43:01");
    expect(l.registro.distribuido_em).toBe("2024-10-14");
  });

  test("datas e percentuais nativos do Excel", () => {
    const p = lerPlanilha(
      planilha(
        [
          ["Reclamante", "Captado em", "% Honorário", "Data de nascimento cliente"],
          ["Ana", 45448.40487268519, 0.3, 30000],
        ],
        (ws) => {
          ws["B2"]!.z = "dd/mm/yyyy - hh:mm:ss";
          ws["C2"]!.z = "0%";
          ws["D2"]!.z = "mm-dd-yy";
        },
      ),
    );
    const l = interpretarLinhas(p).validas[0]!;
    expect(l.registro.captado_em).toBe("2024-06-05T09:43:01");
    expect(l.registro.perc_honorario).toBe("30");
    expect(l.cliente.data_nascimento).toBe("1982-02-18");
  });

  test("avisos em campos opcionais não bloqueiam a linha", () => {
    const p = lerPlanilha(
      planilha([
        ["Reclamante", "CPF Reclamante", "Celular", "Data de nascimento cliente", "UF Comarca"],
        ["Ana", "111.222.333-44", "9999", "31/02/2020", "Ajustar"],
      ]),
    );
    const r = interpretarLinhas(p);
    expect(r.validas).toHaveLength(1);
    expect(r.avisos).toHaveLength(4);
    expect(r.validas[0]!.cpf_valido).toBe(false);
    expect(r.validas[0]!.cliente.data_nascimento).toBe("31/02/2020");
    expect(r.validas[0]!.registro.uf_comarca).toBe("Ajustar");
  });

  test("coluna adicional pode ser mapeada para um campo ausente", () => {
    const p = lerPlanilha(
      planilha([
        ["Reclamante", "Fone"],
        ["Ana", "51 98888-7777"],
      ]),
    );
    expect(interpretarLinhas(p).validas[0]!.extras).toEqual({ Fone: "51 98888-7777" });
    const r = interpretarLinhas(p, { extras: new Map([[1, "celular"]]) });
    expect(r.validas[0]!.cliente.celular).toBe("51 98888-7777");
    expect(r.validas[0]!.extras).toEqual({});
  });

  test("CPF numérico recupera zeros à esquerda", () => {
    const c = converterCelula("cpf_reclamante", { t: "n", v: 12345678909 });
    expect(c.valor).toBe("12345678909");
    const d = converterCelula("cpf_reclamante", { t: "n", v: 1234567890 });
    expect(d.valor).toBe("01234567890");
  });
});

describe("valores", () => {
  test("validação de CPF", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("111.111.111-11")).toBe(false);
  });

  test("exibição no padrão brasileiro", () => {
    expect(formatarValor("valor", "1234.5").replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(formatarValor("valor", "0").replace(/\s/g, " ")).toBe("R$ 0,00");
    expect(formatarValor("valor", null)).toBe("Não informado");
    expect(formatarValor("captado_em", "2024-06-05T09:43:01")).toBe("05/06/2024 09:43:01");
    expect(formatarValor("distribuido_em", "2024-10-14")).toBe("14/10/2024");
    expect(formatarValor("perc_honorario", "30")).toBe("30%");
    expect(formatarValor("uf_comarca", "Rio Grande do Sul")).toBe("Rio Grande do Sul (RS)");
  });

  test("UF e telefones", () => {
    expect(siglaUF("São Paulo")).toBe("SP");
    expect(siglaUF("rs")).toBe("RS");
    expect(siglaUF("Ajustar")).toBeNull();
    expect(extrairTelefones("(51) 99999-0000 esposa / 51 3333-4444")).toEqual([
      "51999990000",
      "5133334444",
    ]);
  });

  test("texto digitado no perfil usa as mesmas regras", () => {
    expect(converterTextoDigitado("valor", "1.234,56").valor).toBe("1234.56");
    expect(converterTextoDigitado("distribuido_em", "14/10/2024").valor).toBe("2024-10-14");
  });
});

describe("resumo da prévia", () => {
  test("conta clientes distintos e não confunde linha repetida com pagamento", () => {
    const base = {
      complementos: [],
      conflitos: [],
      duplicidades: [],
      revisao: null,
      atendimento_id: null,
      nome: "x",
    };
    const linhas: ResultadoLinha[] = [
      { ...base, linha: 2, cliente: "novo", cliente_id: "a", registro: "novo" },
      { ...base, linha: 3, cliente: "mesmo_arquivo", cliente_id: "a", registro: "novo" },
      { ...base, linha: 4, cliente: "existente", cliente_id: "b", registro: "agrupado" },
      { ...base, linha: 5, cliente: "repetida", cliente_id: "b", registro: "repetida" },
    ];
    const r = resumir(linhas, { totalLinhas: 4, linhasVazias: 0, avisos: 0, pendentes: 0 });
    expect(r.clientesNovos).toBe(1);
    expect(r.clientesExistentes).toBe(1);
    expect(r.registrosNovos).toBe(2);
    expect(r.registrosAgrupados).toBe(1);
    expect(r.linhasRepetidas).toBe(1);
  });
});

describe("modelo vazio para download", () => {
  test("tem exatamente os 22 cabeçalhos oficiais", async () => {
    expect(ARQUIVO_MODELO).toBe("/modelos/modelo-clientes-rf-espaider.xlsx");
    const dados = await Bun.file(`public${ARQUIVO_MODELO}`).arrayBuffer();
    const p = lerPlanilha(new Uint8Array(dados));
    expect(p.mapeamento.cabecalhos).toEqual(CABECALHOS_ESPAIDER);
    expect(p.mapeamento.campos.size).toBe(22);
    expect(p.mapeamento.extras.size).toBe(0);
    expect(p.mapeamento.ausentes).toEqual([]);
    expect(p.linhas).toHaveLength(0);
    expect(p.vazias).toBe(0);
  });
});

describe("planilha CLIENTES RF - ESPAIDER (dados fictícios no formato real)", () => {
  // Datas como no arquivo real: número serial do Excel com formato de data.
  const d = (a: number, m: number, dia: number, h = 0, mi = 0, se = 0) =>
    Date.UTC(a, m - 1, dia, h, mi, se) / 86400000 + 25569;
  const linha = (o: Partial<Record<string, unknown>>) =>
    CABECALHOS_ESPAIDER.map((c) => o[c] ?? null);
  const completa = {
    Número: "5000918-42.2024.4.03.6115",
    Reclamante: "Maria Exemplo",
    Adverso: "INSS",
    "Tipo de Ação": "Aposentadoria por Incapacidade Permanente",
    Celular: "16 99641-1648",
    Cidade: "São Paulo",
    "Distribuído em": d(2024, 6, 19),
    Categoria: "Previdenciário",
    Captador: "Ricardo Friedl",
    "Captado em": d(2024, 6, 5, 11, 3, 30),
    "Valor Estimado do Processo": 0,
    "Data inicio contrato": d(2024, 4, 30),
    Situação: "Encerrado",
    "Telefone Cliente": "16 3333-4444",
    "Telefone Residencial": "13 996084478 esposa Ana",
    "Data de nascimento cliente": d(1981, 3, 8),
    "E-mail": "maria@example.com",
    CPF: "529.982.247-25",
    Indicação: "Fulano",
    CEP: "64900-000",
    "CPF Reclamante": "529.982.247-25",
    Pasta: "PRV.01255",
  };
  const ler = (linhas: unknown[][]) =>
    interpretarLinhas(
      lerPlanilha(
        planilha([CABECALHOS_ESPAIDER, ...linhas], (ws) => {
          // Colunas de data: Distribuído em (G), Captado em (J), Data inicio contrato (L),
          // Data de nascimento cliente (P).
          for (const k of Object.keys(ws)) {
            const c = ws[k] as XLSX.CellObject;
            if (/^[GJLP]\d+$/.test(k) && k.slice(1) !== "1" && c?.t === "n")
              c.z = "dd/mm/yyyy hh:mm:ss";
          }
        }),
      ),
    );

  test("os 22 campos são persistidos no payload, no lugar certo e normalizados", () => {
    const r = ler([linha(completa)]);
    expect(r.pendentes).toEqual([]);
    const l = r.validas[0]!;
    expect(l.nome).toBe("Maria Exemplo");
    expect(l.cpf).toBe("529.982.247-25");
    expect(l.cpf_digitos).toBe("52998224725");
    expect(l.cpf_valido).toBe(true);
    expect(l.cliente).toEqual({
      celular: "16 99641-1648",
      cidade: "São Paulo",
      telefone_cliente: "16 3333-4444",
      telefone_residencial: "13 996084478 esposa Ana",
      data_nascimento: "1981-03-08",
      email: "maria@example.com",
      cpf_cnpj: "529.982.247-25",
      cep: "64900-000",
    });
    expect(l.registro).toEqual({
      numero: "5000918-42.2024.4.03.6115",
      adverso: "INSS",
      tipo_acao: "Aposentadoria por Incapacidade Permanente",
      distribuido_em: "2024-06-19",
      categoria: "Previdenciário",
      captador: "Ricardo Friedl",
      captado_em: "2024-06-05T11:03:30",
      valor_estimado: "0",
      data_inicio_contrato: "2024-04-30",
      situacao: "Encerrado",
      indicacao: "Fulano",
      pasta: "PRV.01255",
    });
    // 20 campos em cliente/registro + nome + CPF Reclamante (colunas próprias) = 22
    expect(Object.keys(l.cliente).length + Object.keys(l.registro).length + 2).toBe(22);
    expect(Object.keys(l.valores).length).toBe(22);
    expect(l.chave).toBe("pasta:PRV.01255");
    expect(l.numero_digitos).toBe("50009184220244036115");
  });

  test("Valor Estimado 0 é valor válido; texto monetário é interpretado; vazio fica vazio", () => {
    const r = ler([
      linha({ ...completa, Pasta: "A", "Valor Estimado do Processo": 0 }),
      linha({ ...completa, Pasta: "B", "Valor Estimado do Processo": "R$ 1.416.301,44" }),
      linha({ ...completa, Pasta: "C", "Valor Estimado do Processo": null }),
    ]);
    expect(r.validas.map((l) => l.registro.valor_estimado)).toEqual(["0", "1416301.44", undefined]);
    expect(formatarValor("valor_estimado", "0").replace(/\s/g, " ")).toBe("R$ 0,00");
  });

  test("campos opcionais vazios não bloqueiam a linha", () => {
    const r = ler([linha({ Reclamante: "Só Nome" })]);
    expect(r.pendentes).toEqual([]);
    expect(r.validas[0]!.cliente).toEqual({});
    expect(r.validas[0]!.registro).toEqual({});
  });

  test("CPF com ou sem pontuação gera a mesma identificação", () => {
    const r = ler([
      linha({ ...completa, Pasta: "A" }),
      linha({ ...completa, Pasta: "B", "CPF Reclamante": "52998224725", CPF: "52998224725" }),
    ]);
    expect(r.validas.map((l) => l.cpf_digitos)).toEqual(["52998224725", "52998224725"]);
  });

  test("sem CPF Reclamante, a coluna CPF identifica o cliente", () => {
    const r = ler([linha({ ...completa, "CPF Reclamante": null })]);
    expect(r.validas[0]!.cpf_digitos).toBe("52998224725");
    expect(r.validas[0]!.cliente.cpf_cnpj).toBe("529.982.247-25");
  });

  test("mesmo cliente com processos diferentes: mesma identificação, registros distintos", () => {
    const r = ler([
      linha({ ...completa, Pasta: "PRV.1" }),
      linha({
        ...completa,
        Pasta: "PRV.2",
        Número: "0802170-31.2025.8.18.0042",
        "Tipo de Ação": "Auxílio Acidente",
      }),
      linha({ ...completa, Pasta: "PRV.3", Número: null, "Tipo de Ação": "BPC/LOAS" }),
    ]);
    const ls = r.validas;
    expect(new Set(ls.map((l) => l.cpf_digitos)).size).toBe(1); // uma pasta de cliente
    expect(new Set(ls.map((l) => `${l.numero_digitos}|${l.tipo_norm}`)).size).toBe(3); // 3 processos
    expect(new Set(ls.map((l) => l.chave)).size).toBe(3);
  });

  test("telefones diferentes são preservados lado a lado", () => {
    const l = ler([linha(completa)]).validas[0]!;
    expect([l.cliente.celular, l.cliente.telefone_cliente, l.cliente.telefone_residencial]).toEqual(
      ["16 99641-1648", "16 3333-4444", "13 996084478 esposa Ana"],
    );
  });
});
