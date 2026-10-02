/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda sem tipos gerados (types.ts) */
/**
 * Seções do perfil do cliente com as informações organizadas pela
 * importação (e pelos módulos existentes):
 *
 * Resumo · Processos e atendimentos · Benefícios e implantação ·
 * Financeiro e honorários · RPV, precatório e TED · Acordos ·
 * Cobranças e parcelas · Dados bancários e representantes ·
 * Histórico e observações · Dados originais da importação
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Landmark, Merge } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DialogRecebimentoImportado } from "@/components/furtado/DialogRecebimentoImportado";
import { IconePendencia, rotuloPendencia } from "@/components/importador/furtado/PartesRevisao";
import { SecaoVazia } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BadgeEscritorio } from "@/lib/escritorio";
import { formatBRL, formatDate, formatDateTime } from "@/lib/format";
import {
  celulasDoClienteQuery,
  perfilCompletoQuery,
  type Atendimento,
  type Lancamento,
  type PerfilCompleto,
} from "@/lib/furtado/consultas";
import {
  CATEGORIAS_HONORARIOS,
  ROTULO_CATEGORIA,
  ROTULO_DESTINO,
  type CategoriaFinanceira,
  type Destino,
} from "@/lib/furtado/modelo";
import { mesclarAtendimentos } from "@/lib/furtado/persistencia";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import { ROTULO_SITUACAO, situacaoDoCliente } from "@/lib/situacao";
import type { ClienteComTotais, Pagamento } from "@/lib/tipos";
import { cn } from "@/lib/utils";

const ROTULO_NATUREZA: Record<string, string> = {
  previsto: "Previsto",
  devido: "Devido",
  informativo: "Informativo",
  recebido: "Recebido",
};

const ROTULO_REQ: Record<string, string> = {
  rpv: "RPV",
  precatorio: "Precatório",
  ted: "Pedido de TED",
  alvara: "Alvará",
  nao_definido: "Requisição (tipo não informado)",
};

const ROTULO_SIT_COB: Record<string, { texto: string; classe: string }> = {
  pendente: {
    texto: "Pendente",
    classe: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  parcial: {
    texto: "Parcialmente paga",
    classe: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  },
  quitada: {
    texto: "Quitada (conforme planilha)",
    classe: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  },
  a_confirmar: { texto: "Situação a confirmar", classe: "bg-muted text-muted-foreground" },
};

function Campo({
  rotulo,
  valor,
  className,
}: {
  rotulo: string;
  valor: React.ReactNode;
  className?: string;
}) {
  if (valor === null || valor === undefined || valor === "") return null;
  return (
    <div className={className}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="text-sm font-medium">{valor}</dd>
    </div>
  );
}

function Origens({ origens }: { origens: string[] | null | undefined }) {
  if (!origens?.length) return null;
  const lista = [...new Set(origens)];
  return (
    <p className="mt-2 text-[11px] text-muted-foreground" title={lista.join(", ")}>
      Origem: {lista.slice(0, 4).join(", ")}
      {lista.length > 4 ? ` e mais ${lista.length - 4}` : ""}
    </p>
  );
}

function dataOuTexto(
  iso: string | null | undefined,
  texto: string | null | undefined,
): string | null {
  if (texto) return texto;
  return iso ? formatDate(iso) : null;
}

export function SecoesPerfil({
  cliente,
  pagamentos,
}: {
  cliente: ClienteComTotais;
  pagamentos: Pagamento[];
}) {
  const { data, isLoading } = useQuery(perfilCompletoQuery(cliente.id));
  if (isLoading || !data) return <Skeleton className="mt-6 h-64 rounded-xl" />;
  const c = data;
  return (
    <Tabs defaultValue="resumo" className="mt-8">
      <TabsList className="flex h-auto flex-wrap justify-start">
        <TabsTrigger value="resumo">Resumo</TabsTrigger>
        <TabsTrigger value="processos">
          Processos e atendimentos ({c.atendimentos.length})
        </TabsTrigger>
        <TabsTrigger value="beneficios">
          Benefícios e implantação ({c.beneficios.length})
        </TabsTrigger>
        <TabsTrigger value="financeiro">Financeiro e honorários</TabsTrigger>
        <TabsTrigger value="requisicoes">
          RPV, precatório e TED ({c.requisicoes.length})
        </TabsTrigger>
        <TabsTrigger value="acordos">Acordos ({c.acordos.length})</TabsTrigger>
        <TabsTrigger value="cobrancas">Cobranças e parcelas ({c.cobrancas.length})</TabsTrigger>
        <TabsTrigger value="bancarios">Dados bancários e representantes</TabsTrigger>
        <TabsTrigger value="historico">Histórico e observações ({c.historico.length})</TabsTrigger>
        <TabsTrigger value="originais">Dados originais da importação</TabsTrigger>
      </TabsList>
      <TabsContent value="resumo" className="mt-3">
        <Resumo cliente={cliente} c={c} pagamentos={pagamentos} />
      </TabsContent>
      <TabsContent value="processos" className="mt-3">
        <Processos c={c} />
      </TabsContent>
      <TabsContent value="beneficios" className="mt-3">
        <Beneficios c={c} />
      </TabsContent>
      <TabsContent value="financeiro" className="mt-3">
        <Financeiro cliente={cliente} c={c} pagamentos={pagamentos} />
      </TabsContent>
      <TabsContent value="requisicoes" className="mt-3">
        <Requisicoes c={c} />
      </TabsContent>
      <TabsContent value="acordos" className="mt-3">
        <Acordos c={c} />
      </TabsContent>
      <TabsContent value="cobrancas" className="mt-3">
        <Cobrancas c={c} clienteId={cliente.id} pagamentos={pagamentos} />
      </TabsContent>
      <TabsContent value="bancarios" className="mt-3">
        <Bancarios c={c} />
      </TabsContent>
      <TabsContent value="historico" className="mt-3">
        <Historico c={c} />
      </TabsContent>
      <TabsContent value="originais" className="mt-3">
        <Originais clienteId={cliente.id} c={c} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------

/** Valores principais (sem versões laterais), sem repetir o mesmo valor. */
function principais(lanc: Lancamento[]): Lancamento[] {
  return lanc.filter((l) => l.versao === 1 && !(l.observacao ?? "").includes("Valor alternativo"));
}

function Resumo({
  cliente,
  c,
  pagamentos,
}: {
  cliente: ClienteComTotais;
  c: PerfilCompleto;
  pagamentos: Pagamento[];
}) {
  const escritorios = new Set<string>([
    cliente.escritorio_origem ?? "a_confirmar",
    ...c.vinculos.map((v) => v.escritorio),
  ]);
  const princ = principais(c.lancamentos);
  const aReceber = princ.filter(
    (l) =>
      CATEGORIAS_HONORARIOS.includes(l.categoria) &&
      l.valor !== null &&
      !l.pagamento_id &&
      l.natureza !== "informativo",
  );
  const porCat = new Map<CategoriaFinanceira, number>();
  for (const l of aReceber)
    porCat.set(l.categoria, Math.round(((porCat.get(l.categoria) ?? 0) + l.valor!) * 100) / 100);
  const recebido = pagamentos.reduce((s, p) => s + p.valor, 0);
  const saldoCobrancas = c.cobrancas.reduce((s, cob) => {
    if (cob.situacao === "quitada") return s;
    const parcelas = c.parcelas.filter((p) => p.cobranca_id === cob.id);
    if (parcelas.length) return s + parcelas.reduce((x, p) => x + (p.valor - p.valor_pago), 0);
    return s + (cob.valor_contratado ?? 0);
  }, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="gap-3 p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome completo" valor={cliente.nome} />
          <Campo
            rotulo="Escritório de origem e vínculos"
            valor={
              <span className="flex flex-wrap gap-1">
                <BadgeEscritorio escritorio={cliente.escritorio_origem} completo />
                {[...escritorios]
                  .filter((e) => e !== cliente.escritorio_origem)
                  .map((e) => (
                    <BadgeEscritorio key={e} escritorio={e} completo />
                  ))}
              </span>
            }
          />
          <Campo rotulo="Situação" valor={ROTULO_SITUACAO[situacaoDoCliente(cliente)]} />
          <Campo
            rotulo="Processos e atendimentos"
            valor={`${c.atendimentos.length} (${c.atendimentos.filter((a) => a.numero_processo).length} com número de processo)`}
          />
          <Campo
            rotulo="Benefícios"
            valor={
              c.beneficios.length
                ? c.beneficios
                    .map((b) => [b.especie, b.nb ? `NB ${b.nb}` : null].filter(Boolean).join(" · "))
                    .join(" | ")
                : "—"
            }
            className="sm:col-span-2"
          />
        </dl>
        <p className="text-[11px] text-muted-foreground">
          A origem do cadastro não define quem tem direito a honorários nem o percentual de repasse.
        </p>
      </Card>
      <Card className="gap-3 p-5">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Valores</h3>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Recebidos (confirmados)" valor={formatBRL(recebido)} />
          <Campo
            rotulo="Honorários a receber (informados)"
            valor={formatBRL(aReceber.reduce((s, l) => s + l.valor!, 0))}
          />
          <Campo rotulo="Saldo de cobranças" valor={formatBRL(saldoCobrancas)} />
        </dl>
        {porCat.size ? (
          <ul className="grid gap-1 text-xs sm:grid-cols-2">
            {[...porCat.entries()].map(([k, v]) => (
              <li key={k} className="flex justify-between rounded border border-border px-2 py-1">
                {ROTULO_CATEGORIA[k]} <strong className="tabular">{formatBRL(v)}</strong>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          "A receber" reúne valores previstos/devidos informados na planilha, ainda não confirmados
          como recebidos.
        </p>
      </Card>
      <Card className="gap-2 p-5 lg:col-span-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Pendências importantes
        </h3>
        {c.pendencias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma pendência aberta de importação.</p>
        ) : (
          <ul className="grid gap-1 text-xs">
            {c.pendencias.slice(0, 30).map((p) => (
              <li key={p.id} className="flex gap-1.5">
                <IconePendencia bloqueante={p.bloqueante} />
                <span>
                  <strong>{rotuloPendencia(p.tipo)}:</strong> {p.descricao}{" "}
                  <Link
                    to="/importacoes/$loteId"
                    params={{ loteId: p.lote_id }}
                    className="underline"
                  >
                    abrir lote
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Processos({ c }: { c: PerfilCompleto }) {
  const sincronizar = useSincronizar();
  const [destino, setDestino] = useState<Record<string, string>>({});
  const mesclar = useMutation({
    mutationFn: (v: { origem: string; destino: string }) =>
      mesclarAtendimentos(v.origem, v.destino),
    onSuccess: async () => {
      await sincronizar(EVENTOS.CLIENTE_ATUALIZADO);
      toast.success(
        "Atendimentos unidos. As informações foram movidas para o atendimento escolhido.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!c.atendimentos.length)
    return <SecaoVazia titulo="Nenhum processo ou atendimento registrado" />;
  const contar = (a: Atendimento) =>
    [
      [c.beneficios.filter((x) => x.atendimento_id === a.id).length, "benefício(s)"],
      [c.lancamentos.filter((x) => x.atendimento_id === a.id).length, "valor(es)"],
      [c.requisicoes.filter((x) => x.atendimento_id === a.id).length, "requisição(ões)"],
      [c.acordos.filter((x) => x.atendimento_id === a.id).length, "acordo(s)"],
      [c.historico.filter((x) => x.atendimento_id === a.id).length, "anotação(ões)"],
    ]
      .filter(([n]) => n)
      .map(([n, t]) => `${n} ${t}`)
      .join(" · ");
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {c.atendimentos.map((a) => (
        <Card key={a.id} className="gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{a.numero_processo ?? "Sem número de processo"}</p>
            <BadgeEscritorio escritorio={a.escritorio} />
          </div>
          <dl className="grid gap-2 sm:grid-cols-2">
            <Campo rotulo="Serviço" valor={a.servico} />
            <Campo
              rotulo="Natureza"
              valor={
                a.natureza === "judicial"
                  ? "Judicial"
                  : a.natureza === "administrativo"
                    ? "Administrativa"
                    : null
              }
            />
            <Campo rotulo="Tribunal / órgão" valor={a.tribunal} />
            <Campo rotulo="Benefício relacionado" valor={a.beneficio} />
            <Campo rotulo="Situação" valor={a.situacao} />
            <Campo
              rotulo="Parceria / repasse (texto original)"
              valor={a.parceria}
              className="sm:col-span-2"
            />
            <Campo rotulo="Observações" valor={a.observacoes} className="sm:col-span-2" />
          </dl>
          <p className="text-xs text-muted-foreground">{contar(a) || "Sem registros vinculados"}</p>
          <Origens origens={a.origens} />
          {c.atendimentos.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <Merge className="size-4 text-muted-foreground" aria-hidden />
              <Select
                value={destino[a.id] ?? ""}
                onValueChange={(v) => setDestino({ ...destino, [a.id]: v })}
              >
                <SelectTrigger className="h-8 w-64 text-xs">
                  <SelectValue placeholder="É o mesmo atendimento que..." />
                </SelectTrigger>
                <SelectContent>
                  {c.atendimentos
                    .filter((x) => x.id !== a.id)
                    .map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.numero_processo ?? "sem número"} — {x.servico ?? "atendimento"}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={!destino[a.id] || mesclar.isPending}
                onClick={() => mesclar.mutate({ origem: a.id, destino: destino[a.id]! })}
              >
                Unir atendimentos
              </Button>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function Beneficios({ c }: { c: PerfilCompleto }) {
  if (!c.beneficios.length) return <SecaoVazia titulo="Nenhum benefício registrado" />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {c.beneficios.map((b) => (
        <Card key={b.id} className="gap-2 p-4">
          <p className="text-sm font-semibold">
            {b.especie ?? "Benefício"}{" "}
            {b.nb ? <span className="font-normal text-muted-foreground">· NB {b.nb}</span> : null}
          </p>
          <dl className="grid gap-2 sm:grid-cols-3">
            <Campo rotulo="DIB" valor={dataOuTexto(b.dib, b.dib_texto)} />
            <Campo rotulo="DIB de origem" valor={b.dib_origem_texto} />
            <Campo rotulo="DIP" valor={dataOuTexto(b.dip, b.dip_texto)} />
            <Campo rotulo="DCB" valor={dataOuTexto(b.dcb, b.dcb_texto)} />
            <Campo rotulo="RMI" valor={b.rmi_texto ?? (b.rmi !== null ? formatBRL(b.rmi) : null)} />
            <Campo rotulo="RMA" valor={b.rma_texto ?? (b.rma !== null ? formatBRL(b.rma) : null)} />
            <Campo rotulo="Previsão de pagamento" valor={b.previsao_pagamento_texto} />
            <Campo
              rotulo="Trânsito em julgado"
              valor={dataOuTexto(b.transito_julgado, b.transito_texto)}
            />
            <Campo rotulo="Requerimento" valor={b.data_requerimento_texto} />
            <Campo rotulo="Concessão" valor={b.data_concessao_texto} />
            <Campo rotulo="Atrasados" valor={b.atrasados_texto} className="sm:col-span-3" />
            <Campo
              rotulo="Regra de honorários"
              valor={b.honorarios_regra}
              className="sm:col-span-3"
            />
            <Campo rotulo="Prorrogação" valor={b.prorrogacao_texto} className="sm:col-span-3" />
            <Campo rotulo="Revisão" valor={b.revisao_texto} className="sm:col-span-3" />
            <Campo rotulo="Implantação" valor={b.implantacao_texto} className="sm:col-span-3" />
            <Campo
              rotulo="Comunicação com o cliente"
              valor={b.comunicacao_texto}
              className="sm:col-span-3"
            />
          </dl>
          {b.historico?.length ? (
            <div className="border-t border-border pt-2">
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                Histórico de alterações
              </p>
              <ul className="mt-1 grid gap-0.5 text-xs">
                {b.historico.map((h, i) => (
                  <li key={i}>
                    <strong>{h.campo}:</strong> {h.texto}{" "}
                    <span className="text-muted-foreground">({h.celula})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Origens origens={b.origens} />
        </Card>
      ))}
    </div>
  );
}

function Financeiro({
  cliente,
  c,
  pagamentos,
}: {
  cliente: ClienteComTotais;
  c: PerfilCompleto;
  pagamentos: Pagamento[];
}) {
  const [receber, setReceber] = useState<Lancamento | null>(null);
  const [verLaterais, setVerLaterais] = useState(false);
  const porAtendimento = useMemo(() => {
    const m = new Map<string, Lancamento[]>();
    for (const l of c.lancamentos) {
      if (!verLaterais && l.versao !== 1) continue;
      const k = l.atendimento_id ?? "__sem";
      m.set(k, [...(m.get(k) ?? []), l]);
    }
    return m;
  }, [c.lancamentos, verLaterais]);
  const nomeAt = (id: string) => {
    const a = c.atendimentos.find((x) => x.id === id);
    return a
      ? `${a.numero_processo ?? "Sem número"} — ${a.servico ?? "atendimento"}`
      : "Sem atendimento vinculado";
  };
  const ordem: CategoriaFinanceira[] = [
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
    "calculo_inss",
    "valor_a_receber",
    "ajuste",
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Previsto/devido = informado na planilha. Recebido = confirmado (
          {formatBRL(pagamentos.reduce((s, p) => s + p.valor, 0))} em {pagamentos.length}{" "}
          entrada(s), ver "Entradas de valores"). Valores laterais nunca são somados.
        </p>
        <Button size="sm" variant="outline" onClick={() => setVerLaterais(!verLaterais)}>
          {verLaterais ? "Ocultar versões laterais" : "Mostrar versões laterais e atualizações"}
        </Button>
      </div>
      {porAtendimento.size === 0 ? <SecaoVazia titulo="Nenhum valor informado" /> : null}
      {[...porAtendimento.entries()].map(([at, lista]) => (
        <Card key={at} className="gap-2 p-4">
          <p className="text-sm font-semibold">
            {at === "__sem" ? "Sem atendimento vinculado" : nomeAt(at)}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2">Categoria</th>
                  <th className="py-1 pr-2 text-right">Valor</th>
                  <th className="py-1 pr-2">%</th>
                  <th className="py-1 pr-2">Base de cálculo</th>
                  <th className="py-1 pr-2">Natureza</th>
                  <th className="py-1 pr-2">Situação / observação</th>
                  <th className="py-1 pr-2">Origem</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...lista]
                  .sort(
                    (a, b) =>
                      ordem.indexOf(a.categoria) - ordem.indexOf(b.categoria) ||
                      a.versao - b.versao,
                  )
                  .map((l) => (
                    <tr
                      key={l.id}
                      className={cn(
                        "border-t border-border align-top",
                        l.versao !== 1 && "text-muted-foreground",
                      )}
                    >
                      <td className="py-1 pr-2">
                        {ROTULO_CATEGORIA[l.categoria]}
                        {l.versao !== 1 ? (
                          <span className="block text-[11px]">
                            versão {l.versao} · coluna {l.coluna}
                            {l.data_referencia_texto ? ` · ${l.data_referencia_texto}` : ""}
                          </span>
                        ) : null}
                        {l.rotulo_original ? (
                          <span className="block text-[11px] text-muted-foreground">
                            "{l.rotulo_original}"
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1 pr-2 text-right tabular font-semibold">
                        {l.valor !== null
                          ? formatBRL(l.valor)
                          : (l.ausencia_declarada ?? l.valor_texto ?? "—")}
                      </td>
                      <td className="py-1 pr-2">
                        {l.percentual !== null
                          ? `${l.percentual}%`
                          : l.quantidade_beneficios
                            ? `${l.quantidade_beneficios} benef.`
                            : "—"}
                      </td>
                      <td className="py-1 pr-2">{l.base_calculo ?? "—"}</td>
                      <td className="py-1 pr-2">
                        {l.pagamento_id ? "Recebido" : ROTULO_NATUREZA[l.natureza]}
                      </td>
                      <td className="max-w-xs py-1 pr-2">
                        {[l.situacao_texto, l.observacao].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="py-1 pr-2 text-[11px] text-muted-foreground">
                        {(l.origens ?? []).slice(0, 2).join(", ")}
                      </td>
                      <td className="py-1">
                        {CATEGORIAS_HONORARIOS.includes(l.categoria) &&
                        l.versao === 1 &&
                        !l.pagamento_id ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => setReceber(l)}
                          >
                            Registrar recebimento
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {receber ? (
        <DialogRecebimentoImportado
          aberto
          onFechar={() => setReceber(null)}
          clienteId={cliente.id}
          lancamentoId={receber.id}
          pendencia={{
            id: "",
            lote_id: "",
            pessoa_ref: null,
            bloco_ref: null,
            tipo: "confirmar_recebimento",
            bloqueante: false,
            descricao: `${ROTULO_CATEGORIA[receber.categoria]} — ${receber.rotulo_original ?? ""}`,
            celulas: [],
            dados: { valor: receber.valor, categoria: receber.categoria },
            status: "aberta",
            resolucao: null,
            created_at: "",
          }}
        />
      ) : null}
    </div>
  );
}

function Requisicoes({ c }: { c: PerfilCompleto }) {
  if (!c.requisicoes.length)
    return <SecaoVazia titulo="Nenhuma RPV, precatório ou TED registrada" />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {c.requisicoes.map((r) => (
        <Card key={r.id} className="gap-2 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Landmark className="size-4 text-muted-foreground" aria-hidden />
            {ROTULO_REQ[r.tipo]}
            {r.ano_previsto ? (
              <span className="font-normal text-muted-foreground">· previsão {r.ano_previsto}</span>
            ) : null}
          </p>
          <dl className="grid gap-2 sm:grid-cols-2">
            <Campo rotulo="Processo" valor={r.numero_processo} />
            <Campo rotulo="Situação" valor={r.situacao?.replace(/_/g, " ")} />
            <Campo rotulo="Expedição" valor={r.expedicao_texto} />
            <Campo rotulo="Previsão" valor={r.previsao_texto} />
            <Campo rotulo="Valor" valor={r.valor !== null ? formatBRL(r.valor) : r.valor_texto} />
            <Campo rotulo="Tipo de valor" valor={r.tipo_valor} />
            <Campo rotulo="Conta indicada" valor={r.conta_indicada} />
            <Campo rotulo="Titular" valor={r.titular} />
            <Campo rotulo="Data" valor={r.data_texto} />
            <Campo rotulo="Retificação" valor={r.retificacao} />
            <Campo
              rotulo="Venda do precatório"
              valor={r.venda ? "Sim (informado na planilha)" : null}
            />
            <Campo rotulo="Anotações" valor={r.situacao_texto} className="sm:col-span-2" />
            <Campo rotulo="Observações" valor={r.observacoes} className="sm:col-span-2" />
          </dl>
          <Origens origens={r.origens} />
        </Card>
      ))}
    </div>
  );
}

function Acordos({ c }: { c: PerfilCompleto }) {
  if (!c.acordos.length) return <SecaoVazia titulo="Nenhum acordo registrado" />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {c.acordos.map((a) => (
        <Card key={a.id} className="gap-2 p-4">
          <p className="text-sm font-semibold">
            Acordo INSS {a.numero_processo ? `· ${a.numero_processo}` : ""}
          </p>
          <dl className="grid gap-2 sm:grid-cols-3">
            <Campo
              rotulo="Aceitação"
              valor={
                a.aceitacao === "sim" ? "Sim" : a.aceitacao === "nao" ? "Não" : a.aceitacao_texto
              }
            />
            <Campo rotulo="Percentual" valor={a.percentual !== null ? `${a.percentual}%` : null} />
            <Campo rotulo="Texto original" valor={a.aceitacao_texto} />
            <Campo rotulo="Benefício" valor={a.beneficio} />
            <Campo rotulo="DIB" valor={dataOuTexto(a.dib, a.dib_texto)} />
            <Campo rotulo="DIP" valor={dataOuTexto(a.dip, a.dip_texto)} />
            <Campo
              rotulo="DCB"
              valor={
                a.dcb_prazo_dias
                  ? `${a.dcb_texto} (prazo, sem data inicial expressa)`
                  : dataOuTexto(a.dcb, a.dcb_texto)
              }
            />
            <Campo
              rotulo="Sucumbência"
              valor={
                a.sucumbencia_percentual !== null
                  ? `${a.sucumbencia_percentual}%`
                  : a.sucumbencia_texto
              }
            />
            <Campo rotulo="De acordo c/ laudo" valor={a.de_acordo_laudo} />
            <Campo rotulo="Prorrogação" valor={a.prorrogacao} />
            <Campo rotulo="Reabilitação" valor={a.reabilitacao} />
            <Campo rotulo="Observações" valor={a.observacoes} className="sm:col-span-3" />
          </dl>
          <Origens origens={a.origens} />
        </Card>
      ))}
    </div>
  );
}

function Cobrancas({
  c,
  clienteId,
  pagamentos,
}: {
  c: PerfilCompleto;
  clienteId: string;
  pagamentos: Pagamento[];
}) {
  const [receber, setReceber] = useState(false);
  if (!c.cobrancas.length) return <SecaoVazia titulo="Nenhuma cobrança registrada" />;
  const pagamentoPorId = new Map(pagamentos.map((p) => [p.id, p]));
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setReceber(true)}>
          Registrar pagamento de parcelas
        </Button>
      </div>
      {c.cobrancas.map((cob) => {
        const parcelas = c.parcelas
          .filter((p) => p.cobranca_id === cob.id)
          .sort((a, b) => a.numero - b.numero);
        const pago = parcelas.reduce((s, p) => s + p.valor_pago, 0);
        const sit = ROTULO_SIT_COB[cob.situacao] ?? ROTULO_SIT_COB["a_confirmar"]!;
        return (
          <Card key={cob.id} className="gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{cob.descricao ?? "Cobrança"}</p>
              <span
                className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", sit.classe)}
              >
                {sit.texto}
              </span>
            </div>
            <dl className="grid gap-2 sm:grid-cols-4">
              <Campo
                rotulo="Valor contratado"
                valor={
                  cob.valor_contratado !== null ? formatBRL(cob.valor_contratado) : "não informado"
                }
              />
              <Campo
                rotulo="Entrada"
                valor={cob.entrada !== null ? formatBRL(cob.entrada) : null}
              />
              <Campo
                rotulo="Parcelas"
                valor={
                  cob.quantidade_parcelas
                    ? `${cob.quantidade_parcelas} × ${cob.valor_parcela !== null ? formatBRL(cob.valor_parcela) : "?"}`
                    : null
                }
              />
              <Campo rotulo="Pago (parcelas)" valor={parcelas.length ? formatBRL(pago) : null} />
              <Campo rotulo="Responsável" valor={cob.responsavel} />
              <Campo rotulo="Prestação de contas" valor={cob.prestacao_contas} />
              <Campo
                rotulo="Vencimento inicial"
                valor={
                  cob.vencimento_inicial ? formatDate(cob.vencimento_inicial) : cob.vencimento_texto
                }
              />
            </dl>
            {cob.divergencia ? (
              <p className="flex gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                {cob.divergencia} Parcelas não foram criadas automaticamente.
              </p>
            ) : null}
            {cob.completar ? (
              <p className="text-xs text-muted-foreground">A completar: {cob.completar}.</p>
            ) : null}
            {parcelas.length ? (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1">Parcela</th>
                    <th className="py-1 text-right">Valor</th>
                    <th className="py-1">Vencimento</th>
                    <th className="py-1">Situação</th>
                    <th className="py-1">Recebimento</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelas.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="py-1">{p.numero}</td>
                      <td className="py-1 text-right tabular">{formatBRL(p.valor)}</td>
                      <td className="py-1">
                        {p.vencimento
                          ? formatDate(p.vencimento)
                          : (p.vencimento_texto ?? "não informado")}
                      </td>
                      <td className="py-1">
                        {p.situacao === "paga"
                          ? "Paga"
                          : p.situacao === "paga_parcial"
                            ? `Parcial (${formatBRL(p.valor_pago)})`
                            : "Aberta"}
                      </td>
                      <td className="py-1 text-muted-foreground">
                        {c.recebimentoParcelas
                          .filter((r) => r.parcela_id === p.id)
                          .map((r) => {
                            const pg = pagamentoPorId.get(r.pagamento_id);
                            return `${formatBRL(r.valor)}${pg ? ` em ${formatDate(pg.data_pagamento)}` : ""}`;
                          })
                          .join("; ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {cob.historico ? (
              <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">
                Histórico: {cob.historico}
              </p>
            ) : null}
            <Origens origens={cob.origens} />
          </Card>
        );
      })}
      {receber ? (
        <DialogRecebimentoImportado
          aberto
          onFechar={() => setReceber(false)}
          clienteId={clienteId}
        />
      ) : null}
    </div>
  );
}

function Bancarios({ c }: { c: PerfilCompleto }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card className="gap-2 p-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Dados bancários
        </h3>
        {c.bancarios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum dado bancário.</p>
        ) : (
          c.bancarios.map((b) => (
            <div key={b.id} className="rounded-md border border-border p-3">
              <dl className="grid gap-2 sm:grid-cols-3">
                <Campo rotulo="Banco" valor={b.banco} />
                <Campo rotulo="Agência" valor={b.agencia} />
                <Campo rotulo="Conta" valor={b.conta} />
                <Campo rotulo="Operação" valor={b.operacao} />
                <Campo rotulo="Tipo" valor={b.tipo_conta} />
                <Campo rotulo="Titular" valor={b.titular} />
              </dl>
              {!b.consistente ? (
                <p className="mt-1 text-xs text-amber-700">Verificar: {b.observacao}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-muted-foreground">
                Texto original: {b.texto_original}
              </p>
            </div>
          ))
        )}
      </Card>
      <Card className="gap-2 p-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Representantes, curadores e sucessores
        </h3>
        {c.representantes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum representante mencionado.</p>
        ) : (
          c.representantes.map((r) => (
            <div key={r.id} className="rounded-md border border-border p-3 text-sm">
              <p>
                <strong>{r.nome ?? "Nome não informado"}</strong>{" "}
                {r.relacao ? <span className="text-muted-foreground">— {r.relacao}</span> : null}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Texto original: "{r.texto_original}" (a separação pode ser revisada)
              </p>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

function Historico({ c }: { c: PerfilCompleto }) {
  const [cat, setCat] = useState("todas");
  const cats = [...new Set(c.historico.map((h) => h.categoria))];
  const lista = c.historico.filter((h) => cat === "todas" || h.categoria === cat);
  if (!c.historico.length) return <SecaoVazia titulo="Nenhuma anotação registrada" />;
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={cat === "todas" ? "secondary" : "ghost"}
          onClick={() => setCat("todas")}
        >
          Todas ({c.historico.length})
        </Button>
        {cats.map((x) => (
          <Button
            key={x}
            size="sm"
            variant={cat === x ? "secondary" : "ghost"}
            onClick={() => setCat(x)}
          >
            {x.replace(/_/g, " ")}
          </Button>
        ))}
      </div>
      <ul className="divide-y divide-border">
        {lista.map((h) => (
          <li key={h.id} className="py-2 text-sm">
            <p className="whitespace-pre-wrap">{h.texto}</p>
            <p className="text-[11px] text-muted-foreground">
              {h.aba ? `${h.aba.trim()}${h.celulas ? `!${h.celulas}` : ""}` : "—"} ·{" "}
              {h.categoria.replace(/_/g, " ")}
              {h.data_texto ? ` · data citada: ${h.data_texto}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Originais({ clienteId, c }: { clienteId: string; c: PerfilCompleto }) {
  const { data: celulas = [], isLoading } = useQuery(celulasDoClienteQuery(clienteId));
  const [soAdicionais, setSoAdicionais] = useState(false);
  if (!c.blocos.length)
    return <SecaoVazia titulo="Este cliente não veio de uma importação por planilha Furtado" />;
  const loteNome = new Map(c.lotes.map((l) => [l.id, l]));
  const porBloco = new Map<string, typeof celulas>();
  for (const cel of celulas) {
    if (soAdicionais && cel.destino !== "informacao_adicional") continue;
    const k = `${cel.lote_id}|${cel.bloco_ref}`;
    porBloco.set(k, [...(porBloco.get(k) ?? []), cel]);
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={soAdicionais ? "ghost" : "secondary"}
          onClick={() => setSoAdicionais(false)}
        >
          Blocos completos
        </Button>
        <Button
          size="sm"
          variant={soAdicionais ? "secondary" : "ghost"}
          onClick={() => setSoAdicionais(true)}
        >
          Informações adicionais importadas (
          {celulas.filter((x) => x.destino === "informacao_adicional").length})
        </Button>
      </div>
      {isLoading ? <Skeleton className="h-40" /> : null}
      {c.blocos.map((b) => {
        const lote = loteNome.get(b.lote_id);
        const cels = porBloco.get(`${b.lote_id}|${b.ref}`) ?? [];
        if (soAdicionais && !cels.length) return null;
        return (
          <Card key={b.id} className="gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {b.aba.trim()}!{b.intervalo}
                {b.nome_original ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    — "{b.nome_original.replace(/\s+/g, " ").trim()}"
                  </span>
                ) : null}
              </p>
              {lote ? (
                <Link
                  to="/importacoes/$loteId"
                  params={{ loteId: lote.id }}
                  className="text-xs underline"
                >
                  {lote.arquivo_nome} · {formatDateTime(lote.created_at)}
                </Link>
              ) : null}
            </div>
            <div className="max-h-72 overflow-auto rounded border border-border">
              <table className="w-full text-xs">
                <tbody>
                  {cels.map((x) => (
                    <tr key={x.id} className="border-t border-border align-top first:border-t-0">
                      <td className="w-16 whitespace-nowrap px-2 py-1 font-medium">{x.celula}</td>
                      <td className="whitespace-pre-wrap px-2 py-1">{x.valor_original}</td>
                      <td className="w-48 px-2 py-1 text-[11px] text-muted-foreground">
                        {ROTULO_DESTINO[x.destino as Destino] ?? x.destino}
                        <span className="block">{x.destino_ref}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
