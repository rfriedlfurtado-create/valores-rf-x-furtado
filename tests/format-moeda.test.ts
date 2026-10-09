/**
 * Campo de valor (R$ 99.999,99): o usuário digita só números.
 * Rodar: bun test
 */
import { describe, expect, test } from "bun:test";

import {
  colarMoeda,
  completarCentavos,
  mascararMoeda,
  parseBRL,
  posicaoCursorMoeda,
  valorParaCampoMoeda,
} from "@/lib/format";

describe("máscara ao digitar", () => {
  test("pontos de milhar automáticos", () => {
    expect(mascararMoeda("9")).toBe("9");
    expect(mascararMoeda("9999")).toBe("9.999");
    expect(mascararMoeda("99999")).toBe("99.999");
    expect(mascararMoeda("1250000")).toBe("1.250.000");
  });
  test("vírgula separa os centavos (máximo 2)", () => {
    expect(mascararMoeda("99999,99")).toBe("99.999,99");
    expect(mascararMoeda("9.999,")).toBe("9.999,");
    expect(mascararMoeda("1250,505")).toBe("1.250,50");
    expect(mascararMoeda(",5")).toBe("0,5");
  });
  test("ponto digitado é ignorado e letras somem", () => {
    expect(mascararMoeda("1.2500")).toBe("12.500");
    expect(mascararMoeda("R$ 12a3")).toBe("123");
    expect(mascararMoeda("0012")).toBe("12");
  });
});

describe("ao sair do campo", () => {
  test("completa os centavos", () => {
    expect(completarCentavos("9.999")).toBe("9.999,00");
    expect(completarCentavos("99.999,9")).toBe("99.999,90");
    expect(completarCentavos("99.999,99")).toBe("99.999,99");
    expect(completarCentavos("")).toBe("");
  });
});

describe("conversão para número (gravação)", () => {
  test("parseBRL entende o texto do campo", () => {
    expect(parseBRL("99.999,99")).toBe(99999.99);
    expect(parseBRL("9.999,00")).toBe(9999);
    expect(parseBRL("9.999")).toBe(9999);
    expect(parseBRL("1.250.000,5")).toBe(1250000.5);
  });
  test("valor do banco abre formatado", () => {
    expect(valorParaCampoMoeda(1250)).toBe("1.250,00");
    expect(valorParaCampoMoeda("99999.99")).toBe("99.999,99");
    expect(valorParaCampoMoeda(null)).toBe("");
  });
});

describe("colar", () => {
  test("aceita formatos comuns", () => {
    expect(colarMoeda("R$ 1.250,00")).toBe("1.250,00");
    expect(colarMoeda("1250.5")).toBe("1.250,50");
    expect(colarMoeda("1,250.00")).toBe("1.250,00");
    expect(colarMoeda("1250")).toBe("1.250,00");
    expect(colarMoeda("1.250")).toBe("1.250,00");
  });
});

describe("cursor", () => {
  test("mantém a posição relativa aos dígitos", () => {
    // "1250|" → "1.250|"
    expect(posicaoCursorMoeda("1.250", 4, false)).toBe(5);
    // "1|250" → "1|.250"
    expect(posicaoCursorMoeda("1.250", 1, false)).toBe(1);
    // "1.250,|" (após a vírgula)
    expect(posicaoCursorMoeda("1.250,", 4, true)).toBe(6);
  });
});
