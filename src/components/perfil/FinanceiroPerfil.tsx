/**
 * Seções financeiras do perfil que substituem as antigas páginas
 * VALORES PREVISTOS e COBRANÇAS E PARCELAS (e os dados de parceria):
 *
 *  - PrevistosSemProcesso: valores previstos/pendentes ainda sem processo,
 *    com vínculo ao processo e registro do recebimento.
 *  - OutrosRegistrosFinanceiros: cobranças/parcelas, acordos (percentuais),
 *    requisições (RPV/precatório) e parceria do processo selecionado.
 *
 * Valores previstos ficam SEMPRE separados dos recebidos (não entram no
 * TOTAL RECEBIDO).
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
import { DialogReceberPrevisto } from "@/components/DialogReceberPrevisto";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, formatDate } from "@/lib/format";
import { perfilCompletoQuery } from "@/lib/furtado/consultas";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import {
  alterarValorPrevisto,
  previstosDoClienteQuery,
  ROTULO_SITUACAO_PREVISTO,
  saldoPrevisto,
  SITUACOES_PENDENTES,
  type ValorPrevisto,
} from "@/lib/valoresPrevistos";
import { ROTULO_CATEGORIA_PROCESSO } from "@/lib/valoresProcesso";

const ORIGEM: Record<string, string> = {
  judicial: "Judicial — processo judicial",
  administrativo: "Administrativo — INSS",
};

export function PrevistosSemProcesso({
  clienteId,
  processos,
}: {
  clienteId: string;
  processos: { id: string; numero: string | null }[];
}) {
  const { data } = useQuery(previstosDoClienteQuery(clienteId));
  const lista = (data ?? []).filter(
    (v) => !v.atendimento_id || !processos.some((p) => p.id === v.atendimento_id),
  );
  if (!lista.length) return null;
  const pendente = lista.reduce((s, v) => s + saldoPrevisto(v), 0);
  return (
    <section
      className="border-t border-border px-5 py-4"
      aria-label="Valores previstos sem processo"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Valores previstos sem processo ({lista.length})
        </h3>
        <p className="text-xs text-muted-foreground">
          Pendente: <strong className="text-warning">{formatBRL(pendente)}</strong> · fora do TOTAL
          RECEBIDO
        </p>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {lista.map((v) => (
          <LinhaPrevisto key={v.id} previsto={v} processos={processos} />
        ))}
      </ul>
    </section>
  );
}

function LinhaPrevisto({
  previsto: v,
  processos,
}: {
  previsto: ValorPrevisto;
  processos: { id: string; numero: string | null }[];
}) {
  const sincronizar = useSincronizar();
  const vincular = useMutation({
    mutationFn: (atendimentoId: string) =>
      alterarValorPrevisto(v.id, { atendimento_id: atendimentoId }),
    onSuccess: async () => {
      await sincronizar(EVENTOS.ENTRADA_CLASSIFICADA);
      toast.success("Valor previsto vinculado ao processo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pendente = SITUACOES_PENDENTES.includes(v.situacao);
  return (
    <li className="flex flex-col gap-2 px-3 py-3 text-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="font-semibold">
          {v.categoria ? (
            ROTULO_CATEGORIA_PROCESSO[v.categoria].toUpperCase()
          ) : (
            <span className="text-warning">CONFERÊNCIA</span>
          )}
          {v.descricao ? <span className="font-normal"> — {v.descricao}</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {[
            v.origem ? ORIGEM[v.origem] : null,
            v.canal,
            v.percentual,
            v.parcela ? `parcelas: ${v.parcela}` : null,
            v.competencia,
            v.celulas ? `células ${v.celulas}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {v.conferencia ? <p className="text-xs text-warning">{v.conferencia}</p> : null}
        {v.observacao ? <p className="text-xs text-muted-foreground">{v.observacao}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="tabular text-right">
          {v.valor === null ? "—" : formatBRL(v.valor)}
          {v.valor_recebido ? (
            <span className="block text-xs text-muted-foreground">
              recebido {formatBRL(v.valor_recebido)}
            </span>
          ) : null}
        </span>
        <BadgeStatus
          texto={ROTULO_SITUACAO_PREVISTO[v.situacao]}
          tom={pendente ? "alerta" : "neutro"}
        />
        {processos.length ? (
          <Select onValueChange={(id) => vincular.mutate(id)} disabled={vincular.isPending}>
            <SelectTrigger className="h-8 w-52 text-xs" aria-label="Vincular ao processo">
              <SelectValue placeholder="Vincular ao processo…" />
            </SelectTrigger>
            <SelectContent>
              {processos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.numero || "Sem número"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {pendente ? <DialogReceberPrevisto previsto={v} compacto /> : null}
      </div>
    </li>
  );
}

const SITUACAO_COBRANCA: Record<string, string> = {
  pendente: "Pendente",
  parcial: "Parcialmente paga",
  quitada: "Quitada",
  a_confirmar: "A confirmar",
};

/**
 * Cobranças/parcelas, acordos (percentuais e parceria) e requisições do
 * processo selecionado (ou do cliente, quando sem processo). Só aparece
 * quando há algum registro.
 */
export function OutrosRegistrosFinanceiros({
  clienteId,
  atendimentoId,
  parceria,
}: {
  clienteId: string;
  atendimentoId: string | null;
  parceria?: string | null;
}) {
  const { data } = useQuery(perfilCompletoQuery(clienteId));
  const doProcesso = <T extends { atendimento_id: string | null }>(l: T[] | undefined) =>
    (l ?? []).filter((x) =>
      atendimentoId ? x.atendimento_id === atendimentoId : !x.atendimento_id,
    );
  const cobrancas = doProcesso(data?.cobrancas);
  const acordos = doProcesso(data?.acordos);
  const requisicoes = doProcesso(data?.requisicoes);
  const parcelas = data?.parcelas ?? [];
  if (!cobrancas.length && !acordos.length && !requisicoes.length && !parceria) return null;

  return (
    <Card className="gap-0 p-0">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">
          Parcerias, cobranças e requisições
        </h2>
        <p className="text-xs text-muted-foreground">
          Valores contratados e a receber — separados dos VALORES RECEBIDOS.
        </p>
      </div>
      <div className="space-y-4 px-5 py-4 text-sm">
        {parceria ? (
          <p>
            <span className="text-muted-foreground">Parceria: </span>
            <strong>{parceria}</strong>
          </p>
        ) : null}

        {acordos.length ? (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Acordos e percentuais
            </h3>
            <ul className="space-y-1">
              {acordos.map((a) => (
                <li key={a.id}>
                  {a.percentual !== null ? <strong>{a.percentual}%</strong> : null}
                  {a.sucumbencia_percentual !== null
                    ? ` · sucumbência ${a.sucumbencia_percentual}%`
                    : ""}
                  {a.beneficio ? ` · ${a.beneficio}` : ""}
                  {a.aceitacao_texto || a.aceitacao ? ` · ${a.aceitacao_texto ?? a.aceitacao}` : ""}
                  {a.observacoes ? (
                    <span className="block text-xs text-muted-foreground">{a.observacoes}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {cobrancas.length ? (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cobranças e parcelas
            </h3>
            <ul className="space-y-2">
              {cobrancas.map((c) => {
                const ps = parcelas.filter((p) => p.cobranca_id === c.id);
                const saldo = ps.length
                  ? ps.reduce((s, p) => s + (p.valor - p.valor_pago), 0)
                  : (c.valor_contratado ?? 0);
                return (
                  <li key={c.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{c.descricao ?? "Cobrança"}</span>
                      <BadgeStatus
                        texto={SITUACAO_COBRANCA[c.situacao] ?? c.situacao}
                        tom={c.situacao === "quitada" ? "sucesso" : "alerta"}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Contratado {formatBRL(c.valor_contratado ?? 0)}
                      {c.quantidade_parcelas ? ` · ${c.quantidade_parcelas} parcela(s)` : ""} ·
                      saldo <strong className="text-warning">{formatBRL(saldo)}</strong>
                    </p>
                    {ps.length ? (
                      <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
                        {ps.map((p) => (
                          <li key={p.id} className="tabular">
                            {p.numero}ª · {formatBRL(p.valor)} ·{" "}
                            {p.vencimento ? formatDate(p.vencimento) : (p.vencimento_texto ?? "—")}{" "}
                            ·{" "}
                            {p.situacao === "paga"
                              ? "paga"
                              : p.situacao === "paga_parcial"
                                ? "parcial"
                                : "aberta"}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {requisicoes.length ? (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Requisições (RPV / precatório)
            </h3>
            <ul className="space-y-1">
              {requisicoes.map((q) => (
                <li key={q.id}>
                  <strong>{q.tipo.toUpperCase()}</strong>
                  {q.valor !== null
                    ? ` · ${formatBRL(q.valor)}`
                    : q.valor_texto
                      ? ` · ${q.valor_texto}`
                      : ""}
                  {q.situacao_texto || q.situacao ? ` · ${q.situacao_texto ?? q.situacao}` : ""}
                  {q.previsao_texto ? ` · previsão ${q.previsao_texto}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
