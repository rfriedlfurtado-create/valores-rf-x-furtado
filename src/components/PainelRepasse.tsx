/**
 * Dashboard — painel do REPASSE RICARDO FRIEDL (5 %).
 *
 * Mesma fonte de todas as páginas (base agregada + motor src/lib/repasse.ts),
 * com os filtros: clientes RF (vem do Dashboard), situação (CLIENTES / JÁ
 * PAGOS), período (data do recebimento) e categoria (quebra por linha).
 */
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BaseAgregada } from "@/lib/agregacao";
import { formatBRL } from "@/lib/format";
import {
  GRUPOS_REPASSE,
  noPeriodo,
  REGRA_REPASSE,
  resumirRepasse,
  ROTULO_GRUPO_REPASSE,
  type GrupoRepasse,
} from "@/lib/repasse";
import { estaEmTramitacao, estaPago } from "@/lib/situacao";

type FiltroSituacao = "todas" | "clientes" | "pagos";

const COR: Record<GrupoRepasse, string> = {
  implantacao: "bg-info",
  atrasados: "bg-money",
  sucumbencia: "bg-warning",
  sem_classificacao: "bg-muted-foreground/40",
};

export function PainelRepasse({ base, somenteRF }: { base: BaseAgregada; somenteRF: boolean }) {
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [situacao, setSituacao] = useState<FiltroSituacao>("todas");

  const resumo = useMemo(() => {
    const entradas = base.clientes
      .filter((c) => !somenteRF || c.cliente_rf)
      .filter((c) =>
        situacao === "todas" ? true : situacao === "pagos" ? estaPago(c) : estaEmTramitacao(c),
      )
      .filter((c) => estaPago(c) || estaEmTramitacao(c))
      .flatMap((c) => base.pagamentosPorCliente.get(c.id) ?? [])
      .filter((p) => noPeriodo(p.data_pagamento, de || null, ate || null));
    return resumirRepasse(entradas);
  }, [base, somenteRF, situacao, de, ate]);

  const periodo =
    de || ate
      ? `${de ? de.split("-").reverse().join("/") : "início"} a ${
          ate ? ate.split("-").reverse().join("/") : "hoje"
        }`
      : "Todo o período";

  return (
    <section
      className="mt-6 rounded-xl border border-money/30 bg-card p-5"
      aria-label="Repasse Ricardo Friedl por categoria"
      data-testid="painel-repasse"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide">
            Repasse Ricardo Friedl — {REGRA_REPASSE.rotulo}
          </h2>
          <p className="text-xs text-muted-foreground">
            {REGRA_REPASSE.rotulo} sobre cada valor efetivamente recebido pelo Furtado · {periodo}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            De
            <Input
              type="date"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              className="h-9 w-40"
              aria-label="Período: data inicial"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            Até
            <Input
              type="date"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              className="h-9 w-40"
              aria-label="Período: data final"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            Situação
            <Select value={situacao} onValueChange={(v) => setSituacao(v as FiltroSituacao)}>
              <SelectTrigger className="h-9 w-40" aria-label="Situação">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="clientes">CLIENTES</SelectItem>
                <SelectItem value="pagos">JÁ PAGOS</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Total recebido
          </p>
          <p className="tabular text-2xl font-bold">{formatBRL(resumo.recebido)}</p>
          <p className="text-xs text-muted-foreground">{resumo.quantidade} recebimento(s)</p>
        </div>
        <div className="rounded-lg border border-money/40 bg-money/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {REGRA_REPASSE.rotulo} Ricardo Friedl
          </p>
          <p className="tabular text-2xl font-bold text-money">{formatBRL(resumo.repasse)}</p>
          <p className="text-xs text-muted-foreground">Soma dos repasses de cada recebimento</p>
        </div>
      </div>

      <div
        className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={GRUPOS_REPASSE.map(
          (g) => `${ROTULO_GRUPO_REPASSE[g]} ${formatBRL(resumo.porCategoria[g].repasse)}`,
        ).join(", ")}
      >
        {GRUPOS_REPASSE.map((g) => (
          <div
            key={g}
            className={`h-full ${COR[g]}`}
            style={{
              width: `${resumo.repasse ? (resumo.porCategoria[g].repasse / resumo.repasse) * 100 : 0}%`,
            }}
          />
        ))}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Categoria</th>
              <th className="py-1 text-center">Recebimentos</th>
              <th className="py-1 text-right">Recebido</th>
              <th className="py-1 text-right">Repasse</th>
            </tr>
          </thead>
          <tbody>
            {GRUPOS_REPASSE.filter(
              (g) => g !== "sem_classificacao" || resumo.porCategoria[g].quantidade > 0,
            ).map((g) => (
              <tr key={g} className="border-t border-border">
                <td className="py-1.5">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className={`size-2.5 rounded-full ${COR[g]}`} aria-hidden />
                    {ROTULO_GRUPO_REPASSE[g]}
                  </span>
                </td>
                <td className="py-1.5 text-center tabular">{resumo.porCategoria[g].quantidade}</td>
                <td className="py-1.5 text-right tabular">
                  {formatBRL(resumo.porCategoria[g].recebido)}
                </td>
                <td className="py-1.5 text-right tabular font-semibold text-money">
                  {formatBRL(resumo.porCategoria[g].repasse)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-bold">
              <td className="py-1.5">TOTAL</td>
              <td className="py-1.5 text-center tabular">{resumo.quantidade}</td>
              <td className="py-1.5 text-right tabular">{formatBRL(resumo.recebido)}</td>
              <td className="py-1.5 text-right tabular text-money">{formatBRL(resumo.repasse)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
