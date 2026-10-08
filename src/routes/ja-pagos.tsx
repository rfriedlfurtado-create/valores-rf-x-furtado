import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { BotaoExcluirCliente } from "@/components/BotaoExcluirCliente";
import { BotaoImportarClientes } from "@/components/DialogImportar";
import { CpfCliente } from "@/components/CpfCliente";
import { NumerosProcessos } from "@/components/NumerosProcessos";
import { Valor } from "@/components/Valor";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSistema } from "@/hooks/useSistema";
import { useIdentificadoresPorCliente } from "@/hooks/useDadosFurtado";
import { FiltroEscritorioSelect } from "@/components/FiltroEscritorioSelect";
import {
  BadgeEscritorio,
  clientePassaFiltro,
  escritoriosDoCliente,
  useFiltroEscritorio,
  useVinculosEscritorio,
} from "@/lib/escritorio";
import { formatDate } from "@/lib/format";
import { propsLinhaClicavel } from "@/lib/linhaClicavel";
import { correspondeBusca, processosDaVisao } from "@/lib/situacao";
import type { ClienteComTotais } from "@/lib/tipos";

export const Route = createFileRoute("/ja-pagos")({
  head: () => ({
    meta: [
      { title: "Já pagos — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Clientes identificados como já pagos, movidos automaticamente da listagem de tramitação.",
      },
      { property: "og:title", content: "Já pagos — Base de Pagamentos" },
      {
        property: "og:description",
        content: "Clientes com pagamento identificado.",
      },
    ],
  }),
  component: JaPagos,
});

type OrdenacaoJaPagos = "pago_recente" | "pago_antigo" | "valor_desc" | "valor_asc" | "nome";

function JaPagos() {
  const { base, variacoes, carregando } = useSistema();
  const { filtro } = useFiltroEscritorio();
  const vinculos = useVinculosEscritorio();
  const identificadores = useIdentificadoresPorCliente();
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<OrdenacaoJaPagos>("pago_recente");
  const navigate = useNavigate();
  const abrir = (id: string) =>
    void navigate({
      to: "/clientes/$clienteId",
      params: { clienteId: id },
      search: { visao: "pagos" },
    });

  const variacoesPorCliente = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const variacao of variacoes) {
      mapa.set(variacao.cliente_id, [
        ...(mapa.get(variacao.cliente_id) ?? []),
        variacao.nome_normalizado,
      ]);
    }
    return mapa;
  }, [variacoes]);

  const lista = useMemo(() => {
    if (!base) return [];

    // Visão JÁ PAGOS = clientes com ao menos um processo PAGO (mesmo cadastro, sem cópia).
    const resultado: ClienteComTotais[] = base.jaPagos.filter(
      (cliente) =>
        clientePassaFiltro(cliente, filtro, vinculos) &&
        correspondeBusca(cliente, busca, variacoesPorCliente, identificadores),
    );

    const ordenadores: Record<
      OrdenacaoJaPagos,
      (a: ClienteComTotais, b: ClienteComTotais) => number
    > = {
      pago_recente: (a, b) => (b.pagoEm ?? "").localeCompare(a.pagoEm ?? ""),
      pago_antigo: (a, b) => (a.pagoEm ?? "").localeCompare(b.pagoEm ?? ""),
      valor_desc: (a, b) => b.totalRecebidoPagos - a.totalRecebidoPagos,
      valor_asc: (a, b) => a.totalRecebidoPagos - b.totalRecebidoPagos,
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    };

    return [...resultado].sort(ordenadores[ordenacao]);
  }, [base, busca, ordenacao, variacoesPorCliente, filtro, vinculos, identificadores]);

  if (carregando || !base) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Já pagos" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        titulo="Já pagos"
        descricao={`${base.indicadores.jaPagos} cliente(s) do Ricardo Friedl com pelo menos um recebimento confirmado. Estar aqui não significa quitação integral — saldos e categorias pendentes aparecem no perfil.`}
      >
        <BotaoImportarClientes />
      </PageHeader>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Pesquisar por nome, CPF, processo ou NB..."
            className="h-11 pl-9 text-base"
            aria-label="Pesquisar cliente"
          />
        </div>

        <FiltroEscritorioSelect />
        <Select
          value={ordenacao}
          onValueChange={(valor) => setOrdenacao(valor as OrdenacaoJaPagos)}
        >
          <SelectTrigger className="h-11 lg:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pago_recente">Identificado mais recente</SelectItem>
            <SelectItem value="pago_antigo">Identificado mais antigo</SelectItem>
            <SelectItem value="valor_desc">Maior valor recebido</SelectItem>
            <SelectItem value="valor_asc">Menor valor recebido</SelectItem>
            <SelectItem value="nome">Nome (A-Z)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {lista.length === 0 ? (
        <SecaoVazia
          titulo="Nenhum cliente identificado como já pago"
          descricao={
            busca
              ? "Nenhum resultado para a pesquisa atual."
              : "Um cliente aparece aqui quando é cliente do Ricardo Friedl e tem pelo menos um recebimento confirmado."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-52">Nome</TableHead>
                <TableHead className="min-w-36">CPF</TableHead>
                <TableHead className="min-w-56">Processos pagos</TableHead>
                <TableHead className="text-right">Total recebido</TableHead>
                <TableHead className="text-center">Pagamentos</TableHead>
                <TableHead>Último recebimento</TableHead>
                <TableHead>Cadastro</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((cliente) => (
                <TableRow
                  key={cliente.id}
                  {...propsLinhaClicavel({
                    rotulo: `Abrir perfil de ${cliente.nome}`,
                    abrir: () => abrir(cliente.id),
                    href: `/clientes/${cliente.id}?visao=pagos`,
                  })}
                >
                  <TableCell className="font-semibold">
                    {cliente.nome}
                    <span className="mt-1 flex flex-wrap gap-1">
                      {escritoriosDoCliente(cliente, vinculos).map((e) => (
                        <BadgeEscritorio key={e} escritorio={e} />
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <CpfCliente cliente={cliente} />
                  </TableCell>
                  <TableCell>
                    <NumerosProcessos
                      processos={processosDaVisao(cliente.processos, "pagos")}
                      vazio="Cliente sem processo"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Valor valor={cliente.totalRecebidoPagos} tamanho="lg" />
                  </TableCell>
                  <TableCell className="text-center tabular font-semibold">
                    {cliente.quantidadePagamentosPagos}
                  </TableCell>
                  <TableCell className="tabular text-sm">
                    {cliente.pagoEm ? formatDate(cliente.pagoEm) : "—"}
                  </TableCell>
                  <TableCell className="tabular text-sm">
                    {formatDate(cliente.created_at)}
                  </TableCell>
                  <TableCell>
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Button asChild size="sm" variant="outline">
                        <Link
                          to="/clientes/$clienteId"
                          params={{ clienteId: cliente.id }}
                          search={{ visao: "pagos" }}
                          tabIndex={-1}
                        >
                          Ver perfil
                        </Link>
                      </Button>
                      <BotaoExcluirCliente cliente={cliente} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
