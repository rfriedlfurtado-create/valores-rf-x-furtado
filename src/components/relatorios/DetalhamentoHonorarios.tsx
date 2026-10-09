/**
 * RELATÓRIOS — detalhamento (cliente → processo → categoria → recebimento) e
 * conferência do repasse. Mesmas linhas filtradas dos cards e gráficos.
 */
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { BlocoExpansivel, ResumoLinhas } from "@/components/BlocoExpansivel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDate } from "@/lib/format";
import {
  porCliente,
  type ClienteRelatorio,
  type LinhaHonorario,
  type Totais,
  type TotaisCategoria,
} from "@/lib/relatorioHonorarios";
import { deCentavos, REGRA_REPASSE, ROTULO_GRUPO_REPASSE } from "@/lib/repasse";

const POR_PAGINA_CLIENTES = 20;
const POR_PAGINA_LINHAS = 50;

function Paginacao({
  pagina,
  total,
  porPagina,
  mudar,
}: {
  pagina: number;
  total: number;
  porPagina: number;
  mudar: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      <span className="text-muted-foreground">
        {pagina * porPagina + 1}–{Math.min(total, (pagina + 1) * porPagina)} de {total}
      </span>
      <Button
        size="icon"
        variant="outline"
        className="size-8"
        disabled={pagina === 0}
        onClick={() => mudar(pagina - 1)}
        aria-label="Página anterior"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="outline"
        className="size-8"
        disabled={pagina >= paginas - 1}
        onClick={() => mudar(pagina + 1)}
        aria-label="Próxima página"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

/** Três colunas padrão: Recebido · Escritório · Ricardo. */
function Trio({
  t,
  forte,
}: {
  t: Pick<Totais, "recebido" | "escritorio" | "ricardo">;
  forte?: boolean;
}) {
  return (
    <>
      <TableCell className={`text-right tabular ${forte ? "font-bold" : ""}`}>
        {formatBRL(t.recebido)}
      </TableCell>
      <TableCell className={`text-right tabular ${forte ? "font-bold" : ""}`}>
        {formatBRL(t.escritorio)}
      </TableCell>
      <TableCell
        className={`text-right tabular text-money ${forte ? "font-bold" : "font-semibold"}`}
      >
        {formatBRL(t.ricardo)}
      </TableCell>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tabela por categoria
// ---------------------------------------------------------------------------

export function TabelaCategorias({
  categorias,
  totais,
}: {
  categorias: TotaisCategoria[];
  totais: Totais;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Categoria</TableHead>
            <TableHead className="text-center">Recebimentos</TableHead>
            <TableHead className="text-center">Clientes</TableHead>
            <TableHead className="text-right">Total recebido</TableHead>
            <TableHead className="text-right">Escritório</TableHead>
            <TableHead className="text-right">Ricardo Friedl ({REGRA_REPASSE.rotulo})</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categorias.map((c) => (
            <TableRow key={c.categoria}>
              <TableCell className="font-semibold">{c.rotulo}</TableCell>
              <TableCell className="text-center tabular">{c.quantidade}</TableCell>
              <TableCell className="text-center tabular">{c.clientes}</TableCell>
              <Trio t={c} />
            </TableRow>
          ))}
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableCell className="font-bold">TOTAL</TableCell>
            <TableCell className="text-center font-bold tabular">{totais.quantidade}</TableCell>
            <TableCell className="text-center font-bold tabular">{totais.clientes}</TableCell>
            <Trio t={totais} forte />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalhamento por cliente (expansível) → processo → categoria → recebimento
// ---------------------------------------------------------------------------

function TabelaRecebimentos({
  linhas,
  mostrarCliente,
}: {
  linhas: readonly LinhaHonorario[];
  mostrarCliente?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {mostrarCliente ? <TableHead className="min-w-48">Cliente</TableHead> : null}
            {mostrarCliente ? <TableHead className="min-w-44">Processo</TableHead> : null}
            <TableHead>Data</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead className="text-right">Valor recebido</TableHead>
            <TableHead className="text-right">Escritório</TableHead>
            <TableHead className="text-right">Ricardo Friedl</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l) => (
            <TableRow key={l.pagamentoId}>
              {mostrarCliente ? (
                <TableCell className="font-medium">
                  <Link
                    to="/clientes/$clienteId"
                    params={{ clienteId: l.clienteId }}
                    className="hover:underline"
                  >
                    {l.clienteNome}
                  </Link>
                </TableCell>
              ) : null}
              {mostrarCliente ? (
                <TableCell className="tabular text-xs">
                  {l.processoNumero || "Sem processo"}
                </TableCell>
              ) : null}
              <TableCell className="tabular text-sm">{formatDate(l.data)}</TableCell>
              <TableCell className="text-sm">{ROTULO_GRUPO_REPASSE[l.categoria]}</TableCell>
              <Trio
                t={{
                  recebido: deCentavos(l.recebidoC),
                  escritorio: deCentavos(l.escritorioC),
                  ricardo: deCentavos(l.ricardoC),
                }}
              />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function linhasResumo(t: Totais): string[] {
  return [
    `Total recebido: ${formatBRL(t.recebido)} · Escritório: ${formatBRL(t.escritorio)} · Ricardo Friedl: ${formatBRL(t.ricardo)}`,
    `${t.quantidade} valor(es)`,
  ];
}

function BlocoCliente({ c }: { c: ClienteRelatorio }) {
  return (
    <BlocoExpansivel
      aninhado
      titulo={c.nome}
      resumo={<ResumoLinhas itens={linhasResumo(c.totais)} />}
      acao={
        <Button asChild size="sm" variant="ghost">
          <Link to="/clientes/$clienteId" params={{ clienteId: c.clienteId }}>
            <ExternalLink className="size-4" aria-hidden />
            Perfil
          </Link>
        </Button>
      }
    >
      <div className="space-y-3 p-3">
        {c.processos.map((p) => (
          <div key={p.chave} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">
                {p.processoId
                  ? `Processo: ${p.numero || "sem número"}`
                  : "Valores sem processo vinculado"}
                {p.tipo ? (
                  <span className="font-normal text-muted-foreground"> — {p.tipo}</span>
                ) : null}
              </p>
              <p className="text-xs">
                Recebido <strong className="tabular">{formatBRL(p.totais.recebido)}</strong> ·
                Escritório <strong className="tabular">{formatBRL(p.totais.escritorio)}</strong> ·
                Ricardo{" "}
                <strong className="tabular text-money">{formatBRL(p.totais.ricardo)}</strong>
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {p.categorias.map((cat) => (
                <div key={cat.categoria} className="rounded-md bg-muted/40 px-3 py-2 text-xs">
                  <p className="font-semibold">{cat.rotulo}</p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Recebido</span>
                    <span className="tabular">{formatBRL(cat.recebido)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Escritório</span>
                    <span className="tabular">{formatBRL(cat.escritorio)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Ricardo</span>
                    <span className="tabular font-semibold text-money">
                      {formatBRL(cat.ricardo)}
                    </span>
                  </p>
                </div>
              ))}
            </div>
            <TabelaRecebimentos linhas={p.linhas} />
          </div>
        ))}
        {c.processos.length > 1 ? (
          <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <strong>TOTAL DO CLIENTE</strong> — Recebido {formatBRL(c.totais.recebido)} · Escritório{" "}
            {formatBRL(c.totais.escritorio)} · Ricardo{" "}
            <span className="font-semibold text-money">{formatBRL(c.totais.ricardo)}</span>
          </p>
        ) : null}
      </div>
    </BlocoExpansivel>
  );
}

export function DetalhamentoPorCliente({ linhas }: { linhas: readonly LinhaHonorario[] }) {
  const clientes = useMemo(() => porCliente(linhas), [linhas]);
  const [pagina, setPagina] = useState(0);
  const atual = Math.min(pagina, Math.max(0, Math.ceil(clientes.length / POR_PAGINA_CLIENTES) - 1));
  const visiveis = clientes.slice(atual * POR_PAGINA_CLIENTES, (atual + 1) * POR_PAGINA_CLIENTES);
  return (
    <Secao
      titulo="Detalhamento por cliente"
      descricao={`${clientes.length} cliente(s) · ordenados pelo maior valor recebido · expanda para ver processos, categorias e cada recebimento`}
      testid="detalhamento-clientes"
    >
      {clientes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum recebimento no filtro.</p>
      ) : (
        <div className="space-y-2">
          {visiveis.map((c) => (
            <BlocoCliente key={c.clienteId} c={c} />
          ))}
          <Paginacao
            pagina={atual}
            total={clientes.length}
            porPagina={POR_PAGINA_CLIENTES}
            mudar={setPagina}
          />
        </div>
      )}
    </Secao>
  );
}

export function DetalhamentoRecebimentos({
  linhas,
  totais,
}: {
  linhas: readonly LinhaHonorario[];
  totais: Totais;
}) {
  const [pagina, setPagina] = useState(0);
  const atual = Math.min(pagina, Math.max(0, Math.ceil(linhas.length / POR_PAGINA_LINHAS) - 1));
  return (
    <Secao
      titulo="Detalhamento por recebimento"
      descricao="Cada valor recebido, do mais recente ao mais antigo"
      testid="detalhamento-recebimentos"
    >
      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum recebimento no filtro.</p>
      ) : (
        <div className="space-y-2">
          <TabelaRecebimentos
            linhas={linhas.slice(atual * POR_PAGINA_LINHAS, (atual + 1) * POR_PAGINA_LINHAS)}
            mostrarCliente
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              Total do filtro: <strong className="tabular">{formatBRL(totais.recebido)}</strong> ·
              Escritório <strong className="tabular">{formatBRL(totais.escritorio)}</strong> ·
              Ricardo <strong className="tabular text-money">{formatBRL(totais.ricardo)}</strong>
            </p>
            <Paginacao
              pagina={atual}
              total={linhas.length}
              porPagina={POR_PAGINA_LINHAS}
              mudar={setPagina}
            />
          </div>
        </div>
      )}
    </Secao>
  );
}

// ---------------------------------------------------------------------------
// Conferência do repasse
// ---------------------------------------------------------------------------

export function ConferenciaRepasse({
  linhas,
  totais,
}: {
  linhas: readonly LinhaHonorario[];
  totais: Totais;
}) {
  const clientes = useMemo(() => porCliente(linhas), [linhas]);
  return (
    <Card className="gap-4 border-money/30 p-5" data-testid="conferencia-repasse">
      <h2 className="text-sm font-bold uppercase tracking-wide">
        Repasse Ricardo Friedl — conferência
      </h2>
      <div className="grid gap-3 sm:grid-cols-4">
        <Numero rotulo="Recebimentos considerados" valor={String(totais.quantidade)} />
        <Numero rotulo="Valor-base" valor={formatBRL(totais.recebido)} />
        <Numero
          rotulo="Percentual"
          valor={REGRA_REPASSE.rotulo}
          detalhe={`regra única v${REGRA_REPASSE.versao}`}
        />
        <Numero rotulo="Repasse calculado" valor={formatBRL(totais.ricardo)} destaque />
      </div>
      <p className="text-xs text-muted-foreground">
        O repasse é {REGRA_REPASSE.rotulo} de cada recebimento, arredondado ao centavo, e o total é
        a soma desses repasses. O escritório fica com o valor recebido menos o repasse — por isso
        Recebido = Escritório + Ricardo Friedl, sem diferença de centavos. Valores estimados,
        previstos ou pagos diretamente ao cliente não entram.
      </p>
      {clientes.length ? (
        <BlocoExpansivel aninhado titulo={`Clientes que compõem o repasse (${clientes.length})`}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-center">Recebimentos</TableHead>
                  <TableHead className="text-right">Valor-base</TableHead>
                  <TableHead className="text-right">Escritório</TableHead>
                  <TableHead className="text-right">Repasse</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientes.map((c) => (
                  <TableRow key={c.clienteId}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="text-center tabular">{c.totais.quantidade}</TableCell>
                    <Trio t={c.totais} />
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell className="font-bold">TOTAL</TableCell>
                  <TableCell className="text-center font-bold tabular">
                    {totais.quantidade}
                  </TableCell>
                  <Trio t={totais} forte />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </BlocoExpansivel>
      ) : null}
    </Card>
  );
}

function Numero({
  rotulo,
  valor,
  detalhe,
  destaque,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${destaque ? "border-money/40 bg-money/5" : "border-border bg-muted/30"}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <p className={`tabular text-xl font-bold ${destaque ? "text-money" : ""}`}>{valor}</p>
      {detalhe ? <p className="text-xs text-muted-foreground">{detalhe}</p> : null}
    </div>
  );
}

function Secao({
  titulo,
  descricao,
  children,
  testid,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
  testid?: string;
}) {
  return (
    <Card className="gap-3 p-5" data-testid={testid}>
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wide">{titulo}</h2>
        {descricao ? <p className="text-xs text-muted-foreground">{descricao}</p> : null}
      </div>
      {children}
    </Card>
  );
}
