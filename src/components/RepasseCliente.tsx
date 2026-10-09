/**
 * Perfil do cliente — seção VALORES RECEBIDOS E REPASSE.
 *
 * Mostra quanto o Furtado efetivamente recebeu deste cliente e quanto cabe ao
 * Ricardo Friedl (5 %), por categoria, por processo (sem misturar processos)
 * e por lançamento. Toda conta vem de src/lib/repasse.ts (motor único).
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { BlocoExpansivel, ResumoLinhas } from "@/components/BlocoExpansivel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDate, formatDateTime } from "@/lib/format";
import { db } from "@/lib/furtado/persistencia";
import {
  GRUPOS_REPASSE,
  motivoInelegivel,
  REGRA_REPASSE,
  repasseDaEntrada,
  repassePorProcesso,
  resumirRepasse,
  ROTULO_GRUPO_REPASSE,
  SEM_PROCESSO_REPASSE,
  type ResumoRepasse,
} from "@/lib/repasse";
import { dadosDoRegistro, type PerfilRF } from "@/lib/rf/dados";
import { ROTULO_CLASSIFICACAO, type ClassificacaoEntrada, type Pagamento } from "@/lib/tipos";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Auditoria (gravada pelo banco a cada criação/alteração/exclusão)
// ---------------------------------------------------------------------------

export interface AuditoriaRepasse {
  id: string;
  pagamento_id: string;
  atendimento_id: string | null;
  operacao: "criacao" | "alteracao" | "exclusao" | "saldo_inicial";
  valor_anterior: number | null;
  valor_novo: number | null;
  categoria_anterior: string | null;
  categoria_nova: string | null;
  regra_versao: number;
  percentual: number;
  repasse_anterior: number;
  repasse_novo: number;
  origem: string | null;
  data_pagamento: string | null;
  created_at: string;
}

export const auditoriaRepasseQuery = (clienteId: string) =>
  queryOptions({
    queryKey: ["auditoria_repasse", clienteId],
    queryFn: async (): Promise<AuditoriaRepasse[]> => {
      const res = await db
        .from("auditoria_repasse")
        .select("*")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false })
        .limit(200);
      // Antes da migração ser aplicada a tabela não existe: a seção segue funcionando.
      if (res.error) return [];
      return (res.data ?? []) as AuditoriaRepasse[];
    },
    staleTime: 30_000,
  });

const ROTULO_OPERACAO: Record<AuditoriaRepasse["operacao"], string> = {
  criacao: "Recebimento registrado",
  alteracao: "Recebimento alterado",
  exclusao: "Recebimento excluído",
  saldo_inicial: "Recebimento existente na criação da regra",
};

function rotuloCategoria(c: string | null | undefined): string {
  return c && c in ROTULO_CLASSIFICACAO
    ? ROTULO_CLASSIFICACAO[c as ClassificacaoEntrada]
    : "Sem categoria";
}

// ---------------------------------------------------------------------------
// Peças visuais
// ---------------------------------------------------------------------------

function Indicador({
  rotulo,
  valor,
  destaque,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
  detalhe?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        destaque ? "border-money/40 bg-money/5" : "border-border bg-muted/30",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <p className={cn("tabular text-xl font-bold", destaque && "text-money")}>{valor}</p>
      {detalhe ? <p className="text-xs text-muted-foreground">{detalhe}</p> : null}
    </div>
  );
}

/** Tabela por categoria: Recebido × Repasse. */
export function TabelaCategoriasRepasse({ resumo }: { resumo: ResumoRepasse }) {
  const grupos = GRUPOS_REPASSE.filter(
    (g) => g !== "sem_classificacao" || resumo.porCategoria[g].quantidade > 0,
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Categoria</TableHead>
            <TableHead className="text-center">Lançamentos</TableHead>
            <TableHead className="text-right">Recebido</TableHead>
            <TableHead className="text-right">Repasse {REGRA_REPASSE.rotulo}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grupos.map((g) => (
            <TableRow key={g}>
              <TableCell className="font-semibold">{ROTULO_GRUPO_REPASSE[g]}</TableCell>
              <TableCell className="text-center tabular">
                {resumo.porCategoria[g].quantidade}
              </TableCell>
              <TableCell className="text-right tabular">
                {formatBRL(resumo.porCategoria[g].recebido)}
              </TableCell>
              <TableCell className="text-right tabular font-semibold text-money">
                {formatBRL(resumo.porCategoria[g].repasse)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="bg-muted/40 font-bold hover:bg-muted/40">
            <TableCell>TOTAL</TableCell>
            <TableCell className="text-center tabular">{resumo.quantidade}</TableCell>
            <TableCell className="text-right tabular">{formatBRL(resumo.recebido)}</TableCell>
            <TableCell className="text-right tabular text-money">
              {formatBRL(resumo.repasse)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function TabelaLancamentos({ pagamentos }: { pagamentos: Pagamento[] }) {
  const ordenados = [...pagamentos].sort(
    (a, b) =>
      a.data_pagamento.localeCompare(b.data_pagamento) ||
      (a.linha_importacao ?? 0) - (b.linha_importacao ?? 0),
  );
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Data</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Valor recebido</TableHead>
            <TableHead className="text-right">Repasse {REGRA_REPASSE.rotulo}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordenados.map((p) => {
            const motivo = motivoInelegivel(p);
            return (
              <TableRow key={p.id} className={cn(motivo && "text-muted-foreground")}>
                <TableCell className="tabular text-sm">{formatDate(p.data_pagamento)}</TableCell>
                <TableCell className="text-sm">
                  {rotuloCategoria(p.classificacao).toUpperCase()}
                </TableCell>
                <TableCell className="text-right tabular">{formatBRL(p.valor)}</TableCell>
                <TableCell className="text-right tabular font-semibold">
                  {motivo ? (
                    <span className="text-xs font-normal">
                      {motivo === "pago_ao_cliente"
                        ? "Pago ao cliente — fora do repasse"
                        : "Sem valor"}
                    </span>
                  ) : (
                    <span className="text-money">{formatBRL(repasseDaEntrada(p))}</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seção do perfil
// ---------------------------------------------------------------------------

export function ValoresRecebidosERepasse({ perfil }: { perfil: PerfilRF }) {
  const { data: auditoria } = useQuery(auditoriaRepasseQuery(perfil.cliente.id));
  const resumo = resumirRepasse(perfil.pagamentos);
  const porProcesso = repassePorProcesso(perfil.pagamentos);
  const idsProcessos = new Set(perfil.registros.map((r) => r.id));

  // Processos com lançamento, na ordem do perfil; depois "sem processo".
  const blocos = [
    ...perfil.registros
      .filter((r) => porProcesso.has(r.id))
      .map((r) => {
        const d = dadosDoRegistro(r);
        return {
          chave: r.id,
          titulo: `Processo ${d.numero || "sem número"}${d.tipo_acao ? ` — ${d.tipo_acao}` : ""}`,
          resumo: porProcesso.get(r.id)!,
          pagamentos: perfil.pagamentos.filter((p) => p.atendimento_id === r.id),
        };
      }),
  ];
  const semProcesso = perfil.pagamentos.filter(
    (p) => !p.atendimento_id || !idsProcessos.has(p.atendimento_id),
  );
  if (semProcesso.length)
    blocos.push({
      chave: SEM_PROCESSO_REPASSE,
      titulo: "Valores sem processo vinculado",
      resumo: resumirRepasse(semProcesso),
      pagamentos: semProcesso,
    });

  const linhasResumo =
    resumo.quantidade === 0
      ? ["Nenhum valor efetivamente recebido registrado — repasse R$ 0,00."]
      : [
          `Total recebido pelo Furtado: ${formatBRL(resumo.recebido)}`,
          `Percentual Ricardo Friedl: ${REGRA_REPASSE.rotulo}`,
          `Repasse devido: ${formatBRL(resumo.repasse)}`,
        ];

  return (
    <BlocoExpansivel
      titulo="Valores recebidos e repasse"
      resumo={<ResumoLinhas itens={linhasResumo} />}
      className="border-money/30"
    >
      <div className="space-y-5 p-4" data-testid="repasse-cliente">
        <div className="grid gap-3 sm:grid-cols-3">
          <Indicador
            rotulo="Total recebido pelo Furtado"
            valor={formatBRL(resumo.recebido)}
            detalhe={`${resumo.quantidade} valor(es) recebido(s)`}
          />
          <Indicador
            rotulo="Percentual Ricardo Friedl"
            valor={REGRA_REPASSE.rotulo}
            detalhe={`Regra única v${REGRA_REPASSE.versao} — qualquer ação ou categoria`}
          />
          <Indicador
            rotulo="Repasse devido"
            valor={formatBRL(resumo.repasse)}
            destaque
            detalhe="Soma dos repasses de cada lançamento"
          />
        </div>

        <TabelaCategoriasRepasse resumo={resumo} />

        {blocos.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Por processo
            </h3>
            {blocos.map((b) => (
              <BlocoExpansivel
                key={b.chave}
                aninhado
                titulo={b.titulo}
                resumo={
                  <ResumoLinhas
                    itens={[
                      `Recebido: ${formatBRL(b.resumo.recebido)} · Repasse: ${formatBRL(b.resumo.repasse)}`,
                    ]}
                  />
                }
              >
                <div className="space-y-3 p-3">
                  <TabelaCategoriasRepasse resumo={b.resumo} />
                  <TabelaLancamentos pagamentos={b.pagamentos} />
                </div>
              </BlocoExpansivel>
            ))}
            {blocos.length > 1 ? (
              <p className="rounded-lg border border-border bg-muted/30 px-4 py-2 text-sm">
                <strong>TOTAL CLIENTE</strong> — Recebido{" "}
                <span className="tabular font-semibold">{formatBRL(resumo.recebido)}</span> ·
                Repasse{" "}
                <span className="tabular font-semibold text-money">
                  {formatBRL(resumo.repasse)}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          O repasse é calculado somente sobre valores efetivamente recebidos pelo Furtado. Valor
          Estimado do Processo, valor da causa, previsões e valores pendentes não entram. Valores
          pagos diretamente ao cliente ficam fora. Cada lançamento é arredondado ao centavo uma
          única vez; o total é a soma dos lançamentos.
        </p>

        {auditoria && auditoria.length ? (
          <BlocoExpansivel
            aninhado
            titulo={
              <span className="inline-flex items-center gap-2">
                <History className="size-4" aria-hidden />
                Histórico do repasse ({auditoria.length})
              </span>
            }
          >
            <ul className="divide-y divide-border text-sm">
              {auditoria.map((a) => (
                <li key={a.id} className="px-4 py-2">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{ROTULO_OPERACAO[a.operacao]}</span>
                    <span className="tabular text-xs text-muted-foreground">
                      {formatDateTime(a.created_at)}
                    </span>
                  </p>
                  <p className="text-xs">
                    {a.operacao === "alteracao" ? (
                      <>
                        {formatBRL(a.valor_anterior)} ({rotuloCategoria(a.categoria_anterior)}) →{" "}
                        {formatBRL(a.valor_novo)} ({rotuloCategoria(a.categoria_nova)}) · repasse{" "}
                        {formatBRL(a.repasse_anterior)} →{" "}
                        <strong>{formatBRL(a.repasse_novo)}</strong>
                      </>
                    ) : a.operacao === "exclusao" ? (
                      <>
                        {formatBRL(a.valor_anterior)} ({rotuloCategoria(a.categoria_anterior)}) ·
                        repasse {formatBRL(a.repasse_anterior)} deixou de ser considerado
                      </>
                    ) : (
                      <>
                        {formatBRL(a.valor_novo)} ({rotuloCategoria(a.categoria_nova)}) · repasse{" "}
                        <strong>{formatBRL(a.repasse_novo)}</strong>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Number(a.percentual)}% · regra v{a.regra_versao} ·{" "}
                    {a.origem === "importacao" ? "importação" : "lançamento manual"}
                    {a.data_pagamento ? ` · recebido em ${formatDate(a.data_pagamento)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </BlocoExpansivel>
        ) : null}
      </div>
    </BlocoExpansivel>
  );
}
