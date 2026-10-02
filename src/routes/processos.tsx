import { useQuery } from "@tanstack/react-query";
import { TextoPerfilEmAtualizacao } from "@/components/EmAtualizacao";
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { FiltroEscritorioSelect } from "@/components/FiltroEscritorioSelect";
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
import { BadgeEscritorio, registroPassaFiltro, useFiltroEscritorio } from "@/lib/escritorio";
import { atendimentosQuery, beneficiosTodosQuery } from "@/lib/furtado/consultas";
import { normalizarNome } from "@/lib/similarity";

export const Route = createFileRoute("/processos")({
  head: () => ({
    meta: [
      { title: "Processos e atendimentos — Base de Pagamentos" },
      {
        name: "description",
        content: "Processos judiciais e atendimentos administrativos por cliente e escritório.",
      },
    ],
  }),
  component: Processos,
});

function Processos() {
  const { base, carregando } = useSistema();
  const { filtro } = useFiltroEscritorio();
  const atendimentos = useQuery(atendimentosQuery());
  const beneficios = useQuery(beneficiosTodosQuery());
  const [busca, setBusca] = useState("");
  const [natureza, setNatureza] = useState("todas");

  const nbsPorAtendimento = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const b of beneficios.data ?? [])
      if (b.atendimento_id && b.nb_digitos)
        m.set(b.atendimento_id, [...(m.get(b.atendimento_id) ?? []), b.nb_digitos]);
    return m;
  }, [beneficios.data]);

  const lista = useMemo(() => {
    if (!base) return [];
    const termo = normalizarNome(busca);
    const digitos = busca.replace(/\D/g, "");
    return (atendimentos.data ?? [])
      .filter((a) => base.porId.has(a.cliente_id)) // fora da lixeira
      .filter((a) => registroPassaFiltro(a.escritorio, filtro))
      .filter((a) => natureza === "todas" || (a.natureza ?? "nao_informada") === natureza)
      .filter((a) => {
        if (!busca.trim()) return true;
        const cliente = base.porId.get(a.cliente_id)!;
        if (termo && cliente.nome_normalizado.includes(termo)) return true;
        if (
          digitos.length >= 3 &&
          ((a.processo_digitos ?? "").includes(digitos) ||
            (nbsPorAtendimento.get(a.id) ?? []).some((n) => n.includes(digitos)))
        )
          return true;
        return false;
      })
      .sort((a, b) =>
        base.porId
          .get(a.cliente_id)!
          .nome.localeCompare(base.porId.get(b.cliente_id)!.nome, "pt-BR"),
      );
  }, [base, atendimentos.data, filtro, natureza, busca, nbsPorAtendimento]);

  if (carregando || !base || atendimentos.isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Processos e atendimentos" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        titulo="Processos e atendimentos"
        descricao={`${lista.length} atendimento(s) no filtro atual.`}
      />
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar por nome, processo ou NB..."
            className="h-12 pl-10 text-base"
          />
        </div>
        <FiltroEscritorioSelect />
        <Select value={natureza} onValueChange={setNatureza}>
          <SelectTrigger className="h-12 lg:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Toda natureza</SelectItem>
            <SelectItem value="judicial">Judicial</SelectItem>
            <SelectItem value="administrativo">Administrativa</SelectItem>
            <SelectItem value="nao_informada">Não identificada</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {lista.length === 0 ? (
        <SecaoVazia
          titulo="Nenhum atendimento encontrado"
          descricao="Ajuste os filtros ou importe a planilha da Furtado Advogados."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-52">Cliente</TableHead>
                <TableHead>Processo</TableHead>
                <TableHead>Tribunal / órgão</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead>Benefício</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Escritório</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.slice(0, 1000).map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <TextoPerfilEmAtualizacao>
                      {base.porId.get(a.cliente_id)?.nome}
                    </TextoPerfilEmAtualizacao>
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular text-sm">
                    {a.numero_processo ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{a.tribunal ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {a.servico ?? "—"}
                    <span className="block text-xs text-muted-foreground">
                      {a.natureza === "judicial"
                        ? "Judicial"
                        : a.natureza === "administrativo"
                          ? "Administrativa"
                          : ""}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{a.beneficio ?? "—"}</TableCell>
                  <TableCell className="max-w-56 truncate text-sm" title={a.situacao ?? ""}>
                    {a.situacao?.replace(/_/g, " ") ?? "—"}
                  </TableCell>
                  <TableCell>
                    <BadgeEscritorio escritorio={a.escritorio} />
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
