import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
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
          "Base completa de clientes cadastrados com total recebido e histórico de pagamentos.",
      },
      { property: "og:title", content: "Clientes — Base de Pagamentos" },
      { property: "og:description", content: "Base completa de clientes com valores recebidos." },
    ],
  }),
  component: Clientes,
});

type Ordenacao = "nome" | "valor_desc" | "valor_asc" | "pagamento_recente" | "pagamento_antigo";

function Clientes() {
  const { base, variacoes, carregando } = useSistema();
  const [busca, setBusca] = useState("");
  const [pagamento, setPagamento] = useState("todos");
  const [status, setStatus] = useState("ativos");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("nome");

  const variacoesPorCliente = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const variacao of variacoes) {
      const lista = mapa.get(variacao.cliente_id) ?? [];
      lista.push(variacao.nome_normalizado);
      mapa.set(variacao.cliente_id, lista);
    }
    return mapa;
  }, [variacoes]);

  const lista = useMemo(() => {
    if (!base) return [];
    let resultado = base.clientes;

    if (status === "ativos") resultado = resultado.filter((c) => !c.arquivado);
    if (status === "arquivados") resultado = resultado.filter((c) => c.arquivado);

    if (pagamento === "pagos") resultado = resultado.filter((c) => c.quantidadePagamentos > 0);
    if (pagamento === "nao_identificados") resultado = resultado.filter((c) => c.quantidadePagamentos === 0);

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
    };

    return [...resultado].sort(ordenadores[ordenacao]);
  }, [base, status, pagamento, busca, ordenacao, variacoesPorCliente]);

  if (carregando || !base) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Clientes" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        titulo="Clientes"
        descricao={`${base.clientes.length} clientes na base histórica.`}
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

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
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
        <Select value={pagamento} onValueChange={setPagamento}>
          <SelectTrigger className="h-12 lg:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="pagos">Pagos</SelectItem>
            <SelectItem value="nao_identificados">Não identificados como pagos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-12 lg:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="arquivados">Arquivados</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={ordenacao} onValueChange={(valor) => setOrdenacao(valor as Ordenacao)}>
          <SelectTrigger className="h-12 lg:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
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
          titulo="Nenhum cliente encontrado"
          descricao="Ajuste a pesquisa ou importe uma listagem de clientes."
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
                <TableHead>Pagamento</TableHead>
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
                    <BadgeStatus
                      texto={
                        cliente.arquivado
                          ? "Arquivado"
                          : cliente.quantidadePagamentos > 0
                            ? "Pago"
                            : "Não identificado"
                      }
                      tom={
                        cliente.arquivado
                          ? "neutro"
                          : cliente.quantidadePagamentos > 0
                            ? "sucesso"
                            : "neutro"
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/clientes/$clienteId" params={{ clienteId: cliente.id }}>
                        Ver perfil
                      </Link>
                    </Button>
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
