/**
 * Importação do modelo em BLOCOS ("VALORES PRI EXECUÇÃO") — prévia,
 * decisões de vínculo, gravação e relatório. Leitura em
 * src/lib/recebimentos/blocos.ts; identificação em blocosImportacao.ts.
 */

import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileWarning,
  FolderPlus,
  Layers,
  ListChecks,
  Loader2,
  Search,
  UserCheck,
  UserPlus,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
import { StatCard } from "@/components/StatCard";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBRL } from "@/lib/format";
import {
  ROTULO_ABA,
  ROTULO_SITUACAO_LANCAMENTO,
  type LeituraBlocos,
  type SituacaoLancamento,
} from "@/lib/recebimentos/blocos";
import {
  analisarBlocos,
  aplicarDecisoes,
  montarItensBlocos,
  resumirBlocos,
  type AnaliseBloco,
  type DecisaoUsuario,
} from "@/lib/recebimentos/blocosImportacao";
import type { BaseIdentificacao } from "@/lib/recebimentos/dados";
import {
  gravarBlocos,
  registrarResumoBlocos,
  simularBlocos,
  type ResultadoBloco,
} from "@/lib/recebimentos/dadosBlocos";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import { normalizarTexto } from "@/lib/situacao";
import { cn } from "@/lib/utils";
import { ROTULO_CATEGORIA_PROCESSO } from "@/lib/valoresProcesso";

type Etapa = "simulando" | "previa" | "gravando" | "concluido";
type Filtro = "todos" | "pendentes" | "conferencia" | "novos" | "existentes" | "sem_processo";

const TOM_SITUACAO: Record<SituacaoLancamento, "sucesso" | "neutro" | "alerta" | "perigo"> = {
  recebido: "sucesso",
  parcial: "alerta",
  a_receber: "neutro",
  nao_confirmado: "alerta",
  nao_havera_cobranca: "neutro",
  nao_havera_sucumbencia: "neutro",
};

const ROTULO_ORIGEM: Record<string, string> = {
  judicial: "Judicial",
  administrativo: "Administrativo — INSS",
};

function rotuloCard(c: string | null) {
  return c
    ? ROTULO_CATEGORIA_PROCESSO[c as keyof typeof ROTULO_CATEGORIA_PROCESSO].toUpperCase()
    : "CONFERÊNCIA";
}

export interface RelatorioBlocos {
  blocosPorAba: Record<string, number>;
  clientesCriados: number;
  clientesAtualizados: number;
  processosVinculados: number;
  processosCriados: number;
  lancamentos: number;
  previstos: number;
  previstosAtualizados: number;
  duplicidadesEvitadas: number;
  pendentes: number;
  conferencia: number;
  ignoradas: number;
  totais: Record<string, number>;
}

export function ImportacaoBlocos({
  arquivo,
  leitura,
  base,
  aoReiniciar,
}: {
  arquivo: string;
  leitura: LeituraBlocos;
  base: BaseIdentificacao;
  aoReiniciar: () => void;
}) {
  const sincronizar = useSincronizar();
  const [etapa, setEtapa] = useState<Etapa>("simulando");
  const [decisoes, setDecisoes] = useState<Map<string, DecisaoUsuario>>(new Map());
  const [simulacao, setSimulacao] = useState<Map<string, ResultadoBloco>>(new Map());
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioBlocos | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");

  const analiseBase = useMemo(
    () => analisarBlocos(leitura, base.clientes, base.variacoes, base.processos),
    [leitura, base],
  );
  const analises = useMemo(
    () => aplicarDecisoes(analiseBase, decisoes, base.processos),
    [analiseBase, decisoes, base.processos],
  );
  const itens = useMemo(() => montarItensBlocos(analises), [analises]);
  const resumo = useMemo(() => resumirBlocos(leitura, analises), [leitura, analises]);
  const clientePorId = useMemo(() => new Map(base.clientes.map((c) => [c.id, c])), [base]);
  const processosPorCliente = useMemo(() => {
    const m = new Map<string, BaseIdentificacao["processos"]>();
    for (const p of base.processos) m.set(p.cliente_id, [...(m.get(p.cliente_id) ?? []), p]);
    return m;
  }, [base]);

  // Prévia no banco (uma vez): o que já está registrado de importações anteriores.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await simularBlocos(montarItensBlocos(analiseBase), arquivo, (f, t) =>
          setProgresso(Math.round((f / Math.max(1, t)) * 100)),
        );
        if (vivo) setSimulacao(new Map(r.map((x) => [x.bloco, x])));
      } catch (e) {
        if (vivo)
          setErro(`Prévia no banco indisponível: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (vivo) setEtapa("previa");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [analiseBase, arquivo]);

  const jaRegistrados = useMemo(() => {
    let n = 0;
    for (const r of simulacao.values())
      n +=
        r.recebimentos.filter((x) => x.resultado === "ja_registrado").length +
        r.previstos.filter((x) => x.resultado === "inalterado" || x.resultado === "ja_recebido")
          .length;
    return n;
  }, [simulacao]);

  const decidir = (bloco: string, d: DecisaoUsuario) =>
    setDecisoes((m) => new Map(m).set(bloco, { ...m.get(bloco), ...d }));

  const visiveis = useMemo(() => {
    const q = normalizarTexto(busca);
    return analises.filter((a) => {
      if (q && !normalizarTexto(a.bloco.nome ?? "").includes(q)) return false;
      switch (filtro) {
        case "pendentes":
          return a.cliente.acao === "pendente";
        case "conferencia":
          return (
            a.bloco.conferencia.length > 0 || a.bloco.lancamentos.some((l) => l.conferencia.length)
          );
        case "novos":
          return a.cliente.acao === "novo";
        case "existentes":
          return a.cliente.acao === "existente";
        case "sem_processo":
          return (
            a.cliente.acao !== "pendente" &&
            a.processo.acao === "nenhum" &&
            a.bloco.lancamentos.length > 0
          );
        default:
          return true;
      }
    });
  }, [analises, filtro, busca]);

  async function confirmar() {
    setEtapa("gravando");
    setProgresso(0);
    setErro(null);
    try {
      const { importacaoId, blocos } = await gravarBlocos(itens, arquivo, (f, t) =>
        setProgresso(Math.round((f / Math.max(1, t)) * 100)),
      );
      const totais: Record<string, number> = {};
      const porChave = new Map(
        itens.flatMap((i) => i.recebimentos.map((r) => [`${i.bloco}|${r.chave}`, r])),
      );
      for (const b of blocos)
        for (const r of b.recebimentos)
          if (r.resultado === "inserido") {
            const x = porChave.get(`${b.bloco}|${r.chave}`);
            if (x) {
              const k = `${rotuloCard(x.categoria)} · ${ROTULO_ORIGEM[x.origem] ?? x.origem}`;
              totais[k] = Math.round(((totais[k] ?? 0) + (x.valor ?? 0)) * 100) / 100;
            }
          }
      const rel: RelatorioBlocos = {
        blocosPorAba: resumo.blocosPorAba,
        clientesCriados: new Set(blocos.filter((b) => b.cliente_criado).map((b) => b.cliente_id))
          .size,
        clientesAtualizados: new Set(
          blocos.filter((b) => !b.cliente_criado).map((b) => b.cliente_id),
        ).size,
        processosVinculados: new Set(
          blocos.filter((b) => b.atendimento_id && !b.processo_criado).map((b) => b.atendimento_id),
        ).size,
        processosCriados: blocos.filter((b) => b.processo_criado).length,
        lancamentos: blocos.reduce(
          (s, b) => s + b.recebimentos.filter((r) => r.resultado === "inserido").length,
          0,
        ),
        previstos: blocos.reduce(
          (s, b) => s + b.previstos.filter((r) => r.resultado === "inserido").length,
          0,
        ),
        previstosAtualizados: blocos.reduce(
          (s, b) => s + b.previstos.filter((r) => r.resultado === "atualizado").length,
          0,
        ),
        duplicidadesEvitadas:
          leitura.duplicidades.length +
          blocos.reduce(
            (s, b) =>
              s +
              b.recebimentos.filter((r) => r.resultado === "ja_registrado").length +
              b.previstos.filter(
                (r) => r.resultado === "inalterado" || r.resultado === "ja_recebido",
              ).length,
            0,
          ),
        pendentes: resumo.pendentes,
        conferencia: resumo.conferencia,
        ignoradas: leitura.ignoradas.length,
        totais,
      };
      if (importacaoId)
        await registrarResumoBlocos(importacaoId, {
          ...rel,
          pendentesDetalhe: analises
            .filter((a) => a.cliente.acao === "pendente")
            .map((a) => ({
              bloco: a.bloco.id,
              nome: a.bloco.nome,
              motivo: (a.cliente as { motivo: string }).motivo,
            })),
          ignoradas: leitura.ignoradas,
          duplicidades: leitura.duplicidades,
        });
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      setRelatorio(rel);
      setEtapa("concluido");
      toast.success(
        `Importação concluída: ${rel.lancamentos} recebimento(s) e ${rel.previstos} valor(es) previsto(s).`,
      );
    } catch (e) {
      setErro(
        `${e instanceof Error ? e.message : String(e)} — As partes já gravadas permanecem; importar o mesmo arquivo novamente não duplica.`,
      );
      await sincronizar(EVENTOS.IMPORTACAO_CONCLUIDA);
      setEtapa("previa");
    }
  }

  if (etapa === "simulando" || etapa === "gravando")
    return (
      <Card className="flex flex-col items-center gap-4 p-12 text-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold">
          {etapa === "simulando"
            ? `Conferindo ${arquivo} com a base…`
            : "Gravando clientes, processos e valores…"}
        </p>
        <Progress value={progresso} className="w-full max-w-md" />
        <p className="text-xs text-muted-foreground tabular">{progresso}%</p>
      </Card>
    );

  if (etapa === "concluido" && relatorio)
    return <Relatorio relatorio={relatorio} aoReiniciar={aoReiniciar} />;

  return (
    <div className="space-y-6">
      {erro ? (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{erro}</p>
        </div>
      ) : null}

      <Card className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">{arquivo}</p>
          <p className="text-xs text-muted-foreground">
            Modelo em blocos ·{" "}
            {leitura.abas.map((a) => `${a.nome}: ${a.blocos} blocos`).join(" · ")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={aoReiniciar}>
          Escolher outro arquivo
        </Button>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          titulo="Clientes"
          valor={resumo.clientesExistentes + resumo.clientesNovos}
          icone={UserCheck}
          tom="info"
          descricao={`${resumo.clientesExistentes} já cadastrado(s) · ${resumo.clientesNovos} novo(s) em JÁ PAGOS`}
        />
        <StatCard
          titulo="Pendentes de decisão"
          valor={resumo.pendentes}
          icone={UserPlus}
          tom={resumo.pendentes ? "warning" : "neutro"}
          descricao="Nome parecido ou não identificado — não são gravados até você decidir"
        />
        <StatCard
          titulo="Processos / benefícios"
          valor={resumo.processosVinculados + resumo.processosNovos}
          icone={FolderPlus}
          descricao={`${resumo.processosVinculados} vinculado(s) · ${resumo.processosNovos} novo(s) · ${resumo.semProcesso} bloco(s) sem processo`}
        />
        <StatCard
          titulo="Lançamentos"
          valor={resumo.recebimentos + resumo.previstos}
          icone={Wallet}
          tom="money"
          descricao={`${resumo.recebimentos} recebido(s) · ${resumo.previstos} previsto(s)/pendente(s)`}
        />
        <StatCard
          titulo="Para conferência"
          valor={resumo.conferencia}
          icone={AlertTriangle}
          tom={resumo.conferencia ? "warning" : "neutro"}
          descricao="Versões, natureza incerta, valores inconsistentes"
        />
        <StatCard
          titulo="Duplicidades evitadas"
          valor={resumo.duplicidadesEvitadas + jaRegistrados}
          icone={Copy}
          descricao={`${resumo.duplicidadesEvitadas} entre abas · ${jaRegistrados} já registrado(s) no sistema`}
        />
        <StatCard
          titulo="Células ignoradas"
          valor={resumo.ignoradas}
          icone={FileWarning}
          descricao="Totais, fórmulas, modelos vazios — listadas abaixo"
        />
        <StatCard
          titulo="Blocos"
          valor={analises.length}
          icone={Layers}
          descricao={Object.entries(resumo.blocosPorAba)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        />
      </div>

      <Card className="gap-3 p-5">
        <p className="text-sm font-semibold">Valores por card e origem</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3">Card</th>
                <th className="py-1 pr-3">Origem</th>
                <th className="py-1 pr-3 text-right">Recebido</th>
                <th className="py-1 text-right">Previsto / pendente</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(resumo.totais).map(([k, v]) => {
                const [cat, origem] = k.split("|");
                return (
                  <tr key={k} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-medium">
                      {cat === "conferencia" ? "CONFERÊNCIA" : rotuloCard(cat!)}
                    </td>
                    <td className="py-1.5 pr-3">{ROTULO_ORIGEM[origem!] ?? origem}</td>
                    <td className="tabular py-1.5 pr-3 text-right font-semibold text-money">
                      {formatBRL(v.recebido)}
                    </td>
                    <td className="tabular py-1.5 text-right">{formatBRL(v.previsto)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Recebido = confirmação expressa na planilha. Previsto = a receber, parcelas futuras ou sem
          confirmação — vai para a página VALORES PREVISTOS e não entra no TOTAL RECEBIDO. Valor
          bruto, valor do autor, RMI/RMA e totais da planilha ficam só como informação.
        </p>
      </Card>

      <Tabs defaultValue="blocos">
        <TabsList>
          <TabsTrigger value="blocos">Blocos ({analises.length})</TabsTrigger>
          <TabsTrigger value="ignorados">
            Ignorados e duplicidades ({leitura.ignoradas.length + leitura.duplicidades.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="blocos" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search
                className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cliente…"
                className="pl-9"
                aria-label="Buscar cliente nos blocos"
              />
            </div>
            <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
              <SelectTrigger className="w-56" aria-label="Filtrar blocos">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os blocos</SelectItem>
                <SelectItem value="pendentes">Pendentes de decisão</SelectItem>
                <SelectItem value="conferencia">Com itens para conferência</SelectItem>
                <SelectItem value="novos">Clientes novos</SelectItem>
                <SelectItem value="existentes">Clientes já cadastrados</SelectItem>
                <SelectItem value="sem_processo">Sem processo vinculado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            {visiveis.map((a) => (
              <LinhaBloco
                key={a.bloco.id}
                analise={a}
                simulacao={simulacao.get(a.bloco.id)}
                nomeCliente={(id) => clientePorId.get(id)?.nome ?? id}
                processos={
                  a.cliente.acao === "existente"
                    ? (processosPorCliente.get(a.cliente.id) ?? [])
                    : []
                }
                decidir={(d) => decidir(a.bloco.id, d)}
              />
            ))}
            {!visiveis.length ? (
              <p className="text-sm text-muted-foreground">Nenhum bloco neste filtro.</p>
            ) : null}
          </div>
        </TabsContent>
        <TabsContent value="ignorados">
          <Card className="gap-2 p-4 text-sm">
            {leitura.duplicidades.map((d, i) => (
              <p key={`d${i}`}>
                <BadgeStatus texto="Duplicidade evitada" tom="neutro" /> {d.lancamento} = {d.igualA}{" "}
                — {d.motivo}
              </p>
            ))}
            {leitura.ignoradas.map((x, i) => (
              <p key={`i${i}`} className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {x.aba} {x.celula}
                </span>{" "}
                — {x.motivo}
                {x.texto ? `: “${x.texto.slice(0, 120)}”` : ""}
              </p>
            ))}
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Serão gravados {itens.length} bloco(s).{" "}
          {resumo.pendentes ? `${resumo.pendentes} pendente(s) de decisão ficam de fora. ` : ""}
          Reimportar o mesmo arquivo não duplica clientes, processos nem valores.
        </p>
        <Button onClick={() => void confirmar()} disabled={!itens.length}>
          <CheckCircle2 className="size-4" aria-hidden />
          Confirmar importação
        </Button>
      </Card>
    </div>
  );
}

function LinhaBloco({
  analise: a,
  simulacao,
  nomeCliente,
  processos,
  decidir,
}: {
  analise: AnaliseBloco;
  simulacao: ResultadoBloco | undefined;
  nomeCliente: (id: string) => string;
  processos: BaseIdentificacao["processos"];
  decidir: (d: DecisaoUsuario) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const b = a.bloco;
  const conf = b.conferencia.length + b.lancamentos.filter((l) => l.conferencia.length).length;
  const valorCliente =
    a.cliente.acao === "existente"
      ? a.cliente.id
      : a.cliente.acao === "novo"
        ? a.grupoNovo === `nome:${b.nomeNormalizado}`
          ? "novo"
          : `grupo:${a.cliente.grupo}`
        : "";
  const valorProcesso =
    a.processo.acao === "existente"
      ? a.processo.id
      : a.processo.acao === "novo"
        ? "novo"
        : "nenhum";
  const podeNovoProcesso = Boolean(b.processoDigitos || b.nb);
  const jaRegistrados = simulacao
    ? simulacao.recebimentos.filter((r) => r.resultado === "ja_registrado").length +
      simulacao.previstos.filter((r) => r.resultado !== "inserido").length
    : 0;

  return (
    <Card className={cn("gap-0 p-0", a.cliente.acao === "pendente" && "border-warning/50")}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-muted/40"
      >
        <ChevronRight
          className={cn("size-4 shrink-0 transition-transform", aberto && "rotate-90")}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{b.nome ?? "Cliente não identificado"}</span>
          <span className="block text-xs text-muted-foreground">
            {ROTULO_ABA[b.aba]} · {b.coluna}
            {b.linhaInicial}:{b.coluna}
            {b.linhaFinal}
            {b.cpf ? ` · CPF ${b.cpf}` : ""}
            {b.processo ? ` · Processo ${b.processo}` : ""}
            {b.nb ? ` · NB ${b.nb}` : ""}
            {b.tribunal ? ` · ${b.tribunal}` : ""}
          </span>
        </span>
        {a.cliente.acao === "existente" ? (
          <BadgeStatus texto="Cliente cadastrado" tom="sucesso" />
        ) : a.cliente.acao === "novo" ? (
          <BadgeStatus texto="Novo · JÁ PAGOS" tom="neutro" />
        ) : (
          <BadgeStatus texto="Decidir cliente" tom="alerta" />
        )}
        {a.processo.acao === "nenhum" && b.lancamentos.length ? (
          <BadgeStatus texto="Sem processo" tom="alerta" />
        ) : null}
        {conf ? <BadgeStatus texto={`${conf} conferência`} tom="alerta" /> : null}
        {jaRegistrados ? (
          <BadgeStatus texto={`${jaRegistrados} já registrado(s)`} tom="neutro" />
        ) : null}
      </button>
      {aberto ? (
        <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
          {a.cliente.acao === "pendente" ? (
            <p className="rounded-lg bg-warning-soft px-3 py-2 text-warning">{a.cliente.motivo}</p>
          ) : null}
          {a.avisos.length ? (
            <p className="text-xs text-muted-foreground">{a.avisos.join(" ")}</p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cliente
              </span>
              <Select
                value={valorCliente}
                onValueChange={(v) => decidir({ cliente: v, processo: undefined })}
                disabled={!b.nome}
              >
                <SelectTrigger aria-label="Cliente do bloco">
                  <SelectValue placeholder="Escolha o cliente…" />
                </SelectTrigger>
                <SelectContent>
                  {a.cliente.acao === "existente" &&
                  !a.sugestoes.some((s) => s.id === (a.cliente as { id: string }).id) ? (
                    <SelectItem value={a.cliente.id}>
                      {nomeCliente(a.cliente.id)} (identificado)
                    </SelectItem>
                  ) : null}
                  {a.sugestoes.map((s) => (
                    <SelectItem
                      key={`${s.tipo}${s.id}`}
                      value={s.tipo === "grupo" ? `grupo:${s.id}` : s.id}
                    >
                      {s.tipo === "grupo" ? `Mesmo cliente novo: ${s.nome}` : s.nome} (
                      {Math.round(s.percentual)}%)
                    </SelectItem>
                  ))}
                  <SelectItem value="novo">Criar novo cliente em JÁ PAGOS: {b.nome}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Processo / benefício
              </span>
              <Select
                value={valorProcesso}
                onValueChange={(v) => decidir({ processo: v })}
                disabled={a.cliente.acao === "pendente"}
              >
                <SelectTrigger aria-label="Processo do bloco">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {processos.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.numero || "Sem número"}
                      {p.tipo_acao ? ` · ${p.tipo_acao}` : ""}
                    </SelectItem>
                  ))}
                  {podeNovoProcesso ? (
                    <SelectItem value="novo">Novo: {b.processo ?? `NB ${b.nb}`}</SelectItem>
                  ) : null}
                  <SelectItem value="nenhum">Sem processo (fica para conferência)</SelectItem>
                </SelectContent>
              </Select>
              {a.processo.acao === "nenhum" && a.processo.motivo ? (
                <span className="text-xs text-warning">{a.processo.motivo}</span>
              ) : a.processo.acao === "existente" ? (
                <span className="text-xs text-muted-foreground">
                  Vinculado por {a.processo.via}.
                </span>
              ) : null}
            </div>
          </div>

          {b.lancamentos.length ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">Card</th>
                    <th className="px-2 py-1.5">Descrição</th>
                    <th className="px-2 py-1.5">Origem / canal</th>
                    <th className="px-2 py-1.5 text-right">Valor</th>
                    <th className="px-2 py-1.5 text-right">Recebido</th>
                    <th className="px-2 py-1.5">Situação</th>
                    <th className="px-2 py-1.5">Células</th>
                  </tr>
                </thead>
                <tbody>
                  {b.lancamentos.map((l) => (
                    <tr key={l.id} className="border-t border-border align-top">
                      <td className="px-2 py-1.5 font-semibold">{rotuloCard(l.categoria)}</td>
                      <td className="px-2 py-1.5">
                        <span className="block">{l.rotulo}</span>
                        {l.observacoes.length ? (
                          <span className="block text-muted-foreground">
                            {l.observacoes.join(" · ").slice(0, 220)}
                          </span>
                        ) : null}
                        {l.conferencia.map((c, i) => (
                          <span key={i} className="block text-warning">
                            {c}
                          </span>
                        ))}
                      </td>
                      <td className="px-2 py-1.5">
                        {ROTULO_ORIGEM[l.origem]}
                        {l.canal ? (
                          <span className="block text-muted-foreground">{l.canal}</span>
                        ) : null}
                      </td>
                      <td className="tabular px-2 py-1.5 text-right">
                        {l.valor === null ? "—" : formatBRL(l.valor)}
                      </td>
                      <td className="tabular px-2 py-1.5 text-right">
                        {l.valorRecebido ? formatBRL(l.valorRecebido) : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <BadgeStatus
                          texto={ROTULO_SITUACAO_LANCAMENTO[l.situacao]}
                          tom={TOM_SITUACAO[l.situacao]}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{l.celulas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground">
              Nenhum valor de honorários neste bloco (dados do benefício e observações são
              preservados).
            </p>
          )}

          {b.complementares.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Informações complementares (não somadas)
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {b.complementares.map((c, i) => (
                  <li key={i}>
                    {c.rotulo}:{" "}
                    <span className="tabular font-medium">
                      {c.valor === null ? "—" : formatBRL(c.valor)}
                    </span>{" "}
                    <span className="text-muted-foreground">({c.celula})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {Object.keys(b.beneficio).length ? (
            <p className="text-xs">
              <span className="font-semibold">Benefício: </span>
              {Object.entries(b.beneficio)
                .filter(([, v]) => v)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </p>
          ) : null}
          {b.notas.length || b.conferencia.length ? (
            <div className="text-xs">
              {b.conferencia.map((c, i) => (
                <p key={i} className="text-warning">
                  {c}
                </p>
              ))}
              {b.notas.map((n, i) => (
                <p key={i} className="text-muted-foreground">
                  <span className="font-medium">{n.celula}:</span> {n.texto}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Relatorio({
  relatorio: r,
  aoReiniciar,
}: {
  relatorio: RelatorioBlocos;
  aoReiniciar: () => void;
}) {
  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-6 text-success" aria-hidden />
        <div>
          <p className="text-base font-semibold">Importação concluída</p>
          <p className="text-sm text-muted-foreground">
            Blocos por aba:{" "}
            {Object.entries(r.blocosPorAba)
              .map(([k, v]) => `${k} ${v}`)
              .join(" · ")}
          </p>
        </div>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Item rotulo="Clientes criados (JÁ PAGOS)" valor={r.clientesCriados} />
        <Item rotulo="Clientes atualizados" valor={r.clientesAtualizados} />
        <Item rotulo="Processos/benefícios vinculados" valor={r.processosVinculados} />
        <Item rotulo="Processos/benefícios criados" valor={r.processosCriados} />
        <Item rotulo="Recebimentos importados" valor={r.lancamentos} />
        <Item
          rotulo="Valores previstos (novos / atualizados)"
          valor={`${r.previstos} / ${r.previstosAtualizados}`}
        />
        <Item rotulo="Duplicidades evitadas" valor={r.duplicidadesEvitadas} />
        <Item rotulo="Pendentes de decisão (não gravados)" valor={r.pendentes} />
        <Item rotulo="Itens para conferência" valor={r.conferencia} />
        <Item rotulo="Células ignoradas (totais, fórmulas, modelos)" valor={r.ignoradas} />
      </div>
      {Object.keys(r.totais).length ? (
        <div className="space-y-0.5 rounded-lg border border-border p-3 text-sm">
          <p className="mb-1 font-semibold">Totais recebidos importados</p>
          {Object.entries(r.totais).map(([k, v]) => (
            <p key={k} className="tabular">
              {k}: <span className="font-semibold text-money">{formatBRL(v)}</span>
            </p>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/ja-pagos">Ir para JÁ PAGOS</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/valores-previstos">
            <ListChecks className="size-4" aria-hidden />
            Ver VALORES PREVISTOS
          </Link>
        </Button>
        <Button variant="outline" onClick={aoReiniciar}>
          Importar outro arquivo
        </Button>
      </div>
    </Card>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: number | string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="tabular text-lg font-semibold">{valor}</p>
    </div>
  );
}
