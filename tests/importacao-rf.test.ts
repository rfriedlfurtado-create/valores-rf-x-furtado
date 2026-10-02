/**
 * Modelo de importação Ricardo Friedl (Espaider): leitura, mapeamento e
 * conversões. Rodar: bun test
 */
import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { CAMPOS_MODELO, mapearCabecalhos } from "@/lib/rf/campos";
import { interpretarLinhas, lerPlanilha } from "@/lib/rf/planilha";
import { resumir, type ResultadoLinha } from "@/lib/rf/dados";
import {
  converterCelula,
  converterTextoDigitado,
  cpfValido,
  extrairTelefones,
  formatarValor,
  siglaUF,
} from "@/lib/rf/valores";

function planilha(linhas: unknown[][], formatar?: (ws: XLSX.WorkSheet) => void): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(linhas);
  formatar?.(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Planilha1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("modelo", () => {
  test("29 campos distintos, Reclamante é o único obrigatório", () => {
    expect(CAMPOS_MODELO.length).toBe(29);
    expect(CAMPOS_MODELO.filter((c) => c.obrigatorio).map((c) => c.cabecalho)).toEqual([
      "Reclamante",
    ]);
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

  test("as duas colunas Comarca vão para campos distintos", () => {
    const m = mapearCabecalhos(["Reclamante", "Comarca", "UF Comarca", "Comarca"]);
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
  test("tem os 29 cabeçalhos reconhecidos, com as duas Comarcas", async () => {
    const dados = await Bun.file(
      "public/modelos/modelo-importacao-clientes-ricardo-friedl.xlsx",
    ).arrayBuffer();
    const p = lerPlanilha(new Uint8Array(dados));
    expect(p.mapeamento.campos.size).toBe(29);
    expect(p.mapeamento.extras.size).toBe(0);
    expect(p.mapeamento.ausentes).toEqual([]);
    expect(p.linhas).toHaveLength(0);
    expect(p.vazias).toBe(0);
  });
});
