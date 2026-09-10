import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, CalendarPlus, Coins, Users, Wallet } from "lucide-react";
import { useMemo, useState } from "react";

import { ModalCorrespondencia } from "@/components/ModalCorrespondencia";
import { StatCard } from "@/components/StatCard";
import { TabelaCorrespondencias } from "@/components/TabelaCorrespondencias";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { filtrarJaPagos, useSistema } from "@/hooks/useSistema";
import { formatBRL } from "@/lib/format";
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
  const [selecionado, setSelecionado] = useState<CorrespondenciaDetalhada | null>(null);

  const jaPagos = useMemo(
    () => filtrarJaPagos(correspondencias).filter((item) => item.correspondencia.status === "pendente"),
    [correspondencias],
  );

  const possiveis = useMemo(
    () =>
      correspondencias.filter(
        (item) =>
          item.correspondencia.status === "pendente" &&
          item.correspondencia.classificacao === "possivel",
      ),
    [correspondencias],
  );

  const importadosNoMes = useMemo(() => {
    if (!base) return 0;
    const inicio = new Date();
    inicio.setDate(1);
    inicio.setHours(0, 0, 0, 0);
    return base.clientes.filter(
      (cliente) => cliente.data_importacao && new Date(cliente.data_importacao) >= inicio,
    ).length;
  }, [base]);

  if (carregando || !base) {
    return (
      <div className="space-y-6">
        <PageHeader titulo="Dashboard" descricao="Carregando os dados da base..." />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, indice) => (
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

  return (
    <div>
      <PageHeader
        titulo="Dashboard"
        descricao="Panorama da base histórica e das correspondências encontradas."
      >
        <Button asChild variant="outline">
          <Link to="/clientes">Ver clientes</Link>
        </Button>
        <Button asChild>
          <Link to="/importar">Importar clientes</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard titulo="Total de clientes" valor={base.clientes.length} icone={Users} />
        <StatCard
          titulo="Importados no mês"
          valor={importadosNoMes}
          icone={CalendarPlus}
          tom="info"
        />
        <StatCard
          titulo="Já pagos identificados"
          valor={jaPagos.length}
          icone={Wallet}
          tom="danger"
          descricao="Aguardando sua conferência"
        />
        <StatCard
          titulo="Valor total já pago"
          valor={formatBRL(base.totalPago)}
          icone={Coins}
          tom="money"
          descricao={`${base.totalPagamentos} pagamentos registrados`}
        />
        <StatCard
          titulo="Possíveis correspondências"
          valor={possiveis.length}
          icone={AlertTriangle}
          tom="warning"
        />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Clientes identificados como já pagos</h2>
            <p className="text-sm text-muted-foreground">
              Nomes da nova listagem que batem com clientes que já receberam valores.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/ja-pagos">
              Ver todos
              <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>

        {jaPagos.length === 0 ? (
          <SecaoVazia
            titulo="Nenhuma correspondência pendente"
            descricao="Importe uma nova listagem para que o sistema compare com a base histórica."
          />
        ) : (
          <TabelaCorrespondencias
            itens={jaPagos.slice(0, 10)}
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
