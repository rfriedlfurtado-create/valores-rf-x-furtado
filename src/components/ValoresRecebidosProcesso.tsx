/**
 * VALORES RECEBIDOS do processo selecionado no perfil do cliente: cards
 * ATRASADOS, CONTRATUAL (implantação), SUCUMBÊNCIA e TOTAL RECEBIDO, sempre
 * SOMENTE do processo selecionado. Valores previstos (a receber) aparecem
 * como pendentes, separados do recebido. Regras em src/lib/valoresProcesso.ts.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ListChecks, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
import { DialogPagamento } from "@/components/DialogPagamento";
import { DialogReceberPrevisto } from "@/components/DialogReceberPrevisto";
import { Valor } from "@/components/Valor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  alterarRecebimento,
  definirCategoriaProcesso,
  excluirRecebimento,
  type AlteracaoRecebimento,
} from "@/lib/acoes";
import { formatBRL, formatDate, parseBRL } from "@/lib/format";
import type { PerfilRF, RegistroRF } from "@/lib/rf/dados";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import {
  CLASSIFICACOES_ENTRADA,
  ROTULO_TIPO_PAGAMENTO,
  type ClassificacaoEntrada,
  type Pagamento,
} from "@/lib/tipos";
import { cn } from "@/lib/utils";
import {
  previstosDoClienteQuery,
  ROTULO_SITUACAO_PREVISTO,
  saldoPrevisto,
  type ValorPrevisto,
} from "@/lib/valoresPrevistos";
import {
  CATEGORIAS_PROCESSO,
  ROTULO_CATEGORIA_PROCESSO,
  ROTULO_STATUS_CATEGORIA,
  mensagemReabertura,
  valoresDoProcesso,
  type SituacaoCategoria,
  type SituacaoProcessoBanco,
} from "@/lib/valoresProcesso";

const MSG_CONFLITO_NAO_HAVERA =
  "Este processo já tem recebimento de sucumbência registrado, por isso não pode ser marcado “Não haverá sucumbência”. Confira os registros em “Ver registros” — nada é apagado automaticamente.";

const MSG_SUCUMBENCIA_BLOQUEADA =
  "Este processo está marcado “Não haverá sucumbência”. Desfaça a indicação no card Sucumbência antes de registrar um recebimento de sucumbência.";

/** Executa uma ação de valores, revalida a tela e avisa se algum processo voltou para pendente. */
function useAcaoValores<T>(
  acao: (arg: T) => Promise<SituacaoProcessoBanco[]>,
  sucesso: string | ((arg: T) => string),
  aoConcluir?: () => void,
) {
  const sincronizar = useSincronizar();
  return useMutation({
    mutationFn: acao,
    onSuccess: async (processos, arg) => {
      await sincronizar(EVENTOS.ENTRADA_CLASSIFICADA);
      toast.success(typeof sucesso === "function" ? sucesso(arg) : sucesso);
      const reaberto = mensagemReabertura(processos);
      if (reaberto) toast.warning(reaberto, { duration: 12_000 });
      aoConcluir?.();
    },
    onError: (e: Error) => toast.error(e.message, { duration: 10_000 }),
  });
}

function rotuloProcesso(r: RegistroRF): string {
  return (r.dados_rf?.numero as string | undefined) || r.numero_processo || "Sem número";
}

const ROTULO_ORIGEM: Record<string, string> = {
  judicial: "Judicial — processo judicial",
  administrativo: "Administrativo — INSS",
};

function origemDoRecebimento(p: Pagamento): string {
  if (p.aba || p.celulas) return `Importação · ${p.celulas ?? p.aba}`;
  const o = (p.dados_origem ?? {}) as { arquivo?: string; linha?: number };
  if (p.importacao_id || p.chave_importacao)
    return `Importação${o.arquivo ? ` · ${o.arquivo}` : ""}${
      (o.linha ?? p.linha_importacao) ? `, linha ${o.linha ?? p.linha_importacao}` : ""
    }`;
  return p.usuario_cadastro ? `Lançamento manual · ${p.usuario_cadastro}` : "Lançamento manual";
}

// ---------------------------------------------------------------------------
// Área VALORES RECEBIDOS
// ---------------------------------------------------------------------------

export function ValoresRecebidosProcesso({
  perfil,
  registro,
}: {
  perfil: PerfilRF;
  registro: RegistroRF;
}) {
  const previstosQ = useQuery(previstosDoClienteQuery(perfil.cliente.id));
  const previstos = previstosQ.data ?? [];
  const v = valoresDoProcesso(perfil.pagamentos, perfil.categorias, registro.id, previstos);
  const outros = perfil.registros.filter((r) => r.id !== registro.id);
  const geral = outros.length
    ? perfil.registros.reduce(
        (acc, r) => {
          const x = valoresDoProcesso(perfil.pagamentos, perfil.categorias, r.id, previstos);
          return {
            recebido: acc.recebido + x.totalRecebido,
            pendente: acc.pendente + x.totalPendente,
          };
        },
        { recebido: 0, pendente: 0 },
      )
    : null;
  const faltam = CATEGORIAS_PROCESSO.filter((c) => v.categorias[c].status === "pendente").map(
    (c) => ROTULO_CATEGORIA_PROCESSO[c],
  );
  const legado = registro.pago && !registro.finalizacao_validada && !v.podeFinalizar;
  const bloqueadas = v.categorias.sucumbencia.naoHavera
    ? { sucumbencia: MSG_SUCUMBENCIA_BLOQUEADA }
    : undefined;

  return (
    <section
      aria-label={`Valores recebidos do processo ${rotuloProcesso(registro)}`}
      className="border-t border-border px-5 py-4"
      data-testid="valores-recebidos"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Valores recebidos
          </h3>
          <p className="text-xs text-muted-foreground">
            Somente do processo{" "}
            <span className="tabular font-medium text-foreground">{rotuloProcesso(registro)}</span>
          </p>
        </div>
        {v.podeFinalizar ? (
          <BadgeStatus texto="Todos os valores recebidos" tom="sucesso" />
        ) : (
          <BadgeStatus texto={`Falta: ${faltam.join(", ")}`} tom="alerta" />
        )}
      </div>

      {legado ? (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Este processo foi para JÁ PAGOS antes da regra dos valores recebidos e continua lá.
            Complete os cards abaixo para a conferência.
          </span>
        </p>
      ) : null}

      <div className="@container grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {CATEGORIAS_PROCESSO.map((c) => (
          <CardCategoria
            key={c}
            perfil={perfil}
            registro={registro}
            situacao={v.categorias[c]}
            bloqueadas={bloqueadas}
            previstos={previstos.filter(
              (x) => x.atendimento_id === registro.id && x.categoria === c,
            )}
          />
        ))}
        <CardTotal
          total={v.totalRecebido}
          quantidade={v.quantidadeRecebimentos}
          pendente={v.totalPendente}
          porCategoria={CATEGORIAS_PROCESSO.map((c) => [
            ROTULO_CATEGORIA_PROCESSO[c],
            v.categorias[c].total,
          ])}
          geral={geral}
        />
      </div>

      {v.semCategoria.length ? (
        <SemCategoria registros={v.semCategoria} bloqueada={Boolean(bloqueadas)} />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Card de UMA categoria
// ---------------------------------------------------------------------------

function CardCategoria({
  perfil,
  registro,
  situacao: s,
  bloqueadas,
  previstos,
}: {
  perfil: PerfilRF;
  registro: RegistroRF;
  situacao: SituacaoCategoria;
  bloqueadas: Partial<Record<ClassificacaoEntrada, string>> | undefined;
  previstos: ValorPrevisto[];
}) {
  const rotulo = ROTULO_CATEGORIA_PROCESSO[s.categoria];
  const confirmar = useAcaoValores(
    (integral: boolean) =>
      definirCategoriaProcesso(registro.id, s.categoria, { integral_confirmado: integral }),
    (integral) =>
      integral
        ? `${rotulo}: recebimento integral confirmado.`
        : `${rotulo}: confirmação de recebimento integral retirada.`,
  );
  const naoHavera = useAcaoValores(
    (marcar: boolean) =>
      definirCategoriaProcesso(registro.id, "sucumbencia", { nao_havera: marcar }),
    (marcar) =>
      marcar
        ? "Registrado: não haverá sucumbência neste processo (nenhum valor lançado)."
        : "Indicação “Não haverá sucumbência” desfeita.",
  );

  const tom = s.status === "recebido" ? "sucesso" : s.status === "nao_havera" ? "neutro" : "alerta";

  return (
    <article
      data-testid={`card-${s.categoria}`}
      data-status={s.status}
      className={cn(
        "flex min-h-56 flex-col gap-3 rounded-xl border bg-card p-4 xl:min-h-[calc((100cqw-2.25rem)/4)]",
        s.status === "recebido" && "border-success/40",
        s.status === "pendente" && "border-border",
        s.status === "nao_havera" && "border-dashed border-border bg-muted/30",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-sm font-semibold uppercase tracking-wide">{rotulo}</h4>
        {/* SUCUMBÊNCIA: "Não haverá sucumbência" logo abaixo da situação. */}
        <div className="flex flex-col items-end gap-2">
          <BadgeStatus texto={ROTULO_STATUS_CATEGORIA[s.status]} tom={tom} />
          {s.categoria === "sucumbencia" ? (
            s.naoHavera ? (
              <Button
                size="sm"
                variant="outline"
                disabled={naoHavera.isPending}
                onClick={() => naoHavera.mutate(false)}
              >
                <Undo2 className="size-4" aria-hidden />
                Desfazer “Não haverá”
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={naoHavera.isPending}
                onClick={() =>
                  s.quantidade > 0
                    ? toast.error(MSG_CONFLITO_NAO_HAVERA, { duration: 10_000 })
                    : naoHavera.mutate(true)
                }
              >
                Não haverá sucumbência
              </Button>
            )
          ) : null}
        </div>
      </header>

      <div className="min-w-0 flex-1">
        {s.quantidade > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">Total recebido</p>
            <Valor
              valor={s.total}
              tamanho="lg"
              neutroSeZero={false}
              className="block break-words text-2xl font-bold"
            />
            <OrigensDoCard situacao={s} />
            <p className="mt-1 text-xs text-muted-foreground">
              {s.quantidade === 1 ? "1 lançamento" : `${s.quantidade} lançamentos`}
              {s.parcial ? " · recebimento parcial" : ""}
              {s.status === "recebido"
                ? s.integralConfirmado
                  ? " · integral confirmado"
                  : " · total a receber alcançado"
                : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {s.status === "nao_havera"
              ? "Indicação registrada para este processo — sem lançamento financeiro."
              : "Nenhum recebimento registrado"}
          </p>
        )}
        {s.pendente > 0 ? (
          <p className="mt-2 text-xs">
            <span className="text-muted-foreground">Pendente (previsto): </span>
            <span className="tabular font-semibold text-warning">{formatBRL(s.pendente)}</span>
            <span className="text-muted-foreground">
              {" "}
              · {previstos.filter((x) => saldoPrevisto(x) > 0).length} a receber
            </span>
          </p>
        ) : null}
        {s.totalCliente > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Recebido pelo cliente (fora do total): {formatBRL(s.totalCliente)}
          </p>
        ) : null}
        {s.totalPrevisto !== null ? (
          <p className="mt-2 text-xs">
            <span className="text-muted-foreground">Total a receber: </span>
            <span className="tabular font-semibold">{formatBRL(s.totalPrevisto)}</span>
            {s.saldo && s.status === "pendente" ? (
              <>
                <span className="text-muted-foreground"> · Saldo pendente: </span>
                <span className="tabular font-semibold text-warning">{formatBRL(s.saldo)}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <DialogRegistros perfil={perfil} registro={registro} situacao={s} previstos={previstos} />
        {s.status !== "nao_havera" ? (
          <DialogPagamento
            clienteFixo={perfil.cliente}
            registro={{ id: registro.id, rotulo: rotuloProcesso(registro) }}
            categoriaInicial={s.categoria}
            categoriasBloqueadas={bloqueadas}
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="size-4" aria-hidden />
                Registrar
              </Button>
            }
          />
        ) : null}
        {s.parcial && !s.integralPeloTotal ? (
          <Button
            size="sm"
            variant="outline"
            disabled={confirmar.isPending}
            onClick={() => confirmar.mutate(true)}
            title="Confirmar que o valor desta categoria foi recebido integralmente"
            aria-label={`Confirmar recebimento integral de ${rotulo}`}
          >
            <CheckCircle2 className="size-4" aria-hidden />
            Confirmar integral
          </Button>
        ) : null}
      </div>
    </article>
  );
}

/** Origem dos recebimentos do card; CONTRATUAL com as duas origens mostra os subtotais. */
function OrigensDoCard({ situacao: s }: { situacao: SituacaoCategoria }) {
  const origens = (["judicial", "administrativo"] as const).filter((o) => s.porOrigem[o] > 0);
  if (!origens.length) return null;
  if (origens.length === 1 && !s.porOrigem.sem)
    return <p className="mt-1 text-xs font-medium text-info">{ROTULO_ORIGEM[origens[0]!]}</p>;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {origens.map((o) => (
        <li key={o} className="flex justify-between gap-2">
          <span className="text-info">{ROTULO_ORIGEM[o]}</span>
          <span className="tabular font-semibold">{formatBRL(s.porOrigem[o])}</span>
        </li>
      ))}
      {s.porOrigem.sem ? (
        <li className="flex justify-between gap-2">
          <span className="text-muted-foreground">Origem não informada</span>
          <span className="tabular font-semibold">{formatBRL(s.porOrigem.sem)}</span>
        </li>
      ) : null}
    </ul>
  );
}

/** TOTAL RECEBIDO do processo = Atrasados + Contratual + Sucumbência (escritório). */
function CardTotal({
  total,
  quantidade,
  pendente,
  porCategoria,
  geral,
}: {
  total: number;
  quantidade: number;
  pendente: number;
  porCategoria: [string, number][];
  geral: { recebido: number; pendente: number } | null;
}) {
  return (
    <article
      data-testid="card-total"
      className="flex min-h-56 flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 xl:min-h-[calc((100cqw-2.25rem)/4)]"
    >
      <header className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold whitespace-nowrap uppercase tracking-wide">
          Total recebido
        </h4>
        <span className="shrink-0 whitespace-nowrap">
          <BadgeStatus
            texto={quantidade === 1 ? "1 lançamento" : `${quantidade} lançamentos`}
            tom="neutro"
          />
        </span>
      </header>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">Recebido pelo escritório neste processo</p>
        <Valor
          valor={total}
          tamanho="lg"
          neutroSeZero={false}
          className="block break-words text-2xl font-bold"
        />
        <ul className="mt-2 space-y-0.5 text-xs">
          {porCategoria.map(([rotulo, valor]) => (
            <li key={rotulo} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{rotulo}</span>
              <span className="tabular">{formatBRL(valor)}</span>
            </li>
          ))}
        </ul>
        {pendente > 0 ? (
          <p className="mt-2 text-xs">
            <span className="text-muted-foreground">Pendente (previsto, fora do total): </span>
            <span className="tabular font-semibold text-warning">{formatBRL(pendente)}</span>
          </p>
        ) : null}
      </div>
      {geral ? (
        <p className="border-t border-border pt-2 text-xs">
          <span className="font-semibold">Total geral do cliente (todos os processos): </span>
          <span className="tabular font-semibold">{formatBRL(geral.recebido)}</span>
          {geral.pendente > 0 ? (
            <span className="text-muted-foreground"> · pendente {formatBRL(geral.pendente)}</span>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Registros que compõem o total (consultar, editar, excluir) + situação
// ---------------------------------------------------------------------------

function DialogRegistros({
  perfil,
  registro,
  situacao: s,
  previstos,
}: {
  perfil: PerfilRF;
  registro: RegistroRF;
  situacao: SituacaoCategoria;
  previstos: ValorPrevisto[];
}) {
  const [aberto, setAberto] = useState(false);
  const rotulo = ROTULO_CATEGORIA_PROCESSO[s.categoria];
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="-ml-2">
          <ListChecks className="size-4" aria-hidden />
          Ver registros{s.quantidade ? ` (${s.quantidade})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {rotulo} — processo {rotuloProcesso(registro)}
          </DialogTitle>
          <DialogDescription>
            Cada recebimento é um registro próprio; o card mostra a soma. Alterações e exclusões
            ficam no histórico do cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 md:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Total recebido</p>
            <p className="tabular text-lg font-bold">{formatBRL(s.total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Situação</p>
            <p className="text-sm font-semibold">{ROTULO_STATUS_CATEGORIA[s.status]}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Saldo pendente</p>
            <p className="tabular text-sm font-semibold">
              {s.saldo === null
                ? "Total a receber não informado"
                : s.status === "recebido"
                  ? "Nenhum (recebimento integral)"
                  : formatBRL(s.saldo)}
            </p>
          </div>
        </div>

        {s.categoria !== "sucumbencia" || !s.naoHavera ? (
          <SituacaoDaCategoria registro={registro} situacao={s} />
        ) : null}

        {s.registros.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum recebimento registrado.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {s.registros.map((p) => (
              <LinhaRecebimento key={p.id} pagamento={p} perfil={perfil} />
            ))}
          </ul>
        )}

        {previstos.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Valores previstos (não somados ao recebido)
            </p>
            <ul className="divide-y divide-border rounded-lg border border-dashed border-border">
              {previstos.map((x) => (
                <li
                  key={x.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="tabular font-bold">
                        {x.valor === null ? "—" : formatBRL(x.valor)}
                      </span>
                      <BadgeStatus
                        texto={ROTULO_SITUACAO_PREVISTO[x.situacao]}
                        tom={
                          x.situacao === "parcial" || x.situacao === "nao_confirmado"
                            ? "alerta"
                            : "neutro"
                        }
                      />
                      {x.valor_recebido ? (
                        <span className="text-xs text-muted-foreground">
                          recebido {formatBRL(x.valor_recebido)}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs">
                      {[x.descricao, x.origem && ROTULO_ORIGEM[x.origem], x.canal]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {x.parcela || x.competencia || x.percentual ? (
                      <p className="text-xs text-muted-foreground">
                        {[x.percentual, x.parcela && `parcelas: ${x.parcela}`, x.competencia]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {x.observacao ? (
                      <p className="break-words text-xs text-muted-foreground">{x.observacao}</p>
                    ) : null}
                    {x.celulas ? (
                      <p className="text-xs text-muted-foreground">Origem: {x.celulas}</p>
                    ) : null}
                    {x.conferencia ? <p className="text-xs text-warning">{x.conferencia}</p> : null}
                  </div>
                  {saldoPrevisto(x) > 0 ? <DialogReceberPrevisto previsto={x} compacto /> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Total a receber (opcional) e confirmação de recebimento integral. */
function SituacaoDaCategoria({
  registro,
  situacao: s,
}: {
  registro: RegistroRF;
  situacao: SituacaoCategoria;
}) {
  const rotulo = ROTULO_CATEGORIA_PROCESSO[s.categoria];
  const [total, setTotal] = useState(
    s.totalPrevisto !== null ? s.totalPrevisto.toFixed(2).replace(".", ",") : "",
  );
  const salvarTotal = useAcaoValores(
    (valor: number | null) =>
      definirCategoriaProcesso(registro.id, s.categoria, { total_previsto: valor }),
    (valor) =>
      valor === null
        ? `${rotulo}: total a receber removido.`
        : `${rotulo}: total a receber atualizado.`,
  );
  const integral = useAcaoValores(
    (marcar: boolean) =>
      definirCategoriaProcesso(registro.id, s.categoria, { integral_confirmado: marcar }),
    (marcar) =>
      marcar
        ? `${rotulo}: recebimento integral confirmado.`
        : `${rotulo}: confirmação de recebimento integral retirada.`,
  );

  return (
    <div className="grid gap-3 rounded-lg border border-border px-4 py-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const texto = total.trim();
          salvarTotal.mutate(texto ? parseBRL(texto) : null);
        }}
      >
        <div className="grid min-w-40 flex-1 gap-1">
          <Label htmlFor={`total-${s.categoria}`}>Total a receber (opcional)</Label>
          <Input
            id={`total-${s.categoria}`}
            inputMode="decimal"
            placeholder="Ex.: 12.500,00"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="tabular"
          />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={salvarTotal.isPending}>
          Salvar total
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {s.integralConfirmado
            ? "Recebimento integral confirmado."
            : s.integralPeloTotal
              ? "Total a receber alcançado — considerado integral."
              : s.quantidade
                ? "Recebimento parcial: confirme quando o valor tiver sido recebido integralmente."
                : "Sem recebimento: registre o valor antes de confirmar."}
        </span>
        {s.integralConfirmado ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={integral.isPending}
            onClick={() => integral.mutate(false)}
          >
            <Undo2 className="size-4" aria-hidden />
            Desfazer confirmação
          </Button>
        ) : s.quantidade > 0 && !s.integralPeloTotal ? (
          <Button size="sm" disabled={integral.isPending} onClick={() => integral.mutate(true)}>
            <CheckCircle2 className="size-4" aria-hidden />
            Confirmar recebimento integral
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function LinhaRecebimento({ pagamento: p, perfil }: { pagamento: Pagamento; perfil: PerfilRF }) {
  const [editando, setEditando] = useState(false);
  const excluir = useAcaoValores(
    () => excluirRecebimento(p.id),
    `Recebimento de ${formatBRL(p.valor)} excluído (fica registrado no histórico).`,
  );

  if (editando)
    return (
      <li className="px-4 py-3">
        <FormEdicao pagamento={p} perfil={perfil} fechar={() => setEditando(false)} />
      </li>
    );

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="tabular text-base font-bold">{formatBRL(p.valor)}</span>
          <span className="tabular text-sm text-muted-foreground">
            {formatDate(p.data_pagamento)}
          </span>
          <span className="text-xs text-muted-foreground">
            {ROTULO_TIPO_PAGAMENTO[p.tipo] ?? p.tipo}
          </span>
        </p>
        {p.descricao || p.origem || p.canal ? (
          <p className="text-xs">
            {[p.descricao, p.origem && ROTULO_ORIGEM[p.origem], p.canal]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {p.percentual || p.parcela || p.competencia || p.data_informada === false ? (
          <p className="text-xs text-muted-foreground">
            {[
              p.percentual,
              p.parcela && `parcelas: ${p.parcela}`,
              p.competencia,
              p.data_informada === false &&
                "data não informada na planilha (usada a data da importação)",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{origemDoRecebimento(p)}</p>
        {p.observacao ? <p className="break-words text-sm">{p.observacao}</p> : null}
        {p.conferencia ? <p className="text-xs text-warning">{p.conferencia}</p> : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" variant="ghost" onClick={() => setEditando(true)}>
          <Pencil className="size-4" aria-hidden />
          Editar
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-danger hover:text-danger">
              <Trash2 className="size-4" aria-hidden />
              Excluir
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir este recebimento?</AlertDialogTitle>
              <AlertDialogDescription>
                {formatBRL(p.valor)} de {formatDate(p.data_pagamento)}. O total do card é
                recalculado e o registro excluído fica guardado no histórico do cliente. Se o
                processo estiver finalizado e deixar de cumprir os requisitos, ele volta para
                pendente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => excluir.mutate(undefined)}>
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function FormEdicao({
  pagamento: p,
  perfil,
  fechar,
}: {
  pagamento: Pagamento;
  perfil: PerfilRF;
  fechar: () => void;
}) {
  const [valor, setValor] = useState(Number(p.valor).toFixed(2).replace(".", ","));
  const [data, setData] = useState(p.data_pagamento);
  const [categoria, setCategoria] = useState<string>(p.classificacao ?? "nenhuma");
  const [processo, setProcesso] = useState<string>(p.atendimento_id ?? "nenhum");
  const [observacao, setObservacao] = useState(p.observacao ?? "");
  const salvar = useAcaoValores(
    (alt: AlteracaoRecebimento) => alterarRecebimento(p.id, alt),
    "Recebimento atualizado.",
    fechar,
  );

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate({
          valor: parseBRL(valor),
          data_pagamento: data,
          classificacao: categoria === "nenhuma" ? null : (categoria as ClassificacaoEntrada),
          atendimento_id: processo === "nenhum" ? null : processo,
          observacao: observacao.trim() || null,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor={`ed-valor-${p.id}`}>Valor (R$)</Label>
          <Input
            id={`ed-valor-${p.id}`}
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="tabular"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`ed-data-${p.id}`}>Data do recebimento</Label>
          <Input
            id={`ed-data-${p.id}`}
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label>Categoria</Label>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger aria-label="Categoria do recebimento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nenhuma">Sem categoria (conferência)</SelectItem>
              {CLASSIFICACOES_ENTRADA.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>Processo</Label>
          <Select value={processo} onValueChange={setProcesso}>
            <SelectTrigger aria-label="Processo do recebimento">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {perfil.registros.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {rotuloProcesso(r)}
                  {r.pago ? " (pago)" : ""}
                </SelectItem>
              ))}
              <SelectItem value="nenhum">Sem processo (conferência)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`ed-obs-${p.id}`}>Observação</Label>
        <Textarea
          id={`ed-obs-${p.id}`}
          rows={2}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={fechar}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={salvar.isPending}>
          {salvar.isPending ? "Salvando..." : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Recebimentos do processo sem categoria — para conferência
// ---------------------------------------------------------------------------

function SemCategoria({ registros, bloqueada }: { registros: Pagamento[]; bloqueada: boolean }) {
  return (
    <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
      <p className="flex items-start gap-2 text-sm font-semibold text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {registros.length === 1
          ? "1 recebimento deste processo sem categoria — para conferência"
          : `${registros.length} recebimentos deste processo sem categoria — para conferência`}
      </p>
      <p className="mb-2 text-xs text-warning">
        Não entram em nenhum card até a categoria ser escolhida.
      </p>
      <ul className="space-y-2">
        {registros.map((p) => (
          <ItemSemCategoria key={p.id} pagamento={p} bloqueada={bloqueada} />
        ))}
      </ul>
    </div>
  );
}

function ItemSemCategoria({
  pagamento: p,
  bloqueada,
}: {
  pagamento: Pagamento;
  bloqueada: boolean;
}) {
  const classificar = useAcaoValores(
    (c: ClassificacaoEntrada) => alterarRecebimento(p.id, { classificacao: c }),
    (c) => `Recebimento classificado em ${ROTULO_CATEGORIA_PROCESSO[c]}.`,
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="min-w-0">
        <span className="tabular font-semibold">{formatBRL(p.valor)}</span>{" "}
        <span className="tabular text-muted-foreground">{formatDate(p.data_pagamento)}</span>
        {p.observacao ? <span className="text-muted-foreground"> · {p.observacao}</span> : null}
      </span>
      <Select
        value=""
        disabled={classificar.isPending}
        onValueChange={(v) => classificar.mutate(v as ClassificacaoEntrada)}
      >
        <SelectTrigger
          className="h-8 w-48 border-warning bg-card"
          aria-label={`Categoria do valor de ${formatBRL(p.valor)}`}
        >
          <SelectValue placeholder="Escolher categoria…" />
        </SelectTrigger>
        <SelectContent>
          {CLASSIFICACOES_ENTRADA.map((c) => (
            <SelectItem
              key={c.value}
              value={c.value}
              disabled={bloqueada && c.value === "sucumbencia"}
            >
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </li>
  );
}
