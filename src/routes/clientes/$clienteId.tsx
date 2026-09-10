import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Archive, CalendarClock, CalendarDays, Coins, Plus, Receipt, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DialogPagamento } from "@/components/DialogPagamento";
import { StatCard } from "@/components/StatCard";
import { Valor } from "@/components/Valor";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSistema } from "@/hooks/useSistema";
import { arquivarCliente, atualizarCliente, reativarCliente } from "@/lib/acoes";
import { formatBRL, formatDate } from "@/lib/format";
import { ROTULO_TIPO_PAGAMENTO } from "@/lib/tipos";

export const Route = createFileRoute("/clientes/$clienteId")({
  head: () => ({
    meta: [
      { title: "Perfil do cliente — Base de Pagamentos" },
      {
        name: "description",
        content: "Total recebido, histórico de pagamentos e dados cadastrais do cliente.",
      },
      { property: "og:title", content: "Perfil do cliente — Base de Pagamentos" },
      { property: "og:description", content: "Histórico financeiro completo do cliente." },
    ],
  }),
  component: PerfilCliente,
});

function PerfilCliente() {
  const { clienteId } = Route.useParams();
  const { base, variacoes, carregando } = useSistema();
  const queryClient = useQueryClient();

  const cliente = base?.porId.get(clienteId);
  const pagamentos = base?.pagamentosPorCliente.get(clienteId) ?? [];
  const variacoesDoCliente = useMemo(
    () => variacoes.filter((v) => v.cliente_id === clienteId),
    [variacoes, clienteId],
  );

  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const salvar = useMutation({
    mutationFn: () => atualizarCliente(clienteId, { nome, cpf, observacoes }),
    onSuccess: async () => {
      toast.success("Dados atualizados.");
      await queryClient.invalidateQueries();
      setEditando(false);
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const alternarArquivo = useMutation({
    mutationFn: () => (cliente?.arquivado ? reativarCliente(clienteId) : arquivarCliente(clienteId)),
    onSuccess: async () => {
      toast.success("Status atualizado. O histórico financeiro foi preservado.");
      await queryClient.invalidateQueries();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  if (carregando || !base) return <Skeleton className="h-96 rounded-xl" />;

  if (!cliente) {
    return (
      <SecaoVazia titulo="Cliente não encontrado" descricao="Este cadastro pode ter sido removido." />
    );
  }

  function iniciarEdicao() {
    if (!cliente) return;
    setNome(cliente.nome);
    setCpf(cliente.cpf ?? "");
    setObservacoes(cliente.observacoes ?? "");
    setEditando(true);
  }

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/clientes">
          <ArrowLeft className="size-4" aria-hidden />
          Voltar para clientes
        </Link>
      </Button>

      <PageHeader
        titulo={cliente.nome}
        descricao={`Cadastrado em ${formatDate(cliente.created_at)}${
          cliente.origem_importacao ? ` · Origem: ${cliente.origem_importacao}` : ""
        }`}
      >
        <Button variant="outline" onClick={() => alternarArquivo.mutate()}>
          <Archive className="size-4" aria-hidden />
          {cliente.arquivado ? "Reativar" : "Arquivar"}
        </Button>
        <DialogPagamento
          clienteFixo={cliente}
          trigger={
            <Button>
              <Plus className="size-4" aria-hidden />
              Registrar pagamento
            </Button>
          }
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          titulo="Total recebido"
          valor={formatBRL(cliente.totalRecebido)}
          icone={Coins}
          tom="money"
        />
        <StatCard titulo="Quantidade de pagamentos" valor={cliente.quantidadePagamentos} icone={Receipt} />
        <StatCard
          titulo="Último pagamento"
          valor={formatDate(cliente.ultimoPagamento)}
          icone={CalendarClock}
          tom="info"
        />
        <StatCard
          titulo="Primeiro pagamento"
          valor={formatDate(cliente.primeiroPagamento)}
          icone={CalendarDays}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="mb-3 text-lg font-bold tracking-tight">Histórico de pagamentos</h2>
          {pagamentos.length === 0 ? (
            <SecaoVazia
              titulo="Nenhum pagamento registrado"
              descricao="Use o botão Registrar pagamento para começar o histórico."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Data</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead>Cadastrado por</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagamentos.map((pagamento) => (
                    <TableRow key={pagamento.id}>
                      <TableCell className="tabular font-medium">
                        {formatDate(pagamento.data_pagamento)}
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
        </section>

        <aside className="space-y-4">
          <Card className="gap-3 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Dados cadastrais
              </h3>
              {!editando ? (
                <Button size="sm" variant="ghost" onClick={iniciarEdicao}>
                  Editar
                </Button>
              ) : null}
            </div>

            {editando ? (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="cliente-nome">Nome completo</Label>
                  <Input id="cliente-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cliente-cpf">CPF (opcional)</Label>
                  <Input id="cliente-cpf" value={cpf} onChange={(e) => setCpf(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="cliente-obs">Observações</Label>
                  <Textarea
                    id="cliente-obs"
                    rows={3}
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
                    <Save className="size-4" aria-hidden />
                    Salvar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditando(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">CPF</dt>
                  <dd className="font-medium">{cliente.cpf || "Não informado"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd className="font-medium capitalize">{cliente.status}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Origem da importação</dt>
                  <dd className="font-medium">{cliente.origem_importacao || "Cadastro manual"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Data da importação</dt>
                  <dd className="font-medium tabular">{formatDate(cliente.data_importacao)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Observações</dt>
                  <dd className="font-medium">{cliente.observacoes || "—"}</dd>
                </div>
              </dl>
            )}
          </Card>

          <Card className="gap-2 p-5">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Variações do nome
            </h3>
            {variacoesDoCliente.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma ainda. Elas são criadas ao confirmar correspondências.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {variacoesDoCliente.map((variacao) => (
                  <li
                    key={variacao.id}
                    className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
                  >
                    {variacao.nome_variacao}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
