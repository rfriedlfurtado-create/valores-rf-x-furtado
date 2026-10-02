/**
 * Conversão e exibição dos valores do modelo Ricardo Friedl.
 *
 * Regras (preservação fiel):
 *  - CPF, CEP, telefones, processos e pastas são SEMPRE texto (zeros mantidos).
 *  - Vazio continua vazio (nunca vira zero); zero continua zero.
 *  - Textos como "Sem registro", "Ativo", "Encerrado" são mantidos.
 *  - Problemas em campos opcionais geram AVISO, nunca bloqueiam: o conteúdo
 *    original é guardado para correção posterior.
 *
 * Formato canônico gravado no banco (jsonb, sempre string):
 *  - data:      "AAAA-MM-DD"
 *  - datahora:  "AAAA-MM-DDTHH:MM:SS" (horário local da planilha, sem fuso)
 *  - moeda:     "1234.56"   (ponto decimal)
 *  - percentual:"30"        (30 = 30%)
 *  - demais:    texto original (aparado)
 * Quando não é possível interpretar, grava-se o texto original.
 */

import { formatBRL } from "@/lib/format";
import { normalizarTexto } from "@/lib/situacao";

import { CAMPO_POR_CHAVE, NAO_INFORMADO, type ChaveCampo, type TipoCampo } from "./campos";

/** Célula lida do Excel (subconjunto do objeto do SheetJS). */
export interface CelulaBruta {
  /** n = número, s = texto, b = booleano, d = data, e = erro, z = vazio */
  t: string;
  v?: unknown;
  /** Texto formatado como o Excel exibe. */
  w?: string;
  /** Formato numérico da célula. */
  z?: string;
}

export interface ValorConvertido {
  /** Valor canônico (null = vazio). */
  valor: string | null;
  /** Texto original como estava na planilha (null = vazio). */
  original: string | null;
  avisos: string[];
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function somenteDigitos(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\D/g, "");
}

function numeroParaTexto(n: number): string {
  return String(Number(n.toFixed(6)));
}

const pad = (n: number, t = 2) => String(n).padStart(t, "0");

/** Converte o número serial do Excel (sistema 1900) em data/hora local, sem fuso. */
export function serialExcelParaPartes(serial: number) {
  const dias = Math.floor(serial);
  const fracao = serial - dias;
  // 25569 = dias entre 1899-12-30 e 1970-01-01
  const base = Date.UTC(1899, 11, 30) + dias * 86400000;
  const d = new Date(base);
  let segundos = Math.round(fracao * 86400);
  if (segundos >= 86400) segundos = 86399;
  return {
    ano: d.getUTCFullYear(),
    mes: d.getUTCMonth() + 1,
    dia: d.getUTCDate(),
    hora: Math.floor(segundos / 3600),
    minuto: Math.floor((segundos % 3600) / 60),
    segundo: segundos % 60,
  };
}

function dataValida(a: number, m: number, d: number): boolean {
  if (a < 1900 || a > 2200 || m < 1 || m > 12 || d < 1) return false;
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return d <= ultimo;
}

/** Interpreta data em texto: dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa, dd/mm/aa, aaaa-mm-dd (+ hora opcional). */
export function interpretarDataTexto(texto: string): { iso: string; hora: string | null } | null {
  const t = texto.trim();
  let m = t.match(
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s*(?:-|às|as|,)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i,
  );
  let ano: number, mes: number, dia: number;
  let hh: string | undefined, mm: string | undefined, ss: string | undefined;
  if (m) {
    dia = Number(m[1]);
    mes = Number(m[2]);
    ano = Number(m[3]);
    if (m[3]!.length === 2) ano += ano > 50 ? 1900 : 2000;
    [hh, mm, ss] = [m[4], m[5], m[6]];
  } else {
    m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return null;
    ano = Number(m[1]);
    mes = Number(m[2]);
    dia = Number(m[3]);
    [hh, mm, ss] = [m[4], m[5], m[6]];
  }
  if (!dataValida(ano, mes, dia)) return null;
  const iso = `${ano}-${pad(mes)}-${pad(dia)}`;
  if (hh === undefined) return { iso, hora: null };
  const h = Number(hh),
    mi = Number(mm),
    s = Number(ss ?? 0);
  if (h > 23 || mi > 59 || s > 59) return null;
  return { iso, hora: `${pad(h)}:${pad(mi)}:${pad(s)}` };
}

/** "R$ 1.234,56" | "1234.56" | "1.234" | "-10,5" → número; null se não for valor. */
export function interpretarNumeroTexto(texto: string): number | null {
  let t = texto
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");
  if (!t) return null;
  if (!/^-?[\d.,]+$/.test(t)) return null;
  const temVirgula = t.includes(",");
  const temPonto = t.includes(".");
  if (temVirgula && temPonto) {
    // O último separador é o decimal.
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if (temVirgula) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (temPonto) {
    // "1.234" (milhar) vs "12.5" (decimal): 3 dígitos após cada ponto = milhar.
    if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function cpfValido(cpf: string | null | undefined): boolean {
  const d = somenteDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (fim: number) => {
    let soma = 0;
    for (let i = 0; i < fim; i++) soma += Number(d[i]) * (fim + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function cnpjValido(cnpj: string | null | undefined): boolean {
  const d = somenteDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (tam: number) => {
    const pesos =
      tam === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(d[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export const UF_POR_NOME: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};
const SIGLAS_UF = new Set(Object.values(UF_POR_NOME));

/** Sigla da UF a partir do valor recebido (o valor original é sempre preservado). */
export function siglaUF(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const t = valor.trim();
  if (SIGLAS_UF.has(t.toUpperCase())) return t.toUpperCase();
  return UF_POR_NOME[normalizarTexto(t)] ?? null;
}

/** Números de telefone contidos no texto (o texto original é preservado). */
export function extrairTelefones(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const encontrados = texto.match(/\+?\d[\d\s().-]{6,}\d/g) ?? [];
  return encontrados
    .map((t) => somenteDigitos(t))
    .filter((d) => d.length >= 8)
    .map((d) => (d.length > 11 && d.startsWith("55") ? d.slice(2) : d));
}

// ---------------------------------------------------------------------------
// Conversão de célula
// ---------------------------------------------------------------------------

function textoDaCelula(c: CelulaBruta): string | null {
  if (c.t === "z" || c.v === undefined || c.v === null) return null;
  if (c.t === "s") {
    const s = String(c.v);
    return s.trim() === "" ? null : s;
  }
  if (c.t === "b") return c.v ? "Sim" : "Não";
  if (c.t === "e") return c.w ?? "#ERRO";
  if (c.t === "n") return c.w ?? numeroParaTexto(c.v as number);
  return c.w ?? String(c.v);
}

function formatoEhData(z: string | undefined): boolean {
  if (!z) return false;
  const limpo = z
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[dmyhs]/i.test(limpo) && !/^[#0.,%\s]+$/.test(limpo);
}

/**
 * Converte uma célula para o campo indicado. Nunca lança erro: problemas
 * viram avisos e o texto original é preservado.
 */
export function converterCelula(
  chave: ChaveCampo,
  celula: CelulaBruta | undefined,
): ValorConvertido {
  const tipo: TipoCampo = CAMPO_POR_CHAVE.get(chave)?.tipo ?? "texto";
  if (!celula) return { valor: null, original: null, avisos: [] };
  const original = textoDaCelula(celula);
  if (original === null) return { valor: null, original: null, avisos: [] };
  const avisos: string[] = [];
  const rotulo = CAMPO_POR_CHAVE.get(chave)?.cabecalho ?? chave;
  const numerico = celula.t === "n" && typeof celula.v === "number";

  switch (tipo) {
    case "nome":
    case "texto":
    case "uf": {
      const valor = original.trim();
      if (tipo === "uf" && !siglaUF(valor))
        avisos.push(`${rotulo}: "${valor}" não é uma UF reconhecida (valor mantido).`);
      return { valor, original, avisos };
    }
    case "processo":
    case "pasta": {
      const valor = numerico && !celula.w ? (celula.v as number).toFixed(0) : original.trim();
      return { valor, original, avisos };
    }
    case "documento": {
      let valor = original.trim();
      if (numerico) {
        const d = (celula.v as number).toFixed(0);
        valor = d.length <= 11 ? d.padStart(11, "0") : d.padStart(14, "0");
        if (valor !== d)
          avisos.push(
            `${rotulo}: estava em formato numérico; zeros à esquerda restaurados (${valor}).`,
          );
      }
      const d = somenteDigitos(valor);
      if (d.length === 11) {
        if (!cpfValido(d)) avisos.push(`${rotulo}: CPF "${valor}" inválido (valor mantido).`);
      } else if (d.length === 14) {
        if (!cnpjValido(d)) avisos.push(`${rotulo}: CNPJ "${valor}" inválido (valor mantido).`);
      } else {
        avisos.push(
          `${rotulo}: "${valor}" não tem 11 (CPF) nem 14 (CNPJ) dígitos (valor mantido).`,
        );
      }
      return { valor, original, avisos };
    }
    case "cep": {
      let valor = original.trim();
      if (numerico) {
        const d = (celula.v as number).toFixed(0);
        valor = d.padStart(8, "0");
      }
      if (somenteDigitos(valor).length !== 8)
        avisos.push(`${rotulo}: "${valor}" não tem 8 dígitos (valor mantido).`);
      return { valor, original, avisos };
    }
    case "telefone": {
      const valor = numerico ? (celula.v as number).toFixed(0) : original.trim();
      const numeros = extrairTelefones(valor);
      if (numeros.length === 0 || numeros.every((n) => n.length < 10))
        avisos.push(`${rotulo}: "${valor}" parece incompleto (sem DDD ou com poucos dígitos).`);
      return { valor, original, avisos };
    }
    case "email": {
      const valor = original.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor))
        avisos.push(`${rotulo}: "${valor}" não parece um e-mail válido (valor mantido).`);
      return { valor, original, avisos };
    }
    case "data":
    case "datahora": {
      if (numerico) {
        const serial = celula.v as number;
        if (serial > 0 && serial < 109575) {
          const p = serialExcelParaPartes(serial);
          const iso = `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`;
          const valor =
            tipo === "datahora" ? `${iso}T${pad(p.hora)}:${pad(p.minuto)}:${pad(p.segundo)}` : iso;
          if (!formatoEhData(celula.z) && celula.z && celula.z !== "General")
            avisos.push(
              `${rotulo}: número ${original} interpretado como data (${formatarValor(chave, valor)}).`,
            );
          return { valor, original: formatarValor(chave, valor), avisos };
        }
        avisos.push(`${rotulo}: "${original}" não é uma data reconhecida (valor mantido).`);
        return { valor: original.trim(), original, avisos };
      }
      const r = interpretarDataTexto(original);
      if (!r) {
        avisos.push(`${rotulo}: "${original.trim()}" não é uma data reconhecida (valor mantido).`);
        return { valor: original.trim(), original, avisos };
      }
      const valor = tipo === "datahora" && r.hora ? `${r.iso}T${r.hora}` : r.iso;
      return { valor, original, avisos };
    }
    case "moeda": {
      if (numerico) return { valor: numeroParaTexto(celula.v as number), original, avisos };
      const n = interpretarNumeroTexto(original);
      if (n === null) {
        avisos.push(`${rotulo}: "${original.trim()}" não é um valor numérico (texto mantido).`);
        return { valor: original.trim(), original, avisos };
      }
      return { valor: numeroParaTexto(n), original, avisos };
    }
    case "percentual": {
      if (numerico) {
        const v = celula.v as number;
        // Formato percentual nativo do Excel guarda 0,3 para 30%.
        const ehPercentNativo = (celula.z ?? "").includes("%");
        return { valor: numeroParaTexto(ehPercentNativo ? v * 100 : v), original, avisos };
      }
      const n = interpretarNumeroTexto(original.replace("%", ""));
      if (n === null) {
        avisos.push(
          `${rotulo}: "${original.trim()}" não é um percentual reconhecido (texto mantido).`,
        );
        return { valor: original.trim(), original, avisos };
      }
      return { valor: numeroParaTexto(n), original, avisos };
    }
  }
}

/** Converte um texto digitado no perfil (mesmas regras da importação). */
export function converterTextoDigitado(chave: ChaveCampo, texto: string): ValorConvertido {
  return converterCelula(chave, { t: "s", v: texto });
}

// ---------------------------------------------------------------------------
// Exibição
// ---------------------------------------------------------------------------

const ISO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATAHORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const NUMERO = /^-?\d+(\.\d+)?$/;

/** Valor formatado no padrão brasileiro; vazio → "Não informado". */
export function formatarValor(
  chave: ChaveCampo | string,
  valor: string | null | undefined,
): string {
  if (valor === null || valor === undefined || String(valor).trim() === "") return NAO_INFORMADO;
  const v = String(valor);
  const tipo = CAMPO_POR_CHAVE.get(chave as ChaveCampo)?.tipo ?? "texto";
  if (tipo === "data" || tipo === "datahora") {
    let m = v.match(ISO_DATAHORA);
    if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6] ?? "00"}`;
    m = v.match(ISO_DATA);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return v;
  }
  if (tipo === "moeda") return NUMERO.test(v) ? formatBRL(Number(v)) : v;
  if (tipo === "percentual") {
    if (!NUMERO.test(v)) return v;
    return `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%`;
  }
  if (tipo === "uf") {
    const sigla = siglaUF(v);
    return sigla && sigla !== v.trim().toUpperCase() ? `${v} (${sigla})` : v;
  }
  return v;
}

/** O valor gravado é interpretável no tipo do campo? (false = texto preservado com aviso). */
export function valorInterpretado(chave: ChaveCampo, valor: string | null | undefined): boolean {
  if (!valor) return true;
  const tipo = CAMPO_POR_CHAVE.get(chave)?.tipo;
  if (tipo === "data") return ISO_DATA.test(valor);
  if (tipo === "datahora") return ISO_DATAHORA.test(valor) || ISO_DATA.test(valor);
  if (tipo === "moeda" || tipo === "percentual") return NUMERO.test(valor);
  return true;
}

/** Valor para preencher o campo de edição (formato brasileiro simples). */
export function valorParaEdicao(chave: ChaveCampo, valor: string | null | undefined): string {
  if (!valor) return "";
  const tipo = CAMPO_POR_CHAVE.get(chave)?.tipo;
  if (tipo === "data" || tipo === "datahora") {
    const f = formatarValor(chave, valor);
    return f === NAO_INFORMADO ? "" : f;
  }
  if ((tipo === "moeda" || tipo === "percentual") && NUMERO.test(valor))
    return Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 6 });
  return valor;
}
