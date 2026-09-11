import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { BotaoExcluirCliente } from "@/components/BotaoExcluirCliente";
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
import { formatDate } from "@/lib/format";
import { normalizarNome } from "@/lib/similarity";
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
  const { base, carregando } = useSistema();
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<OrdenacaoJaPagos>("pago_recente");

  const lista = useMemo(() => {
    if (!base) return [];

    // Apenas clientes com status "pago" e não excluídos
    let resultado: ClienteComTotais[] = base.clientes.filter(
      (c) => c.status === "pago" && !c.deleted_at,
    );

    const termo = normalizarNome(busca);
    if (termo) {
      resultado = resultado.filter((c) => c.nome_normalizado.includes(termo));
    }

    const ordenadores: Record<OrdenacaoJaPagos, (a: ClienteComTotais, b: ClienteComTotais) => number> = {
      pago_recente: (a, b) => b.updated_at.localeCompare(a.updated_at),
      pago_antigo: (a, b) => a.updated_at.localeCompare(b.updated_at),
      valor_desc: (a, b) => b.totalRecebido - a.totalRecebido,
      valor_asc: (a, b) => a.totalRecebido - b.totalRecebido,
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    };

    return [...resultado].sort(ordenadores[ordenacao]);
  }, [base, busca, ordenacao]);

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
        descricao={`${lista.length} cliente(s) identificado(s) como já pago(s).`}
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Pesquisar nome..."
            className="h-11 pl-9 text-base"
            aria-label="Pesquisar cliente"
          />
        </div>

        <Select value={ordenacao} onValueChange={(valor) => setOrdenacao(valor as OrdenacaoJaPagos)}>
          <SelectTrigger className="h-11 lg:w-56"><SelectValue /></SelectTrigger>
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
              : "Quando um nome importado na seção 2 corresponder a um cliente em tramitação, ele aparecerá aqui automaticamente."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-52">Nome</TableHead>
                <TableHead className="text-right">Total recebido</TableHead>
                <TableHead className="text-center">Pagamentos</TableHead>
                <TableHead>Pago em</TableHead>
                <TableHead>Cadastro</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((cliente) => (
                <TableRow key={cliente.id}>
                  <TableCell className="font-semibold">{cliente.nome}</TableCell>
                  <TableCell className="text-right">
                    <Valor valor={cliente.totalRecebido} tamanho="lg" />
                  </TableCell>
                  <TableCell className="text-center tabular font-semibold">
                    {cliente.quantidadePagamentos}
                  </TableCell>
                  <TableCell className="tabular text-sm">
                    {formatDate(cliente.updated_at)}
                  </TableCell>
                  <TableCell className="tabular text-sm">
                    {formatDate(cliente.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end">
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
