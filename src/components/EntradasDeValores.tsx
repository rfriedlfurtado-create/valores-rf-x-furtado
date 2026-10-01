import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Valor } from "@/components/Valor";
import { SecaoVazia } from "@/components/layout/AppShell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { classificarEntrada } from "@/lib/acoes";
import { formatBRL, formatDate } from "@/lib/format";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import {
  fraseQuantidadeEntradas,
  resumirEntradas,
  ROTULO_GRUPO,
  type GrupoClassificacao,
} from "@/lib/situacao";
import {
  CLASSIFICACOES_ENTRADA,
  ROTULO_CLASSIFICACAO,
  ROTULO_TIPO_PAGAMENTO,
  type ClassificacaoEntrada,
  type Pagamento,
} from "@/lib/tipos";

const SEM_CLASSIFICACAO = "__sem__";

/**
 * Seção "Entradas de valores" do perfil: cada entrada financeira do
 * cliente aparece separada, com a sua própria classificação.
 * Os números (quantidade, total, por classificação) vêm de `resumirEntradas`,
 * a mesma função usada pelos indicadores do Dashboard.
 */
export function EntradasDeValores({ entradas }: { entradas: Pagamento[] }) {
  const sincronizar = useSincronizar();
  const resumo = resumirEntradas(entradas);

  const mutation = useMutation({
    mutationFn: (v: { id: string; classificacao: ClassificacaoEntrada | null }) =>
      classificarEntrada(v.id, v.classificacao),
    onSuccess: async (_d, v) => {
      await sincronizar(EVENTOS.ENTRADA_CLASSIFICADA);
      toast.success(
        v.classificacao
          ? `Valor classificado como ${ROTULO_CLASSIFICACAO[v.classificacao]}.`
          : "Classificação removida.",
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section aria-labelledby="titulo-entradas">
      <h2 id="titulo-entradas" className="text-lg font-bold tracking-tight">
        Entradas de valores
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {fraseQuantidadeEntradas(resumo.quantidade)}
      </p>

      {entradas.length === 0 ? (
        <SecaoVazia
          titulo="Nenhum valor registrado"
          descricao="Valores informados no Modelo Documento ou em Registrar pagamento aparecem aqui."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <ol className="divide-y divide-border">
            {entradas.map((entrada, indice) => {
              const salvando = mutation.isPending && mutation.variables?.id === entrada.id;
              return (
                <li
                  key={entrada.id}
                  className="grid gap-3 px-4 py-3 sm:grid-cols-[2rem_1fr_15rem] sm:items-center"
                >
                  <span className="text-sm font-semibold tabular text-muted-foreground">
                    {indice + 1}.
                  </span>
                  <div className="min-w-0">
                    <Valor valor={entrada.valor} tamanho="lg" />
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDate(entrada.data_pagamento)} · {ROTULO_TIPO_PAGAMENTO[entrada.tipo]}
                      {entrada.observacao ? ` · ${entrada.observacao}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={entrada.classificacao ?? SEM_CLASSIFICACAO}
                      onValueChange={(valor) =>
                        mutation.mutate({
                          id: entrada.id,
                          classificacao:
                            valor === SEM_CLASSIFICACAO ? null : (valor as ClassificacaoEntrada),
                        })
                      }
                      disabled={salvando}
                    >
                      <SelectTrigger
                        className="h-9 w-full"
                        aria-label={`Classificação do valor ${indice + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_CLASSIFICACAO}>Selecionar classificação</SelectItem>
                        {CLASSIFICACOES_ENTRADA.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {salvando ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {(Object.keys(resumo.porClassificacao) as GrupoClassificacao[])
                .filter((g) => resumo.porClassificacao[g].quantidade > 0)
                .map((g) => (
                  <li key={g}>
                    {ROTULO_GRUPO[g]}:{" "}
                    <strong className="tabular text-foreground">
                      {formatBRL(resumo.porClassificacao[g].valor)}
                    </strong>
                  </li>
                ))}
            </ul>
            <p className="text-sm">
              Total identificado: <strong className="tabular">{formatBRL(resumo.total)}</strong>
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
