import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
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
import { formatDateTime } from "@/lib/format";
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
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.nome_original}</TableCell>
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

function HistoricoImportacoes() {
  const { importacoes, importados, carregando } = useSistema();
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
        <Button asChild size="sm">
          <Link to="/importar">Nova importação</Link>
        </Button>
      </PageHeader>

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
