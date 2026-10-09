/**
 * RELATÓRIO DE HONORÁRIOS — Escritório × Ricardo Friedl.
 *
 * Fonte: a MESMA base agregada usada por Dashboard, perfil e JÁ PAGOS
 * (`agregarBase` → pagamentos efetivamente recebidos). Regra: o motor central
 * `repasse.ts` (Ricardo = 5 % de cada recebimento; escritório = recebido −
 * repasse). Este módulo só filtra, agrupa e soma CENTAVOS INTEIROS — não tem
 * regra financeira própria. Cards, tabelas, gráficos e exportações usam as
 * mesmas `LinhaHonorario` filtradas, então sempre fecham entre si.
 *
 * Valores estimados, valor da causa, previstos e pendentes não entram (não são
 * linhas de `pagamentos`); valores pagos diretamente ao cliente também não.
 *
 * Módulo puro (testado em tests/relatorio-honorarios.test.ts).
 */

import {
  deCentavos,
  entradaElegivel,
  GRUPOS_REPASSE,
  paraCentavos,
  REGRA_REPASSE,
  repasseCentavos,
  ROTULO_GRUPO_REPASSE,
  type GrupoRepasse,
} from "./repasse";
import type { ClienteComTotais, Pagamento } from "./tipos";

// ---------------------------------------------------------------------------
// Linhas (um recebimento elegível = uma linha)
// ---------------------------------------------------------------------------

export interface LinhaHonorario {
  pagamentoId: string;
  clienteId: string;
  clienteNome: string;
  clienteRF: boolean;
  /** null = valor sem processo vinculado. */
  processoId: string | null;
  processoNumero: string | null;
  processoTipo: string | null;
  /** AAAA-MM-DD */
  data: string;
  categoria: GrupoRepasse;
  recebidoC: number;
  ricardoC: number;
  escritorioC: number;
}

function grupo(c: string | null | undefined): GrupoRepasse {
  return c === "atrasados" || c === "implantacao" || c === "sucumbencia" ? c : "sem_classificacao";
}

/**
 * Monta as linhas a partir da base agregada (sem consulta nova, sem cópia de
 * cliente). `incluirCliente` aplica filtros de cadastro (ex.: escritório).
 */
export function montarLinhas(
  clientes: readonly ClienteComTotais[],
  pagamentosPorCliente: ReadonlyMap<string, readonly Pagamento[]>,
  incluirCliente: (c: ClienteComTotais) => boolean = () => true,
  /** Filtro por recebimento (ex.: escritório registrado no lançamento). Tem prioridade. */
  incluirPagamento?: (p: Pagamento, c: ClienteComTotais) => boolean | undefined,
): LinhaHonorario[] {
  const linhas: LinhaHonorario[] = [];
  for (const c of clientes) {
    if (c.deleted_at) continue;
    const clienteOk = incluirCliente(c);
    const processos = new Map(c.processos.map((p) => [p.id, p]));
    for (const p of pagamentosPorCliente.get(c.id) ?? []) {
      if (!entradaElegivel(p)) continue;
      if (!(incluirPagamento?.(p, c) ?? clienteOk)) continue;
      const proc = p.atendimento_id ? processos.get(p.atendimento_id) : undefined;
      const recebidoC = paraCentavos(p.valor);
      const ricardoC = repasseCentavos(p);
      linhas.push({
        pagamentoId: p.id,
        clienteId: c.id,
        clienteNome: c.nome,
        clienteRF: Boolean(c.cliente_rf),
        processoId: proc ? proc.id : null,
        processoNumero: proc ? proc.numero : null,
        processoTipo: proc ? proc.tipo_acao : null,
        data: (p.data_pagamento ?? "").slice(0, 10),
        categoria: grupo(p.classificacao),
        recebidoC,
        ricardoC,
        escritorioC: recebidoC - ricardoC,
      });
    }
  }
  linhas.sort(
    (a, b) =>
      b.data.localeCompare(a.data) ||
      a.clienteNome.localeCompare(b.clienteNome, "pt-BR") ||
      a.pagamentoId.localeCompare(b.pagamentoId),
  );
  return linhas;
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

export type PeriodoRapido =
  "tudo" | "hoje" | "este_mes" | "mes_anterior" | "este_ano" | "personalizado";

export const ROTULO_PERIODO: Record<PeriodoRapido, string> = {
  tudo: "Todo o período",
  hoje: "Hoje",
  este_mes: "Este mês",
  mes_anterior: "Mês anterior",
  este_ano: "Este ano",
  personalizado: "Período personalizado",
};

export interface FiltroRelatorio {
  periodo: PeriodoRapido;
  /** Usados quando periodo = "personalizado" (AAAA-MM-DD, inclusivos). */
  de?: string | null;
  ate?: string | null;
  /** Nome do cliente/Reclamante (parcial, sem acento). */
  cliente?: string;
  /** Número do processo (parcial; compara só dígitos quando houver). */
  processo?: string;
  /** Categorias incluídas (vazio = todas). */
  categorias?: readonly GrupoRepasse[];
}

export const FILTRO_PADRAO: FiltroRelatorio = { periodo: "tudo", categorias: [] };

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Intervalo (inclusivo) de um período rápido. null = sem limite. */
export function intervaloDoPeriodo(
  f: Pick<FiltroRelatorio, "periodo" | "de" | "ate">,
  hoje: Date = new Date(),
): { de: string | null; ate: string | null } {
  const y = hoje.getFullYear();
  const m = hoje.getMonth();
  switch (f.periodo) {
    case "hoje":
      return { de: iso(hoje), ate: iso(hoje) };
    case "este_mes":
      return { de: iso(new Date(y, m, 1)), ate: iso(new Date(y, m + 1, 0)) };
    case "mes_anterior":
      return { de: iso(new Date(y, m - 1, 1)), ate: iso(new Date(y, m, 0)) };
    case "este_ano":
      return { de: `${y}-01-01`, ate: `${y}-12-31` };
    case "personalizado":
      return { de: f.de || null, ate: f.ate || null };
    default:
      return { de: null, ate: null };
  }
}

export function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Aplica TODOS os filtros. Cards, gráficos, tabelas e exportação usam este resultado. */
export function filtrarLinhas(
  linhas: readonly LinhaHonorario[],
  f: FiltroRelatorio,
  hoje: Date = new Date(),
): LinhaHonorario[] {
  const { de, ate } = intervaloDoPeriodo(f, hoje);
  const cli = normalizar(f.cliente ?? "");
  const procTexto = (f.processo ?? "").trim();
  const procDig = procTexto.replace(/\D/g, "");
  const cats = new Set(f.categorias ?? []);
  return linhas.filter((l) => {
    if (de && l.data < de) return false;
    if (ate && l.data > ate) return false;
    if (cats.size && !cats.has(l.categoria)) return false;
    if (cli && !normalizar(l.clienteNome).includes(cli)) return false;
    if (procTexto) {
      const num = l.processoNumero ?? "";
      const ok = procDig
        ? num.replace(/\D/g, "").includes(procDig)
        : normalizar(num).includes(normalizar(procTexto));
      if (!ok) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Totais e agrupamentos (centavos inteiros → reais só na saída)
// ---------------------------------------------------------------------------

export interface Totais {
  quantidade: number;
  clientes: number;
  recebido: number;
  escritorio: number;
  ricardo: number;
}

export function totalizar(linhas: readonly LinhaHonorario[]): Totais {
  let r = 0;
  let e = 0;
  let k = 0;
  const clientes = new Set<string>();
  for (const l of linhas) {
    r += l.recebidoC;
    e += l.escritorioC;
    k += l.ricardoC;
    clientes.add(l.clienteId);
  }
  return {
    quantidade: linhas.length,
    clientes: clientes.size,
    recebido: deCentavos(r),
    escritorio: deCentavos(e),
    ricardo: deCentavos(k),
  };
}

export interface TotaisCategoria extends Totais {
  categoria: GrupoRepasse;
  rotulo: string;
}

/** Categorias oficiais sempre presentes; "sem categoria" só quando houver. */
export function porCategoria(linhas: readonly LinhaHonorario[]): TotaisCategoria[] {
  return GRUPOS_REPASSE.map((g) => {
    const doGrupo = linhas.filter((l) => l.categoria === g);
    return { categoria: g, rotulo: ROTULO_GRUPO_REPASSE[g], ...totalizar(doGrupo) };
  }).filter((t) => t.categoria !== "sem_classificacao" || t.quantidade > 0);
}

export interface ProcessoRelatorio {
  chave: string;
  processoId: string | null;
  numero: string | null;
  tipo: string | null;
  totais: Totais;
  categorias: TotaisCategoria[];
  linhas: LinhaHonorario[];
}

export interface ClienteRelatorio {
  clienteId: string;
  nome: string;
  totais: Totais;
  processos: ProcessoRelatorio[];
}

const SEM_PROCESSO = "__sem_processo__";

/** Cliente → processo (sem misturar processos) → categoria → linhas. */
export function porCliente(linhas: readonly LinhaHonorario[]): ClienteRelatorio[] {
  const clientes = new Map<string, LinhaHonorario[]>();
  for (const l of linhas) clientes.set(l.clienteId, [...(clientes.get(l.clienteId) ?? []), l]);
  return [...clientes.values()]
    .map((lista) => {
      const procs = new Map<string, LinhaHonorario[]>();
      for (const l of lista) {
        const k = l.processoId ?? SEM_PROCESSO;
        procs.set(k, [...(procs.get(k) ?? []), l]);
      }
      return {
        clienteId: lista[0]!.clienteId,
        nome: lista[0]!.clienteNome,
        totais: totalizar(lista),
        processos: [...procs.entries()]
          .map(([chave, ls]) => ({
            chave,
            processoId: ls[0]!.processoId,
            numero: ls[0]!.processoNumero,
            tipo: ls[0]!.processoTipo,
            totais: totalizar(ls),
            categorias: porCategoria(ls).filter((c) => c.quantidade > 0),
            linhas: ls,
          }))
          .sort((a, b) => (a.processoId === null ? 1 : b.processoId === null ? -1 : 0)),
      };
    })
    .sort((a, b) => b.totais.recebido - a.totais.recebido || a.nome.localeCompare(b.nome, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Séries para gráficos
// ---------------------------------------------------------------------------

export type Metrica = "recebido" | "escritorio" | "ricardo" | "quantidade" | "clientes";
export type Agrupamento = "mes" | "ano" | "categoria" | "cliente" | "processo";
export type TipoGrafico = "barras" | "linhas" | "rosca";

export const ROTULO_METRICA: Record<Metrica, string> = {
  recebido: "Total recebido",
  escritorio: "Honorários do escritório",
  ricardo: `Repasse Ricardo Friedl (${REGRA_REPASSE.rotulo})`,
  quantidade: "Quantidade de recebimentos",
  clientes: "Quantidade de clientes",
};
export const ROTULO_AGRUPAMENTO: Record<Agrupamento, string> = {
  mes: "Mês",
  ano: "Ano",
  categoria: "Categoria",
  cliente: "Cliente",
  processo: "Processo",
};
export const ROTULO_TIPO: Record<TipoGrafico, string> = {
  barras: "Barras",
  linhas: "Linhas",
  rosca: "Rosca",
};

export const METRICA_MONETARIA: Record<Metrica, boolean> = {
  recebido: true,
  escritorio: true,
  ricardo: true,
  quantidade: false,
  clientes: false,
};

export interface ConfigGrafico {
  id: string;
  titulo?: string;
  metrica: Metrica;
  agrupamento: Agrupamento;
  /** Restringe o gráfico a uma categoria (além dos filtros da página). */
  categoria: GrupoRepasse | "todas";
  tipo: TipoGrafico;
}

/**
 * Combinações que fazem sentido:
 *  - Linhas: só para tempo (mês/ano).
 *  - Rosca: só para partes de um todo — categoria, cliente ou processo — e
 *    nunca com "quantidade de clientes" (um cliente pode estar em várias
 *    fatias; a soma das fatias não seria o total).
 *  - Barras: sempre.
 */
export function tiposPermitidos(agr: Agrupamento, metrica: Metrica): TipoGrafico[] {
  const tipos: TipoGrafico[] = ["barras"];
  if (agr === "mes" || agr === "ano") tipos.push("linhas");
  else if (metrica !== "clientes") tipos.push("rosca");
  return tipos;
}

/** Corrige uma configuração incompatível (mantém o resto). */
export function normalizarConfig(c: ConfigGrafico): ConfigGrafico {
  const tipos = tiposPermitidos(c.agrupamento, c.metrica);
  return tipos.includes(c.tipo) ? c : { ...c, tipo: tipos[0]! };
}

export interface PontoSerie {
  chave: string;
  rotulo: string;
  recebido: number;
  escritorio: number;
  ricardo: number;
  quantidade: number;
  clientes: number;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function rotuloMes(chave: string): string {
  const [a, m] = chave.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${a}`;
}

function ponto(chave: string, rotulo: string, ls: readonly LinhaHonorario[]): PontoSerie {
  const t = totalizar(ls);
  return { chave, rotulo, ...t };
}

/** Meses entre dois AAAA-MM (inclusivo) — evolução sem buracos. */
function mesesEntre(ini: string, fim: string): string[] {
  const out: string[] = [];
  let [a, m] = ini.split("-").map(Number) as [number, number];
  const [af, mf] = fim.split("-").map(Number) as [number, number];
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
    if (out.length > 600) break;
  }
  return out;
}

/** Máximo de barras/fatias por cliente/processo; o restante vira "Outros". */
export const MAX_ITENS_GRAFICO = 10;

/**
 * Série agrupada. Usa só as linhas recebidas (já filtradas pela página);
 * a soma dos pontos (métricas monetárias e quantidade) é igual ao total.
 */
export function serie(
  linhas: readonly LinhaHonorario[],
  agr: Agrupamento,
  ordenarPor: Metrica = "recebido",
): PontoSerie[] {
  if (agr === "mes" || agr === "ano") {
    const tam = agr === "mes" ? 7 : 4;
    const grupos = new Map<string, LinhaHonorario[]>();
    for (const l of linhas) {
      const k = l.data.slice(0, tam);
      grupos.set(k, [...(grupos.get(k) ?? []), l]);
    }
    const chaves = [...grupos.keys()].sort();
    if (!chaves.length) return [];
    const todas =
      agr === "mes"
        ? mesesEntre(chaves[0]!, chaves[chaves.length - 1]!)
        : Array.from(
            { length: Number(chaves[chaves.length - 1]) - Number(chaves[0]) + 1 },
            (_, i) => String(Number(chaves[0]) + i),
          );
    return todas.map((k) => ponto(k, agr === "mes" ? rotuloMes(k) : k, grupos.get(k) ?? []));
  }
  if (agr === "categoria") {
    return porCategoria(linhas).map((c) =>
      ponto(
        c.categoria,
        c.rotulo,
        linhas.filter((l) => l.categoria === c.categoria),
      ),
    );
  }
  const chaveDe = (l: LinhaHonorario) =>
    agr === "cliente" ? l.clienteId : `${l.clienteId}|${l.processoId ?? SEM_PROCESSO}`;
  const rotuloDe = (l: LinhaHonorario) =>
    agr === "cliente" ? l.clienteNome : `${l.processoNumero || "Sem processo"} — ${l.clienteNome}`;
  const grupos = new Map<string, LinhaHonorario[]>();
  for (const l of linhas) grupos.set(chaveDe(l), [...(grupos.get(chaveDe(l)) ?? []), l]);
  const pontos = [...grupos.entries()]
    .map(([k, ls]) => ({ p: ponto(k, rotuloDe(ls[0]!), ls), ls }))
    .sort((a, b) => b.p[ordenarPor] - a.p[ordenarPor] || a.p.rotulo.localeCompare(b.p.rotulo));
  if (pontos.length <= MAX_ITENS_GRAFICO) return pontos.map((x) => x.p);
  const principais = pontos.slice(0, MAX_ITENS_GRAFICO - 1).map((x) => x.p);
  const resto = pontos.slice(MAX_ITENS_GRAFICO - 1).flatMap((x) => x.ls);
  return [
    ...principais,
    ponto("__outros__", `Outros (${pontos.length - principais.length})`, resto),
  ];
}

/** Dados de um gráfico personalizado: aplica a categoria da configuração e agrupa. */
export function dadosGrafico(
  linhas: readonly LinhaHonorario[],
  config: ConfigGrafico,
): { config: ConfigGrafico; pontos: PontoSerie[] } {
  const c = normalizarConfig(config);
  const base = c.categoria === "todas" ? linhas : linhas.filter((l) => l.categoria === c.categoria);
  return { config: c, pontos: serie(base, c.agrupamento, c.metrica) };
}

export function novoId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Lê configurações salvas, descartando o que não for válido (nunca dados financeiros). */
export function lerConfigs(valor: unknown): ConfigGrafico[] {
  const lista = (valor as { graficos?: unknown })?.graficos;
  if (!Array.isArray(lista)) return [];
  const metricas = Object.keys(ROTULO_METRICA);
  const agrs = Object.keys(ROTULO_AGRUPAMENTO);
  const tipos = Object.keys(ROTULO_TIPO);
  const cats = ["todas", ...GRUPOS_REPASSE];
  return lista
    .filter(
      (g): g is ConfigGrafico =>
        g &&
        typeof g.id === "string" &&
        metricas.includes(g.metrica) &&
        agrs.includes(g.agrupamento) &&
        tipos.includes(g.tipo) &&
        cats.includes(g.categoria),
    )
    .map((g) =>
      normalizarConfig({
        id: g.id,
        metrica: g.metrica,
        agrupamento: g.agrupamento,
        categoria: g.categoria,
        tipo: g.tipo,
        ...(typeof g.titulo === "string" && g.titulo.trim() ? { titulo: g.titulo.trim() } : {}),
      }),
    );
}

export function tituloGrafico(c: ConfigGrafico): string {
  if (c.titulo) return c.titulo;
  const cat = c.categoria === "todas" ? "" : ` · ${ROTULO_GRUPO_REPASSE[c.categoria]}`;
  return `${ROTULO_METRICA[c.metrica]} por ${ROTULO_AGRUPAMENTO[c.agrupamento].toLowerCase()}${cat}`;
}

// ---------------------------------------------------------------------------
// Exportação (mesmas linhas filtradas)
// ---------------------------------------------------------------------------

export function descricaoPeriodo(f: FiltroRelatorio, hoje: Date = new Date()): string {
  const { de, ate } = intervaloDoPeriodo(f, hoje);
  const br = (d: string) => d.split("-").reverse().join("/");
  if (!de && !ate) return "Todo o período";
  return `${de ? br(de) : "início"} a ${ate ? br(ate) : "hoje"}`;
}

export interface DocumentoRelatorio {
  titulo: string;
  periodo: string;
  filtros: string[];
  totais: Totais;
  percentual: number;
  categorias: TotaisCategoria[];
  detalhamento: {
    cliente: string;
    processo: string;
    data: string;
    categoria: string;
    recebido: number;
    escritorio: number;
    ricardo: number;
  }[];
}

/** Conteúdo exportado (Excel/PDF): derivado das MESMAS linhas exibidas. */
export function documentoRelatorio(
  linhas: readonly LinhaHonorario[],
  f: FiltroRelatorio,
  hoje: Date = new Date(),
  filtrosExtras: string[] = [],
): DocumentoRelatorio {
  const filtros = [
    ...filtrosExtras,
    ...(f.cliente?.trim() ? [`Cliente: ${f.cliente.trim()}`] : []),
    ...(f.processo?.trim() ? [`Processo: ${f.processo.trim()}`] : []),
    ...(f.categorias?.length
      ? [`Categorias: ${f.categorias.map((c) => ROTULO_GRUPO_REPASSE[c]).join(", ")}`]
      : []),
  ];
  return {
    titulo: "RELATÓRIO DE HONORÁRIOS",
    periodo: descricaoPeriodo(f, hoje),
    filtros,
    totais: totalizar(linhas),
    percentual: REGRA_REPASSE.percentual,
    categorias: porCategoria(linhas),
    detalhamento: [...linhas]
      .sort(
        (a, b) =>
          a.clienteNome.localeCompare(b.clienteNome, "pt-BR") ||
          (a.processoNumero ?? "").localeCompare(b.processoNumero ?? "") ||
          a.data.localeCompare(b.data),
      )
      .map((l) => ({
        cliente: l.clienteNome,
        processo: l.processoNumero || "Sem processo",
        data: l.data.split("-").reverse().join("/"),
        categoria: ROTULO_GRUPO_REPASSE[l.categoria],
        recebido: deCentavos(l.recebidoC),
        escritorio: deCentavos(l.escritorioC),
        ricardo: deCentavos(l.ricardoC),
      })),
  };
}

/**
 * Rosca com muitas fatias fica ilegível: mantém as `n − 1` maiores e soma o
 * restante (inclusive um "Outros" já existente) numa única fatia.
 */
export function agruparCauda(
  pontos: readonly PontoSerie[],
  n: number,
  metrica: Metrica,
): PontoSerie[] {
  if (pontos.length <= n) return [...pontos];
  const ordenados = [...pontos].sort((a, b) => b[metrica] - a[metrica]);
  const cabeca = ordenados.slice(0, n - 1).filter((p) => p.chave !== "__outros__");
  const cauda = ordenados.filter((p) => !cabeca.includes(p));
  const somaC = (k: "recebido" | "escritorio" | "ricardo") =>
    deCentavos(cauda.reduce((s, p) => s + paraCentavos(p[k]), 0));
  return [
    ...cabeca,
    {
      chave: "__outros__",
      rotulo: `Outros (${cauda.length})`,
      recebido: somaC("recebido"),
      escritorio: somaC("escritorio"),
      ricardo: somaC("ricardo"),
      quantidade: cauda.reduce((s, p) => s + p.quantidade, 0),
      clientes: cauda.reduce((s, p) => s + p.clientes, 0),
    },
  ];
}
