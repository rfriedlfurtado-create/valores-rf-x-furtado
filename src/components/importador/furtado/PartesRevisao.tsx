/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda sem tipos gerados (types.ts) */
/**
 * Peças da revisão da importação Furtado (pré-visualização e lote gravado).
 */

import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/format";
import {
  ROTULO_CATEGORIA,
  ROTULO_DESTINO,
  ROTULO_PENDENCIA,
  type CategoriaFinanceira,
  type Destino,
  type TipoPendencia,
  type TotalPlanilha,
} from "@/lib/furtado/modelo";
import { cn } from "@/lib/utils";

export function Contador({
  valor,
  rotulo,
  tom,
  dica,
}: {
  valor: ReactNode;
  rotulo: string;
  tom?: "alerta" | "perigo" | "sucesso" | "info" | undefined;
  dica?: string | undefined;
}) {
  const cor =
    tom === "alerta"
      ? "text-amber-700 dark:text-amber-400"
      : tom === "perigo"
        ? "text-red-700 dark:text-red-400"
        : tom === "sucesso"
          ? "text-green-700 dark:text-green-400"
          : tom === "info"
            ? "text-sky-700 dark:text-sky-400"
            : "";
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5" title={dica}>
      <p className={cn("text-lg font-bold tabular leading-none", cor)}>{valor}</p>
      <p className="mt-1 text-xs text-muted-foreground">{rotulo}</p>
    </div>
  );
}

export const ROTULO_CORRESPONDENCIA: Record<string, { texto: string; classe: string }> = {
  cpf: {
    texto: "Mesmo CPF",
    classe: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  },
  processo: {
    texto: "Mesmo processo",
    classe: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  },
  nb: {
    texto: "Mesmo NB",
    classe: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  },
  furtado_anterior: {
    texto: "Já importado (Furtado)",
    classe: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  },
  nome_identico: {
    texto: "Nome idêntico",
    classe: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  semelhante: {
    texto: "Nome semelhante",
    classe: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  conflito: {
    texto: "Conflito de identificadores",
    classe: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  },
  nenhuma: {
    texto: "Sem cadastro",
    classe: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  },
  decisao: {
    texto: "Decidido na revisão",
    classe: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  },
};

export function BadgeCorrespondencia({ tipo }: { tipo: string | null | undefined }) {
  const r = ROTULO_CORRESPONDENCIA[tipo ?? "nenhuma"] ?? ROTULO_CORRESPONDENCIA["nenhuma"]!;
  return (
    <Badge variant="outline" className={cn("border-0 whitespace-nowrap", r.classe)}>
      {r.texto}
    </Badge>
  );
}

export function IconePendencia({ bloqueante, status }: { bloqueante: boolean; status?: string }) {
  if (status === "resolvida")
    return <CheckCircle2 className="size-4 shrink-0 text-green-600" aria-label="Resolvida" />;
  if (status === "ignorada")
    return <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-label="Ignorada" />;
  return bloqueante ? (
    <XCircle
      className="size-4 shrink-0 text-red-600"
      aria-label="Bloqueia a gravação deste cliente"
    />
  ) : (
    <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-label="Aviso para revisão" />
  );
}

export function rotuloPendencia(tipo: string): string {
  return ROTULO_PENDENCIA[tipo as TipoPendencia] ?? tipo;
}

export function TabelaValoresPorCategoria({
  porCategoria,
}: {
  porCategoria: Partial<Record<CategoriaFinanceira, number>>;
}) {
  const linhas = Object.entries(porCategoria).filter(([, v]) => v !== undefined) as [
    CategoriaFinanceira,
    number,
  ][];
  if (!linhas.length)
    return <p className="text-sm text-muted-foreground">Nenhum valor identificado.</p>;
  return (
    <ul className="grid gap-1 text-sm sm:grid-cols-2">
      {linhas.map(([c, v]) => (
        <li key={c} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5">
          <span>{ROTULO_CATEGORIA[c]}</span>
          <strong className="ml-auto tabular">{formatBRL(v)}</strong>
        </li>
      ))}
    </ul>
  );
}

export function TabelaTotais({ totais }: { totais: TotalPlanilha[] }) {
  if (!totais.length)
    return <p className="text-sm text-muted-foreground">Nenhum total geral encontrado.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Aba / célula</TableHead>
            <TableHead>Rótulo</TableHead>
            <TableHead className="text-right">Total na planilha</TableHead>
            <TableHead className="text-right">Recalculado</TableHead>
            <TableHead className="text-right">Apurado nos registros</TableHead>
            <TableHead className="text-right">Diferença</TableHead>
            <TableHead>Observações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totais.map((t) => (
            <TableRow key={`${t.aba}!${t.celula}`}>
              <TableCell className="whitespace-nowrap text-xs">
                {t.aba.trim()}!{t.celula}
              </TableCell>
              <TableCell className="text-xs">{t.rotulo ?? "—"}</TableCell>
              <TableCell className="text-right tabular text-xs">
                {typeof t.armazenado === "number" ? formatBRL(t.armazenado) : (t.armazenado ?? "—")}
              </TableCell>
              <TableCell className="text-right tabular text-xs">
                {t.erroFormula ? (
                  <span className="text-red-700">{t.erroFormula}</span>
                ) : typeof t.recalculado === "number" ? (
                  formatBRL(t.recalculado)
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right tabular text-xs">
                {t.apurado !== null ? formatBRL(t.apurado) : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right tabular text-xs",
                  t.diferenca !== null &&
                    Math.abs(t.diferenca) > 0.01 &&
                    "font-semibold text-amber-700 dark:text-amber-400",
                )}
              >
                {t.diferenca !== null ? formatBRL(t.diferenca) : "—"}
              </TableCell>
              <TableCell className="max-w-md text-xs text-muted-foreground">
                {[
                  t.omitidas.length ? `Fora da fórmula: ${t.omitidas.join(", ")}` : null,
                  t.estranhas.length
                    ? `Referências de outra categoria: ${t.estranhas.join(", ")}`
                    : null,
                  t.observacao,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <Info className="size-3.5" aria-hidden />
        Totais gerais são elementos do arquivo: servem para conferência e nunca são gravados como
        recebimentos.
      </p>
    </div>
  );
}

export function DistribuicaoDestinos({
  porDestino,
}: {
  porDestino: Partial<Record<Destino, number>>;
}) {
  const ordem: Destino[] = [
    "campo",
    "historico",
    "informacao_adicional",
    "resumo_arquivo",
    "pendencia_revisao",
  ];
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {ordem.map((d) => (
        <span key={d} className="rounded-md border border-border px-2 py-1">
          {ROTULO_DESTINO[d]}: <strong className="tabular">{porDestino[d] ?? 0}</strong>
        </span>
      ))}
    </div>
  );
}
