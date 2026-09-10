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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSistema } from "@/hooks/useSistema";
import { ROTULO_CLASSIFICACAO, normalizarNome, type Classificacao } from "@/lib/similarity";
import type { CorrespondenciaDetalhada } from "@/lib/tipos";

export const Route = createFileRoute("/analise")({
  head: () => ({
    meta: [
      { title: "Análise de nomes — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Todas as correspondências de nomes encontradas, organizadas por faixa de probabilidade.",
      },
      { property: "og:title", content: "Análise de nomes — Base de Pagamentos" },
      {
        property: "og:description",
        content: "Correspondências de nomes por faixa de similaridade.",
      },
    ],
  }),
  component: AnaliseNomes,
});

type Aba = "todas" | Classificacao;

function AnaliseNomes() {
  const { base, correspondencias, carregando } = useSistema();
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("pendente");
  const [aba, setAba] = useState<Aba>("todas");
  const [selecionado, setSelecionado] = useState<CorrespondenciaDetalhada | null>(null);

  const contagens = useMemo(() => {
    const base: Record<Aba, number> = { todas: 0, igual: 0, muito_parecido: 0, possivel: 0 };
    for (const item of correspondencias) {
      if (status !== "todos" && item.correspondencia.status !== status) continue;
      base.todas += 1;
      base[item.correspondencia.classificacao] += 1;
    }
    return base;
  }, [correspondencias, status]);

  const itens = useMemo(() => {
    let lista = correspondencias;

    if (status !== "todos") {
      lista = lista.filter((item) => item.correspondencia.status === status);
    }
    if (aba !== "todas") {
      lista = lista.filter((item) => item.correspondencia.classificacao === aba);
    }
    const termo = normalizarNome(busca);
    if (termo) {
      lista = lista.filter(
        (item) =>
          item.importado.nome_normalizado.includes(termo) ||
          item.clienteEncontrado.nome_normalizado.includes(termo),
      );
    }

    return [...lista].sort(
      (a, b) =>
        b.correspondencia.percentual_similaridade - a.correspondencia.percentual_similaridade,
    );
  }, [correspondencias, status, aba, busca]);

  if (carregando || !base) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Análise de nomes" />
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
        titulo="Análise de nomes"
        descricao="Todas as correspondências encontradas, organizadas por faixa de probabilidade — do mais parecido ao menos parecido."
      />

      <Tabs value={aba} onValueChange={(valor) => setAba(valor as Aba)} className="mb-4">
        <TabsList>
          <TabsTrigger value="todas">Todas ({contagens.todas})</TabsTrigger>
          <TabsTrigger value="igual">
            {ROTULO_CLASSIFICACAO.igual} ({contagens.igual})
          </TabsTrigger>
          <TabsTrigger value="muito_parecido">
            {ROTULO_CLASSIFICACAO.muito_parecido} ({contagens.muito_parecido})
          </TabsTrigger>
          <TabsTrigger value="possivel">
            {ROTULO_CLASSIFICACAO.possivel} ({contagens.possivel})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
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
          <SelectTrigger className="h-11 lg:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="confirmado">Confirmados</SelectItem>
            <SelectItem value="analisar_depois">Analisar depois</SelectItem>
            <SelectItem value="rejeitado">Pessoas diferentes</SelectItem>
            <SelectItem value="todos">Todos os status</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {itens.length === 0 ? (
        <SecaoVazia
          titulo="Nada por aqui"
          descricao="Nenhuma correspondência encontrada com os filtros atuais."
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
