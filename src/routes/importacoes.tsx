/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda sem tipos gerados (types.ts) */
import {
  avisarEmAtualizacao,
  BotaoEmAtualizacao,
  MENSAGEM_EM_ATUALIZACAO,
} from "@/components/EmAtualizacao";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
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
import { FiltroEscritorioSelect } from "@/components/FiltroEscritorioSelect";
import { BadgeEscritorio, registroPassaFiltro, useFiltroEscritorio } from "@/lib/escritorio";
import { lotesQuery } from "@/lib/furtado/consultas";
import { ROTULO_STATUS_LOTE } from "@/lib/furtado/rotulosUi";
import { formatBRL, formatDate, formatDateTime } from "@/lib/format";
import type { ClienteImportado, Importacao, StatusAnalise } from "@/lib/tipos";

export const Route = createFileRoute("/importacoes")({
  head: () => ({
    meta: [
      { title: "Histórico de importações — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Cada importação realizada, com contagem de correspondências e já pagos identificados.",
      },
      { property: "og:title", content: "Histórico de importações — Base de Pagamentos" },
      { property: "og:description", content: "Histórico completo de importações de clientes." },
    ],
  }),
  component: HistoricoImportacoes,
});

const ROTULO_STATUS: Record<
  StatusAnalise,
  { texto: string; tom: "neutro" | "sucesso" | "alerta" | "perigo" }
> = {
  pendente: { texto: "Pendente", tom: "alerta" },
  sem_correspondencia: { texto: "Sem correspondência", tom: "neutro" },
  ja_pago: { texto: "Já pago", tom: "perigo" },
  confirmado: { texto: "Confirmado", tom: "sucesso" },
  rejeitado: { texto: "Rejeitado", tom: "neutro" },
  analisar_depois: { texto: "Analisar depois", tom: "alerta" },
};

function DetalheImportacao({ itens }: { itens: ClienteImportado[] }) {
  if (itens.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum registro encontrado.</p>;
  }
  return (
    <div className="border-t border-border bg-muted/20 px-4 py-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome importado</TableHead>
            <TableHead>CPF</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.nome_original}</TableCell>
              <TableCell className="tabular text-sm text-muted-foreground">
                {item.cpf_original ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular text-sm">
                {item.valor_original != null ? formatBRL(item.valor_original) : "—"}
              </TableCell>
              <TableCell className="tabular text-sm">
                {item.data_original ? formatDate(item.data_original) : "—"}
              </TableCell>
              <TableCell>
                <BadgeStatus
                  texto={ROTULO_STATUS[item.status_analise].texto}
                  tom={ROTULO_STATUS[item.status_analise].tom}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function LinhaImportacao({
  importacao,
  itens,
  aberta,
  onAlternar,
}: {
  importacao: Importacao;
  itens: ClienteImportado[];
  aberta: boolean;
  onAlternar: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full flex-col gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3">
          {importacao.tipo_origem === "arquivo" ? (
            <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <Upload className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div>
            <p className="text-sm font-semibold text-foreground">{importacao.nome_importacao}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(importacao.created_at)}
              {importacao.origem_arquivo ? ` · ${importacao.origem_arquivo}` : " · colagem manual"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="tabular">
            <strong>{importacao.quantidade_clientes}</strong>{" "}
            <span className="text-muted-foreground">importados</span>
          </span>
          <span className="tabular">
            <strong>{importacao.quantidade_correspondencias}</strong>{" "}
            <span className="text-muted-foreground">correspondências</span>
          </span>
          <span className="tabular text-danger">
            <strong>{importacao.quantidade_ja_pagos}</strong>{" "}
            <span className="text-muted-foreground">já pagos</span>
          </span>
          <span className="tabular text-info">
            <strong>{importacao.quantidade_possiveis}</strong>{" "}
            <span className="text-muted-foreground">possíveis</span>
          </span>
          {aberta ? (
            <ChevronUp className="size-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          )}
        </div>
      </button>
      {aberta ? <DetalheImportacao itens={itens} /> : null}
    </div>
  );
}

function LotesPorEscritorio() {
  const { data: lotes = [] } = useQuery(lotesQuery());
  const { filtro } = useFiltroEscritorio();
  const lista = lotes.filter((l) => registroPassaFiltro(l.escritorio, filtro));
  if (!lista.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Lotes de importação por escritório
      </h2>
      <div className="space-y-2">
        {lista.map((l) => {
          const st = ROTULO_STATUS_LOTE[l.status] ?? { texto: l.status, tom: "neutro" as const };
          const plano = (l.resumo?.["plano"] ?? {}) as Record<string, number>;
          return (
            <button
              key={l.id}
              type="button"
              title={MENSAGEM_EM_ATUALIZACAO}
              onClick={avisarEmAtualizacao}
              className="flex w-full cursor-default flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {l.arquivo_nome}
                    <BadgeEscritorio escritorio={l.escritorio} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(l.created_at)} · {l.pessoas_aplicadas} de {l.total_pessoas}{" "}
                    pessoa(s) gravada(s)
                    {plano["pendenciasAbertas"]
                      ? ` · ${plano["pendenciasAbertas"]} pendência(s) identificada(s)`
                      : ""}
                  </p>
                </div>
              </div>
              <BadgeStatus texto={st.texto} tom={st.tom} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function HistoricoImportacoes() {
  const { importacoes: todasImportacoes, importados, carregando } = useSistema();
  const { filtro } = useFiltroEscritorio();
  const importacoes = todasImportacoes.filter(
    (i) => filtro === "todos" || (i.escritorio ?? "a_confirmar") === filtro,
  );
  const [abertaId, setAbertaId] = useState<string | null>(null);

  const itensPorImportacao = useMemo(() => {
    const mapa = new Map<string, ClienteImportado[]>();
    for (const item of importados) {
      const lista = mapa.get(item.importacao_id) ?? [];
      lista.push(item);
      mapa.set(item.importacao_id, lista);
    }
    return mapa;
  }, [importados]);

  if (carregando) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Histórico de importações" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        titulo="Histórico de importações"
        descricao="Todas as importações realizadas, com o resultado da comparação automática de nomes."
      >
        <FiltroEscritorioSelect className="h-9" />
        <BotaoEmAtualizacao size="sm">Nova importação</BotaoEmAtualizacao>
      </PageHeader>

      <LotesPorEscritorio />

      {importacoes.length === 0 ? (
        <SecaoVazia
          titulo="Nenhuma importação ainda"
          descricao="Quando você importar uma listagem de clientes, ela aparece aqui com o resultado completo."
        />
      ) : (
        <div className="space-y-3">
          {importacoes.map((importacao) => (
            <LinhaImportacao
              key={importacao.id}
              importacao={importacao}
              itens={itensPorImportacao.get(importacao.id) ?? []}
              aberta={abertaId === importacao.id}
              onAlternar={() =>
                setAbertaId((atual) => (atual === importacao.id ? null : importacao.id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
