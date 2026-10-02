import { useQuery } from "@tanstack/react-query";
import { LinkPerfil } from "@/components/LinkPerfil";
import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList, Coins, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { FiltroEscritorioSelect } from "@/components/FiltroEscritorioSelect";
import { StatCard } from "@/components/StatCard";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSistema } from "@/hooks/useSistema";
import { BadgeEscritorio, registroPassaFiltro, useFiltroEscritorio } from "@/lib/escritorio";
import { formatBRL, formatDate } from "@/lib/format";
import { cobrancasQuery } from "@/lib/furtado/consultas";
import { normalizarNome } from "@/lib/similarity";

export const Route = createFileRoute("/cobrancas")({
  head: () => ({
    meta: [
      { title: "Cobranças e parcelas — Base de Pagamentos" },
      {
        name: "description",
        content: "Cobranças de honorários, parcelamentos e parcelas por escritório.",
      },
    ],
  }),
  component: Cobrancas,
});

const SITUACAO: Record<string, string> = {
  pendente: "Pendente",
  parcial: "Parcialmente paga",
  quitada: "Quitada",
  a_confirmar: "A confirmar",
};

function Cobrancas() {
  const { base, carregando } = useSistema();
  const { filtro } = useFiltroEscritorio();
  const { data, isLoading } = useQuery(cobrancasQuery());
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("abertas");

  const { cobrancas, parcelas, saldo } = useMemo(() => {
    if (!base || !data) return { cobrancas: [], parcelas: [], saldo: 0 };
    const termo = normalizarNome(busca);
    const escopo = data.cobrancas.filter(
      (c) => base.porId.has(c.cliente_id) && registroPassaFiltro(c.escritorio, filtro),
    );
    const ids = new Set(escopo.map((c) => c.id));
    const todasParcelas = data.parcelas.filter((p) => ids.has(p.cobranca_id));
    const parcelasPorCob = new Map<string, typeof todasParcelas>();
    for (const p of todasParcelas)
      parcelasPorCob.set(p.cobranca_id, [...(parcelasPorCob.get(p.cobranca_id) ?? []), p]);
    let saldo = 0;
    for (const c of escopo) {
      if (c.situacao === "quitada") continue;
      const ps = parcelasPorCob.get(c.id);
      saldo += ps?.length
        ? ps.reduce((s, p) => s + (p.valor - p.valor_pago), 0)
        : (c.valor_contratado ?? 0);
    }
    const cobs = escopo
      .filter((c) =>
        situacao === "todas"
          ? true
          : situacao === "abertas"
            ? c.situacao !== "quitada"
            : c.situacao === situacao,
      )
      .filter((c) => !termo || base.porId.get(c.cliente_id)!.nome_normalizado.includes(termo));
    const visiveis = new Set(cobs.map((c) => c.id));
    return {
      cobrancas: cobs,
      parcelas: todasParcelas.filter((p) => visiveis.has(p.cobranca_id)),
      saldo: Math.round(saldo * 100) / 100,
    };
  }, [base, data, filtro, busca, situacao]);

  if (carregando || !base || isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Cobranças e parcelas" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  const nome = (id: string) => base.porId.get(id)?.nome ?? "—";
  const cobPorId = new Map(cobrancas.map((c) => [c.id, c]));

  return (
    <div>
      <PageHeader
        titulo="Cobranças e parcelas"
        descricao="Parcelas só existem quando o acordo trouxe dados suficientes e consistentes."
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard titulo="Cobranças no filtro" valor={cobrancas.length} icone={ClipboardList} />
        <StatCard
          titulo="Saldo em aberto (escritório)"
          valor={formatBRL(saldo)}
          icone={Coins}
          tom="warning"
        />
        <StatCard
          titulo="Parcelas abertas"
          valor={parcelas.filter((p) => p.situacao !== "paga").length}
          icone={ClipboardList}
          tom="info"
        />
      </div>
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar cliente..."
            className="h-12 pl-10 text-base"
          />
        </div>
        <FiltroEscritorioSelect />
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger className="h-12 lg:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abertas">Não quitadas</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
            {Object.entries(SITUACAO).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Tabs defaultValue="cobrancas">
        <TabsList>
          <TabsTrigger value="cobrancas">Cobranças ({cobrancas.length})</TabsTrigger>
          <TabsTrigger value="parcelas">Parcelas ({parcelas.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="cobrancas" className="mt-3">
          {cobrancas.length === 0 ? (
            <SecaoVazia titulo="Nenhuma cobrança no filtro" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Cliente</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Contratado</TableHead>
                    <TableHead>Parcelamento</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>A completar / divergência</TableHead>
                    <TableHead>Escritório</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cobrancas.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <LinkPerfil clienteId={c.cliente_id}>{nome(c.cliente_id)}</LinkPerfil>
                      </TableCell>
                      <TableCell className="max-w-64 text-sm">{c.descricao}</TableCell>
                      <TableCell className="text-right tabular">
                        {c.valor_contratado !== null ? formatBRL(c.valor_contratado) : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.quantidade_parcelas
                          ? `${c.quantidade_parcelas} × ${c.valor_parcela !== null ? formatBRL(c.valor_parcela) : "?"}`
                          : "—"}
                        {c.entrada ? (
                          <span className="block text-xs text-muted-foreground">
                            entrada {formatBRL(c.entrada)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">{SITUACAO[c.situacao]}</TableCell>
                      <TableCell className="max-w-64 text-xs text-muted-foreground">
                        {[c.divergencia, c.completar ? `Completar: ${c.completar}` : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </TableCell>
                      <TableCell>
                        <BadgeEscritorio escritorio={c.escritorio} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="parcelas" className="mt-3">
          {parcelas.length === 0 ? (
            <SecaoVazia titulo="Nenhuma parcela no filtro" />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Cliente</TableHead>
                    <TableHead>Parcela</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="text-right">Pago</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...parcelas]
                    .sort(
                      (a, b) =>
                        (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999") ||
                        a.numero - b.numero,
                    )
                    .map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <LinkPerfil clienteId={p.cliente_id}>{nome(p.cliente_id)}</LinkPerfil>
                          <span className="block text-xs text-muted-foreground">
                            {cobPorId.get(p.cobranca_id)?.descricao}
                          </span>
                        </TableCell>
                        <TableCell>{p.numero}</TableCell>
                        <TableCell className="text-right tabular">{formatBRL(p.valor)}</TableCell>
                        <TableCell className="text-sm">
                          {p.vencimento
                            ? formatDate(p.vencimento)
                            : (p.vencimento_texto ?? "não informado")}
                        </TableCell>
                        <TableCell className="text-sm">
                          {p.situacao === "paga"
                            ? "Paga"
                            : p.situacao === "paga_parcial"
                              ? "Parcial"
                              : "Aberta"}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          {formatBRL(p.valor_pago)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
