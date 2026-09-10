import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { ModalCorrespondencia } from "@/components/ModalCorrespondencia";
import { TabelaCorrespondencias } from "@/components/TabelaCorrespondencias";
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
import { filtrarJaPagos, useSistema } from "@/hooks/useSistema";
import { normalizarNome } from "@/lib/similarity";
import type { CorrespondenciaDetalhada } from "@/lib/tipos";

export const Route = createFileRoute("/ja-pagos")({
  head: () => ({
    meta: [
      { title: "Já pagos — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Clientes da nova listagem que correspondem a pessoas que já receberam valores anteriormente.",
      },
      { property: "og:title", content: "Já pagos — Base de Pagamentos" },
      {
        property: "og:description",
        content: "Correspondências com clientes que já receberam valores.",
      },
    ],
  }),
  component: JaPagos,
});

type OrdenacaoJaPagos = "valor_desc" | "valor_asc" | "similaridade_desc" | "similaridade_asc" | "recente";

function JaPagos() {
  const { base, correspondencias, carregando } = useSistema();
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("pendente");
  const [classificacao, setClassificacao] = useState<string>("todas");
  const [ordenacao, setOrdenacao] = useState<OrdenacaoJaPagos>("valor_desc");
  const [selecionado, setSelecionado] = useState<CorrespondenciaDetalhada | null>(null);

  const itens = useMemo(() => {
    let lista = filtrarJaPagos(correspondencias);

    if (status !== "todos") {
      lista = lista.filter((item) => item.correspondencia.status === status);
    }
    if (classificacao !== "todas") {
      lista = lista.filter((item) => item.correspondencia.classificacao === classificacao);
    }
    const termo = normalizarNome(busca);
    if (termo) {
      lista = lista.filter(
        (item) =>
          item.importado.nome_normalizado.includes(termo) ||
          item.clienteEncontrado.nome_normalizado.includes(termo),
      );
    }

    const ordenadores: Record<OrdenacaoJaPagos, (a: CorrespondenciaDetalhada, b: CorrespondenciaDetalhada) => number> = {
      valor_desc: (a, b) => b.clienteEncontrado.totalRecebido - a.clienteEncontrado.totalRecebido,
      valor_asc: (a, b) => a.clienteEncontrado.totalRecebido - b.clienteEncontrado.totalRecebido,
      similaridade_desc: (a, b) =>
        b.correspondencia.percentual_similaridade - a.correspondencia.percentual_similaridade,
      similaridade_asc: (a, b) =>
        a.correspondencia.percentual_similaridade - b.correspondencia.percentual_similaridade,
      recente: (a, b) => b.importado.created_at.localeCompare(a.importado.created_at),
    };

    return [...lista].sort(ordenadores[ordenacao]);
  }, [correspondencias, status, classificacao, busca, ordenacao]);

  if (carregando || !base) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Já pagos" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  const pagamentosDoSelecionado = selecionado
    ? (base.pagamentosPorCliente.get(selecionado.clienteEncontrado.id) ?? [])
    : [];

  return (
    <div>
      <PageHeader
        titulo="Já pagos"
        descricao="Correspondências com clientes que já possuem pagamentos registrados. Confirme ou descarte cada uma."
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Pesquisar nome..."
            className="h-11 pl-9 text-base"
            aria-label="Pesquisar correspondência"
          />
        </div>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-11 lg:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="confirmado">Confirmados</SelectItem>
            <SelectItem value="analisar_depois">Analisar depois</SelectItem>
            <SelectItem value="todos">Todos os status</SelectItem>
          </SelectContent>
        </Select>

        <Select value={classificacao} onValueChange={setClassificacao}>
          <SelectTrigger className="h-11 lg:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as similaridades</SelectItem>
            <SelectItem value="igual">Igual</SelectItem>
            <SelectItem value="muito_parecido">Muito parecido</SelectItem>
            <SelectItem value="possivel">Possível correspondência</SelectItem>
          </SelectContent>
        </Select>

        <Select value={ordenacao} onValueChange={(valor) => setOrdenacao(valor as OrdenacaoJaPagos)}>
          <SelectTrigger className="h-11 lg:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="valor_desc">Maior valor recebido</SelectItem>
            <SelectItem value="valor_asc">Menor valor recebido</SelectItem>
            <SelectItem value="similaridade_desc">Maior similaridade</SelectItem>
            <SelectItem value="similaridade_asc">Menor similaridade</SelectItem>
            <SelectItem value="recente">Mais recentes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {itens.length === 0 ? (
        <SecaoVazia
          titulo="Nada por aqui"
          descricao="Nenhuma correspondência com clientes que já receberam valores nos filtros atuais."
        />
      ) : (
        <TabelaCorrespondencias itens={itens} onAbrir={setSelecionado} />
      )}

      <ModalCorrespondencia
        item={selecionado}
        pagamentos={pagamentosDoSelecionado}
        onFechar={() => setSelecionado(null)}
      />
    </div>
  );
}
