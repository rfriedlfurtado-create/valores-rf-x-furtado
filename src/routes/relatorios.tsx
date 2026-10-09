/**
 * RELATÓRIOS — honorários do Escritório × repasse Ricardo Friedl.
 *
 * Fonte única: a base agregada (useSistema → agregarBase), a mesma de
 * Dashboard, perfil e JÁ PAGOS. Regra única: src/lib/repasse.ts. Os filtros
 * produzem UMA lista de linhas usada por cards, gráficos, tabelas e
 * exportação. A sincronização global revalida a base, então a página se
 * atualiza sozinha após importações, lançamentos, alterações e exclusões.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Coins, FileSpreadsheet, FileText, HandCoins, Landmark, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { FiltroEscritorioSelect } from "@/components/FiltroEscritorioSelect";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/layout/AppShell";
import {
  ConferenciaRepasse,
  DetalhamentoPorCliente,
  DetalhamentoRecebimentos,
  TabelaCategorias,
} from "@/components/relatorios/DetalhamentoHonorarios";
import {
  DialogGrafico,
  GraficoCategorias,
  GraficoDistribuicao,
  GraficoEvolucao,
  GraficoPersonalizado,
  type PrefEvolucao,
} from "@/components/relatorios/GraficosHonorarios";
import { BlocoExpansivel } from "@/components/BlocoExpansivel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSistema } from "@/hooks/useSistema";
import { supabase } from "@/integrations/supabase/client";
import {
  clientePassaFiltro,
  OPCOES_FILTRO_ESCRITORIO,
  registroPassaFiltro,
  useFiltroEscritorio,
  useVinculosEscritorio,
} from "@/lib/escritorio";
import { baixarExcel, imprimirPdf } from "@/lib/exportarRelatorio";
import { formatBRL } from "@/lib/format";
import { lancamentosQuery, requisicoesQuery } from "@/lib/furtado/consultas";
import { ROTULO_CATEGORIA, type CategoriaFinanceira } from "@/lib/furtado/modelo";
import {
  descricaoPeriodo,
  documentoRelatorio,
  filtrarLinhas,
  FILTRO_PADRAO,
  lerConfigs,
  montarLinhas,
  porCategoria,
  ROTULO_PERIODO,
  totalizar,
  type ConfigGrafico,
  type FiltroRelatorio,
  type PeriodoRapido,
} from "@/lib/relatorioHonorarios";
import {
  GRUPOS_REPASSE,
  REGRA_REPASSE,
  ROTULO_GRUPO_REPASSE,
  type GrupoRepasse,
} from "@/lib/repasse";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Honorários" },
      {
        name: "description",
        content:
          "Honorários do escritório e repasse Ricardo Friedl sobre os valores efetivamente recebidos.",
      },
    ],
  }),
  component: Relatorios,
});

// ---------------------------------------------------------------------------
// Preferências de visualização (só configuração — nunca dados financeiros)
// ---------------------------------------------------------------------------

interface PrefRelatorios {
  evolucao: PrefEvolucao;
  graficos: ConfigGrafico[];
}

const PREF_PADRAO: PrefRelatorios = {
  evolucao: { agrupamento: "mes", tipo: "barras" },
  graficos: [],
};
const CHAVE_CONFIG = "relatorios";

function lerPref(valor: unknown): PrefRelatorios {
  const v = (valor ?? {}) as { evolucao?: Partial<PrefEvolucao> };
  const e = v.evolucao ?? {};
  return {
    evolucao: {
      agrupamento: e.agrupamento === "ano" ? "ano" : "mes",
      tipo: e.tipo === "linhas" ? "linhas" : "barras",
    },
    graficos: lerConfigs(valor),
  };
}

const prefQuery = {
  queryKey: ["configuracoes", CHAVE_CONFIG],
  queryFn: async (): Promise<PrefRelatorios> => {
    const r = await supabase
      .from("configuracoes")
      .select("valor")
      .eq("chave", CHAVE_CONFIG)
      .maybeSingle();
    if (r.error) return PREF_PADRAO;
    return lerPref(r.data?.valor);
  },
  staleTime: 60_000,
};

function usePreferencias() {
  const qc = useQueryClient();
  const q = useQuery(prefQuery);
  const salvar = useMutation({
    mutationFn: async (p: PrefRelatorios) => {
      const { error } = await supabase
        .from("configuracoes")
        .upsert(
          { chave: CHAVE_CONFIG, valor: JSON.parse(JSON.stringify(p)) },
          { onConflict: "chave" },
        );
      if (error) throw new Error(error.message);
    },
    onMutate: (p) => {
      qc.setQueryData(prefQuery.queryKey, p);
    },
    onError: (e: Error) => toast.error(`Não foi possível salvar a configuração: ${e.message}`),
  });
  return { pref: q.data ?? PREF_PADRAO, salvar: (p: PrefRelatorios) => salvar.mutate(p) };
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function Relatorios() {
  const { base, carregando } = useSistema();
  const { filtro: filtroEscritorio } = useFiltroEscritorio();
  const vinculos = useVinculosEscritorio();
  const [filtro, setFiltro] = useState<FiltroRelatorio>(FILTRO_PADRAO);
  const { pref, salvar } = usePreferencias();
  const [dialogo, setDialogo] = useState<{ aberto: boolean; grafico: ConfigGrafico | null }>({
    aberto: false,
    grafico: null,
  });

  // 1) Linhas = recebimentos elegíveis da base (filtro de escritório como antes).
  const todas = useMemo(() => {
    if (!base) return [];
    return montarLinhas(
      base.clientes,
      base.pagamentosPorCliente,
      (c) => clientePassaFiltro(c, filtroEscritorio, vinculos),
      (p) => (p.escritorio ? registroPassaFiltro(p.escritorio, filtroEscritorio) : undefined),
    );
  }, [base, filtroEscritorio, vinculos]);

  // 2) Um único universo filtrado para cards, gráficos, tabelas e exportação.
  const linhas = useMemo(() => filtrarLinhas(todas, filtro), [todas, filtro]);
  const totais = useMemo(() => totalizar(linhas), [linhas]);
  const categorias = useMemo(() => porCategoria(linhas), [linhas]);

  const rotuloEscritorio =
    filtroEscritorio === "todos"
      ? []
      : [
          `Escritório de origem: ${OPCOES_FILTRO_ESCRITORIO.find((o) => o.value === filtroEscritorio)?.label ?? filtroEscritorio}`,
        ];
  const documento = () => documentoRelatorio(linhas, filtro, new Date(), rotuloEscritorio);

  if (carregando || !base) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Relatórios" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const salvarGrafico = (g: ConfigGrafico) => {
    const existe = pref.graficos.some((x) => x.id === g.id);
    salvar({
      ...pref,
      graficos: existe ? pref.graficos.map((x) => (x.id === g.id ? g : x)) : [...pref.graficos, g],
    });
    setDialogo({ aberto: false, grafico: null });
    toast.success(existe ? "Gráfico atualizado." : "Gráfico adicionado.");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Relatórios"
        descricao={`Honorários sobre os valores efetivamente recebidos · Ricardo Friedl = ${REGRA_REPASSE.rotulo} de cada recebimento · Escritório = recebido − repasse`}
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              baixarExcel(documento());
              toast.success("Excel gerado com os filtros aplicados.");
            }}
          >
            <FileSpreadsheet className="size-4" aria-hidden />
            Exportar Excel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (!imprimirPdf(documento()))
                toast.error("O navegador bloqueou a janela de impressão.");
            }}
          >
            <FileText className="size-4" aria-hidden />
            Exportar PDF
          </Button>
        </div>
      </PageHeader>

      <BarraFiltros filtro={filtro} mudar={setFiltro} />

      <p className="-mt-3 text-xs text-muted-foreground" data-testid="resumo-filtro">
        {descricaoPeriodo(filtro)} · {totais.quantidade} recebimento(s) · {totais.clientes}{" "}
        cliente(s)
      </p>

      <div className="grid gap-4 md:grid-cols-3" data-testid="cards-honorarios">
        <StatCard
          titulo="Total recebido"
          valor={formatBRL(totais.recebido)}
          icone={Coins}
          tom="neutro"
          descricao={`${totais.quantidade} recebimento(s) · ${totais.clientes} cliente(s)`}
        />
        <StatCard
          titulo="Escritório"
          valor={formatBRL(totais.escritorio)}
          icone={Landmark}
          tom="info"
          descricao={`${100 - REGRA_REPASSE.percentual}% · recebido − repasse`}
        />
        <StatCard
          titulo="Ricardo Friedl"
          valor={formatBRL(totais.ricardo)}
          icone={HandCoins}
          tom="money"
          descricao={`${REGRA_REPASSE.rotulo} de cada recebimento`}
        />
      </div>

      <GraficoEvolucao
        linhas={linhas}
        pref={pref.evolucao}
        mudarPref={(e) => salvar({ ...pref, evolucao: e })}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <GraficoDistribuicao totais={totais} />
        <GraficoCategorias categorias={categorias} />
      </div>

      <Card className="gap-3 p-5" data-testid="tabela-categorias">
        <h2 className="text-sm font-bold uppercase tracking-wide">Por categoria</h2>
        <TabelaCategorias categorias={categorias} totais={totais} />
      </Card>

      <section className="space-y-3" aria-label="Gráficos personalizados">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Gráficos personalizados</h2>
            <p className="text-sm text-muted-foreground">
              Escolha métrica, agrupamento, categoria e tipo. Ficam salvos para a próxima visita e
              seguem os filtros da página.
            </p>
          </div>
          <Button onClick={() => setDialogo({ aberto: true, grafico: null })}>
            <Plus className="size-4" aria-hidden />
            Adicionar gráfico
          </Button>
        </div>
        {pref.graficos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum gráfico personalizado. Use “Adicionar gráfico” para criar um.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pref.graficos.map((g) => (
              <GraficoPersonalizado
                key={g.id}
                linhas={linhas}
                config={g}
                editar={() => setDialogo({ aberto: true, grafico: g })}
                remover={() => {
                  salvar({ ...pref, graficos: pref.graficos.filter((x) => x.id !== g.id) });
                  toast.success("Gráfico removido (os dados financeiros não foram alterados).");
                }}
              />
            ))}
          </div>
        )}
      </section>

      <ConferenciaRepasse linhas={linhas} totais={totais} />

      <DetalhamentoPorCliente linhas={linhas} />

      <DetalhamentoRecebimentos linhas={linhas} totais={totais} />

      <OutrasInformacoes />

      <DialogGrafico
        aberto={dialogo.aberto}
        inicial={dialogo.grafico}
        fechar={() => setDialogo({ aberto: false, grafico: null })}
        salvar={salvarGrafico}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra de filtros
// ---------------------------------------------------------------------------

function BarraFiltros({
  filtro,
  mudar,
}: {
  filtro: FiltroRelatorio;
  mudar: (f: FiltroRelatorio) => void;
}) {
  const cats = filtro.categorias ?? [];
  const alternar = (g: GrupoRepasse) =>
    mudar({ ...filtro, categorias: cats.includes(g) ? cats.filter((c) => c !== g) : [...cats, g] });
  const ativo =
    filtro.periodo !== "tudo" ||
    Boolean(filtro.cliente?.trim()) ||
    Boolean(filtro.processo?.trim()) ||
    cats.length > 0;

  return (
    <Card className="gap-3 p-4" data-testid="filtros-relatorio">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[13rem_1fr_1fr_auto]">
        <Select
          value={filtro.periodo}
          onValueChange={(v) => mudar({ ...filtro, periodo: v as PeriodoRapido })}
        >
          <SelectTrigger className="h-10" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROTULO_PERIODO) as PeriodoRapido[]).map((p) => (
              <SelectItem key={p} value={p}>
                {ROTULO_PERIODO[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-10"
          placeholder="Cliente / Reclamante"
          aria-label="Cliente / Reclamante"
          value={filtro.cliente ?? ""}
          onChange={(e) => mudar({ ...filtro, cliente: e.target.value })}
        />
        <Input
          className="h-10"
          placeholder="Número do processo"
          aria-label="Número do processo"
          value={filtro.processo ?? ""}
          onChange={(e) => mudar({ ...filtro, processo: e.target.value })}
        />
        <FiltroEscritorioSelect className="h-10 lg:w-56" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filtro.periodo === "personalizado" ? (
          <>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              De
              <Input
                type="date"
                className="h-9 w-40"
                aria-label="Data inicial"
                value={filtro.de ?? ""}
                onChange={(e) => mudar({ ...filtro, de: e.target.value || null })}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              Até
              <Input
                type="date"
                className="h-9 w-40"
                aria-label="Data final"
                value={filtro.ate ?? ""}
                onChange={(e) => mudar({ ...filtro, ate: e.target.value || null })}
              />
            </label>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
          </>
        ) : null}
        <span className="text-xs font-semibold text-muted-foreground">Categoria:</span>
        {GRUPOS_REPASSE.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={cats.includes(g)}
            onClick={() => alternar(g)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
              cats.includes(g)
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted",
            )}
          >
            {ROTULO_GRUPO_REPASSE[g]}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">{cats.length ? "" : "(todas)"}</span>
        {ativo ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => mudar(FILTRO_PADRAO)}
          >
            <X className="size-4" aria-hidden />
            Limpar filtros
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Informações já existentes (planilhas e requisições) — preservadas
// ---------------------------------------------------------------------------

const ORDEM: CategoriaFinanceira[] = [
  "valor_total",
  "atrasados",
  "valor_cliente",
  "repasse_cliente",
  "honorarios_contratuais",
  "honorarios_implantacao",
  "honorarios_sucumbenciais",
  "honorarios_execucao",
  "honorarios_tutela",
  "honorarios_administrativos",
  "outros_honorarios",
];

function OutrasInformacoes() {
  const { base } = useSistema();
  const { filtro } = useFiltroEscritorio();
  const lancamentos = useQuery(lancamentosQuery());
  const requisicoes = useQuery(requisicoesQuery());

  const dados = useMemo(() => {
    if (!base) return null;
    const porCat = new Map<
      CategoriaFinanceira,
      { previsto: number; devido: number; recebido: number; ausente: number }
    >();
    for (const l of lancamentos.data ?? []) {
      if (!base.porId.has(l.cliente_id) || l.versao !== 1) continue;
      if ((l.observacao ?? "").includes("Valor alternativo")) continue;
      if (!registroPassaFiltro(l.escritorio, filtro)) continue;
      const linha = porCat.get(l.categoria) ?? { previsto: 0, devido: 0, recebido: 0, ausente: 0 };
      if (l.valor === null) linha.ausente += 1;
      else if (l.pagamento_id) linha.recebido += l.valor;
      else if (l.natureza === "previsto") linha.previsto += l.valor;
      else if (l.natureza === "devido") linha.devido += l.valor;
      porCat.set(l.categoria, linha);
    }
    const req = new Map<string, { quantidade: number; valor: number }>();
    for (const r of requisicoes.data ?? []) {
      if (!base.porId.has(r.cliente_id) || !registroPassaFiltro(r.escritorio, filtro)) continue;
      const k = `${r.tipo === "precatorio" ? "Precatório" : r.tipo === "rpv" ? "RPV" : r.tipo === "ted" ? "Pedido de TED" : "Outras"}${
        r.ano_previsto ? ` ${r.ano_previsto}` : ""
      }${r.situacao ? ` · ${r.situacao.replace(/_/g, " ")}` : ""}`;
      const x = req.get(k) ?? { quantidade: 0, valor: 0 };
      x.quantidade += 1;
      x.valor += r.valor ?? 0;
      req.set(k, x);
    }
    return { porCat, req };
  }, [base, lancamentos.data, requisicoes.data, filtro]);

  if (!dados) return null;
  return (
    <BlocoExpansivel
      titulo="Outras informações (planilhas e requisições — fora dos honorários)"
      resumo="Valores informados nas planilhas (previstos/devidos) e RPV/precatórios. Não entram nos honorários nem no repasse."
    >
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="space-y-2 lg:col-span-2">
          <h3 className="text-xs font-bold uppercase tracking-wide">
            Valores informados nas planilhas, por categoria
          </h3>
          {dados.porCat.size === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum valor informado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1">Categoria</th>
                    <th className="py-1 text-right">Previsto</th>
                    <th className="py-1 text-right">Devido</th>
                    <th className="py-1 text-right">Recebido (confirmado)</th>
                    <th className="py-1 text-right">Ausência declarada</th>
                  </tr>
                </thead>
                <tbody>
                  {ORDEM.filter((c) => dados.porCat.has(c)).map((c) => {
                    const l = dados.porCat.get(c)!;
                    return (
                      <tr key={c} className="border-t border-border">
                        <td className="py-1.5">{ROTULO_CATEGORIA[c]}</td>
                        <td className="py-1.5 text-right tabular">{formatBRL(l.previsto)}</td>
                        <td className="py-1.5 text-right tabular">{formatBRL(l.devido)}</td>
                        <td className="py-1.5 text-right tabular">{formatBRL(l.recebido)}</td>
                        <td className="py-1.5 text-right tabular text-muted-foreground">
                          {l.ausente || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide">RPV, precatórios e TED</h3>
          {dados.req.size === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma requisição registrada.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {[...dados.req.entries()]
                .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
                .map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span>{k}</span>
                    <span className="tabular text-muted-foreground">
                      {v.quantidade}
                      {v.valor ? ` · ${formatBRL(v.valor)}` : ""}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </BlocoExpansivel>
  );
}
