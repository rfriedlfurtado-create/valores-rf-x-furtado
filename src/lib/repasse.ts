/**
 * REPASSE RICARDO FRIEDL — FONTE ÚNICA DA REGRA (frontend).
 *
 *   valor efetivamente recebido pelo Furtado (uma linha de `pagamentos`)
 *        │
 *        ▼
 *   REGRA ÚNICA  ── percentual = 5 % (não varia por tipo de ação, requerimento,
 *        │          cliente, processo, valor ou categoria)
 *        ▼
 *   repasse da entrada (centavos inteiros, arredondamento meio-para-cima)
 *        │
 *        ├── cliente (soma dos repasses das entradas)
 *        ├── processo (sem misturar processos)
 *        ├── categoria (Contratual / Atrasados / Sucumbência)
 *        └── Dashboard, JÁ PAGOS, Relatórios, filtros
 *
 * O banco tem a MESMA regra (tabela `regras_repasse`, função `repasse_de`, view
 * `vw_repasse_pagamentos`, migração 20261009180000_repasse_ricardo_friedl.sql).
 * O teste `tests/repasse.test.ts` garante que o percentual e a versão daqui são
 * os mesmos gravados na migração, e que o arredondamento é igual ao `round()` do
 * Postgres. Nenhum componente calcula 5 % por conta própria: todos usam este
 * módulo.
 *
 * Precisão: toda conta é feita em CENTAVOS INTEIROS (sem ponto flutuante nas
 * somas). O repasse é calculado por entrada e arredondado UMA vez (2 casas,
 * meio centavo para cima — igual ao `round(numeric, 2)` do Postgres). Os
 * totais são a soma dos repasses individuais — nunca 5 % aplicado de novo sobre
 * o total (sem dupla incidência).
 *
 * Módulo puro (sem imports de runtime do app) para poder ser testado isoladamente.
 */

import type { ClassificacaoEntrada } from "./tipos";

/** Regra oficial vigente. Alterar aqui exige nova versão também no banco. */
export const REGRA_REPASSE = {
  versao: 1,
  /** Percentual em pontos percentuais (5 = 5 %). */
  percentual: 5,
  rotulo: "5%",
  beneficiario: "Ricardo Friedl",
} as const;

export type GrupoRepasse = ClassificacaoEntrada | "sem_classificacao";

/** Ordem de exibição (mesma do restante do sistema). */
export const GRUPOS_REPASSE: GrupoRepasse[] = [
  "implantacao",
  "atrasados",
  "sucumbencia",
  "sem_classificacao",
];

/** Rótulos em caixa alta usados nas seções de repasse. */
export const ROTULO_GRUPO_REPASSE: Record<GrupoRepasse, string> = {
  implantacao: "CONTRATUAL",
  atrasados: "ATRASADOS",
  sucumbencia: "SUCUMBÊNCIA",
  sem_classificacao: "SEM CATEGORIA",
};

/** Entrada mínima para o cálculo (uma linha de `pagamentos`). */
export interface EntradaRepasse {
  valor: number | string;
  classificacao?: ClassificacaoEntrada | string | null;
  /** 'cliente' = valor pago diretamente ao cliente: NÃO foi recebido pelo Furtado. */
  destinatario?: string | null;
  atendimento_id?: string | null;
}

// ---------------------------------------------------------------------------
// Aritmética monetária (centavos inteiros)
// ---------------------------------------------------------------------------

/**
 * Converte um valor monetário (número ou texto do banco, ex. "1234.56") em
 * centavos inteiros, sem erro de ponto flutuante.
 */
export function paraCentavos(valor: number | string | null | undefined): number {
  if (valor === null || valor === undefined || valor === "") return 0;
  if (typeof valor === "string") {
    const t = valor.trim();
    const m = /^(-)?(\d+)(?:\.(\d{0,}))?$/.exec(t);
    if (m) {
      const frac = (m[3] ?? "").padEnd(3, "0");
      // 2 casas + 1 de arredondamento (o banco guarda numeric(14,2): já vem exato).
      let c = Number(m[2]) * 100 + Number(frac.slice(0, 2));
      if (Number(frac[2]) >= 5) c += 1;
      return m[1] ? -c : c;
    }
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  if (!Number.isFinite(valor)) return 0;
  // Correção do erro binário (ex.: 1.005 * 100 = 100.49999…): arredonda em 1e-6.
  return Math.round(Number((valor * 100).toFixed(6)));
}

export function deCentavos(centavos: number): number {
  return centavos / 100;
}

/**
 * Aplica um percentual a um valor em centavos, arredondando para o centavo
 * mais próximo (meio centavo afastado do zero — mesmo critério do `round()`
 * do Postgres). Aritmética inteira: percentual em centésimos de ponto.
 */
export function aplicarPercentualCentavos(centavos: number, percentual: number): number {
  const pctCentesimos = Math.round(percentual * 100); // 5 % → 500
  const produto = Math.abs(centavos) * pctCentesimos; // inteiro exato
  const q = Math.floor((produto + 5000) / 10000); // ÷ (100 × 100), meio para cima
  return centavos < 0 ? -q : q;
}

// ---------------------------------------------------------------------------
// Regra por entrada
// ---------------------------------------------------------------------------

export type MotivoInelegivel = "pago_ao_cliente" | "sem_valor";

/**
 * Entrada elegível = valor EFETIVAMENTE RECEBIDO pelo Furtado: valor positivo
 * e não pago diretamente ao cliente. Valores previstos, estimados, valor da
 * causa ou pendentes nunca chegam aqui (ficam em outras tabelas).
 */
export function motivoInelegivel(e: EntradaRepasse): MotivoInelegivel | null {
  if (e.destinatario === "cliente") return "pago_ao_cliente";
  if (paraCentavos(e.valor) <= 0) return "sem_valor";
  return null;
}

export function entradaElegivel(e: EntradaRepasse): boolean {
  return motivoInelegivel(e) === null;
}

/** Repasse (em centavos) de UMA entrada. Inelegível = 0. */
export function repasseCentavos(e: EntradaRepasse): number {
  if (!entradaElegivel(e)) return 0;
  return aplicarPercentualCentavos(paraCentavos(e.valor), REGRA_REPASSE.percentual);
}

/**
 * Parte do escritório (em centavos) de UMA entrada: valor recebido − repasse.
 * Nunca 95 % calculado à parte — assim recebido = escritório + repasse, sempre.
 */
export function escritorioCentavos(e: EntradaRepasse): number {
  if (!entradaElegivel(e)) return 0;
  return paraCentavos(e.valor) - repasseCentavos(e);
}

/** Repasse (em reais) de UMA entrada. */
export function repasseDaEntrada(e: EntradaRepasse): number {
  return deCentavos(repasseCentavos(e));
}

/** Repasse (em reais) de um valor avulso já elegível (ex.: pré-visualização). */
export function repasseDoValor(valor: number | string): number {
  const c = paraCentavos(valor);
  return c > 0 ? deCentavos(aplicarPercentualCentavos(c, REGRA_REPASSE.percentual)) : 0;
}

// ---------------------------------------------------------------------------
// Resumos (cliente, processo, categoria, geral) — sempre soma de entradas
// ---------------------------------------------------------------------------

export interface TotaisRepasse {
  /** Entradas elegíveis consideradas. */
  quantidade: number;
  /** Soma dos valores efetivamente recebidos elegíveis (R$). */
  recebido: number;
  /** Soma dos repasses individuais (R$). */
  repasse: number;
  /** Honorários do escritório = recebido − repasse (R$). Recebido = escritório + repasse, sempre. */
  escritorio: number;
}

export interface ResumoRepasse extends TotaisRepasse {
  percentual: number;
  versaoRegra: number;
  porCategoria: Record<GrupoRepasse, TotaisRepasse>;
  /** Entradas fora do cálculo (pagas ao cliente / sem valor). */
  ignoradas: number;
}

function grupoDe(e: EntradaRepasse): GrupoRepasse {
  const c = e.classificacao;
  return c === "atrasados" || c === "implantacao" || c === "sucumbencia" ? c : "sem_classificacao";
}

/**
 * Resumo de um conjunto de entradas. O total de repasse é a SOMA dos repasses
 * individuais (cada entrada arredondada uma vez), nunca 5 % sobre o total.
 * A categoria só distribui os totais: não altera o percentual.
 */
export function resumirRepasse(entradas: readonly EntradaRepasse[]): ResumoRepasse {
  const acc = Object.fromEntries(
    GRUPOS_REPASSE.map((g) => [g, { quantidade: 0, recebido: 0, repasse: 0 }]),
  ) as Record<GrupoRepasse, { quantidade: number; recebido: number; repasse: number }>;
  let quantidade = 0;
  let recebido = 0;
  let repasse = 0;
  let ignoradas = 0;
  for (const e of entradas) {
    if (!entradaElegivel(e)) {
      ignoradas += 1;
      continue;
    }
    const v = paraCentavos(e.valor);
    const r = aplicarPercentualCentavos(v, REGRA_REPASSE.percentual);
    const g = acc[grupoDe(e)];
    g.quantidade += 1;
    g.recebido += v;
    g.repasse += r;
    quantidade += 1;
    recebido += v;
    repasse += r;
  }
  const porCategoria = Object.fromEntries(
    GRUPOS_REPASSE.map((g) => [
      g,
      {
        quantidade: acc[g].quantidade,
        recebido: deCentavos(acc[g].recebido),
        repasse: deCentavos(acc[g].repasse),
        escritorio: deCentavos(acc[g].recebido - acc[g].repasse),
      },
    ]),
  ) as Record<GrupoRepasse, TotaisRepasse>;
  return {
    quantidade,
    recebido: deCentavos(recebido),
    repasse: deCentavos(repasse),
    escritorio: deCentavos(recebido - repasse),
    percentual: REGRA_REPASSE.percentual,
    versaoRegra: REGRA_REPASSE.versao,
    porCategoria,
    ignoradas,
  };
}

/** Chave usada para entradas sem processo vinculado. */
export const SEM_PROCESSO_REPASSE = "__sem_processo__";

/**
 * Resumo por processo: cada processo tem os SEUS lançamentos (nunca mistura
 * processos). Entradas sem processo ficam em `SEM_PROCESSO_REPASSE`.
 */
export function repassePorProcesso(
  entradas: readonly EntradaRepasse[],
): Map<string, ResumoRepasse> {
  const grupos = new Map<string, EntradaRepasse[]>();
  for (const e of entradas) {
    const k = e.atendimento_id || SEM_PROCESSO_REPASSE;
    grupos.set(k, [...(grupos.get(k) ?? []), e]);
  }
  return new Map([...grupos].map(([k, lista]) => [k, resumirRepasse(lista)]));
}

/**
 * Filtro de período pela data do recebimento (AAAA-MM-DD, limites inclusivos;
 * vazio = sem limite). Mesmo critério no Dashboard e nos Relatórios.
 */
export function noPeriodo(
  dataPagamento: string | null | undefined,
  de?: string | null,
  ate?: string | null,
): boolean {
  const d = (dataPagamento ?? "").slice(0, 10);
  if (de && (!d || d < de)) return false;
  if (ate && (!d || d > ate)) return false;
  return true;
}

/** Frase padrão: "5% de R$ 20.000,00". */
export function descricaoRegra(): string {
  return `${REGRA_REPASSE.rotulo} de todo valor efetivamente recebido pelo Furtado (regra v${REGRA_REPASSE.versao})`;
}
