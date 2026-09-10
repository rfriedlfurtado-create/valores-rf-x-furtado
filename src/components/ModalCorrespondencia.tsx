import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Check, Clock, X } from "lucide-react";
import { toast } from "sonner";

import { BadgeSimilaridade } from "@/components/BadgeSimilaridade";
import { Valor } from "@/components/Valor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  adiarCorrespondencia,
  confirmarCorrespondencia,
  rejeitarCorrespondencia,
} from "@/lib/acoes";
import { formatDate } from "@/lib/format";
import { ROTULO_TIPO_PAGAMENTO, type CorrespondenciaDetalhada, type Pagamento } from "@/lib/tipos";

export interface ModalCorrespondenciaProps {
  item: CorrespondenciaDetalhada | null;
  pagamentos: Pagamento[];
  onFechar: () => void;
}

export function ModalCorrespondencia({ item, pagamentos, onFechar }: ModalCorrespondenciaProps) {
  const queryClient = useQueryClient();

  const executar = useMutation({
    mutationFn: async (acao: "confirmar" | "rejeitar" | "adiar") => {
      if (!item) return;
      if (acao === "confirmar") {
        await confirmarCorrespondencia({
          correspondenciaId: item.correspondencia.id,
          clienteImportadoId: item.importado.id,
          clienteEncontradoId: item.clienteEncontrado.id,
          nomeImportado: item.importado.nome_original,
        });
      } else if (acao === "rejeitar") {
        await rejeitarCorrespondencia({
          correspondenciaId: item.correspondencia.id,
          clienteImportadoId: item.importado.id,
          nomeNormalizadoImportado: item.importado.nome_normalizado,
          nomeNormalizadoEncontrado: item.clienteEncontrado.nome_normalizado,
        });
      } else {
        await adiarCorrespondencia(item.correspondencia.id, item.importado.id);
      }
    },
    onSuccess: async (_dados, acao) => {
      const mensagens = {
        confirmar: "Correspondência confirmada. O nome virou uma variação do cliente.",
        rejeitar: "Marcado como pessoas diferentes. Não será sugerido novamente.",
        adiar: "Guardado para analisar depois.",
      } as const;
      toast.success(mensagens[acao]);
      await queryClient.invalidateQueries();
      onFechar();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  return (
    <Dialog open={item !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {item ? (
          <>
            <DialogHeader>
              <DialogTitle>Comparação de nomes</DialogTitle>
              <DialogDescription>
                Confira lado a lado antes de decidir. Nada é unido automaticamente.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-center gap-3">
              <BadgeSimilaridade
                classificacao={item.correspondencia.classificacao}
                percentual={item.correspondencia.percentual_similaridade}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Novo registro
                </p>
                <p className="mt-2 text-lg font-bold leading-tight">{item.importado.nome_original}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Importação: {item.importacao?.nome_importacao ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Em {formatDate(item.importado.created_at)}
                </p>
              </div>

              <ArrowRight className="mx-auto hidden size-5 text-muted-foreground sm:block" aria-hidden />

              <div className="rounded-xl border border-money/30 bg-money-soft/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Cliente encontrado na base
                </p>
                <p className="mt-2 text-lg font-bold leading-tight">{item.clienteEncontrado.nome}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cadastrado em {formatDate(item.clienteEncontrado.created_at)}
                </p>
              </div>
            </div>

            <Separator />

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Histórico financeiro do cliente encontrado
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Total recebido</p>
                  <Valor valor={item.clienteEncontrado.totalRecebido} tamanho="lg" />
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Pagamentos</p>
                  <p className="text-xl font-bold tabular">
                    {item.clienteEncontrado.quantidadePagamentos}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Último pagamento</p>
                  <p className="text-xl font-bold tabular">
                    {formatDate(item.clienteEncontrado.ultimoPagamento)}
                  </p>
                </div>
              </div>

              {pagamentos.length > 0 ? (
                <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
                  {pagamentos.map((pagamento) => (
                    <li key={pagamento.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">{formatDate(pagamento.data_pagamento)}</p>
                        <p className="text-xs text-muted-foreground">
                          {ROTULO_TIPO_PAGAMENTO[pagamento.tipo]}
                          {pagamento.observacao ? ` · ${pagamento.observacao}` : ""}
                        </p>
                      </div>
                      <Valor valor={pagamento.valor} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                  Este cliente ainda não possui pagamentos registrados.
                </p>
              )}

              <Link
                to="/clientes/$clienteId"
                params={{ clienteId: item.clienteEncontrado.id }}
                className="mt-3 inline-block text-sm font-medium text-info underline-offset-4 hover:underline"
              >
                Abrir perfil completo
              </Link>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft/50 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Nomes parecidos podem pertencer a pessoas diferentes. Confirme apenas se tiver certeza.
              </span>
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => executar.mutate("adiar")}
                disabled={executar.isPending}
              >
                <Clock className="size-4" aria-hidden />
                Analisar depois
              </Button>
              <Button
                variant="outline"
                onClick={() => executar.mutate("rejeitar")}
                disabled={executar.isPending}
                className="border-danger/40 text-danger hover:bg-danger-soft hover:text-danger"
              >
                <X className="size-4" aria-hidden />
                Não é o mesmo cliente
              </Button>
              <Button onClick={() => executar.mutate("confirmar")} disabled={executar.isPending}>
                <Check className="size-4" aria-hidden />
                Confirmar que é o mesmo
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
