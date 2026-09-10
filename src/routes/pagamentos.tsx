import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { DialogPagamento } from "@/components/DialogPagamento";
import { StatCard } from "@/components/StatCard";
import { Valor } from "@/components/Valor";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSistema } from "@/hooks/useSistema";
import { formatBRL, formatDate } from "@/lib/format";
import { normalizarNome } from "@/lib/similarity";
import { Coins, Receipt } from "lucide-react";
import { ROTULO_TIPO_PAGAMENTO } from "@/lib/tipos";

export const Route = createFileRoute("/pagamentos")({
  head: () => ({
    meta: [
      { title: "Histórico de pagamentos — Base de Pagamentos" },
      {
        name: "description",
        content: "Consulta de todos os pagamentos registrados, com filtros por período e cliente.",
      },
      { property: "og:title", content: "Histórico de pagamentos — Base de Pagamentos" },
      { property: "og:description", content: "Todos os pagamentos registrados no sistema." },
    ],
  }),
  component: HistoricoPagamentos,
});

function HistoricoPagamentos() {
  const { base, carregando } = useSistema();
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("todos");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  const linhas = useMemo(() => {
    if (!base) return [];
    const todos = [...base.pagamentosPorCliente.entries()].flatMap(([clienteId, pagamentos]) =>
      pagamentos.map((pagamento) => ({ pagamento, cliente: base.porId.get(clienteId) })),
    );

    const termo = normalizarNome(busca);
    return todos
      .filter(({ pagamento, cliente }) => {
        if (!cliente) return false;
        if (termo && !cliente.nome_normalizado.includes(termo)) return false;
        if (tipo !== "todos" && pagamento.tipo !== tipo) return false;
        if (de && pagamento.data_pagamento < de) return false;
        if (ate && pagamento.data_pagamento > ate) return false;
        return true;
      })
      .sort((a, b) => b.pagamento.data_pagamento.localeCompare(a.pagamento.data_pagamento));
  }, [base, busca, tipo, de, ate]);

  const totalFiltrado = linhas.reduce((soma, linha) => soma + linha.pagamento.valor, 0);

  if (carregando || !base) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Histórico de pagamentos" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader titulo="Histórico de pagamentos" descricao="Todos os valores registrados na base.">
        <DialogPagamento
          clientes={base.clientes}
          trigger={
            <Button>
              <Plus className="size-4" aria-hidden />
              Registrar pagamento
            </Button>
          }
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard titulo="Valor no filtro atual" valor={formatBRL(totalFiltrado)} icone={Coins} tom="money" />
        <StatCard titulo="Pagamentos no filtro" valor={linhas.length} icone={Receipt} />
        <StatCard titulo="Valor total da base" valor={formatBRL(base.totalPago)} icone={Coins} tom="money" />
      </div>

      <div className="my-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Pesquisar cliente..."
            className="h-11 pl-9 text-base"
            aria-label="Pesquisar cliente"
          />
        </div>
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="h-11 lg:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="pix">PIX</SelectItem>
            <SelectItem value="transferencia">Transferência</SelectItem>
            <SelectItem value="dinheiro">Dinheiro</SelectItem>
            <SelectItem value="cheque">Cheque</SelectItem>
            <SelectItem value="boleto">Boleto</SelectItem>
            <SelectItem value="outro">Outro</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={de}
          onChange={(evento) => setDe(evento.target.value)}
          className="h-11 lg:w-44"
          aria-label="Data inicial"
        />
        <Input
          type="date"
          value={ate}
          onChange={(evento) => setAte(evento.target.value)}
          className="h-11 lg:w-44"
          aria-label="Data final"
        />
      </div>

      {linhas.length === 0 ? (
        <SecaoVazia titulo="Nenhum pagamento encontrado" descricao="Ajuste os filtros ou registre um pagamento." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Data</TableHead>
                <TableHead className="min-w-52">Cliente</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Observação</TableHead>
                <TableHead>Cadastrado por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map(({ pagamento, cliente }) => (
                <TableRow key={pagamento.id}>
                  <TableCell className="tabular font-medium">
                    {formatDate(pagamento.data_pagamento)}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/clientes/$clienteId"
                      params={{ clienteId: pagamento.cliente_id }}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {cliente?.nome}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Valor valor={pagamento.valor} tamanho="lg" />
                  </TableCell>
                  <TableCell>{ROTULO_TIPO_PAGAMENTO[pagamento.tipo]}</TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground">
                    {pagamento.observacao ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {pagamento.usuario_cadastro ?? "—"}
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
