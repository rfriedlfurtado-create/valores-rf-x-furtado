import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { FiltroEscritorioSelect } from "@/components/FiltroEscritorioSelect";
import { PageHeader } from "@/components/layout/AppShell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSistema } from "@/hooks/useSistema";
import {
  clientePassaFiltro,
  registroPassaFiltro,
  useFiltroEscritorio,
  useVinculosEscritorio,
} from "@/lib/escritorio";
import { formatBRL } from "@/lib/format";
import { lancamentosQuery, requisicoesQuery } from "@/lib/furtado/consultas";
import {
  ROTULO_CATEGORIA,
  ROTULO_ESCRITORIO,
  type CategoriaFinanceira,
  type EscritorioOrigem,
} from "@/lib/furtado/modelo";
import { TabelaCategoriasRepasse } from "@/components/RepasseCliente";
import { REGRA_REPASSE, resumirRepasse } from "@/lib/repasse";
import { ROTULO_GRUPO, type GrupoClassificacao } from "@/lib/situacao";
import type { Pagamento } from "@/lib/tipos";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — Base de Pagamentos" },
      {
        name: "description",
        content: "Valores previstos, devidos e recebidos por categoria e escritório.",
      },
    ],
  }),
  component: Relatorios,
});

const ORDEM: CategoriaFinanceira[] = [
  "valor_total",
  "atrasados",
  "valor_cliente",
  "repasse_cliente",
  "honorarios_contratuais",
  "honorarios_implantacao",
  "honorarios_sucumbenciais",
  "honorarios_execucao",
  "honorarios_tutela",
  "honorarios_administrativos",
  "outros_honorarios",
];

function Relatorios() {
  const { base, carregando } = useSistema();
  const { filtro } = useFiltroEscritorio();
  const vinculos = useVinculosEscritorio();
  const lancamentos = useQuery(lancamentosQuery());
  const requisicoes = useQuery(requisicoesQuery());

  const dados = useMemo(() => {
    if (!base) return null;
    // Valores informados: somente coluna principal, sem valores alternativos
    // (conflitos) e sem totais da planilha — cada valor conta uma vez.
    const porCat = new Map<
      CategoriaFinanceira,
      { previsto: number; devido: number; recebido: number; ausente: number }
    >();
    for (const l of lancamentos.data ?? []) {
      if (!base.porId.has(l.cliente_id) || l.versao !== 1) continue;
      if ((l.observacao ?? "").includes("Valor alternativo")) continue;
      if (!registroPassaFiltro(l.escritorio, filtro)) continue;
      const linha = porCat.get(l.categoria) ?? { previsto: 0, devido: 0, recebido: 0, ausente: 0 };
      if (l.valor === null) linha.ausente += 1;
      else if (l.pagamento_id) linha.recebido += l.valor;
      else if (l.natureza === "previsto") linha.previsto += l.valor;
      else if (l.natureza === "devido") linha.devido += l.valor;
      porCat.set(l.categoria, linha);
    }
    // Recebimentos confirmados (módulo existente)
    const recebidosPorClass = new Map<GrupoClassificacao, number>();
    const entradasFiltro: Pagamento[] = [];
    let totalRecebido = 0;
    const porEscritorio = new Map<EscritorioOrigem, number>();
    for (const [clienteId, lista] of base.pagamentosPorCliente) {
      const cliente = base.porId.get(clienteId);
      if (!cliente) continue;
      for (const p of lista) {
        const passa = p.escritorio
          ? registroPassaFiltro(p.escritorio, filtro)
          : clientePassaFiltro(cliente, filtro, vinculos);
        if (!passa) continue;
        entradasFiltro.push(p);
        totalRecebido += p.valor;
        const g = (p.classificacao ?? "sem_classificacao") as GrupoClassificacao;
        recebidosPorClass.set(g, (recebidosPorClass.get(g) ?? 0) + p.valor);
        const e = (p.escritorio ?? cliente.escritorio_origem ?? "a_confirmar") as EscritorioOrigem;
        porEscritorio.set(e, (porEscritorio.get(e) ?? 0) + p.valor);
      }
    }
    const req = new Map<string, { quantidade: number; valor: number }>();
    for (const r of requisicoes.data ?? []) {
      if (!base.porId.has(r.cliente_id) || !registroPassaFiltro(r.escritorio, filtro)) continue;
      const k = `${r.tipo === "precatorio" ? "Precatório" : r.tipo === "rpv" ? "RPV" : r.tipo === "ted" ? "Pedido de TED" : "Outras"}${
        r.ano_previsto ? ` ${r.ano_previsto}` : ""
      }${r.situacao ? ` · ${r.situacao.replace(/_/g, " ")}` : ""}`;
      const x = req.get(k) ?? { quantidade: 0, valor: 0 };
      x.quantidade += 1;
      x.valor += r.valor ?? 0;
      req.set(k, x);
    }
    const clientes = base.clientes.filter((c) => clientePassaFiltro(c, filtro, vinculos)).length;
    // Repasse Ricardo Friedl: motor único, mesmas entradas do filtro.
    const repasse = resumirRepasse(entradasFiltro);
    const porMes = new Map<string, Pagamento[]>();
    for (const p of entradasFiltro) {
      const m = p.data_pagamento.slice(0, 7);
      porMes.set(m, [...(porMes.get(m) ?? []), p]);
    }
    const repassePorMes = [...porMes.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([mes, lista]) => ({ mes, resumo: resumirRepasse(lista) }))
      .filter((x) => x.resumo.quantidade > 0);
    return {
      porCat,
      recebidosPorClass,
      totalRecebido,
      porEscritorio,
      req,
      clientes,
      repasse,
      repassePorMes,
    };
  }, [base, lancamentos.data, requisicoes.data, filtro, vinculos]);

  if (carregando || !base || !dados) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Relatórios" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        titulo="Relatórios"
        descricao={`${dados.clientes} cliente(s) no filtro. Totais excluem a lixeira e contam cada pessoa/valor uma única vez.`}
      >
        <FiltroEscritorioSelect className="h-10" />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 border-money/30 p-5 lg:col-span-2" data-testid="relatorio-repasse">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wide">
              Repasse Ricardo Friedl — {REGRA_REPASSE.rotulo}
            </h2>
            <p className="text-xs text-muted-foreground">
              {REGRA_REPASSE.rotulo} de cada valor efetivamente recebido · regra v
              {REGRA_REPASSE.versao}
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <TabelaCategoriasRepasse resumo={dados.repasse} />
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Mês do recebimento</th>
                    <th className="px-3 py-2 text-right">Recebido</th>
                    <th className="px-3 py-2 text-right">Repasse</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.repassePorMes.length === 0 ? (
                    <tr className="border-t border-border">
                      <td colSpan={3} className="px-3 py-2 text-muted-foreground">
                        Nenhum valor recebido no filtro.
                      </td>
                    </tr>
                  ) : (
                    dados.repassePorMes.map(({ mes, resumo }) => (
                      <tr key={mes} className="border-t border-border">
                        <td className="px-3 py-1.5 tabular">
                          {mes.split("-").reverse().join("/")}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular">
                          {formatBRL(resumo.recebido)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular font-semibold text-money">
                          {formatBRL(resumo.repasse)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        <Card className="gap-3 p-5 lg:col-span-2">
          <h2 className="text-sm font-bold uppercase tracking-wide">
            Valores informados nas planilhas, por categoria
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">Categoria</th>
                  <th className="py-1 text-right">Previsto</th>
                  <th className="py-1 text-right">Devido</th>
                  <th className="py-1 text-right">Recebido (confirmado)</th>
                  <th className="py-1 text-right">Ausência declarada</th>
                </tr>
              </thead>
              <tbody>
                {ORDEM.filter((c) => dados.porCat.has(c)).map((c) => {
                  const l = dados.porCat.get(c)!;
                  return (
                    <tr key={c} className="border-t border-border">
                      <td className="py-1.5">{ROTULO_CATEGORIA[c]}</td>
                      <td className="py-1.5 text-right tabular">{formatBRL(l.previsto)}</td>
                      <td className="py-1.5 text-right tabular">{formatBRL(l.devido)}</td>
                      <td className="py-1.5 text-right tabular">{formatBRL(l.recebido)}</td>
                      <td className="py-1.5 text-right tabular text-muted-foreground">
                        {l.ausente || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Previsto = previsões de execução/atrasados; devido = honorários informados; recebido =
            valores confirmados. Atrasados e valores destinados ao cliente são créditos do cliente,
            não receitas do escritório.
          </p>
        </Card>

        <Card className="gap-3 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide">Recebimentos confirmados</h2>
          <p className="text-2xl font-bold tabular">{formatBRL(dados.totalRecebido)}</p>
          <ul className="grid gap-1 text-sm">
            {[...dados.recebidosPorClass.entries()].map(([g, v]) => (
              <li key={g} className="flex justify-between">
                {ROTULO_GRUPO[g]} <strong className="tabular">{formatBRL(v)}</strong>
              </li>
            ))}
          </ul>
          {filtro === "todos" ? (
            <div className="border-t border-border pt-2 text-sm">
              <p className="text-xs text-muted-foreground">
                Por escritório (registro do recebimento ou origem do cliente):
              </p>
              {[...dados.porEscritorio.entries()].map(([e, v]) => (
                <p key={e} className="flex justify-between">
                  {ROTULO_ESCRITORIO[e]} <strong className="tabular">{formatBRL(v)}</strong>
                </p>
              ))}
            </div>
          ) : null}
        </Card>

        <Card className="gap-3 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wide">RPV, precatórios e TED</h2>
          {dados.req.size === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma requisição registrada.</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {[...dados.req.entries()]
                .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
                .map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-2">
                    <span>{k}</span>
                    <span className="tabular text-muted-foreground">
                      {v.quantidade}
                      {v.valor ? ` · ${formatBRL(v.valor)}` : ""}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
