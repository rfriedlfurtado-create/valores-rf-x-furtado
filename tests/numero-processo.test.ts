import { describe, expect, test } from "bun:test";

import {
  digitoVerificadorCNJ,
  ehNumeroCNJ,
  mascararCNJ,
  naturezaDoProcesso,
  normalizarNumeroProcesso,
} from "../src/lib/numeroProcesso";

const VALIDO = "5001234-30.2024.8.21.0001";

describe("número do processo", () => {
  test("DV CNJ (módulo 97)", () => {
    expect(digitoVerificadorCNJ("50012340020248210001")).toBe("30");
    expect(ehNumeroCNJ(VALIDO)).toBe(true);
    expect(ehNumeroCNJ("5001234-31.2024.8.21.0001")).toBe(false);
  });

  test("judicial: aceita só dígitos e formata no padrão CNJ", () => {
    expect(normalizarNumeroProcesso("judicial", "50012343020248210001")).toEqual({
      ok: true,
      valor: VALIDO,
    });
    expect(normalizarNumeroProcesso("judicial", ` ${VALIDO} `)).toEqual({
      ok: true,
      valor: VALIDO,
    });
  });

  test("judicial: rejeita tamanho, DV e letras", () => {
    expect(normalizarNumeroProcesso("judicial", "123").ok).toBe(false);
    expect(normalizarNumeroProcesso("judicial", "5001234-31.2024.8.21.0001").ok).toBe(false);
    expect(normalizarNumeroProcesso("judicial", "Proc 5001234-30.2024.8.21.0001").ok).toBe(false);
  });

  test("administrativo: protocolo livre com número", () => {
    expect(normalizarNumeroProcesso("administrativo", "  NB  123.456.789-0 ")).toEqual({
      ok: true,
      valor: "NB 123.456.789-0",
    });
    expect(normalizarNumeroProcesso("administrativo", "protocolo").ok).toBe(false);
  });

  test("vazio = sem número", () => {
    expect(normalizarNumeroProcesso("judicial", "  ")).toEqual({ ok: true, valor: null });
    expect(normalizarNumeroProcesso("administrativo", "")).toEqual({ ok: true, valor: null });
  });

  test("máscara durante a digitação", () => {
    expect(mascararCNJ("5001234")).toBe("5001234");
    expect(mascararCNJ("50012343")).toBe("5001234-3");
    expect(mascararCNJ("500123430202482100019999")).toBe(VALIDO);
  });

  test("natureza: gravada prevalece; sem ela, CNJ válido = judicial", () => {
    expect(naturezaDoProcesso("administrativo", VALIDO)).toBe("administrativo");
    expect(naturezaDoProcesso(null, VALIDO)).toBe("judicial");
    expect(naturezaDoProcesso(null, "12345")).toBeNull();
  });
});
