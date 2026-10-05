import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileWarning,
  FolderPlus,
  Layers,
  ListChecks,
  Loader2,
  RefreshCw,
  Upload,
  UserCheck,
  UserPlus,
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
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CAMPO_POR_CHAVE, CAMPOS_OFICIAIS, type ChaveCampo } from "@/lib/rf/campos";
import {
  gravarImportacao,
  registrarResumo,
  resumir,
  simularImportacao,
  type ResultadoLinha,
  type ResumoImportacao,
} from "@/lib/rf/dados";
import {
  ARQUIVO_MODELO,
  ErroPlanilha,
  interpretarLinhas,
  lerPlanilha,
  type MapeamentoExtras,
  type PlanilhaLida,
  type ResultadoInterpretacao,
} from "@/lib/rf/planilha";
import { formatarValor } from "@/lib/rf/valores";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/importar")({
  head: () => ({
    meta: [
      { title: "Importar clientes — Base de Pagamentos" },
      {
        name: "description",
        content: "Importação de clientes no modelo oficial CLIENTES RF - ESPAIDER.",
      },
    ],
  }),
  component: ImportarClientes,
});

type Etapa = "arquivo" | "analisando" | "previa" | "gravando" | "concluido";

const ROTULO_CLIENTE: Record<
  ResultadoLinha["cliente"],
  { texto: string; tom: "neutro" | "sucesso" | "alerta" | "perigo" }
> = {
  novo: { texto: "Cliente novo", tom: "sucesso" },
  mesmo_arquivo: { texto: "Mesmo cliente de outra linha", tom: "neutro" },
  existente: { texto: "Cliente existente", tom: "alerta" },
  ja_importado: { texto: "Linha já importada", tom: "neutro" },
  repetida: { texto: "Linha repetida", tom: "perigo" },
};

const ROTULO_REGISTRO: Record<ResultadoLinha["registro"], string> = {
  novo: "Processo/atendimento novo",
  agrupado: "Reunido ao mesmo processo e tipo de ação",
  ja_importado: "Já importado (só complementa)",
  repetida: "Ignorada",
  sem_registro: "Sem dados de processo",
};

function rotuloCampo(campo: string): string {
  if (campo.startsWith("adicional:")) return `Informação adicional: ${campo.slice(10)}`;
  return CAMPO_POR_CHAVE.get(campo as ChaveCampo)?.rotulo ?? campo;
}

function ImportarClientes() {
  const sincronizar = useSincronizar();
  const inputRef = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<Etapa>("arquivo");
  const [arquivo, setArquivo] = useState<string>("");
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null);
  const [extras, setExtras] = useState<MapeamentoExtras>(new Map());
  const [nomesDigitados, setNomesDigitados] = useState<Map<number, string>>(new Map());
  const [nomesAplicados, setNomesAplicados] = useState<Map<number, string>>(new Map());
  const [interpretacao, setInterpretacao] = useState<ResultadoInterpretacao | null>(null);
  const [previa, setPrevia] = useState<ResultadoLinha[]>([]);
  const [substituir, setSubstituir] = useState<Set<string>>(new Set());
  const [progresso, setProgresso] = useState(0);
  const [relatorio, setRelatorio] = useState<{
    resumo: ResumoImportacao;
    linhas: ResultadoLinha[];
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const analisar = useCallback(
    async (
      p: PlanilhaLida,
      nomeArquivo: string,
      mapExtras: MapeamentoExtras,
      nomes: Map<number, string>,
    ) => {
      setEtapa("analisando");
      setErro(null);
      try {
        const interp = interpretarLinhas(p, { extras: mapExtras, nomesCorrigidos: nomes });
        const resultado = await simularImportacao(interp.validas, nomeArquivo, p.aba);
        setInterpretacao(interp);
        setPrevia(resultado);
        setSubstituir(new Set());
        setEtapa("previa");
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
        setInterpretacao(null);
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
    try {
      const p = lerPlanilha(new Uint8Array(await file.arrayBuffer()));
      setArquivo(file.name);
      setPlanilha(p);
      const mapa: MapeamentoExtras = new Map([...p.mapeamento.extras.keys()].map((k) => [k, null]));
      setExtras(mapa);
      setNomesDigitados(new Map());
      setNomesAplicados(new Map());
      await analisar(p, file.name, mapa, new Map());
    } catch (e) {
      setEtapa("arquivo");
      setErro(e instanceof ErroPlanilha || e instanceof Error ? e.message : String(e));
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  // Arrastar e soltar em qualquer ponto da página (exceto durante a análise/gravação).
  const ocupado = etapa === "analisando" || etapa === "gravando";
  const arrastando = useSoltarArquivo((f) => void aoEscolherArquivo(f), !ocupado);

  // Arquivo solto na página CLIENTES: abre direto aqui.
  useEffect(() => {
    const pendente = arquivoParaImportar.retirar();
    if (pendente) void aoEscolherArquivo(pendente);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumo = useMemo(
    () =>
      planilha && interpretacao
        ? resumir(previa, {
            totalLinhas: planilha.linhas.length,
            linhasVazias: planilha.vazias,
            avisos: interpretacao.avisos.length,
            pendentes: interpretacao.pendentes.length,
          })
        : null,
    [planilha, interpretacao, previa],
  );

  const conflitos = useMemo(
    () => previa.flatMap((l) => l.conflitos.map((c) => ({ ...c, linha: l.linha, nome: l.nome }))),
    [previa],
  );
  const duplicidades = useMemo(() => previa.filter((l) => l.duplicidades.length > 0), [previa]);

  async function confirmar() {
    if (!planilha || !interpretacao) return;
    setEtapa("gravando");
    setProgresso(0);
    try {
      const { importacaoId, linhas } = await gravarImportacao(
        interpretacao.validas,
        arquivo,
        planilha.aba,
        [...substituir],
        (feitas, total) => setProgresso(Math.round((feitas / total) * 100)),
      );
      const final = resumir(linhas, {
        totalLinhas: planilha.linhas.length,
        linhasVazias: planilha.vazias,
        avisos: interpretacao.avisos.length,
        pendentes: interpretacao.pendentes.length,
      });
      if (importacaoId) await registrarResumo(importacaoId, final);
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      setRelatorio({ resumo: final, linhas });
      setEtapa("concluido");
      toast.success("Importação concluída.");
    } catch (e) {
      setErro(
        `${e instanceof Error ? e.message : String(e)} — As partes já gravadas permanecem; importar o mesmo arquivo novamente não duplica registros.`,
      );
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      setEtapa("previa");
    }
  }

  function reiniciar() {
    setEtapa("arquivo");
    setPlanilha(null);
    setInterpretacao(null);
    setPrevia([]);
    setRelatorio(null);
    setErro(null);
  }

  const camposDisponiveisParaExtras = useMemo(() => {
    if (!planilha) return [];
    return CAMPOS_OFICIAIS.filter((c) => planilha.mapeamento.ausentes.includes(c.chave));
  }, [planilha]);

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
        titulo="Importar clientes"
        descricao="Modelo oficial: planilha “CLIENTES RF - ESPAIDER” (22 colunas). Somente “Reclamante” é obrigatório."
      >
        <Button asChild variant="outline">
          <a href={ARQUIVO_MODELO} download>
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
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card className="p-6">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                arrastando ? "border-primary bg-primary/5" : "border-border bg-muted/30",
              )}
            >
              <FileSpreadsheet className="size-10 text-muted-foreground" aria-hidden />
              <span className="text-base font-semibold">Arraste e solte a planilha Excel aqui</span>
              <span className="text-sm text-muted-foreground">
                ou clique para escolher · .xlsx ou .xls · a primeira linha deve conter os cabeçalhos
              </span>
              <span className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                <Upload className="size-4" aria-hidden />
                Escolher arquivo
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
                <strong className="text-foreground">Obrigatório:</strong> somente a coluna
                Reclamante (nome do cliente).
              </li>
              <li>
                <strong className="text-foreground">Opcionais:</strong> todas as demais colunas —
                CPF, número, cidade, telefones, e-mail, datas, valor estimado, pasta etc. Podem
                estar vazias ou ausentes.
              </li>
              <li>
                Antes de gravar, você vê uma prévia com novos, existentes, duplicidades e avisos.
              </li>
              <li>
                Reimportar o mesmo arquivo não duplica: linhas já importadas só complementam campos
                vazios.
              </li>
              <li>
                Mesmo CPF = mesmo cliente (uma única pasta). Cada processo diferente fica como um
                processo dentro da mesma pasta.
              </li>
              <li>
                Nenhum valor da planilha é registrado como pagamento — o “Valor Estimado do
                Processo” é só uma estimativa.
              </li>
            </ul>
          </Card>
        </div>
      ) : null}

      {etapa === "analisando" ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">Analisando {arquivo}…</p>
          <p className="text-xs text-muted-foreground">
            Comparando com os clientes cadastrados. Nada é gravado nesta etapa.
          </p>
        </Card>
      ) : null}

      {etapa === "gravando" ? (
        <Card className="flex flex-col items-center gap-4 p-12 text-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">Gravando importação…</p>
          <Progress value={progresso} className="w-full max-w-md" />
          <p className="text-xs text-muted-foreground tabular">{progresso}%</p>
        </Card>
      ) : null}

      {etapa === "previa" && planilha && interpretacao && resumo ? (
        <div className="space-y-6">
          <Card className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">{arquivo}</p>
              <p className="text-xs text-muted-foreground">
                Aba “{planilha.aba}” ·{" "}
                {
                  [...planilha.mapeamento.campos.values()].filter(
                    (c) => !CAMPO_POR_CHAVE.get(c)!.legado,
                  ).length
                }{" "}
                de {CAMPOS_OFICIAIS.length} coluna(s) do modelo oficial reconhecida(s)
                {planilha.vazias
                  ? ` · ${planilha.vazias} linha(s) totalmente vazia(s) ignorada(s)`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reiniciar}>
                Escolher outro arquivo
              </Button>
              <Button
                onClick={() => void confirmar()}
                disabled={interpretacao.validas.length === 0}
              >
                <CheckCircle2 className="size-4" aria-hidden />
                Confirmar importação
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard titulo="Linhas de dados" valor={resumo.totalLinhas} icone={ListChecks} />
            <StatCard
              titulo="Clientes novos"
              valor={resumo.clientesNovos}
              icone={UserPlus}
              tom="money"
            />
            <StatCard
              titulo="Clientes existentes identificados"
              valor={resumo.clientesExistentes}
              icone={UserCheck}
              tom="info"
              descricao="Identificados pelo CPF válido"
            />
            <StatCard
              titulo="Processos ou atendimentos novos"
              valor={resumo.registrosNovos}
              icone={FolderPlus}
              tom="money"
              descricao={
                resumo.registrosAgrupados
                  ? `${resumo.registrosAgrupados} linha(s) reunida(s) a um mesmo processo`
                  : undefined
              }
            />
            <StatCard
              titulo="Possíveis duplicidades"
              valor={resumo.duplicidades}
              icone={Copy}
              tom="warning"
              descricao="Nome igual sem CPF que confirme — revisar"
            />
            <StatCard
              titulo="Avisos em campos opcionais"
              valor={resumo.avisos}
              icone={FileWarning}
              tom="warning"
              descricao="Não impedem a importação"
            />
            <StatCard
              titulo="Linhas sem nome do reclamante"
              valor={resumo.pendentes}
              icone={AlertTriangle}
              tom={resumo.pendentes ? "danger" : "neutro"}
              descricao="Ficam pendentes"
            />
            <StatCard
              titulo="Já importadas / conflitos"
              valor={`${resumo.linhasJaImportadas} / ${resumo.conflitos}`}
              icone={Layers}
              descricao={`${resumo.complementos} campo(s) vazio(s) serão complementados`}
            />
          </div>

          {/* Colunas */}
          <Card className="gap-3 p-5">
            <p className="text-sm font-semibold">Colunas do arquivo</p>
            <div className="flex flex-wrap gap-1.5">
              {[...planilha.mapeamento.campos.entries()].map(([indice, chave]) => (
                <span
                  key={indice}
                  className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success"
                >
                  {planilha.mapeamento.cabecalhos[indice]?.trim()} →{" "}
                  {CAMPO_POR_CHAVE.get(chave)!.rotulo}
                </span>
              ))}
            </div>
            {planilha.mapeamento.ausentes.length ? (
              <p className="text-xs text-muted-foreground">
                Colunas opcionais ausentes (ficarão como “Não informado”):{" "}
                {planilha.mapeamento.ausentes.map((c) => CAMPO_POR_CHAVE.get(c)!.rotulo).join(", ")}
                .
              </p>
            ) : null}
            {planilha.mapeamento.extras.size ? (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs font-semibold">
                  Colunas adicionais — guardadas em “Informações adicionais”, ou mapeie para um
                  campo do modelo:
                </p>
                {[...planilha.mapeamento.extras.entries()].map(([indice, cabecalho]) => (
                  <div key={indice} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="min-w-48 text-sm font-medium">
                      {cabecalho || `Coluna ${indice + 1}`}
                    </span>
                    <Select
                      value={extras.get(indice) ?? "adicional"}
                      onValueChange={(v) => {
                        const novo = new Map(extras);
                        novo.set(indice, v === "adicional" ? null : (v as ChaveCampo));
                        setExtras(novo);
                      }}
                    >
                      <SelectTrigger className="h-9 sm:w-80">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="adicional">Informações adicionais</SelectItem>
                        {camposDisponiveisParaExtras.map((c) => (
                          <SelectItem key={c.chave} value={c.chave}>
                            {c.rotulo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void analisar(planilha, arquivo, extras, nomesAplicados)}
                >
                  <RefreshCw className="size-4" aria-hidden />
                  Atualizar prévia
                </Button>
              </div>
            ) : null}
          </Card>

          {interpretacao.pendentes.length ? (
            <Card className="gap-3 p-5">
              <div>
                <p className="text-sm font-semibold">Linhas pendentes (sem Reclamante)</p>
                <p className="text-xs text-muted-foreground">
                  Não serão importadas. Digite o nome para incluí-las, ou confirme para importar as
                  demais linhas válidas.
                </p>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-20">Linha</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Conteúdo</TableHead>
                      <TableHead className="min-w-64">Nome do reclamante</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {interpretacao.pendentes.map((p) => (
                      <TableRow key={p.linha}>
                        <TableCell className="tabular font-semibold">{p.linha}</TableCell>
                        <TableCell className="text-sm">{p.motivo}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.resumo}</TableCell>
                        <TableCell>
                          <Input
                            value={nomesDigitados.get(p.linha) ?? ""}
                            placeholder="Digite o nome"
                            aria-label={`Nome do reclamante da linha ${p.linha}`}
                            onChange={(e) => {
                              const novo = new Map(nomesDigitados);
                              novo.set(p.linha, e.target.value);
                              setNomesDigitados(novo);
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={![...nomesDigitados.values()].some((n) => n.trim())}
                  onClick={() => {
                    const aplicados = new Map(nomesAplicados);
                    for (const [l, n] of nomesDigitados) if (n.trim()) aplicados.set(l, n.trim());
                    setNomesAplicados(aplicados);
                    void analisar(planilha, arquivo, extras, aplicados);
                  }}
                >
                  <RefreshCw className="size-4" aria-hidden />
                  Aplicar nomes e atualizar prévia
                </Button>
              </div>
            </Card>
          ) : null}

          <Tabs defaultValue={conflitos.length ? "conflitos" : "linhas"}>
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="linhas">Linhas ({previa.length})</TabsTrigger>
              <TabsTrigger value="conflitos">Conflitos ({conflitos.length})</TabsTrigger>
              <TabsTrigger value="duplicidades">
                Possíveis duplicidades ({duplicidades.length})
              </TabsTrigger>
              <TabsTrigger value="avisos">Avisos ({interpretacao.avisos.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="linhas">
              <TabelaLinhas linhas={previa} />
            </TabsContent>

            <TabsContent value="conflitos">
              {conflitos.length === 0 ? (
                <SecaoVazia
                  titulo="Nenhum conflito"
                  descricao="Nenhum campo já preenchido será alterado."
                />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Estes campos já estão preenchidos com outro valor. Por padrão o valor atual é
                    mantido e a nova versão fica guardada para revisão no perfil. Marque para
                    substituir agora.
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-24">Substituir</TableHead>
                          <TableHead className="w-16">Linha</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Campo</TableHead>
                          <TableHead>Valor atual</TableHead>
                          <TableHead>Valor no arquivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {conflitos.map((c) => (
                          <TableRow key={c.chave}>
                            <TableCell>
                              <Checkbox
                                checked={substituir.has(c.chave)}
                                aria-label={`Substituir ${rotuloCampo(c.campo)} da linha ${c.linha}`}
                                onCheckedChange={(v) => {
                                  const novo = new Set(substituir);
                                  if (v) novo.add(c.chave);
                                  else novo.delete(c.chave);
                                  setSubstituir(novo);
                                }}
                              />
                            </TableCell>
                            <TableCell className="tabular">{c.linha}</TableCell>
                            <TableCell className="font-medium">{c.nome}</TableCell>
                            <TableCell className="text-sm">{rotuloCampo(c.campo)}</TableCell>
                            <TableCell className="text-sm">
                              {formatarValor(c.campo, c.atual)}
                            </TableCell>
                            <TableCell className="text-sm font-semibold">
                              {formatarValor(c.campo, c.novo)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="duplicidades">
              {duplicidades.length === 0 ? (
                <SecaoVazia titulo="Nenhuma possível duplicidade" />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Mesmo nome de um cliente já cadastrado, sem CPF que confirme ser a mesma pessoa.
                    O cliente será importado separadamente e a correspondência ficará para revisão
                    no perfil — nada é unido automaticamente.
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-16">Linha</TableHead>
                          <TableHead>Nome no arquivo</TableHead>
                          <TableHead>Cliente(s) com o mesmo nome</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {duplicidades.map((l) => (
                          <TableRow key={l.linha}>
                            <TableCell className="tabular">{l.linha}</TableCell>
                            <TableCell className="font-medium">{l.nome}</TableCell>
                            <TableCell className="text-sm">
                              {l.duplicidades
                                .map((d) => `${d.nome} (CPF: ${d.cpf || "Não informado"})`)
                                .join("; ")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="avisos">
              {interpretacao.avisos.length === 0 ? (
                <SecaoVazia titulo="Nenhum aviso" />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-16">Linha</TableHead>
                        <TableHead>Campo</TableHead>
                        <TableHead>Aviso</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {interpretacao.avisos.map((a, i) => (
                        <TableRow key={`${a.linha}-${i}`}>
                          <TableCell className="tabular">{a.linha}</TableCell>
                          <TableCell className="text-sm">{a.campo}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {a.mensagem}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      ) : null}

      {etapa === "concluido" && relatorio ? (
        <div className="space-y-6">
          <Card className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-8 text-success" aria-hidden />
              <div>
                <p className="text-base font-semibold">Importação concluída</p>
                <p className="text-sm text-muted-foreground">{arquivo}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={reiniciar}>
                Nova importação
              </Button>
              <Button asChild>
                <Link to="/clientes">Ver clientes</Link>
              </Button>
            </div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              titulo="Importadas"
              valor={
                relatorio.linhas.filter(
                  (l) => l.cliente !== "ja_importado" && l.cliente !== "repetida",
                ).length
              }
              icone={CheckCircle2}
              tom="money"
              descricao={`${relatorio.resumo.clientesNovos} cliente(s) novo(s) · ${relatorio.resumo.registrosNovos} processo(s)/atendimento(s)`}
            />
            <StatCard
              titulo="Complementadas"
              valor={relatorio.linhas.filter((l) => l.complementos.length > 0).length}
              icone={Layers}
              tom="info"
              descricao={`${relatorio.resumo.complementos} campo(s) vazio(s) preenchido(s)`}
            />
            <StatCard
              titulo="Pendentes"
              valor={relatorio.resumo.pendentes}
              icone={AlertTriangle}
              tom={relatorio.resumo.pendentes ? "danger" : "neutro"}
              descricao="Linhas sem Reclamante (não importadas)"
            />
            <StatCard
              titulo="Para revisar no perfil"
              valor={
                relatorio.linhas.filter((l) => l.conflitos.some((c) => !c.substituido)).length +
                relatorio.resumo.duplicidades +
                relatorio.resumo.revisoesAssociacao
              }
              icone={FileWarning}
              tom="warning"
              descricao="Divergências, duplicidades e associações"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {relatorio.resumo.linhasJaImportadas} linha(s) já existiam e não foram criadas
            novamente.
            {relatorio.resumo.linhasRepetidas
              ? ` ${relatorio.resumo.linhasRepetidas} linha(s) repetida(s) no arquivo foram ignoradas.`
              : ""}
          </p>
          {interpretacao?.pendentes.length ? (
            <Card className="gap-2 p-5">
              <p className="text-sm font-semibold">Linhas pendentes</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {interpretacao.pendentes.map((p) => (
                  <li key={p.linha}>
                    Linha {p.linha}: {p.motivo} {p.resumo ? `(${p.resumo})` : ""}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <TabelaLinhas linhas={relatorio.linhas} comLink />
        </div>
      ) : null}
    </div>
  );
}

function TabelaLinhas({ linhas, comLink }: { linhas: ResultadoLinha[]; comLink?: boolean }) {
  const [pagina, setPagina] = useState(0);
  const porPagina = 50;
  const total = Math.max(1, Math.ceil(linhas.length / porPagina));
  const visiveis = linhas.slice(pagina * porPagina, pagina * porPagina + porPagina);
  if (linhas.length === 0) return <SecaoVazia titulo="Nenhuma linha válida" />;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16">Linha</TableHead>
              <TableHead className="min-w-52">Reclamante</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Processo/atendimento</TableHead>
              <TableHead>Observações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visiveis.map((l) => {
              const rc = ROTULO_CLIENTE[l.cliente];
              const obs = [
                l.revisao,
                l.cliente === "repetida" && l.linha_original
                  ? `Igual à linha ${l.linha_original}`
                  : null,
                l.complementos.length ? `${l.complementos.length} campo(s) complementado(s)` : null,
                l.conflitos.length ? `${l.conflitos.length} conflito(s)` : null,
                l.duplicidades.length ? "Possível duplicidade" : null,
              ].filter(Boolean);
              return (
                <TableRow key={l.linha}>
                  <TableCell className="tabular">{l.linha}</TableCell>
                  <TableCell className="font-semibold">
                    {comLink && l.cliente_id ? (
                      <Link
                        to="/clientes/$clienteId"
                        params={{ clienteId: l.cliente_id }}
                        className="hover:underline"
                      >
                        {l.nome}
                      </Link>
                    ) : (
                      l.nome
                    )}
                  </TableCell>
                  <TableCell>
                    <BadgeStatus texto={rc.texto} tom={rc.tom} />
                  </TableCell>
                  <TableCell className="text-sm">{ROTULO_REGISTRO[l.registro]}</TableCell>
                  <TableCell
                    className={cn("text-xs", obs.length ? "text-warning" : "text-muted-foreground")}
                  >
                    {obs.join(" · ") || "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {total > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={pagina === 0}
            onClick={() => setPagina(pagina - 1)}
          >
            Anterior
          </Button>
          <span className="tabular text-muted-foreground">
            {pagina + 1} de {total}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={pagina >= total - 1}
            onClick={() => setPagina(pagina + 1)}
          >
            Próxima
          </Button>
        </div>
      ) : null}
    </div>
  );
}
