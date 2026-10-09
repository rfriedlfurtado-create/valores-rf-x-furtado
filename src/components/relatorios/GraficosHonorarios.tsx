/**
 * Gráficos da página RELATÓRIOS. Todos recebem as MESMAS linhas filtradas da
 * página e só agrupam/somam (src/lib/relatorioHonorarios.ts). Personalizar um
 * gráfico muda apenas a visualização — nunca os dados financeiros.
 */
import { Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL } from "@/lib/format";
import {
  agruparCauda,
  dadosGrafico,
  METRICA_MONETARIA,
  normalizarConfig,
  novoId,
  ROTULO_AGRUPAMENTO,
  ROTULO_METRICA,
  ROTULO_TIPO,
  serie,
  tiposPermitidos,
  tituloGrafico,
  type Agrupamento,
  type ConfigGrafico,
  type LinhaHonorario,
  type Metrica,
  type PontoSerie,
  type TipoGrafico,
  type TotaisCategoria,
  type Totais,
} from "@/lib/relatorioHonorarios";
import {
  GRUPOS_REPASSE,
  REGRA_REPASSE,
  ROTULO_GRUPO_REPASSE,
  type GrupoRepasse,
} from "@/lib/repasse";

// ---------------------------------------------------------------------------
// Cores (tokens do sistema; identidade fixa por entidade, nunca por posição)
// ---------------------------------------------------------------------------

export const COR_ESCRITORIO = "var(--chart-2)";
export const COR_RICARDO = "var(--chart-1)";
export const COR_CATEGORIA: Record<GrupoRepasse, string> = {
  implantacao: "var(--chart-2)",
  atrasados: "var(--chart-1)",
  sucumbencia: "var(--chart-3)",
  sem_classificacao: "var(--muted-foreground)",
};
const COR_METRICA: Record<Metrica, string> = {
  recebido: "var(--primary)",
  escritorio: COR_ESCRITORIO,
  ricardo: COR_RICARDO,
  quantidade: "var(--chart-5)",
  clientes: "var(--chart-5)",
};
/** Fatias de rosca por cliente/processo: ordem fixa; "Outros" sempre cinza. */
const CORES_FATIAS = [
  "var(--chart-2)",
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-5)",
  "var(--chart-4)",
];

const fmt = (m: Metrica, v: number) => (METRICA_MONETARIA[m] ? formatBRL(v) : String(v));
const COMPACTO = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
/** Eixo sempre no mesmo formato: "R$ 0", "R$ 900", "R$ 5,5 mil", "R$ 1,2 mi". */
const fmtEixo = (m: Metrica) => (v: number) =>
  METRICA_MONETARIA[m] ? `R$ ${COMPACTO.format(v)}` : String(v);
/** Legenda com texto na cor do texto (a bolinha carrega a cor da série). */
const textoLegenda = (v: string) => <span className="text-foreground">{v}</span>;

// ---------------------------------------------------------------------------
// Tooltip: sempre mostra Total / Escritório / Ricardo do ponto
// ---------------------------------------------------------------------------

function TooltipHonorarios({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PontoSerie }[];
}) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="min-w-48 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold">{p.rotulo}</p>
      <Linha rotulo="Total recebido" valor={formatBRL(p.recebido)} />
      <Linha rotulo="Escritório" valor={formatBRL(p.escritorio)} cor={COR_ESCRITORIO} />
      <Linha
        rotulo={`Ricardo Friedl (${REGRA_REPASSE.rotulo})`}
        valor={formatBRL(p.ricardo)}
        cor={COR_RICARDO}
      />
      <p className="mt-1 border-t border-border pt-1 text-muted-foreground">
        {p.quantidade} recebimento(s) · {p.clientes} cliente(s)
      </p>
    </div>
  );
}

function Linha({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <p className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {cor ? <span className="size-2 rounded-full" style={{ background: cor }} /> : null}
        {rotulo}
      </span>
      <span className="tabular font-semibold">{valor}</span>
    </p>
  );
}

function Moldura({
  titulo,
  descricao,
  acoes,
  children,
  className,
  testid,
}: {
  titulo: string;
  descricao?: string;
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
  testid?: string;
}) {
  return (
    <Card className={`gap-3 p-5 ${className ?? ""}`} data-testid={testid}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide">{titulo}</h2>
          {descricao ? <p className="text-xs text-muted-foreground">{descricao}</p> : null}
        </div>
        {acoes ? <div className="flex gap-1">{acoes}</div> : null}
      </div>
      {children}
    </Card>
  );
}

function Vazio() {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
      Nenhum recebimento no filtro.
    </div>
  );
}

const configDupla: ChartConfig = {
  escritorio: { label: "Escritório", color: COR_ESCRITORIO },
  ricardo: { label: `Ricardo Friedl (${REGRA_REPASSE.rotulo})`, color: COR_RICARDO },
};

// ---------------------------------------------------------------------------
// 1. Evolução dos honorários (Escritório × Ricardo)
// ---------------------------------------------------------------------------

export interface PrefEvolucao {
  agrupamento: "mes" | "ano";
  tipo: "barras" | "linhas";
}

export function GraficoEvolucao({
  linhas,
  pref,
  mudarPref,
}: {
  linhas: readonly LinhaHonorario[];
  pref: PrefEvolucao;
  mudarPref: (p: PrefEvolucao) => void;
}) {
  const dados = serie(linhas, pref.agrupamento);
  return (
    <Moldura
      titulo="Evolução dos honorários"
      descricao={`Escritório × Ricardo Friedl por ${pref.agrupamento === "mes" ? "mês" : "ano"} · barras empilhadas somam o total recebido`}
      testid="grafico-evolucao"
      acoes={
        <>
          <Select
            value={pref.agrupamento}
            onValueChange={(v) => mudarPref({ ...pref, agrupamento: v as "mes" | "ano" })}
          >
            <SelectTrigger className="h-8 w-28" aria-label="Agrupar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mes">Por mês</SelectItem>
              <SelectItem value="ano">Por ano</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={pref.tipo}
            onValueChange={(v) => mudarPref({ ...pref, tipo: v as "barras" | "linhas" })}
          >
            <SelectTrigger className="h-8 w-28" aria-label="Tipo de gráfico">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="barras">Barras</SelectItem>
              <SelectItem value="linhas">Linhas</SelectItem>
            </SelectContent>
          </Select>
        </>
      }
    >
      {dados.length === 0 ? (
        <Vazio />
      ) : (
        <ChartContainer config={configDupla} className="aspect-auto h-72 w-full">
          {pref.tipo === "barras" ? (
            <BarChart data={dados} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="rotulo" tickLine={false} axisLine={false} minTickGap={12} />
              <YAxis
                tickFormatter={fmtEixo("recebido")}
                tickLine={false}
                axisLine={false}
                width={88}
              />
              <Tooltip content={<TooltipHonorarios />} cursor={{ fill: "var(--muted)" }} />
              <Legend verticalAlign="top" height={28} iconType="circle" formatter={textoLegenda} />
              <Bar
                dataKey="escritorio"
                name="Escritório"
                stackId="h"
                fill={COR_ESCRITORIO}
                maxBarSize={44}
              />
              <Bar
                dataKey="ricardo"
                name={`Ricardo Friedl (${REGRA_REPASSE.rotulo})`}
                stackId="h"
                fill={COR_RICARDO}
                radius={[4, 4, 0, 0]}
                maxBarSize={44}
              />
            </BarChart>
          ) : (
            <LineChart data={dados} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="rotulo" tickLine={false} axisLine={false} minTickGap={12} />
              <YAxis
                tickFormatter={fmtEixo("recebido")}
                tickLine={false}
                axisLine={false}
                width={88}
              />
              <Tooltip content={<TooltipHonorarios />} />
              <Legend verticalAlign="top" height={28} iconType="circle" formatter={textoLegenda} />
              <Line
                dataKey="escritorio"
                name="Escritório"
                stroke={COR_ESCRITORIO}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
              <Line
                dataKey="ricardo"
                name={`Ricardo Friedl (${REGRA_REPASSE.rotulo})`}
                stroke={COR_RICARDO}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          )}
        </ChartContainer>
      )}
    </Moldura>
  );
}

// ---------------------------------------------------------------------------
// 2. Distribuição (rosca Escritório × Ricardo)
// ---------------------------------------------------------------------------

export function GraficoDistribuicao({ totais }: { totais: Totais }) {
  const dados = [
    { nome: "Escritório", valor: totais.escritorio, cor: COR_ESCRITORIO },
    { nome: `Ricardo Friedl`, valor: totais.ricardo, cor: COR_RICARDO },
  ];
  const pct = (v: number) =>
    totais.recebido
      ? `${((v / totais.recebido) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
      : "—";
  return (
    <Moldura
      titulo="Distribuição dos honorários"
      descricao="Valores reais do filtro"
      testid="grafico-distribuicao"
    >
      {totais.recebido === 0 ? (
        <Vazio />
      ) : (
        <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <ChartContainer config={configDupla} className="aspect-square h-56 w-full">
            <PieChart>
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.[0] ? (
                    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
                      <p className="font-semibold">{String(payload[0].name)}</p>
                      <p className="tabular">
                        {formatBRL(Number(payload[0].value))} · {pct(Number(payload[0].value))}
                      </p>
                    </div>
                  ) : null
                }
              />
              <Pie
                data={dados}
                dataKey="valor"
                nameKey="nome"
                innerRadius="58%"
                outerRadius="92%"
                paddingAngle={1}
                stroke="var(--card)"
                strokeWidth={2}
              >
                {dados.map((d) => (
                  <Cell key={d.nome} fill={d.cor} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <ul className="space-y-3 text-sm">
            {dados.map((d) => (
              <li key={d.nome}>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="size-2.5 rounded-full" style={{ background: d.cor }} />
                  {d.nome}
                </span>
                <span className="block text-lg font-bold tabular">{pct(d.valor)}</span>
                <span className="block tabular text-xs">{formatBRL(d.valor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Moldura>
  );
}

// ---------------------------------------------------------------------------
// 3. Recebimentos por categoria (Escritório × Ricardo)
// ---------------------------------------------------------------------------

export function GraficoCategorias({ categorias }: { categorias: TotaisCategoria[] }) {
  const dados: PontoSerie[] = categorias.map((c) => ({
    chave: c.categoria,
    rotulo: c.rotulo,
    recebido: c.recebido,
    escritorio: c.escritorio,
    ricardo: c.ricardo,
    quantidade: c.quantidade,
    clientes: c.clientes,
  }));
  const vazio = dados.every((d) => d.recebido === 0);
  return (
    <Moldura
      titulo="Recebimentos por categoria"
      descricao="De onde vêm os honorários"
      testid="grafico-categorias"
    >
      {vazio ? (
        <Vazio />
      ) : (
        <ChartContainer config={configDupla} className="aspect-auto h-60 w-full">
          <BarChart data={dados} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="rotulo" tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={fmtEixo("recebido")}
              tickLine={false}
              axisLine={false}
              width={88}
            />
            <Tooltip content={<TooltipHonorarios />} cursor={{ fill: "var(--muted)" }} />
            <Legend verticalAlign="top" height={28} iconType="circle" formatter={textoLegenda} />
            <Bar
              dataKey="escritorio"
              name="Escritório"
              fill={COR_ESCRITORIO}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
            <Bar
              dataKey="ricardo"
              name={`Ricardo Friedl (${REGRA_REPASSE.rotulo})`}
              fill={COR_RICARDO}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ChartContainer>
      )}
    </Moldura>
  );
}

// ---------------------------------------------------------------------------
// 4. Gráficos personalizados
// ---------------------------------------------------------------------------

export function GraficoPersonalizado({
  linhas,
  config,
  editar,
  remover,
}: {
  linhas: readonly LinhaHonorario[];
  config: ConfigGrafico;
  editar: () => void;
  remover: () => void;
}) {
  const { config: c, pontos: brutos } = dadosGrafico(linhas, config);
  const pontos = c.tipo === "rosca" ? agruparCauda(brutos, 6, c.metrica) : brutos;
  const cor = COR_METRICA[c.metrica];
  const vazio = pontos.every((p) => p[c.metrica] === 0);
  const corFatia = (p: PontoSerie, i: number) =>
    c.agrupamento === "categoria"
      ? COR_CATEGORIA[p.chave as GrupoRepasse]
      : p.chave === "__outros__"
        ? "var(--muted-foreground)"
        : CORES_FATIAS[i % CORES_FATIAS.length]!;
  const horizontal =
    c.tipo === "barras" && (c.agrupamento === "cliente" || c.agrupamento === "processo");
  const total = pontos.reduce((s, p) => s + p[c.metrica], 0);

  return (
    <Moldura
      titulo={tituloGrafico(c)}
      descricao={`${ROTULO_TIPO[c.tipo]} · ${c.categoria === "todas" ? "todas as categorias" : ROTULO_GRUPO_REPASSE[c.categoria]} · segue os filtros da página`}
      testid="grafico-personalizado"
      acoes={
        <>
          <Button size="sm" variant="ghost" onClick={editar} aria-label="Editar gráfico">
            <Pencil className="size-4" aria-hidden />
            Editar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger hover:text-danger"
            onClick={remover}
            aria-label="Remover gráfico"
          >
            <Trash2 className="size-4" aria-hidden />
            Remover
          </Button>
        </>
      }
    >
      {vazio ? (
        <Vazio />
      ) : c.tipo === "rosca" ? (
        <div className="grid items-center gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <ChartContainer config={{}} className="aspect-square h-48 w-full">
            <PieChart>
              <Tooltip content={<TooltipHonorarios />} />
              <Pie
                data={pontos}
                dataKey={c.metrica}
                nameKey="rotulo"
                innerRadius="58%"
                outerRadius="92%"
                paddingAngle={pontos.filter((p) => p[c.metrica] > 0).length > 1 ? 1 : 0}
                stroke={pontos.filter((p) => p[c.metrica] > 0).length > 1 ? "var(--card)" : "none"}
                strokeWidth={2}
              >
                {pontos.map((p, i) => (
                  <Cell key={p.chave} fill={corFatia(p, i)} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <ul className="space-y-1 text-xs">
            {pontos.map((p, i) => (
              <li key={p.chave} className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: corFatia(p, i) }}
                />
                <span className="min-w-0 flex-1 truncate" title={p.rotulo}>
                  {p.rotulo}
                </span>
                <span className="tabular font-semibold">{fmt(c.metrica, p[c.metrica])}</span>
                <span className="w-12 text-right tabular text-muted-foreground">
                  {total ? `${Math.round((p[c.metrica] / total) * 100)}%` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ChartContainer
          config={{ [c.metrica]: { label: ROTULO_METRICA[c.metrica], color: cor } }}
          className="aspect-auto w-full"
          style={{ height: horizontal ? Math.max(200, pontos.length * 34 + 40) : 260 }}
        >
          {c.tipo === "linhas" ? (
            <LineChart data={pontos} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="rotulo" tickLine={false} axisLine={false} minTickGap={12} />
              <YAxis
                tickFormatter={fmtEixo(c.metrica)}
                tickLine={false}
                axisLine={false}
                width={88}
                allowDecimals={METRICA_MONETARIA[c.metrica]}
              />
              <Tooltip content={<TooltipHonorarios />} />
              <Line
                dataKey={c.metrica}
                name={ROTULO_METRICA[c.metrica]}
                stroke={cor}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          ) : horizontal ? (
            <BarChart data={pontos} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis
                type="number"
                tickFormatter={fmtEixo(c.metrica)}
                tickLine={false}
                axisLine={false}
                allowDecimals={METRICA_MONETARIA[c.metrica]}
              />
              <YAxis
                type="category"
                dataKey="rotulo"
                width={190}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) => (v.length > 28 ? `${v.slice(0, 27)}…` : v)}
              />
              <Tooltip content={<TooltipHonorarios />} cursor={{ fill: "var(--muted)" }} />
              <Bar
                dataKey={c.metrica}
                name={ROTULO_METRICA[c.metrica]}
                fill={cor}
                radius={[0, 4, 4, 0]}
                maxBarSize={22}
              />
            </BarChart>
          ) : (
            <BarChart data={pontos} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="rotulo" tickLine={false} axisLine={false} minTickGap={12} />
              <YAxis
                tickFormatter={fmtEixo(c.metrica)}
                tickLine={false}
                axisLine={false}
                width={88}
                allowDecimals={METRICA_MONETARIA[c.metrica]}
              />
              <Tooltip content={<TooltipHonorarios />} cursor={{ fill: "var(--muted)" }} />
              <Bar
                dataKey={c.metrica}
                name={ROTULO_METRICA[c.metrica]}
                radius={[4, 4, 0, 0]}
                maxBarSize={44}
              >
                {pontos.map((p) => (
                  <Cell
                    key={p.chave}
                    fill={
                      c.agrupamento === "categoria" ? COR_CATEGORIA[p.chave as GrupoRepasse] : cor
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          )}
        </ChartContainer>
      )}
    </Moldura>
  );
}

export function DialogGrafico({
  aberto,
  inicial,
  fechar,
  salvar,
}: {
  aberto: boolean;
  /** null = novo gráfico. */
  inicial: ConfigGrafico | null;
  fechar: () => void;
  salvar: (c: ConfigGrafico) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? null : fechar())}>
      <DialogContent className="sm:max-w-md">
        {aberto ? (
          <FormGrafico
            key={inicial?.id ?? "novo"}
            inicial={inicial}
            fechar={fechar}
            salvar={salvar}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FormGrafico({
  inicial,
  fechar,
  salvar,
}: {
  inicial: ConfigGrafico | null;
  fechar: () => void;
  salvar: (c: ConfigGrafico) => void;
}) {
  const [c, setC] = useState<ConfigGrafico>(
    inicial ?? {
      id: novoId(),
      metrica: "ricardo",
      agrupamento: "mes",
      categoria: "todas",
      tipo: "linhas",
    },
  );
  const [titulo, setTitulo] = useState(inicial?.titulo ?? "");
  const tipos = tiposPermitidos(c.agrupamento, c.metrica);
  const mudar = (parcial: Partial<ConfigGrafico>) =>
    setC((x) => normalizarConfig({ ...x, ...parcial }));

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Settings2 className="size-4" aria-hidden />
          {inicial ? "Personalizar gráfico" : "Adicionar gráfico"}
        </DialogTitle>
        <DialogDescription>
          Muda só a visualização. Os recebimentos, as categorias e o percentual de repasse não são
          alterados.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <Campo rotulo="Métrica">
          <Select value={c.metrica} onValueChange={(v) => mudar({ metrica: v as Metrica })}>
            <SelectTrigger aria-label="Métrica">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROTULO_METRICA) as Metrica[]).map((m) => (
                <SelectItem key={m} value={m}>
                  {ROTULO_METRICA[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Agrupar por">
          <Select
            value={c.agrupamento}
            onValueChange={(v) => mudar({ agrupamento: v as Agrupamento })}
          >
            <SelectTrigger aria-label="Agrupar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROTULO_AGRUPAMENTO) as Agrupamento[]).map((a) => (
                <SelectItem key={a} value={a}>
                  {ROTULO_AGRUPAMENTO[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Categoria">
          <Select
            value={c.categoria}
            onValueChange={(v) => mudar({ categoria: v as ConfigGrafico["categoria"] })}
          >
            <SelectTrigger aria-label="Categoria">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {GRUPOS_REPASSE.map((g) => (
                <SelectItem key={g} value={g}>
                  {ROTULO_GRUPO_REPASSE[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Campo>
        <Campo rotulo="Tipo">
          <Select value={c.tipo} onValueChange={(v) => mudar({ tipo: v as TipoGrafico })}>
            <SelectTrigger aria-label="Tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tipos.map((t) => (
                <SelectItem key={t} value={t}>
                  {ROTULO_TIPO[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Linhas só para mês/ano; rosca só para partes de um total (não para quantidade de
            clientes).
          </p>
        </Campo>
        <Campo rotulo="Título (opcional)">
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder={tituloGrafico(c)}
          />
        </Campo>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={fechar}>
          Cancelar
        </Button>
        <Button
          onClick={() => {
            const { titulo: _t, ...semTitulo } = c;
            salvar(titulo.trim() ? { ...semTitulo, titulo: titulo.trim() } : semTitulo);
          }}
        >
          {inicial ? (
            "Salvar"
          ) : (
            <>
              <Plus className="size-4" aria-hidden />
              Adicionar gráfico
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <Label>{rotulo}</Label>
      {children}
    </div>
  );
}
