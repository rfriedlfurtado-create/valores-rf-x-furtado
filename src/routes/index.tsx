import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarPlus,
  Coins,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ModalCorrespondencia } from "@/components/ModalCorrespondencia";
import { StatCard } from "@/components/StatCard";
import { TabelaCorrespondencias } from "@/components/TabelaCorrespondencias";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { filtrarJaPagos, useSistema } from "@/hooks/useSistema";
import { useQuery } from "@tanstack/react-query";
import { FiltroEscritorioSelect } from "@/components/FiltroEscritorioSelect";
import {
  clientePassaFiltro,
  registroPassaFiltro,
  useFiltroEscritorio,
  useVinculosEscritorio,
} from "@/lib/escritorio";
import { cobrancasQuery, lancamentosQuery } from "@/lib/furtado/consultas";
import { CATEGORIAS_HONORARIOS } from "@/lib/furtado/modelo";
import { calcularIndicadores } from "@/lib/situacao";
import { ClipboardList, Landmark } from "lucide-react";
import { formatBRL, formatPercent } from "@/lib/format";
import {
  GRUPOS_CLASSIFICACAO,
  ROTULO_GRUPO,
  type GrupoClassificacao,
  type ResumoEntradas,
} from "@/lib/situacao";
import type { CorrespondenciaDetalhada } from "@/lib/tipos";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Visão geral dos clientes cadastrados, valores já pagos e correspondências de nomes identificadas.",
      },
      { property: "og:title", content: "Dashboard — Base de Pagamentos" },
      {
        property: "og:description",
        content: "Total de clientes, valores já pagos e correspondências identificadas.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { base, correspondencias, carregando } = useSistema();
  const { filtro } = useFiltroEscritorio();
  const vinculos = useVinculosEscritorio();
  const lancamentos = useQuery(lancamentosQuery());
  const cobrancas = useQuery(cobrancasQuery());
  const [selecionado, setSelecionado] = useState<CorrespondenciaDetalhada | null>(null);

  // Indicadores no escritório escolhido: cada cliente conta uma única vez.
  const indFiltrado = useMemo(() => {
    if (!base) return null;
    if (filtro === "todos") return base.indicadores;
    const clientes = base.clientes.filter((c) => clientePassaFiltro(c, filtro, vinculos));
    return calcularIndicadores(clientes, base.pagamentosPorCliente);
  }, [base, filtro, vinculos]);

  const extras = useMemo(() => {
    if (!base) return { aReceber: 0, qtdAReceber: 0, saldoCobrancas: 0, cobrancasAbertas: 0 };
    const vigente = (id: string) => base.porId.has(id);
    const principais = (lancamentos.data ?? []).filter(
      (l) =>
        l.versao === 1 &&
        vigente(l.cliente_id) &&
        CATEGORIAS_HONORARIOS.includes(l.categoria) &&
        l.valor !== null &&
        !l.pagamento_id &&
        l.natureza !== "informativo" &&
        !(l.observacao ?? "").includes("Valor alternativo") &&
        registroPassaFiltro(l.escritorio, filtro),
    );
    const parcelasPorCob = new Map<string, { valor: number; valor_pago: number }[]>();
    for (const p of cobrancas.data?.parcelas ?? [])
      parcelasPorCob.set(p.cobranca_id, [...(parcelasPorCob.get(p.cobranca_id) ?? []), p]);
    let saldo = 0;
    let abertas = 0;
    for (const c of cobrancas.data?.cobrancas ?? []) {
      if (
        !vigente(c.cliente_id) ||
        !registroPassaFiltro(c.escritorio, filtro) ||
        c.situacao === "quitada"
      )
        continue;
      abertas++;
      const ps = parcelasPorCob.get(c.id);
      saldo += ps?.length
        ? ps.reduce((s, p) => s + (p.valor - p.valor_pago), 0)
        : (c.valor_contratado ?? 0);
    }
    return {
      aReceber: Math.round(principais.reduce((s, l) => s + (l.valor ?? 0), 0) * 100) / 100,
      qtdAReceber: principais.length,
      saldoCobrancas: Math.round(saldo * 100) / 100,
      cobrancasAbertas: abertas,
    };
  }, [base, lancamentos.data, cobrancas.data, filtro]);

  // Correspondências de nomes (alertas de similaridade) — NÃO confundir com
  // a situação PAGO do cliente, que vem de base.indicadores.jaPagos.
  const pendentes = useMemo(
    () => correspondencias.filter((item) => item.correspondencia.status === "pendente"),
    [correspondencias],
  );
  const pendentesComHistorico = useMemo(() => filtrarJaPagos(pendentes), [pendentes]);

  if (carregando || !base) {
    return (
      <div className="space-y-6">
        <PageHeader titulo="Dashboard" descricao="Carregando os dados da base..." />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, indice) => (
            <Skeleton key={indice} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const pagamentosDoSelecionado = selecionado
    ? (base.pagamentosPorCliente.get(selecionado.clienteEncontrado.id) ?? [])
    : [];

  const ind = indFiltrado ?? base.indicadores;

  return (
    <div>
      <PageHeader
        titulo="Dashboard"
        descricao="Panorama da base histórica e das correspondências encontradas."
      >
        <FiltroEscritorioSelect className="h-10" />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          titulo="Em tramitação"
          valor={ind.emTramitacao}
          icone={Users}
          tom="info"
          descricao="Clientes na página Clientes"
        />
        <StatCard
          titulo="Já pagos"
          valor={ind.jaPagos}
          icone={Wallet}
          tom="money"
          descricao={`${formatPercent(ind.percentualPagos)} da base${
            ind.pagosSemValor ? ` · ${ind.pagosSemValor} sem valor informado` : ""
          }`}
        />
        <StatCard
          titulo="Total de clientes"
          valor={ind.totalClientes}
          icone={UserCheck}
          descricao={`${ind.importadosNoMes} importado(s) neste mês`}
        />
        <StatCard
          titulo="Valor recebido"
          valor={formatBRL(ind.valorRecebido)}
          icone={Coins}
          tom="money"
          descricao={`${ind.quantidadePagamentos} pagamento(s) registrado(s)`}
        />
        <StatCard
          titulo="Importados no mês"
          valor={ind.importadosNoMes}
          icone={CalendarPlus}
          tom="info"
        />
        <StatCard
          titulo="Honorários a receber (informados)"
          valor={formatBRL(extras.aReceber)}
          icone={Landmark}
          tom="info"
          descricao={`${extras.qtdAReceber} valor(es) previstos/devidos na planilha, ainda não confirmados`}
        />
        <StatCard
          titulo="Cobranças em aberto"
          valor={formatBRL(extras.saldoCobrancas)}
          icone={ClipboardList}
          tom="warning"
          descricao={`${extras.cobrancasAbertas} cobrança(s) não quitada(s)`}
        />
        <StatCard
          titulo="Correspondências a conferir"
          valor={pendentes.length}
          icone={AlertTriangle}
          tom="warning"
          descricao={`${pendentesComHistorico.length} com histórico de pagamento`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <DistribuicaoSituacao emTramitacao={ind.emTramitacao} jaPagos={ind.jaPagos} />
        <ValoresPorClassificacao resumo={ind.entradas} />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">
              Correspondências com histórico de pagamento
            </h2>
            <p className="text-sm text-muted-foreground">
              Nomes importados parecidos com clientes que já têm valores registrados.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/analise">
              Ver todos
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>

        {pendentesComHistorico.length === 0 ? (
          <SecaoVazia
            titulo="Nenhuma correspondência pendente"
            descricao="Importe uma nova listagem para que o sistema compare com a base histórica."
          />
        ) : (
          <TabelaCorrespondencias
            itens={pendentesComHistorico.slice(0, 10)}
            onAbrir={setSelecionado}
            mostrarStatus={false}
          />
        )}
      </section>

      <ModalCorrespondencia
        item={selecionado}
        pagamentos={pagamentosDoSelecionado}
        onFechar={() => setSelecionado(null)}
      />
    </div>
  );
}

/** Gráfico de distribuição por situação — derivado dos mesmos indicadores. */
function DistribuicaoSituacao({
  emTramitacao,
  jaPagos,
}: {
  emTramitacao: number;
  jaPagos: number;
}) {
  const total = emTramitacao + jaPagos;
  const pctPagos = total ? (jaPagos / total) * 100 : 0;
  return (
    <section
      className="mt-6 rounded-xl border border-border bg-card p-5"
      aria-label="Situação dos clientes"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">Situação dos clientes</h2>
        <p className="text-xs text-muted-foreground">{total} cliente(s)</p>
      </div>
      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${emTramitacao} em tramitação, ${jaPagos} já pagos`}
      >
        <div className="h-full bg-info" style={{ width: `${100 - pctPagos}%` }} />
        <div className="h-full bg-money" style={{ width: `${pctPagos}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-info" aria-hidden />
          Em tramitação <strong className="tabular">{emTramitacao}</strong>
          <span className="text-muted-foreground">
            ({formatPercent(total ? 100 - pctPagos : 0)})
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-money" aria-hidden />
          Já pagos <strong className="tabular">{jaPagos}</strong>
          <span className="text-muted-foreground">({formatPercent(pctPagos)})</span>
        </span>
      </div>
    </section>
  );
}

const COR_GRUPO: Record<GrupoClassificacao, string> = {
  atrasados: "bg-money",
  implantacao: "bg-info",
  sucumbencia: "bg-warning",
  sem_classificacao: "bg-muted-foreground/40",
};

/**
 * Valores por classificação das entradas — mesmo cálculo (`resumirEntradas`)
 * usado no perfil de cada cliente. Reclassificar uma entrada move o valor de
 * grupo; o total nunca muda nem duplica.
 */
function ValoresPorClassificacao({ resumo }: { resumo: ResumoEntradas }) {
  return (
    <section
      className="rounded-xl border border-border bg-card p-5"
      aria-label="Valores por classificação"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">Valores por classificação</h2>
        <p className="text-xs text-muted-foreground">{resumo.quantidade} entrada(s)</p>
      </div>
      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={GRUPOS_CLASSIFICACAO.map(
          (g) => `${ROTULO_GRUPO[g]} ${formatBRL(resumo.porClassificacao[g].valor)}`,
        ).join(", ")}
      >
        {GRUPOS_CLASSIFICACAO.map((g) => (
          <div
            key={g}
            className={`h-full ${COR_GRUPO[g]}`}
            style={{
              width: `${resumo.total ? (resumo.porClassificacao[g].valor / resumo.total) * 100 : 0}%`,
            }}
          />
        ))}
      </div>
      <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        {GRUPOS_CLASSIFICACAO.map((g) => (
          <li key={g} className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${COR_GRUPO[g]}`} aria-hidden />
            {ROTULO_GRUPO[g]}
            <strong className="ml-auto tabular">
              {formatBRL(resumo.porClassificacao[g].valor)}
            </strong>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-border pt-2 text-right text-sm">
        Total: <strong className="tabular">{formatBRL(resumo.total)}</strong>
      </p>
    </section>
  );
}
