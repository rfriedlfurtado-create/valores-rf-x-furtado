/**
 * Importador da planilha Furtado Advogados.
 *
 * arquivo → leitura integral (todas as abas/células) → interpretação em
 * blocos → identificação dos clientes → REVISÃO (associações, conflitos,
 * pendências, totais) → gravação em etapas com progresso → lote.
 *
 * Nada é gravado sem a confirmação do usuário. Registros sem associação
 * segura ficam pendentes no lote, sempre consultáveis.
 */

import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { configuracoesQuery } from "@/lib/dados";
import { formatDateTime } from "@/lib/format";
import { analisarBinarioFurtado } from "@/lib/furtado/analise";
import type { AnaliseFurtado, EstrategiaAba } from "@/lib/furtado/modelo";
import {
  carregarBaseFurtado,
  gravarLoteFurtado,
  hashArquivo,
  lotesComMesmoArquivo,
  type LoteExistente,
  type Progresso,
} from "@/lib/furtado/persistencia";
import type { PlanilhaLida } from "@/lib/furtado/planilha";
import {
  planejarImportacaoFurtado,
  type DecisoesFurtado,
  type DecisaoPessoa,
} from "@/lib/furtado/planejador";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";

import {
  Contador,
  DistribuicaoDestinos,
  IconePendencia,
  rotuloPendencia,
  TabelaTotais,
  TabelaValoresPorCategoria,
} from "./PartesRevisao";
import { RevisaoPessoas } from "./RevisaoPessoas";

const ROTULO_ESTRATEGIA: Record<EstrategiaAba, string> = {
  rotulos_verticais: "Blocos com rótulos (ATRASADOS / CLIENTE / CONTRATUAIS...)",
  campos_em_celula: "Campos dentro da célula (DIB: / RMI: / HONORÁRIOS:...)",
  tabela_cabecalho: "Tabela com cabeçalho",
  linhas_registro: "Um registro por linha",
  somente_preservar: "Somente preservar (sem interpretação)",
};

type Fase = "inicio" | "lendo" | "revisao" | "gravando" | "erro";

export function ImportadorFurtado() {
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const sincronizar = useSincronizar();
  const limiares = useQuery(configuracoesQuery());

  const [fase, setFase] = useState<Fase>("inicio");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [leitura, setLeitura] = useState<{
    planilha: PlanilhaLida;
    analise: AnaliseFurtado;
  } | null>(null);
  const [estrategias, setEstrategias] = useState<Record<string, EstrategiaAba>>({});
  const [decisoes, setDecisoes] = useState<DecisoesFurtado>({ pessoas: {}, unioes: {} });
  const [duplicados, setDuplicados] = useState<LoteExistente[]>([]);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const base = useQuery({
    queryKey: ["base_furtado", arquivo?.name ?? null],
    queryFn: carregarBaseFurtado,
    enabled: fase === "revisao" || fase === "lendo",
    staleTime: 0,
  });

  const plano = useMemo(() => {
    if (!leitura || !base.data) return null;
    return planejarImportacaoFurtado({
      analise: leitura.analise,
      base: base.data,
      decisoes,
      arquivoNome: arquivo?.name ?? "arquivo",
      ...(limiares.data ? { limiares: limiares.data } : {}),
    });
  }, [leitura, base.data, decisoes, arquivo, limiares.data]);

  function reiniciar() {
    setFase("inicio");
    setArquivo(null);
    setBytes(null);
    setLeitura(null);
    setEstrategias({});
    setDecisoes({ pessoas: {}, unioes: {} });
    setDuplicados([]);
    setProgresso(null);
    setErro(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function analisar(dados: Uint8Array, est: Record<string, EstrategiaAba>) {
    setFase("lendo");
    await new Promise((r) => setTimeout(r, 30)); // deixa a tela mostrar o progresso
    try {
      setLeitura(analisarBinarioFurtado(dados, { estrategias: est }));
      setFase("revisao");
    } catch (e) {
      setErro(`Não foi possível ler o arquivo: ${(e as Error).message}`);
      setFase("erro");
    }
  }

  async function aoSelecionar(file: File | undefined) {
    if (!file) return;
    reiniciar();
    setArquivo(file);
    const dados = new Uint8Array(await file.arrayBuffer());
    setBytes(dados);
    hashArquivo(file)
      .then(lotesComMesmoArquivo)
      .then(setDuplicados)
      .catch(() => setDuplicados([]));
    await analisar(dados, {});
  }

  function decidir(ref: string, d: DecisaoPessoa | null) {
    setDecisoes((atual) => {
      const pessoas = { ...(atual.pessoas ?? {}) };
      if (d) pessoas[ref] = d;
      else delete pessoas[ref];
      return { ...atual, pessoas };
    });
  }

  function decidirVarios(lista: { ref: string; decisao: DecisaoPessoa }[]) {
    setDecisoes((atual) => {
      const pessoas = { ...(atual.pessoas ?? {}) };
      for (const x of lista) pessoas[x.ref] = x.decisao;
      return { ...atual, pessoas };
    });
  }

  function unir(de: string, para: string | null) {
    setDecisoes((atual) => {
      const unioes = { ...(atual.unioes ?? {}) };
      if (para) unioes[de] = para;
      else delete unioes[de];
      return { ...atual, unioes };
    });
  }

  const abasAConfirmar = leitura
    ? leitura.analise.abas.filter((a) => a.mapeamento.requerConfirmacao && !estrategias[a.aba])
    : [];
  const prontas = plano
    ? plano.pessoas.filter((p) => p.pronta && (p.acao === "criar" || p.acao === "vincular"))
    : [];
  const pendentes = plano ? plano.pessoas.filter((p) => !p.pronta) : [];

  async function gravar() {
    if (!arquivo || !leitura || !plano) return;
    setFase("gravando");
    setErro(null);
    try {
      const res = await gravarLoteFurtado({
        arquivo,
        planilha: leitura.planilha,
        analise: leitura.analise,
        plano,
        estrategias,
        onProgresso: setProgresso,
      });
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      toast.success("Importação gravada", {
        description: `${res.aplicadas} cliente(s) gravado(s); ${res.pendentes} item(ns) pendente(s) no lote.`,
        duration: 8000,
      });
      void navigate({ to: "/importacoes/$loteId", params: { loteId: res.loteId } });
    } catch (e) {
      setErro((e as Error).message);
      setFase("revisao");
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      toast.error(
        "A gravação foi interrompida. O lote ficou registrado e pode ser retomado no histórico de importações.",
      );
    }
  }

  return (
    <div className="grid gap-4">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        onChange={(e) => void aoSelecionar(e.target.files?.[0])}
      />

      {fase === "inicio" || fase === "erro" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            void aoSelecionar(e.dataTransfer.files?.[0]);
          }}
          className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
            arrastando ? "border-primary bg-primary/10" : "border-border bg-card"
          }`}
        >
          <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden />
          <p className="max-w-xl text-sm text-muted-foreground">
            Selecione a planilha de controle da <strong>Furtado Advogados</strong> no formato em que
            ela é usada no dia a dia — não é preciso reorganizar o arquivo. Todas as abas, linhas e
            colunas (inclusive ocultas) serão lidas e revisadas antes de qualquer gravação.
          </p>
          <Button onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" aria-hidden />
            Selecionar arquivo
          </Button>
          {erro ? <p className="text-sm text-red-700 dark:text-red-400">{erro}</p> : null}
        </div>
      ) : null}

      {fase === "lendo" || (fase === "revisao" && (!plano || base.isLoading)) ? (
        <Card className="flex flex-row items-center gap-3 p-4">
          <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
          <div>
            <p className="text-sm font-semibold">Analisando {arquivo?.name}</p>
            <p className="text-xs text-muted-foreground">
              Lendo todas as abas, identificando blocos e comparando com os cadastros existentes...
            </p>
          </div>
        </Card>
      ) : null}

      {base.isError ? (
        <Card className="border-red-300 p-4 text-sm text-red-700">
          Não foi possível carregar a base atual: {(base.error as Error).message}
        </Card>
      ) : null}

      {fase === "gravando" ? (
        <Card className="gap-3 p-5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {progresso?.etapa ?? "Preparando"}
          </p>
          <Progress
            value={progresso && progresso.total ? (progresso.atual / progresso.total) * 100 : 5}
          />
          <p className="text-xs text-muted-foreground">
            {progresso ? `${progresso.atual} de ${progresso.total}` : ""} — não feche esta página.
            Se a conexão cair, o lote poderá ser retomado sem duplicar dados.
          </p>
        </Card>
      ) : null}

      {fase === "revisao" && leitura && plano && !base.isLoading ? (
        <>
          <Card className="gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{arquivo?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {leitura.analise.abas.length} aba(s) · {leitura.analise.celulasTotal} células
                  preenchidas · {leitura.analise.blocos.length} blocos/registros · origem:{" "}
                  <strong>Furtado Advogados</strong>
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={reiniciar}>
                Escolher outro arquivo
              </Button>
            </div>

            {duplicados.length ? (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Este mesmo arquivo já foi importado (
                  {duplicados.map((d) => formatDateTime(d.created_at)).join(", ")}). Reimportar não
                  duplica clientes, processos, cobranças, parcelas nem recebimentos — os itens já
                  gravados aparecem como existentes.{" "}
                  <Link
                    to="/importacoes/$loteId"
                    params={{ loteId: duplicados[0]!.id }}
                    className="underline"
                  >
                    Abrir o lote anterior
                  </Link>
                </span>
              </div>
            ) : null}

            {erro ? (
              <div className="flex gap-2 rounded-lg border border-red-300 p-3 text-xs text-red-800 dark:border-red-900 dark:text-red-300">
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {erro}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Contador valor={plano.resumo.novos} rotulo="Clientes novos (prontos)" tom="info" />
              <Contador
                valor={plano.resumo.complementar}
                rotulo="Cadastros a complementar"
                tom="sucesso"
              />
              <Contador
                valor={plano.resumo.revisar}
                rotulo="Correspondências a revisar"
                tom={plano.resumo.revisar ? "alerta" : undefined}
              />
              <Contador valor={plano.resumo.atendimentos} rotulo="Processos e atendimentos" />
              <Contador valor={plano.resumo.beneficios} rotulo="Benefícios" />
              <Contador valor={plano.resumo.lancamentos} rotulo="Valores identificados" />
              <Contador valor={plano.resumo.requisicoes} rotulo="RPV / precatório / TED" />
              <Contador valor={plano.resumo.acordos} rotulo="Acordos" />
              <Contador
                valor={`${plano.resumo.cobrancas} / ${plano.resumo.parcelas}`}
                rotulo="Cobranças / parcelas"
              />
              <Contador
                valor={plano.resumo.pagamentosIdentificados}
                rotulo="Pagamentos mencionados"
                tom="alerta"
                dica="Exigem confirmação antes de virarem recebimento"
              />
              <Contador
                valor={plano.resumo.conflitos}
                rotulo="Conflitos"
                tom={plano.resumo.conflitos ? "alerta" : undefined}
              />
              <Contador
                valor={plano.resumo.informacoesAdicionais}
                rotulo="Informações adicionais"
              />
            </div>
            {plano.resumo.jaExistentes ? (
              <p className="text-xs text-muted-foreground">
                {plano.resumo.jaExistentes} item(ns) já existem na base (reimportação) e não serão
                duplicados.
              </p>
            ) : null}
          </Card>

          <Tabs defaultValue="pessoas">
            <TabsList className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value="pessoas">Clientes ({plano.pessoas.length})</TabsTrigger>
              <TabsTrigger value="pendencias">
                Pendências e conflitos ({plano.resumo.pendenciasAbertas})
              </TabsTrigger>
              <TabsTrigger value="abas">Abas ({leitura.analise.abas.length})</TabsTrigger>
              <TabsTrigger value="valores">Valores por categoria</TabsTrigger>
              <TabsTrigger value="totais">
                Totais gerais ({leitura.analise.totais.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pessoas" className="mt-3">
              <RevisaoPessoas
                plano={plano}
                clientes={base.data?.clientes ?? []}
                decisoes={decisoes}
                analise={leitura.analise}
                onDecidir={decidir}
                onDecidirVarios={decidirVarios}
                onUnir={unir}
              />
            </TabsContent>

            <TabsContent value="pendencias" className="mt-3">
              <ListaPendenciasPrevia plano={plano} />
            </TabsContent>

            <TabsContent value="abas" className="mt-3">
              <div className="grid gap-2">
                {leitura.analise.abas.map((a) => (
                  <Card key={a.aba} className="gap-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {a.aba}
                        {a.aba !== a.aba.trim() ? (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            (nome com espaço final, preservado)
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.celulasPreenchidas} células · {a.blocos} registros · {a.formulas}{" "}
                        fórmulas · {a.mescladas} mesclagens
                        {a.ocultas ? ` · ${a.ocultas} em linhas/colunas ocultas` : ""}
                      </p>
                    </div>
                    {a.mapeamento.conhecida ? (
                      <p className="text-xs text-muted-foreground">
                        Leitura: {ROTULO_ESTRATEGIA[a.mapeamento.estrategia]}
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950/40">
                        <AlertTriangle className="size-4 text-amber-700" aria-hidden />
                        Aba nova: confirme como ela deve ser lida (todo o conteúdo é preservado em
                        qualquer opção).
                        <Select
                          value={estrategias[a.aba] ?? ""}
                          onValueChange={(v) => {
                            const novo = { ...estrategias, [a.aba]: v as EstrategiaAba };
                            setEstrategias(novo);
                            if (bytes) void analisar(bytes, novo);
                          }}
                        >
                          <SelectTrigger className="h-8 w-80 bg-background">
                            <SelectValue
                              placeholder={`Sugestão: ${ROTULO_ESTRATEGIA[a.mapeamento.estrategia]}`}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(ROTULO_ESTRATEGIA) as EstrategiaAba[]).map((e) => (
                              <SelectItem key={e} value={e}>
                                {ROTULO_ESTRATEGIA[e]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <DistribuicaoDestinos porDestino={a.porDestino} />
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="valores" className="mt-3">
              <Card className="gap-3 p-4">
                <p className="text-xs text-muted-foreground">
                  Soma dos valores principais identificados (previstos e devidos), sem colunas
                  laterais e sem totais gerais da planilha. Valores iguais repetidos entre abas para
                  o mesmo processo são contados uma única vez. Não são recebimentos.
                </p>
                <TabelaValoresPorCategoria porCategoria={plano.resumo.porCategoria} />
              </Card>
            </TabsContent>

            <TabsContent value="totais" className="mt-3">
              <TabelaTotais totais={leitura.analise.totais} />
            </TabsContent>
          </Tabs>

          <Card className="sticky bottom-3 z-10 flex flex-col gap-3 border-primary/40 p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p>
                <CheckCircle2 className="mr-1 inline size-4 text-green-600" aria-hidden />
                <strong>{prontas.length}</strong> cliente(s) prontos para gravar
                {pendentes.length ? (
                  <>
                    {" "}
                    · <strong>{pendentes.length}</strong> ficarão <strong>pendentes no lote</strong>{" "}
                    (nada é descartado)
                  </>
                ) : null}
              </p>
              {abasAConfirmar.length ? (
                <p className="text-xs text-amber-700">
                  Confirme a leitura das abas novas: {abasAConfirmar.map((a) => a.aba).join(", ")}.
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={reiniciar}>
                Cancelar
              </Button>
              <Button
                onClick={() => void gravar()}
                disabled={abasAConfirmar.length > 0 || (!prontas.length && !pendentes.length)}
              >
                <CheckCircle2 className="size-4" aria-hidden />
                Confirmar e gravar
              </Button>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ListaPendenciasPrevia({
  plano,
}: {
  plano: NonNullable<ReturnType<typeof planejarImportacaoFurtado>>;
}) {
  const [tipo, setTipo] = useState<string>("todas");
  const tipos = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plano.pendencias) m.set(p.tipo, (m.get(p.tipo) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [plano]);
  const nomePorRef = useMemo(() => new Map(plano.pessoas.map((p) => [p.ref, p.nome])), [plano]);
  const lista = plano.pendencias.filter((p) => tipo === "todas" || p.tipo === tipo).slice(0, 400);
  return (
    <Card className="gap-3 p-4">
      <p className="text-xs text-muted-foreground">
        Pendências bloqueantes (<XCircle className="inline size-3 text-red-600" aria-hidden />)
        impedem só a gravação do cliente envolvido — resolva na aba Clientes. Avisos (
        <AlertTriangle className="inline size-3 text-amber-600" aria-hidden />) são gravados no lote
        para revisão posterior; nenhum valor é alterado automaticamente.
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={tipo === "todas" ? "secondary" : "ghost"}
          onClick={() => setTipo("todas")}
        >
          Todas ({plano.pendencias.length})
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
      <ul className="max-h-[32rem] divide-y divide-border overflow-auto rounded-lg border border-border text-sm">
        {lista.map((p, i) => (
          <li key={i} className="flex gap-2 px-3 py-2">
            <IconePendencia bloqueante={p.bloqueante} />
            <div className="min-w-0">
              <p className="text-xs font-semibold">
                {rotuloPendencia(p.tipo)}
                {p.pessoaRef ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    · {nomePorRef.get(p.pessoaRef) ?? ""}
                  </span>
                ) : null}
              </p>
              <p className="text-xs">{p.descricao}</p>
              {p.celulas.length ? (
                <p className="text-[11px] text-muted-foreground">
                  Células: {p.celulas.slice(0, 6).join(", ")}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
