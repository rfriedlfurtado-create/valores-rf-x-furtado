import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Coins, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
import { LinkPerfil } from "@/components/LinkPerfil";
import { StatCard } from "@/components/StatCard";
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
import { formatBRL } from "@/lib/format";
import { normalizarTexto } from "@/lib/situacao";
import { DialogReceberPrevisto } from "@/components/DialogReceberPrevisto";
import {
  ROTULO_SITUACAO_PREVISTO,
  saldoPrevisto,
  SITUACOES_PENDENTES,
  valoresPrevistosQuery,
  type SituacaoPrevisto,
  type ValorPrevisto,
} from "@/lib/valoresPrevistos";
import { ROTULO_CATEGORIA_PROCESSO } from "@/lib/valoresProcesso";

export const Route = createFileRoute("/valores-previstos")({
  head: () => ({
    meta: [
      { title: "Valores previstos — Base de Pagamentos" },
      {
        name: "description",
        content: "Valores a receber, parcelas futuras e recebimentos ainda não confirmados.",
      },
    ],
  }),
  component: ValoresPrevistos,
});

const TOM: Record<SituacaoPrevisto, "sucesso" | "neutro" | "alerta" | "perigo"> = {
  a_receber: "neutro",
  parcial: "alerta",
  nao_confirmado: "alerta",
  nao_havera_cobranca: "neutro",
  nao_havera_sucumbencia: "neutro",
  recebido: "sucesso",
  cancelado: "neutro",
};

const ORIGEM: Record<string, string> = {
  judicial: "Judicial",
  administrativo: "Administrativo — INSS",
};

function ValoresPrevistos() {
  const { base, carregando } = useSistema();
  const previstos = useQuery(valoresPrevistosQuery());
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("pendentes");
  const [categoria, setCategoria] = useState("todas");
  const [origem, setOrigem] = useState("todas");

  const linhas = useMemo(() => {
    const q = normalizarTexto(busca);
    return (previstos.data ?? []).filter((v) => {
      const cliente = base?.porId.get(v.cliente_id);
      if (q && !normalizarTexto(cliente?.nome ?? "").includes(q)) return false;
      if (situacao === "pendentes" && !SITUACOES_PENDENTES.includes(v.situacao)) return false;
      if (situacao === "conferencia" && !v.conferencia && v.atendimento_id) return false;
      if (!["pendentes", "todas", "conferencia"].includes(situacao) && v.situacao !== situacao)
        return false;
      if (categoria !== "todas" && (v.categoria ?? "sem") !== categoria) return false;
      if (origem !== "todas" && v.origem !== origem) return false;
      return true;
    });
  }, [previstos.data, base, busca, situacao, categoria, origem]);

  const totais = useMemo(() => {
    const t = { pendente: 0, atrasados: 0, implantacao: 0, sucumbencia: 0, sem: 0, qtd: 0 };
    for (const v of previstos.data ?? []) {
      const s = saldoPrevisto(v);
      if (!s) continue;
      t.pendente += s;
      t.qtd += 1;
      t[(v.categoria ?? "sem") as "atrasados"] += s;
    }
    for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = Math.round(t[k] * 100) / 100;
    return t;
  }, [previstos.data]);

  if (carregando || !base || previstos.isLoading)
    return (
      <div className="space-y-4">
        <PageHeader titulo="Valores previstos" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );

  const processoDe = (v: ValorPrevisto) =>
    v.atendimento_id
      ? base.porId.get(v.cliente_id)?.processos.find((p) => p.id === v.atendimento_id)
      : undefined;

  return (
    <div>
      <PageHeader
        titulo="Valores previstos"
        descricao="Valores a receber, parcelas futuras e recebimentos sem confirmação. Não entram no TOTAL RECEBIDO — ao receber, registre aqui e o valor passa para o card do processo."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          titulo="Pendente (saldo)"
          valor={formatBRL(totais.pendente)}
          icone={CalendarClock}
          tom="warning"
          descricao={`${totais.qtd} valor(es)`}
        />
        <StatCard titulo="Atrasados" valor={formatBRL(totais.atrasados)} icone={Coins} />
        <StatCard titulo="Contratual" valor={formatBRL(totais.implantacao)} icone={Coins} />
        <StatCard
          titulo="Sucumbência"
          valor={formatBRL(totais.sucumbencia)}
          icone={Coins}
          descricao={
            totais.sem ? `+ ${formatBRL(totais.sem)} sem categoria (conferência)` : undefined
          }
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente…"
            className="pl-9"
            aria-label="Buscar cliente"
          />
        </div>
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger className="w-52" aria-label="Situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pendentes">Pendentes</SelectItem>
            <SelectItem value="conferencia">Para conferência</SelectItem>
            {(Object.keys(ROTULO_SITUACAO_PREVISTO) as SituacaoPrevisto[]).map((s) => (
              <SelectItem key={s} value={s}>
                {ROTULO_SITUACAO_PREVISTO[s]}
              </SelectItem>
            ))}
            <SelectItem value="todas">Todas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger className="w-44" aria-label="Card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todos os cards</SelectItem>
            <SelectItem value="atrasados">Atrasados</SelectItem>
            <SelectItem value="implantacao">Contratual</SelectItem>
            <SelectItem value="sucumbencia">Sucumbência</SelectItem>
            <SelectItem value="sem">Sem categoria</SelectItem>
          </SelectContent>
        </Select>
        <Select value={origem} onValueChange={setOrigem}>
          <SelectTrigger className="w-52" aria-label="Origem">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as origens</SelectItem>
            <SelectItem value="judicial">Judicial</SelectItem>
            <SelectItem value="administrativo">Administrativo — INSS</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!linhas.length ? (
        <SecaoVazia
          titulo="Nenhum valor previsto neste filtro"
          descricao="Valores previstos vêm da importação de valores ou são lançados no perfil."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Cliente</TableHead>
                <TableHead>Processo / benefício</TableHead>
                <TableHead>Card</TableHead>
                <TableHead className="min-w-48">Descrição</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((v) => {
                const cliente = base.porId.get(v.cliente_id);
                const proc = processoDe(v);
                return (
                  <TableRow key={v.id} className="align-top">
                    <TableCell className="min-w-36 text-sm">
                      <LinkPerfil clienteId={v.cliente_id}>{cliente?.nome ?? "—"}</LinkPerfil>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {proc ? (
                        (proc.numero ?? "Sem número")
                      ) : (
                        <span className="text-warning">Sem processo (conferência)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-semibold">
                      {v.categoria ? (
                        ROTULO_CATEGORIA_PROCESSO[v.categoria].toUpperCase()
                      ) : (
                        <span className="text-warning">CONFERÊNCIA</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="block">{v.descricao}</span>
                      {v.percentual || v.parcela || v.competencia ? (
                        <span className="block text-muted-foreground">
                          {[v.percentual, v.parcela && `parcelas: ${v.parcela}`, v.competencia]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                      {v.observacao ? (
                        <span className="block text-muted-foreground">
                          {v.observacao.slice(0, 180)}
                        </span>
                      ) : null}
                      {v.conferencia ? (
                        <span className="block text-warning">{v.conferencia.slice(0, 200)}</span>
                      ) : null}
                      {v.celulas ? (
                        <span className="block text-muted-foreground">Origem: {v.celulas}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      {v.origem ? ORIGEM[v.origem] : "—"}
                      {v.canal ? (
                        <span className="block text-muted-foreground">{v.canal}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular text-right whitespace-nowrap">
                      {v.valor === null ? "—" : formatBRL(v.valor)}
                      {v.valor_recebido ? (
                        <span className="block text-xs text-muted-foreground">
                          recebido {formatBRL(v.valor_recebido)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular text-right font-semibold whitespace-nowrap">
                      {saldoPrevisto(v) ? formatBRL(saldoPrevisto(v)) : "—"}
                    </TableCell>
                    <TableCell className="w-40">
                      <div className="flex flex-col items-start gap-2">
                        <BadgeStatus
                          texto={ROTULO_SITUACAO_PREVISTO[v.situacao]}
                          tom={TOM[v.situacao]}
                        />
                        {SITUACOES_PENDENTES.includes(v.situacao) ? (
                          <DialogReceberPrevisto previsto={v} compacto />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
