import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeDollarSign,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileWarning,
  ListChecks,
  Loader2,
  Search,
  Tags,
  Upload,
  UserCheck,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
import {
  arquivoParaImportar,
  ehPlanilha,
  SobreposicaoSoltar,
  useSoltarArquivo,
} from "@/components/SoltarArquivo";
import { StatCard } from "@/components/StatCard";
import { PageHeader } from "@/components/layout/AppShell";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBRL, formatDate } from "@/lib/format";
import {
  carregarBaseIdentificacao,
  gravarRecebimentos,
  registrarResumoRecebimentos,
  ROTULO_RESULTADO,
  simularRecebimentos,
  type BaseIdentificacao,
  type LinhaResultado,
  type ResultadoRecebimento,
} from "@/lib/recebimentos/dados";
import {
  chaveClassificacao,
  chaveItem,
  identificarLinha,
  indexarClientes,
  montarItens,
  resumirPrevia,
  ROTULO_IDENTIFICACAO,
  sugerirClientes,
  type Identificacao,
  type ItemRecebimento,
} from "@/lib/recebimentos/identificacao";
import {
  ARQUIVO_MODELO_RECEBIMENTOS,
  ErroPlanilhaRecebimentos,
  lerPlanilhaRecebimentos,
  type PlanilhaRecebimentos,
} from "@/lib/recebimentos/modelo";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import { normalizarTexto } from "@/lib/situacao";
import { CLASSIFICACOES_ENTRADA, type ClassificacaoEntrada } from "@/lib/tipos";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/importar_/recebimentos")({
  head: () => ({
    meta: [
      { title: "Importar clientes com valores recebidos — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Identifica clientes já cadastrados pelo Reclamante e registra os valores recebidos no mesmo perfil.",
      },
    ],
  }),
  component: ImportarRecebimentos,
});

type Etapa = "arquivo" | "analisando" | "previa" | "gravando" | "concluido";

const TOM_RESULTADO: Record<ResultadoRecebimento, "sucesso" | "neutro" | "alerta" | "perigo"> = {
  inserido: "sucesso",
  ja_registrado: "neutro",
  possivel_duplicado: "alerta",
  cliente_indisponivel: "perigo",
  valor_invalido: "perigo",
  marcado_pago: "alerta",
  ja_pago: "neutro",
  processo_nao_definido: "alerta",
};

function ImportarRecebimentos() {
  const sincronizar = useSincronizar();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<Etapa>("arquivo");
  const [arquivo, setArquivo] = useState("");
  const [planilha, setPlanilha] = useState<PlanilhaRecebimentos | null>(null);
  const [base, setBase] = useState<BaseIdentificacao | null>(null);
  const [vinculos, setVinculos] = useState<Map<number, string>>(new Map());
  /** Processo escolhido na prévia (cliente com vários processos), por linha. */
  const [escolhidos, setEscolhidos] = useState<Map<number, string>>(new Map());
  const [classificacoes, setClassificacoes] = useState<Map<string, ClassificacaoEntrada | null>>(
    new Map(),
  );
  const [resultados, setResultados] = useState<LinhaResultado[]>([]);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<ReturnType<typeof resumirPrevia> | null>(null);

  const indice = useMemo(
    () => (base ? indexarClientes(base.clientes, base.variacoes) : null),
    [base],
  );
  const clientePorId = useMemo(() => new Map((base?.clientes ?? []).map((c) => [c.id, c])), [base]);

  const identificacoes = useMemo(() => {
    const m = new Map<number, Identificacao>();
    if (!planilha || !indice) return m;
    for (const l of planilha.linhas)
      m.set(l.linha, identificarLinha(l, indice, vinculos.get(l.linha)));
    return m;
  }, [planilha, indice, vinculos]);

  const itens: ItemRecebimento[] = useMemo(
    () =>
      planilha && base
        ? montarItens(
            planilha.linhas,
            identificacoes,
            base.processos,
            classificacoes,
            arquivo,
            escolhidos,
          )
        : [],
    [planilha, base, identificacoes, classificacoes, arquivo, escolhidos],
  );

  const resumo = useMemo(
    () =>
      planilha
        ? resumirPrevia({
            linhas: planilha.linhas,
            pendentes: planilha.pendentes.length,
            identificacoes,
            itens,
            resultados,
            statusCliente: (id) => clientePorId.get(id)?.status,
          })
        : null,
    [planilha, identificacoes, itens, resultados, clientePorId],
  );

  const simular = useCallback(
    async (
      p: PlanilhaRecebimentos,
      b: BaseIdentificacao,
      v: Map<number, string>,
      nome: string,
      esc: Map<number, string> = new Map(),
    ) => {
      setEtapa("analisando");
      setErro(null);
      try {
        const ind = indexarClientes(b.clientes, b.variacoes);
        const ids = new Map(
          p.linhas.map((l) => [l.linha, identificarLinha(l, ind, v.get(l.linha))]),
        );
        const its = montarItens(p.linhas, ids, b.processos, new Map(), nome, esc);
        setResultados(await simularRecebimentos(its, nome, p.aba));
        setEtapa("previa");
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        setEtapa("arquivo");
      }
    },
    [],
  );

  async function aoEscolherArquivo(file: File | undefined) {
    if (!file) return;
    if (!ehPlanilha(file)) {
      setErro(`"${file.name}" não é uma planilha Excel. Envie um arquivo .xlsx ou .xls.`);
      return;
    }
    setErro(null);
    setEtapa("analisando");
    try {
      const p = lerPlanilhaRecebimentos(new Uint8Array(await file.arrayBuffer()));
      const b = await carregarBaseIdentificacao();
      setArquivo(file.name);
      setPlanilha(p);
      setBase(b);
      setVinculos(new Map());
      setEscolhidos(new Map());
      setClassificacoes(new Map());
      await simular(p, b, new Map(), file.name);
    } catch (e) {
      setEtapa("arquivo");
      setErro(e instanceof ErroPlanilhaRecebimentos || e instanceof Error ? e.message : String(e));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const ocupado = etapa === "analisando" || etapa === "gravando";
  const arrastando = useSoltarArquivo((f) => void aoEscolherArquivo(f), !ocupado);

  // Arquivo escolhido no modal IMPORTAR CLIENTES.
  useEffect(() => {
    const pendente = arquivoParaImportar.retirar();
    if (pendente) void aoEscolherArquivo(pendente);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function vincular(linha: number, clienteId: string | null) {
    if (!planilha || !base) return;
    const novo = new Map(vinculos);
    if (clienteId) novo.set(linha, clienteId);
    else novo.delete(linha);
    setVinculos(novo);
    void simular(planilha, base, novo, arquivo, escolhidos);
  }

  function escolherProcesso(linha: number, atendimentoId: string) {
    if (!planilha || !base) return;
    const novo = new Map(escolhidos).set(linha, atendimentoId);
    setEscolhidos(novo);
    void simular(planilha, base, vinculos, arquivo, novo);
  }

  const processosPorCliente = useMemo(() => {
    const m = new Map<string, BaseIdentificacao["processos"]>();
    for (const p of base?.processos ?? []) m.set(p.cliente_id, [...(m.get(p.cliente_id) ?? []), p]);
    return m;
  }, [base]);
  const aEscolher = itens.filter(
    (i) => !i.atendimento_id && (processosPorCliente.get(i.cliente_id)?.length ?? 0) > 1,
  ).length;

  function reiniciar() {
    setEtapa("arquivo");
    setPlanilha(null);
    setResultados([]);
    setVinculos(new Map());
    setEscolhidos(new Map());
    setClassificacoes(new Map());
    setRelatorio(null);
    setErro(null);
  }

  const revisao = useMemo(
    () =>
      (planilha?.linhas ?? [])
        .map((l) => ({ l, ident: identificacoes.get(l.linha)! }))
        .filter((x) => x.ident && x.ident.status !== "encontrado"),
    [planilha, identificacoes],
  );

  async function confirmar() {
    if (!planilha || !resumo) return;
    setEtapa("gravando");
    setProgresso(0);
    try {
      const { importacaoId, linhas } = await gravarRecebimentos(
        itens,
        arquivo,
        planilha.aba,
        (feitos, total) => setProgresso(Math.round((feitos / total) * 100)),
      );
      const final = resumirPrevia({
        linhas: planilha.linhas,
        pendentes: planilha.pendentes.length,
        identificacoes,
        itens,
        resultados: linhas,
        statusCliente: (id) => clientePorId.get(id)?.status,
      });
      if (importacaoId)
        await registrarResumoRecebimentos(
          importacaoId,
          final,
          revisao.map(({ l, ident }) => ({
            linha: l.linha,
            reclamante: l.reclamante,
            motivo: ROTULO_IDENTIFICACAO[ident.status],
          })),
        );
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      toast.success(
        `Importação concluída: ${final.valoresNovos} valor(es) registrado(s)` +
          (final.clientesMovidos
            ? `, ${final.clientesMovidos} processo(s) movido(s) para JÁ PAGOS.`
            : "."),
      );
      if (revisao.length === 0 && planilha.pendentes.length === 0) {
        // Sucesso sem pendências: fecha a importação e mostra JÁ PAGOS.
        void navigate({ to: "/ja-pagos" });
        return;
      }
      setRelatorio(final);
      setEtapa("concluido");
    } catch (e) {
      setErro(
        `${e instanceof Error ? e.message : String(e)} — As partes já gravadas permanecem; importar o mesmo arquivo novamente não duplica valores.`,
      );
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      setEtapa("previa");
    }
  }

  const resultadoPorItem = useMemo(
    () => new Map(resultados.map((r) => [chaveItem(r), r])),
    [resultados],
  );

  return (
    <div>
      <SobreposicaoSoltar visivel={arrastando} />
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/clientes">
          <ArrowLeft className="size-4" aria-hidden />
          Clientes
        </Link>
      </Button>
      <PageHeader
        titulo="Clientes com valores recebidos"
        descricao="Identifica o cliente já cadastrado pelo Reclamante (ou CPF) e registra os valores recebidos no mesmo perfil, que passa para JÁ PAGOS."
      >
        <Button asChild variant="outline">
          <a href={ARQUIVO_MODELO_RECEBIMENTOS} download>
            <Download className="size-4" aria-hidden />
            Baixar modelo vazio
          </a>
        </Button>
      </PageHeader>

      {erro ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{erro}</p>
        </div>
      ) : null}

      {etapa === "arquivo" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <Card className="border-success/40 p-6">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                arrastando ? "border-success bg-success/10" : "border-success/50 bg-success-soft",
              )}
            >
              <BadgeDollarSign className="size-10 text-success" aria-hidden />
              <span className="text-base font-semibold">
                Arraste e solte a planilha de valores recebidos aqui
              </span>
              <span className="text-sm text-muted-foreground">
                ou clique para escolher · .xlsx ou .xls
              </span>
              <span className="mt-2 inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white">
                <Upload className="size-4" aria-hidden />
                Selecionar arquivo
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => void aoEscolherArquivo(e.target.files?.[0])}
            />
          </Card>
          <Card className="gap-3 p-5 text-sm">
            <p className="font-semibold">Como funciona</p>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>
                <strong className="text-foreground">Obrigatória:</strong> somente a coluna
                Reclamante.
              </li>
              <li>
                <strong className="text-foreground">Opcionais:</strong> Valor (ou colunas
                “Contratual”, “Atrasados”, “Sucumbência”), CPF, Categoria, Data, Número do processo,
                Pasta, Observação.
              </li>
              <li>
                Linha sem valor: o cliente vai para JÁ PAGOS e os valores recebidos podem ser
                lançados depois, manualmente, no perfil do cliente.
              </li>
              <li>
                O cliente é localizado na base pelo CPF ou pelo nome idêntico. Nenhum cliente novo é
                criado; quem não for encontrado fica para revisão.
              </li>
              <li>
                Cada valor vira um recebimento próprio — várias linhas do mesmo cliente = um perfil.
              </li>
              <li>Reimportar o mesmo arquivo não duplica valores.</li>
              <li>
                O pagamento é marcado por PROCESSO: o processo da linha (pela Pasta ou Número, ou o
                único processo do cliente) passa para JÁ PAGOS; os demais processos do mesmo cliente
                continuam em CLIENTES. Cliente com vários processos: escolha o processo na prévia.
              </li>
            </ul>
          </Card>
        </div>
      ) : null}

      {etapa === "analisando" ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">Analisando {arquivo || "arquivo"}…</p>
          <p className="text-xs text-muted-foreground">
            Localizando os clientes na base. Nada é gravado nesta etapa.
          </p>
        </Card>
      ) : null}

      {etapa === "gravando" ? (
        <Card className="flex flex-col items-center gap-4 p-12 text-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">Registrando valores recebidos…</p>
          <Progress value={progresso} className="w-full max-w-md" />
          <p className="text-xs text-muted-foreground tabular">{progresso}%</p>
        </Card>
      ) : null}

      {etapa === "previa" && planilha && resumo && base ? (
        <div className="space-y-6">
          <Card className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">{arquivo}</p>
              <p className="text-xs text-muted-foreground">
                Aba “{planilha.aba}” · colunas reconhecidas:{" "}
                {[...planilha.colunas.entries()].map(([i]) => planilha.cabecalhos[i]).join(", ")}
                {planilha.extras.size
                  ? ` · outras colunas guardadas no conteúdo original: ${[...planilha.extras.values()].join(", ")}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reiniciar}>
                Escolher outro arquivo
              </Button>
              <Button
                className="bg-success text-white hover:bg-success/90"
                onClick={() => void confirmar()}
                disabled={resumo.valoresNovos === 0 && resumo.clientesMovidos === 0}
              >
                <CheckCircle2 className="size-4" aria-hidden />
                Confirmar importação
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard titulo="Valores na planilha" valor={resumo.valores} icone={ListChecks} />
            <StatCard
              titulo="Clientes identificados"
              valor={resumo.clientesIdentificados}
              icone={UserCheck}
              tom="info"
              descricao={`${resumo.clientesMovidos} processo(s) vão para JÁ PAGOS${
                aEscolher ? ` · ${aEscolher} linha(s): escolha o processo` : ""
              }`}
            />
            <StatCard
              titulo="Valores novos"
              valor={resumo.valoresNovos}
              icone={Wallet}
              tom="money"
              descricao={`Total ${formatBRL(resumo.totalNovo)}`}
            />
            <StatCard
              titulo="Já registrados"
              valor={resumo.valoresJaRegistrados}
              icone={Copy}
              descricao={
                resumo.possiveisDuplicados
                  ? `${resumo.possiveisDuplicados} igual(is) a lançamento manual — não serão gravados`
                  : "Não serão duplicados"
              }
            />
            <StatCard
              titulo="Sem valor informado"
              valor={resumo.clientesSemValor}
              icone={Wallet}
              tom={resumo.clientesSemValor ? "warning" : "neutro"}
              descricao="Vão para JÁ PAGOS — lance os valores depois, no perfil"
            />
            <StatCard
              titulo="Para revisão"
              valor={resumo.revisao}
              icone={AlertTriangle}
              tom={resumo.revisao ? "warning" : "neutro"}
              descricao="Cliente não encontrado ou ambíguo"
            />
            <StatCard
              titulo="Sem categoria"
              valor={resumo.semCategoria}
              icone={Tags}
              tom={resumo.semCategoria ? "warning" : "neutro"}
              descricao="Escolha abaixo ou depois, no perfil"
            />
            <StatCard
              titulo="Linhas ignoradas"
              valor={resumo.pendentes}
              icone={FileWarning}
              tom={resumo.pendentes ? "danger" : "neutro"}
              descricao="Sem Reclamante"
            />
          </div>

          <Tabs defaultValue={revisao.length ? "revisao" : "valores"}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="valores">Clientes e valores ({itens.length})</TabsTrigger>
              <TabsTrigger value="revisao">Revisão ({revisao.length})</TabsTrigger>
              <TabsTrigger value="ignoradas">Ignoradas ({planilha.pendentes.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="valores">
              <TabelaValores
                itens={itens}
                resultadoPorItem={resultadoPorItem}
                nomeCliente={(id) => clientePorId.get(id)?.nome ?? id}
                processosDoCliente={(id) => processosPorCliente.get(id) ?? []}
                escolherProcesso={escolherProcesso}
                reclamante={(linha) =>
                  planilha.linhas.find((l) => l.linha === linha)?.reclamante ?? ""
                }
                classificar={(linha, indice, c) =>
                  setClassificacoes((m) => new Map(m).set(chaveClassificacao(linha, indice), c))
                }
              />
            </TabsContent>

            <TabsContent value="revisao">
              {revisao.length === 0 ? (
                <Card className="p-6 text-sm text-muted-foreground">
                  Todos os Reclamantes foram identificados na base.
                </Card>
              ) : (
                <Card className="gap-0 p-0">
                  <p className="border-b border-border px-5 py-3 text-xs text-muted-foreground">
                    Nada é gravado para estas linhas até o cliente ser vinculado. Nenhum cliente é
                    criado automaticamente e nenhum vínculo é feito por semelhança de nome.
                  </p>
                  <ul className="divide-y divide-border">
                    {revisao.map(({ l, ident }) => (
                      <LinhaRevisao
                        key={l.linha}
                        linha={l.linha}
                        reclamante={l.reclamante}
                        cpf={l.cpf}
                        valores={
                          l.entradas.length
                            ? l.entradas.map((e) => formatBRL(e.valor)).join(" + ")
                            : "Sem valor informado"
                        }
                        ident={ident}
                        candidatos={[
                          ...new Set([
                            ...ident.candidatos,
                            ...(indice ? sugerirClientes(l.reclamante, indice) : []),
                          ]),
                        ]}
                        clientes={base.clientes}
                        vincular={(id) => vincular(l.linha, id)}
                      />
                    ))}
                  </ul>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="ignoradas">
              {planilha.pendentes.length === 0 ? (
                <Card className="p-6 text-sm text-muted-foreground">Nenhuma linha ignorada.</Card>
              ) : (
                <Card className="gap-0 overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Linha</TableHead>
                        <TableHead>Conteúdo</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {planilha.pendentes.map((p) => (
                        <TableRow key={p.linha}>
                          <TableCell className="tabular">{p.linha}</TableCell>
                          <TableCell className="text-sm">{p.resumo}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {p.motivo}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      ) : null}

      {etapa === "concluido" && relatorio ? (
        <Card className="gap-4 p-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-6 text-success" aria-hidden />
            <div>
              <p className="text-base font-semibold">Importação concluída</p>
              <p className="text-sm text-muted-foreground">
                {relatorio.valoresNovos} valor(es) registrado(s) · total{" "}
                {formatBRL(relatorio.totalNovo)} · {relatorio.clientesMovidos} processo(s) movido(s)
                para JÁ PAGOS · {relatorio.valoresJaRegistrados} já registrado(s)
                {relatorio.clientesSemValor
                  ? ` · ${relatorio.clientesSemValor} linha(s) sem valor — lance os valores no perfil do cliente`
                  : ""}
                .
              </p>
            </div>
          </div>
          {revisao.length ? (
            <div className="rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm">
              <p className="font-semibold text-warning">
                {revisao.length} linha(s) ficaram para revisão (nada foi gravado para elas):
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {revisao.map(({ l, ident }) => (
                  <li key={l.linha}>
                    Linha {l.linha} — {l.reclamante}: {ROTULO_IDENTIFICACAO[ident.status]}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Cadastre o cliente pela importação de clientes (ou vincule-o na prévia) e importe o
                arquivo novamente — os valores já gravados não serão duplicados.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/ja-pagos">Ir para JÁ PAGOS</Link>
            </Button>
            <Button variant="outline" onClick={reiniciar}>
              Importar outro arquivo
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function TabelaValores({
  itens,
  resultadoPorItem,
  nomeCliente,
  processosDoCliente,
  escolherProcesso,
  reclamante,
  classificar,
}: {
  itens: ItemRecebimento[];
  resultadoPorItem: Map<string, LinhaResultado>;
  nomeCliente: (id: string) => string;
  processosDoCliente: (id: string) => BaseIdentificacao["processos"];
  escolherProcesso: (linha: number, atendimentoId: string) => void;
  reclamante: (linha: number) => string;
  classificar: (linha: number, indice: number, c: ClassificacaoEntrada | null) => void;
}) {
  if (itens.length === 0)
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Nenhuma linha com cliente identificado.
      </Card>
    );
  return (
    <Card className="gap-0 overflow-x-auto p-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Linha</TableHead>
            <TableHead>Reclamante → cliente</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Data</TableHead>
            <TableHead className="min-w-44">Categoria</TableHead>
            <TableHead>Processo</TableHead>
            <TableHead>Resultado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((i) => {
            const r = resultadoPorItem.get(chaveItem(i));
            const mesmoNome =
              normalizarTexto(reclamante(i.linha)) === normalizarTexto(nomeCliente(i.cliente_id));
            return (
              <TableRow key={`${i.linha}-${i.indice}`}>
                <TableCell className="tabular">{i.linha}</TableCell>
                <TableCell className="text-sm">
                  <span className="font-medium">{reclamante(i.linha)}</span>
                  {!mesmoNome ? (
                    <span className="block text-xs text-muted-foreground">
                      → {nomeCliente(i.cliente_id)}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular font-semibold">
                  {i.sem_valor ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      Sem valor (lançar no perfil)
                    </span>
                  ) : (
                    formatBRL(i.valor ?? 0)
                  )}
                </TableCell>
                <TableCell className="tabular text-sm">
                  {i.data ? formatDate(i.data) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {i.sem_valor ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Select
                      value={i.classificacao ?? "nenhuma"}
                      onValueChange={(v) =>
                        classificar(
                          i.linha,
                          i.indice,
                          v === "nenhuma" ? null : (v as ClassificacaoEntrada),
                        )
                      }
                    >
                      <SelectTrigger
                        className="h-8"
                        aria-label={`Categoria do valor da linha ${i.linha}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhuma">Sem categoria</SelectItem>
                        {CLASSIFICACOES_ENTRADA.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label.toUpperCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <CelulaProcesso
                    item={i}
                    processos={processosDoCliente(i.cliente_id)}
                    escolher={(id) => escolherProcesso(i.linha, id)}
                  />
                </TableCell>
                <TableCell>
                  {r ? (
                    <BadgeStatus
                      texto={
                        ROTULO_RESULTADO[r.resultado] + (r.movido ? " · vai para JÁ PAGOS" : "")
                      }
                      tom={TOM_RESULTADO[r.resultado]}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Processo que recebe a linha (o pagamento é marcado por processo). */
function CelulaProcesso({
  item,
  processos,
  escolher,
}: {
  item: ItemRecebimento;
  processos: BaseIdentificacao["processos"];
  escolher: (atendimentoId: string) => void;
}) {
  const rotulo = (p: BaseIdentificacao["processos"][number]) =>
    `${p.numero || "Sem número"}${p.tipo_acao ? ` · ${p.tipo_acao}` : ""}`;
  if (processos.length === 0)
    return <span className="text-muted-foreground">Cliente sem processo</span>;
  const atual = processos.find((p) => p.id === item.atendimento_id);
  if (processos.length === 1 && atual)
    return (
      <span className="tabular">
        {rotulo(atual)}
        {atual.pago ? <span className="block text-muted-foreground">Já em JÁ PAGOS</span> : null}
      </span>
    );
  return (
    <Select value={item.atendimento_id ?? ""} onValueChange={escolher}>
      <SelectTrigger
        className={cn("h-8 min-w-48", !item.atendimento_id && "border-warning text-warning")}
        aria-label={`Processo da linha ${item.linha}`}
      >
        <SelectValue placeholder="Escolha o processo…" />
      </SelectTrigger>
      <SelectContent>
        {processos.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {rotulo(p)}
            {p.pago ? " (já pago)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LinhaRevisao({
  linha,
  reclamante,
  cpf,
  valores,
  ident,
  candidatos,
  clientes,
  vincular,
}: {
  linha: number;
  reclamante: string;
  cpf: string | null;
  valores: string;
  ident: Identificacao;
  candidatos: string[];
  clientes: BaseIdentificacao["clientes"];
  vincular: (clienteId: string | null) => void;
}) {
  const [busca, setBusca] = useState("");
  const porId = new Map(clientes.map((c) => [c.id, c]));
  const termo = normalizarTexto(busca);
  const encontrados =
    termo.length >= 3
      ? clientes
          .filter(
            (c) =>
              normalizarTexto(c.nome).includes(termo) ||
              (busca.replace(/\D/g, "").length >= 3 &&
                (c.cpf ?? "").replace(/\D/g, "").includes(busca.replace(/\D/g, ""))),
          )
          .slice(0, 8)
      : candidatos.map((id) => porId.get(id)).filter((c) => c !== undefined);

  return (
    <li className="flex flex-col gap-3 px-5 py-4 text-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">
          Linha {linha} — {reclamante}
          {cpf ? <span className="font-normal text-muted-foreground"> · CPF {cpf}</span> : null}
        </p>
        <p className="tabular">{valores}</p>
        <p className="text-warning">
          {ROTULO_IDENTIFICACAO[ident.status]}: {ident.motivo}
        </p>
      </div>
      <div className="w-full space-y-2 lg:w-96">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente cadastrado (nome ou CPF)…"
            className="h-9 pl-8"
            aria-label={`Buscar cliente para a linha ${linha}`}
          />
          {busca ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              onClick={() => setBusca("")}
              aria-label="Limpar busca"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {encontrados.length ? (
          <ul className="space-y-1">
            {encontrados.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5"
              >
                <span className="min-w-0 truncate">
                  {c.nome}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · {c.cpf || "sem CPF"}
                    {c.status === "pago" ? " · Já pago" : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0"
                  onClick={() => vincular(c.id)}
                >
                  Vincular
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Digite ao menos 3 letras para procurar o cliente. Confirme o vínculo só se tiver
            certeza.
          </p>
        )}
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <FileSpreadsheet className="size-3.5" aria-hidden />
          Sugestões apenas — nada é vinculado sem o seu clique.
        </p>
      </div>
    </li>
  );
}
