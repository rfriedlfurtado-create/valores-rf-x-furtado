/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda sem tipos gerados (types.ts) */
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
import { DialogRecebimentoImportado } from "@/components/furtado/DialogRecebimentoImportado";
import {
  Contador,
  DistribuicaoDestinos,
  IconePendencia,
  rotuloPendencia,
  TabelaTotais,
  TabelaValoresPorCategoria,
} from "@/components/importador/furtado/PartesRevisao";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSistema } from "@/hooks/useSistema";
import { BadgeEscritorio } from "@/lib/escritorio";
import { formatDateTime } from "@/lib/format";
import {
  celulasDoLoteQuery,
  loteQuery,
  type PendenciaLote,
  type PessoaLote,
} from "@/lib/furtado/consultas";
import { ROTULO_DESTINO, type Destino } from "@/lib/furtado/modelo";
import {
  desfazerLote,
  resolverPendencia,
  resolverPessoa,
  retomarLote,
  substituirCampoImportado,
  urlArquivoOriginal,
  type Progresso as ProgressoGravacao,
} from "@/lib/furtado/persistencia";
import { ROTULO_STATUS_LOTE } from "@/lib/furtado/rotulosUi";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import { normalizarNome } from "@/lib/similarity";

export const Route = createFileRoute("/importacoes_/$loteId")({
  head: () => ({
    meta: [
      { title: "Lote de importação — Base de Pagamentos" },
      {
        name: "description",
        content: "Detalhe, pendências, rastreabilidade e desfazimento de um lote de importação.",
      },
    ],
  }),
  component: PaginaLote,
});

function PaginaLote() {
  const { loteId } = Route.useParams();
  const sincronizar = useSincronizar();
  const { data, isLoading, error } = useQuery(loteQuery(loteId));
  const [progresso, setProgresso] = useState<ProgressoGravacao | null>(null);

  const retomar = useMutation({
    mutationFn: () => retomarLote(loteId, setProgresso),
    onSuccess: async () => {
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      toast.success("Lote retomado e concluído sem duplicações.");
      setProgresso(null);
    },
    onError: async (e: Error) => {
      toast.error(e.message);
      setProgresso(null);
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
    },
  });

  const desfazer = useMutation({
    mutationFn: () => desfazerLote(loteId),
    onSuccess: async (r) => {
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      toast.success("Lote desfeito", {
        description: `${r.removidos} registro(s) removido(s), ${r.revertidos} campo(s) revertido(s), ${r.preservados.length} preservado(s) por terem sido alterados depois ou terem outros vínculos.`,
        duration: 10000,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (error || !data)
    return (
      <SecaoVazia titulo="Lote não encontrado" descricao={(error as Error | null)?.message ?? ""} />
    );

  const { lote, pessoas, pendencias } = data;
  const st = ROTULO_STATUS_LOTE[lote.status] ?? { texto: lote.status, tom: "neutro" as const };
  const aplicadas = pessoas.filter((p) => p.status === "aplicado").length;
  const pendentes = pessoas.filter((p) => p.status === "pendente").length;
  const abertas = pendencias.filter((p) => p.status === "aberta");
  const desfeito = lote.status === "desfeito" || lote.status === "desfeito_parcial";
  const plano = lote.resumo?.["plano"] as Record<string, any> | undefined;

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/importacoes">
          <ArrowLeft className="size-4" aria-hidden />
          Histórico de importações
        </Link>
      </Button>
      <PageHeader
        titulo={`Lote — ${lote.arquivo_nome}`}
        descricao={`Importado em ${formatDateTime(lote.created_at)}`}
      >
        {lote.arquivo_path ? (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                window.open(await urlArquivoOriginal(lote.arquivo_path!), "_blank");
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            <Download className="size-4" aria-hidden />
            Arquivo original
          </Button>
        ) : null}
        {(lote.status === "gravando" || lote.status === "falhou") && !retomar.isPending ? (
          <Button onClick={() => retomar.mutate()}>
            <RotateCcw className="size-4" aria-hidden />
            Retomar gravação
          </Button>
        ) : null}
        {!desfeito ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="border-red-300 text-red-700"
                disabled={desfazer.isPending}
              >
                <Undo2 className="size-4" aria-hidden />
                Desfazer lote
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Desfazer este lote?</AlertDialogTitle>
                <AlertDialogDescription>
                  Serão removidos ou revertidos apenas os efeitos deste lote. Cadastros anteriores,
                  vínculos preexistentes e alterações feitas depois por outros usuários são
                  preservados. O registro do lote, o arquivo original e as células continuam
                  disponíveis para consulta.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => desfazer.mutate()}>Desfazer</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <BadgeStatus texto={st.texto} tom={st.tom} />
        <BadgeEscritorio escritorio={lote.escritorio} completo />
        <span className="text-xs text-muted-foreground">Modelo: {lote.modelo}</span>
        {lote.erro ? <span className="text-xs text-red-700">Erro: {lote.erro}</span> : null}
        {abertas.length || pendentes ? (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Importação ainda não totalmente organizada: {pendentes} cliente(s) sem associação e{" "}
            {abertas.length} pendência(s) aberta(s).
          </span>
        ) : null}
      </div>

      {retomar.isPending ? (
        <Card className="mb-4 gap-2 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {progresso?.etapa ?? "Retomando"}
          </p>
          <Progress
            value={progresso && progresso.total ? (progresso.atual / progresso.total) * 100 : 5}
          />
        </Card>
      ) : null}

      {lote.resumo?.["desfazimento"] ? (
        <Card className="mb-4 gap-1 p-4 text-xs">
          <p className="font-semibold">Desfazimento</p>
          <p>
            {lote.resumo["desfazimento"].removidos} registro(s) removido(s) ·{" "}
            {lote.resumo["desfazimento"].revertidos} campo(s) revertido(s) ·{" "}
            {(lote.resumo["desfazimento"].preservados ?? []).length} item(ns) preservado(s)
            (alterados depois ou com outros vínculos).
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Contador valor={pessoas.length} rotulo="Pessoas identificadas" />
        <Contador valor={aplicadas} rotulo="Gravadas" tom="sucesso" />
        <Contador
          valor={pendentes}
          rotulo="Sem associação (pendentes)"
          tom={pendentes ? "alerta" : undefined}
        />
        <Contador
          valor={pessoas.filter((p) => p.status === "ignorado").length}
          rotulo="Mantidas só no lote"
        />
        <Contador
          valor={abertas.length}
          rotulo="Pendências abertas"
          tom={abertas.length ? "alerta" : undefined}
        />
        <Contador valor={lote.resumo?.["celulas"] ?? "—"} rotulo="Células preservadas" />
      </div>

      <Tabs defaultValue={pendentes ? "pessoas" : "pendencias"} className="mt-6">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="pessoas">Clientes ({pessoas.length})</TabsTrigger>
          <TabsTrigger value="pendencias">Pendências ({abertas.length} abertas)</TabsTrigger>
          <TabsTrigger value="abas">Abas e destinos</TabsTrigger>
          <TabsTrigger value="totais">Totais gerais</TabsTrigger>
          <TabsTrigger value="celulas">Células (rastreabilidade)</TabsTrigger>
        </TabsList>
        <TabsContent value="pessoas" className="mt-3">
          <PessoasDoLote
            loteId={loteId}
            pessoas={pessoas}
            pendencias={pendencias}
            bloqueado={desfeito}
          />
        </TabsContent>
        <TabsContent value="pendencias" className="mt-3">
          <PendenciasDoLote
            loteId={loteId}
            pendencias={pendencias}
            pessoas={pessoas}
            bloqueado={desfeito}
          />
        </TabsContent>
        <TabsContent value="abas" className="mt-3 grid gap-3">
          {plano ? (
            <Card className="gap-2 p-4">
              <p className="text-sm font-semibold">
                Valores identificados por categoria (previstos e devidos — não são recebimentos)
              </p>
              <TabelaValoresPorCategoria porCategoria={plano["porCategoria"] ?? {}} />
            </Card>
          ) : null}
          {(lote.abas ?? []).map((a: any) => (
            <Card key={a.aba} className="gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{a.aba}</p>
                <p className="text-xs text-muted-foreground">
                  {a.celulas} células · {a.blocos} registros · {a.formulas} fórmulas · leitura:{" "}
                  {a.estrategia}
                </p>
              </div>
              <DistribuicaoDestinos porDestino={a.porDestino ?? {}} />
            </Card>
          ))}
        </TabsContent>
        <TabsContent value="totais" className="mt-3">
          <TabelaTotais totais={lote.totais ?? []} />
        </TabsContent>
        <TabsContent value="celulas" className="mt-3">
          <CelulasDoLote
            loteId={loteId}
            abas={(lote.abas ?? []).map((a: any) => a.aba as string)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PessoasDoLote({
  loteId,
  pessoas,
  pendencias,
  bloqueado,
}: {
  loteId: string;
  pessoas: PessoaLote[];
  pendencias: PendenciaLote[];
  bloqueado: boolean;
}) {
  const [filtro, setFiltro] = useState<"pendente" | "todos">(
    pessoas.some((p) => p.status === "pendente") ? "pendente" : "todos",
  );
  const [busca, setBusca] = useState("");
  const termo = normalizarNome(busca);
  const lista = pessoas.filter(
    (p) =>
      (filtro === "todos" || p.status === "pendente") &&
      (!termo || p.nome_normalizado.includes(termo)),
  );
  const pendPorPessoa = useMemo(() => {
    const m = new Map<string, PendenciaLote[]>();
    for (const p of pendencias)
      if (p.pessoa_ref) m.set(p.pessoa_ref, [...(m.get(p.pessoa_ref) ?? []), p]);
    return m;
  }, [pendencias]);
  const clientePorRef = useMemo(
    () => new Map(pessoas.filter((p) => p.cliente_id).map((p) => [p.ref, p])),
    [pessoas],
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={filtro === "pendente" ? "secondary" : "ghost"}
          onClick={() => setFiltro("pendente")}
        >
          Pendentes ({pessoas.filter((p) => p.status === "pendente").length})
        </Button>
        <Button
          size="sm"
          variant={filtro === "todos" ? "secondary" : "ghost"}
          onClick={() => setFiltro("todos")}
        >
          Todos ({pessoas.length})
        </Button>
        <Input
          className="ml-auto h-9 w-full sm:w-72"
          placeholder="Buscar nome..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs">
            <tr>
              <th className="px-2 py-2">Pessoa</th>
              <th className="px-2 py-2">Situação</th>
              <th className="px-2 py-2">Cliente</th>
              <th className="min-w-80 px-2 py-2">Pendências / decisão</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className="border-t border-border align-top">
                <td className="px-2 py-2">
                  <p className="font-semibold">{p.nome}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(p.blocos ?? []).length} bloco(s) · {p.motivo}
                  </p>
                </td>
                <td className="px-2 py-2 text-xs">
                  {p.status === "aplicado"
                    ? "Gravado"
                    : p.status === "pendente"
                      ? "Pendente"
                      : p.status === "ignorado"
                        ? "Só no lote"
                        : "Desfeito"}
                </td>
                <td className="px-2 py-2 text-xs">
                  {p.cliente_id && p.status === "aplicado" ? (
                    <Link
                      to="/clientes/$clienteId"
                      params={{ clienteId: p.cliente_id }}
                      className="underline underline-offset-2"
                    >
                      Ver perfil
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-2 text-xs">
                  <ul className="grid gap-1">
                    {(pendPorPessoa.get(p.ref) ?? [])
                      .filter((x) => x.bloqueante)
                      .map((x) => (
                        <li key={x.id} className="flex gap-1.5">
                          <IconePendencia bloqueante={x.bloqueante} status={x.status} />
                          <span>{x.descricao}</span>
                        </li>
                      ))}
                  </ul>
                  {p.status === "pendente" && !bloqueado ? (
                    <ResolverPessoa
                      loteId={loteId}
                      pessoa={p}
                      outros={(pendPorPessoa.get(p.ref) ?? [])
                        .flatMap((x) => (x.dados?.["pessoas"] as string[] | undefined) ?? [])
                        .filter((r) => r !== p.ref)
                        .map((r) => clientePorRef.get(r))
                        .filter((x): x is PessoaLote => !!x && x.status === "aplicado")}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">Nenhum registro.</p>
        ) : null}
      </div>
    </div>
  );
}

function ResolverPessoa({
  loteId,
  pessoa,
  outros,
}: {
  loteId: string;
  pessoa: PessoaLote;
  outros: PessoaLote[];
}) {
  const sincronizar = useSincronizar();
  const { base } = useSistema();
  const [valor, setValor] = useState<string>(pessoa.sugestao ? `vincular:${pessoa.sugestao}` : "");
  const [nome, setNome] = useState(pessoa.ref.startsWith("b:") ? "" : pessoa.nome);
  const [busca, setBusca] = useState("");
  const candidatos = new Map<string, string>();
  for (const c of pessoa.candidatos ?? []) candidatos.set(c.clienteId, `${c.nome} — ${c.motivo}`);
  for (const o of outros)
    if (o.cliente_id) candidatos.set(o.cliente_id, `${o.nome} — registro unido nesta planilha`);
  const t = normalizarNome(busca);
  const encontrados =
    t.length >= 3 && base
      ? base.clientes.filter((c) => c.nome_normalizado.includes(t)).slice(0, 8)
      : [];

  const m = useMutation({
    mutationFn: () => {
      if (valor === "criar") {
        if (!nome.trim()) throw new Error("Informe o nome do cliente.");
        return resolverPessoa({
          loteId,
          ref: pessoa.ref,
          acao: "criar",
          nome: nome.trim(),
          nomeNormalizado: normalizarNome(nome),
        });
      }
      if (valor === "ignorar") return resolverPessoa({ loteId, ref: pessoa.ref, acao: "ignorar" });
      if (valor.startsWith("vincular:"))
        return resolverPessoa({
          loteId,
          ref: pessoa.ref,
          acao: "vincular",
          clienteId: valor.slice(9),
        });
      throw new Error("Escolha uma decisão.");
    },
    onSuccess: async () => {
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      toast.success("Decisão gravada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-2 grid gap-1 rounded-md border border-border p-2">
      <Select value={valor} onValueChange={setValor}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Escolha a decisão..." />
        </SelectTrigger>
        <SelectContent>
          {[...candidatos.entries()].map(([id, r]) => (
            <SelectItem key={id} value={`vincular:${id}`}>
              Vincular a {r}
            </SelectItem>
          ))}
          {encontrados.map((c) => (
            <SelectItem key={c.id} value={`vincular:${c.id}`}>
              Vincular a {c.nome}
            </SelectItem>
          ))}
          <SelectItem value="criar">Criar novo cliente</SelectItem>
          <SelectItem value="ignorar">Manter só no lote</SelectItem>
        </SelectContent>
      </Select>
      <Input
        className="h-8 text-xs"
        placeholder="Buscar outro cliente (3+ letras) e escolha acima"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      {valor === "criar" ? (
        <Input
          className="h-8 text-xs"
          placeholder="Nome completo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
      ) : null}
      <Button
        size="sm"
        className="h-7 justify-self-start"
        disabled={!valor || m.isPending}
        onClick={() => m.mutate()}
      >
        {m.isPending ? "Gravando..." : "Confirmar e gravar"}
      </Button>
    </div>
  );
}

function PendenciasDoLote({
  loteId,
  pendencias,
  pessoas,
  bloqueado,
}: {
  loteId: string;
  pendencias: PendenciaLote[];
  pessoas: PessoaLote[];
  bloqueado: boolean;
}) {
  const sincronizar = useSincronizar();
  const [status, setStatus] = useState<"aberta" | "todas">("aberta");
  const [tipo, setTipo] = useState("todas");
  const [recebimento, setRecebimento] = useState<PendenciaLote | null>(null);
  const pessoaPorRef = useMemo(() => new Map(pessoas.map((p) => [p.ref, p])), [pessoas]);
  const tipos = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pendencias)
      if (status === "todas" || p.status === "aberta") m.set(p.tipo, (m.get(p.tipo) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [pendencias, status]);
  const lista = pendencias.filter(
    (p) => (status === "todas" || p.status === "aberta") && (tipo === "todas" || p.tipo === tipo),
  );

  const marcar = useMutation({
    mutationFn: (v: { id: string; status: "resolvida" | "ignorada"; obs: string | null }) =>
      resolverPendencia(v.id, v.status, v.obs, loteId),
    onSuccess: () => sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA),
    onError: (e: Error) => toast.error(e.message),
  });
  const substituir = useMutation({
    mutationFn: (p: PendenciaLote) =>
      substituirCampoImportado({
        tabela: p.dados["tabela"],
        registroId: p.dados["registroId"],
        campo: p.dados["campo"],
        valor: p.dados["importado"],
        pendenciaId: p.id,
        loteId,
      }),
    onSuccess: async () => {
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      toast.success("Valor da planilha aplicado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={status === "aberta" ? "secondary" : "ghost"}
          onClick={() => setStatus("aberta")}
        >
          Abertas
        </Button>
        <Button
          size="sm"
          variant={status === "todas" ? "secondary" : "ghost"}
          onClick={() => setStatus("todas")}
        >
          Todas
        </Button>
        <span className="mx-1 border-l border-border" />
        <Button
          size="sm"
          variant={tipo === "todas" ? "secondary" : "ghost"}
          onClick={() => setTipo("todas")}
        >
          Todos os tipos
        </Button>
        {tipos.map(([t, n]) => (
          <Button
            key={t}
            size="sm"
            variant={tipo === t ? "secondary" : "ghost"}
            onClick={() => setTipo(t)}
          >
            {rotuloPendencia(t)} ({n})
          </Button>
        ))}
      </div>
      {lista.length === 0 ? (
        <SecaoVazia titulo="Nenhuma pendência neste filtro" />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lista.slice(0, 500).map((p) => {
            const pessoa = p.pessoa_ref ? pessoaPorRef.get(p.pessoa_ref) : undefined;
            return (
              <li key={p.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 gap-2">
                  <IconePendencia bloqueante={p.bloqueante} status={p.status} />
                  <div className="min-w-0 text-xs">
                    <p className="font-semibold">
                      {rotuloPendencia(p.tipo)}
                      {pessoa ? (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          ·{" "}
                          {pessoa.cliente_id && pessoa.status === "aplicado" ? (
                            <Link
                              to="/clientes/$clienteId"
                              params={{ clienteId: pessoa.cliente_id }}
                              className="underline"
                            >
                              {pessoa.nome}
                            </Link>
                          ) : (
                            pessoa.nome
                          )}
                        </span>
                      ) : null}
                    </p>
                    <p>{p.descricao}</p>
                    {p.celulas.length ? (
                      <p className="text-[11px] text-muted-foreground">
                        Células: {p.celulas.slice(0, 8).join(", ")}
                      </p>
                    ) : null}
                    {p.status !== "aberta" && p.resolucao ? (
                      <p className="text-[11px] text-muted-foreground">
                        Resolução: {JSON.stringify(p.resolucao)}
                      </p>
                    ) : null}
                  </div>
                </div>
                {p.status === "aberta" && !bloqueado ? (
                  <div className="flex flex-wrap gap-1">
                    {p.tipo === "confirmar_recebimento" ? (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!pessoa?.cliente_id || pessoa.status !== "aplicado"}
                        title={!pessoa?.cliente_id ? "Associe o cliente primeiro" : undefined}
                        onClick={() => setRecebimento(p)}
                      >
                        Registrar recebimento
                      </Button>
                    ) : null}
                    {(p.tipo === "conflito_valor" || p.tipo === "conflito_dado") &&
                    p.dados?.["registroId"] &&
                    p.dados?.["tabela"] !== "clientes" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => substituir.mutate(p)}
                      >
                        Usar valor da planilha
                      </Button>
                    ) : null}
                    {!p.bloqueante ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() =>
                            marcar.mutate({ id: p.id, status: "resolvida", obs: null })
                          }
                        >
                          {p.tipo.startsWith("conflito")
                            ? "Manter cadastrado"
                            : "Marcar como revisada"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => marcar.mutate({ id: p.id, status: "ignorada", obs: null })}
                        >
                          Ignorar
                        </Button>
                      </>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Resolva na aba Clientes
                      </span>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {recebimento ? (
        <DialogRecebimentoImportado
          aberto
          onFechar={() => setRecebimento(null)}
          clienteId={pessoaPorRef.get(recebimento.pessoa_ref ?? "")?.cliente_id ?? ""}
          pendencia={recebimento}
          loteId={loteId}
        />
      ) : null}
    </div>
  );
}

function CelulasDoLote({ loteId, abas }: { loteId: string; abas: string[] }) {
  const [aba, setAba] = useState<string>("");
  const [destino, setDestino] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [pagina, setPagina] = useState(0);
  const filtro = {
    pagina,
    ...(aba ? { aba } : {}),
    ...(destino ? { destino } : {}),
    ...(buscaAplicada ? { busca: buscaAplicada } : {}),
  };
  const { data, isLoading } = useQuery(celulasDoLoteQuery(loteId, filtro));
  const total = data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / (data?.tamanho ?? 200)));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Select
          value={aba || "__todas"}
          onValueChange={(v) => {
            setAba(v === "__todas" ? "" : v);
            setPagina(0);
          }}
        >
          <SelectTrigger className="h-9 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__todas">Todas as abas</SelectItem>
            {abas.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={destino || "__todos"}
          onValueChange={(v) => {
            setDestino(v === "__todos" ? "" : v);
            setPagina(0);
          }}
        >
          <SelectTrigger className="h-9 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos">Todos os destinos</SelectItem>
            {(Object.keys(ROTULO_DESTINO) as Destino[]).map((d) => (
              <SelectItem key={d} value={d}>
                {ROTULO_DESTINO[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setBuscaAplicada(busca.trim());
            setPagina(0);
          }}
        >
          <Input
            className="h-9 w-64"
            placeholder="Texto ou célula (ex.: F139)"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Button size="sm" type="submit" variant="outline">
            Buscar
          </Button>
        </form>
        <span className="ml-auto self-center text-xs text-muted-foreground">{total} célula(s)</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="max-h-[36rem] overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="px-2 py-1.5">Aba!Célula</th>
                <th className="px-2 py-1.5">Conteúdo original</th>
                <th className="px-2 py-1.5">Valor interpretado</th>
                <th className="px-2 py-1.5">Destino</th>
                <th className="px-2 py-1.5">Situação</th>
                <th className="px-2 py-1.5">Metadados</th>
              </tr>
            </thead>
            <tbody>
              {(data?.celulas ?? []).map((c) => (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {c.aba.trim()}!{c.celula}
                    {c.cliente_id ? (
                      <Link
                        to="/clientes/$clienteId"
                        params={{ clienteId: c.cliente_id }}
                        className="ml-1 text-[11px] underline"
                      >
                        cliente
                      </Link>
                    ) : null}
                  </td>
                  <td className="max-w-md whitespace-pre-wrap px-2 py-1.5">
                    {c.valor_original}
                    {c.formula ? (
                      <span className="block text-[11px] text-muted-foreground">
                        Fórmula {c.formula} · armazenado {c.resultado_armazenado ?? "—"} ·
                        recalculado {c.resultado_recalculado ?? "—"}
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-xs px-2 py-1.5 text-[11px] text-muted-foreground">
                    {c.valor_interpretado
                      ? JSON.stringify(c.valor_interpretado).slice(0, 220)
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {ROTULO_DESTINO[c.destino as Destino] ?? c.destino}
                    <span className="block text-[11px] text-muted-foreground">{c.destino_ref}</span>
                  </td>
                  <td className="px-2 py-1.5">{c.situacao}</td>
                  <td className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    {[
                      c.metadados?.["cor"] ? `cor ${c.metadados["cor"]}` : null,
                      c.metadados?.["oculta"] ? "oculta" : null,
                      c.metadados?.["mesclada"] ? `mesclada ${c.metadados["mesclada"]}` : null,
                      c.metadados?.["comentario"]
                        ? `comentário: ${c.metadados["comentario"]}`
                        : null,
                      c.formato && c.formato !== "General" ? `formato ${c.formato}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-end gap-2 text-xs">
        <Button
          size="sm"
          variant="outline"
          disabled={pagina === 0}
          onClick={() => setPagina(pagina - 1)}
        >
          Anterior
        </Button>
        <span>
          Página {pagina + 1} de {paginas}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={pagina + 1 >= paginas}
          onClick={() => setPagina(pagina + 1)}
        >
          Próxima
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Cores e destaques da planilha são guardados apenas como metadados — nenhuma cor é
        transformada em situação financeira.
      </p>
    </div>
  );
}
