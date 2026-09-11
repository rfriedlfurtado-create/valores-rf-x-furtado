import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { BotaoExcluirCliente } from "@/components/BotaoExcluirCliente";
import { DialogImportadorClientes } from "@/components/DialogImportadorClientes";
import { DialogPagamento } from "@/components/DialogPagamento";
import { Valor } from "@/components/Valor";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
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

export const Route = createFileRoute("/clientes/")({
  head: () => ({
    meta: [
      { title: "Clientes — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Clientes com processos em tramitação cadastrados no sistema.",
      },
      { property: "og:title", content: "Clientes — Base de Pagamentos" },
      { property: "og:description", content: "Clientes com processos em tramitação." },
    ],
  }),
  component: Clientes,
});

type Ordenacao = "nome" | "valor_desc" | "valor_asc" | "pagamento_recente" | "pagamento_antigo" | "cadastro_recente";


function Clientes() {
  const { base, variacoes, carregando } = useSistema();
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("cadastro_recente");

  const variacoesPorCliente = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const variacao of variacoes) {
      const lista = mapa.get(variacao.cliente_id) ?? [];
      lista.push(variacao.nome_normalizado);
      mapa.set(variacao.cliente_id, lista);
    }
    return mapa;
  }, [variacoes]);

  // Apenas clientes em tramitação: não pagos e não excluídos
  const lista = useMemo(() => {
    if (!base) return [];
    let resultado = base.clientes.filter(
      (c) => c.status !== "pago" && c.status !== "arquivado" && !c.deleted_at,
    );

    const termo = normalizarNome(busca);
    if (termo) {
      resultado = resultado.filter(
        (cliente) =>
          cliente.nome_normalizado.includes(termo) ||
          (variacoesPorCliente.get(cliente.id) ?? []).some((nome) => nome.includes(termo)),
      );
    }

    const ordenadores: Record<Ordenacao, (a: ClienteComTotais, b: ClienteComTotais) => number> = {
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
      valor_desc: (a, b) => b.totalRecebido - a.totalRecebido,
      valor_asc: (a, b) => a.totalRecebido - b.totalRecebido,
      pagamento_recente: (a, b) => (b.ultimoPagamento ?? "").localeCompare(a.ultimoPagamento ?? ""),
      pagamento_antigo: (a, b) =>
        (a.primeiroPagamento ?? "z").localeCompare(b.primeiroPagamento ?? "z"),
      cadastro_recente: (a, b) => b.created_at.localeCompare(a.created_at),
    };

    return [...resultado].sort(ordenadores[ordenacao]);
  }, [base, busca, ordenacao, variacoesPorCliente]);

  if (carregando || !base) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Clientes" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const totalEmTramitacao = base.clientes.filter(
    (c) => c.status !== "pago" && c.status !== "arquivado" && !c.deleted_at,
  ).length;

  return (
    <div>
      <PageHeader
        titulo="Clientes"
        descricao={`${totalEmTramitacao} cliente(s) com processo em tramitação.`}
      >
        <DialogPagamento
          clientes={base.clientes}
          trigger={
            <Button variant="outline">
              <Plus className="size-4" aria-hidden />
              Registrar pagamento
            </Button>
          }
        />
        <DialogImportadorClientes
          trigger={
            <Button>
              <Upload className="size-4" aria-hidden />
              Importar Clientes
            </Button>
          }
        />
      </PageHeader>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Pesquisar cliente..."
            className="h-12 pl-10 text-base"
            aria-label="Pesquisar cliente"
          />
        </div>
        <Select value={ordenacao} onValueChange={(valor) => setOrdenacao(valor as Ordenacao)}>
          <SelectTrigger className="h-12 lg:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cadastro_recente">Cadastro mais recente</SelectItem>
            <SelectItem value="nome">Nome (A-Z)</SelectItem>
            <SelectItem value="valor_desc">Maior valor recebido</SelectItem>
            <SelectItem value="valor_asc">Menor valor recebido</SelectItem>
            <SelectItem value="pagamento_recente">Pagamento mais recente</SelectItem>
            <SelectItem value="pagamento_antigo">Pagamento mais antigo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {lista.length === 0 ? (
        <SecaoVazia
          titulo="Nenhum cliente em tramitação"
          descricao={
            busca
              ? "Nenhum resultado para a pesquisa atual."
              : "Importe uma listagem de clientes para começar."
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
                <TableHead>Último pagamento</TableHead>
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
                    {formatDate(cliente.ultimoPagamento)}
                  </TableCell>
                  <TableCell className="tabular text-sm">
                    {formatDate(cliente.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild size="sm" variant="outline">
                        <Link to="/clientes/$clienteId" params={{ clienteId: cliente.id }}>
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
