import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  History,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { BadgeStatus } from "@/components/BadgeSimilaridade";
import { BlocoExpansivel, ResumoLinhas } from "@/components/BlocoExpansivel";
import { BotaoExcluirCliente } from "@/components/BotaoExcluirCliente";
import { DialogPagamento } from "@/components/DialogPagamento";
import { SecaoVazia } from "@/components/layout/AppShell";
import { Valor } from "@/components/Valor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BadgeEscritorio, escritoriosDoCliente, useVinculosEscritorio } from "@/lib/escritorio";
import { formatBRL, formatDate, formatDateTime } from "@/lib/format";
import { blocoPerfil, CAMPO_POR_CHAVE, NAO_INFORMADO, type ChaveCampo } from "@/lib/rf/campos";
import {
  dadosDoRegistro,
  editarCampo,
  perfilRFQuery,
  resolverRevisao,
  type PerfilRF,
  type RegistroRF,
  type RevisaoRF,
} from "@/lib/rf/dados";
import { organizarCampos, resumoDoBloco, valorDoCliente } from "@/lib/rf/perfil";
import {
  converterTextoDigitado,
  extrairTelefones,
  formatarValor,
  valorInterpretado,
  valorParaEdicao,
} from "@/lib/rf/valores";
import {
  classificarEntrada,
  definirClientePago,
  definirProcessoPago,
  vincularEntradaProcesso,
} from "@/lib/acoes";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import { fraseQuantidadeEntradas, resumirEntradas } from "@/lib/situacao";
import {
  CLASSIFICACOES_ENTRADA,
  ROTULO_CLASSIFICACAO,
  type ClassificacaoEntrada,
  type Pagamento,
} from "@/lib/tipos";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/clientes/$clienteId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { registro?: string; visao?: "clientes" | "pagos" } => ({
    ...(typeof search["registro"] === "string" ? { registro: search["registro"] } : {}),
    ...(search["visao"] === "clientes" || search["visao"] === "pagos"
      ? { visao: search["visao"] }
      : {}),
  }),
  head: () => ({
    meta: [{ title: "Perfil do cliente — Base de Pagamentos" }],
  }),
  component: PerfilCliente,
});

const ROTULO_ORIGEM: Record<string, string> = {
  ricardo_friedl: "Ricardo Friedl",
  furtado: "Furtado Advogados",
  a_confirmar: "Origem a confirmar",
};

const ROTULO_HISTORICO: Record<string, string> = {
  importacao: "Importação",
  complementacao: "Complementação",
  alteracao: "Alteração",
  observacao: "Observação",
};

function rotuloCampo(campo: string): string {
  if (campo.startsWith("adicional:")) return `Informação adicional: ${campo.slice(10)}`;
  return CAMPO_POR_CHAVE.get(campo as ChaveCampo)?.rotulo ?? campo;
}

function rotuloRegistro(r: RegistroRF): string {
  const d = dadosDoRegistro(r);
  return `${d.numero || "Sem número"} — ${d.tipo_acao || "Tipo de ação não informado"}`;
}

// ---------------------------------------------------------------------------

/** Opção do seletor de processos para valores sem processo vinculado. */
const SEM_PROCESSO = "sem-processo";

type Visao = "clientes" | "pagos";

function PerfilCliente() {
  const { clienteId } = Route.useParams();
  const { registro: registroBuscado, visao } = Route.useSearch();
  const navigate = useNavigate();
  const { data: perfil, isLoading, error } = useQuery(perfilRFQuery(clienteId));
  const vinculos = useVinculosEscritorio();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  if (error || !perfil) {
    return (
      <div>
        <Voltar visao={visao} />
        <SecaoVazia
          titulo={error ? "Não foi possível carregar o perfil" : "Cliente não encontrado"}
          descricao={error ? (error as Error).message : "O cliente pode ter sido excluído."}
        />
      </div>
    );
  }

  const { cliente } = perfil;
  const todos = perfil.registros;
  // Visão de origem: CLIENTES mostra os processos não pagos; JÁ PAGOS, os pagos.
  const daVisao = visao ? todos.filter((r) => (visao === "pagos" ? r.pago : !r.pago)) : todos;
  const visiveis = daVisao.length ? daVisao : todos;
  const idsProcessos = new Set(todos.map((r) => r.id));
  const valoresSemProcesso = perfil.pagamentos.filter(
    (p) => !p.atendimento_id || !idsProcessos.has(p.atendimento_id),
  );
  const opcoes = [
    ...visiveis.map((r) => r.id),
    ...(valoresSemProcesso.length ? [SEM_PROCESSO] : []),
  ];
  // Um processo só: selecionado automaticamente. Vários: o escolhido (ou o primeiro).
  const selecionado =
    registroBuscado && opcoes.includes(registroBuscado) ? registroBuscado : (opcoes[0] ?? null);
  const registroAtual = todos.find((r) => r.id === selecionado) ?? null;
  const revisoesAbertas = perfil.revisoes.filter(
    (r) => r.status === "aberta" && (!r.atendimento_id || r.atendimento_id === registroAtual?.id),
  );
  const pagamentosSelecionados =
    selecionado === SEM_PROCESSO
      ? valoresSemProcesso
      : registroAtual
        ? perfil.pagamentos.filter((p) => p.atendimento_id === registroAtual.id)
        : todos.length === 0
          ? perfil.pagamentos
          : [];

  const qtdPagos = todos.filter((r) => r.pago).length;
  const qtdAbertos = todos.length - qtdPagos;

  const ir = (busca: { registro?: string; visao?: Visao }) =>
    void navigate({
      to: "/clientes/$clienteId",
      params: { clienteId },
      search: busca,
      replace: true,
      resetScroll: false,
    });

  return (
    <div className="space-y-6">
      <div>
        <Voltar visao={visao} />
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Perfil do cliente
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {cliente.nome}
            </h1>
            <p className="mt-1 text-base">
              <span className="text-muted-foreground">CPF: </span>
              <span
                className={cn(
                  "tabular font-semibold",
                  !cliente.cpf && "font-normal text-muted-foreground",
                )}
              >
                {cliente.cpf || NAO_INFORMADO}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {escritoriosDoCliente(cliente, vinculos).map((e) => (
                <BadgeEscritorio key={e} escritorio={e} completo />
              ))}
              {cliente.deleted_at ? <BadgeStatus texto="Arquivado" tom="neutro" /> : null}
              {todos.length ? (
                <>
                  {qtdPagos ? (
                    <BadgeStatus texto={`${qtdPagos} processo(s) pago(s)`} tom="sucesso" />
                  ) : null}
                  {qtdAbertos ? (
                    <BadgeStatus texto={`${qtdAbertos} em tramitação`} tom="neutro" />
                  ) : null}
                </>
              ) : cliente.status === "pago" ? (
                <BadgeStatus texto="Já pago" tom="sucesso" />
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BotaoExcluirCliente
              cliente={{
                id: cliente.id,
                nome: cliente.nome,
                quantidadePagamentos: perfil.pagamentos.length,
              }}
            />
          </div>
        </div>
      </div>

      {/* PROCESSOS logo abaixo do nome e CPF: escolhe o processo exibido no perfil. */}
      <SecaoProcessos
        perfil={perfil}
        visao={visao}
        visiveis={visiveis}
        foraDaVisao={visao ? todos.length - daVisao.length : 0}
        semVisao={Boolean(visao) && daVisao.length === 0}
        valoresSemProcesso={valoresSemProcesso.length}
        selecionado={selecionado}
        selecionar={(id) => ir({ registro: id, ...(visao ? { visao } : {}) })}
        trocarVisao={(v) => ir(v ? { visao: v } : {})}
      />

      {revisoesAbertas.length ? <Revisoes perfil={perfil} revisoes={revisoesAbertas} /> : null}

      {registroAtual ? (
        <BlocoInterno key={`${registroAtual.id}-interno`} registro={registroAtual} />
      ) : null}

      <BlocoValoresRecebidos
        key={`${cliente.id}-${selecionado ?? "todos"}-valores`}
        perfil={perfil}
        pagamentos={pagamentosSelecionados}
        registro={registroAtual}
        semProcesso={selecionado === SEM_PROCESSO}
      />

      <BlocoCliente key={`${cliente.id}-identificacao`} perfil={perfil} secao="identificacao" />
      <BlocoCliente key={`${cliente.id}-contato`} perfil={perfil} secao="contato" />

      <OrigemEHistorico perfil={perfil} registro={registroAtual} />
    </div>
  );
}

/**
 * Parte inferior de cada bloco: campos sem informação, recolhidos por padrão
 * (continuam previstos para preenchimento manual ou futuras importações). Ao
 * salvar um valor, o campo volta à posição habitual; ao apagar, retorna para cá.
 */
function CamposNaoPreenchidos({
  campos,
  todosVazios,
  renderizar,
}: {
  campos: ChaveCampo[];
  todosVazios: boolean;
  renderizar: (chave: ChaveCampo) => ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  if (campos.length === 0) return null;
  return (
    <div>
      {todosVazios ? (
        <div className="px-5 py-4 text-sm text-muted-foreground">
          Nenhum campo deste bloco está preenchido.
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={id}
        className="flex w-full items-center justify-between gap-3 bg-muted/30 px-5 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Campos não preenchidos ({campos.length})
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            aberto && "rotate-180",
          )}
          aria-hidden
        />
        <span className="sr-only">{aberto ? "Recolher" : "Expandir"}</span>
      </button>
      <div id={id} hidden={!aberto} className="divide-y divide-border border-t border-border">
        {campos.map((chave) => renderizar(chave))}
      </div>
    </div>
  );
}

function Voltar({ visao }: { visao?: Visao | undefined }) {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
      {visao === "pagos" ? (
        <Link to="/ja-pagos">
          <ArrowLeft className="size-4" aria-hidden />
          Já pagos
        </Link>
      ) : (
        <Link to="/clientes">
          <ArrowLeft className="size-4" aria-hidden />
          Clientes
        </Link>
      )}
    </Button>
  );
}

function Secao({
  titulo,
  descricao,
  children,
  acao,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
  acao?: ReactNode;
}) {
  return (
    <Card className="gap-0 p-0">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">{titulo}</h2>
          {descricao ? <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p> : null}
        </div>
        {acao}
      </div>
      <dl className="divide-y divide-border">{children}</dl>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Campo com edição
// ---------------------------------------------------------------------------

function CampoEditavel({
  chave,
  rotulo,
  valor,
  salvar,
  obrigatorio,
}: {
  chave: ChaveCampo | string;
  rotulo?: string;
  valor: string | null | undefined;
  salvar: (valor: string | null) => Promise<void>;
  obrigatorio?: boolean;
}) {
  const sincronizar = useSincronizar();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const campo = CAMPO_POR_CHAVE.get(chave as ChaveCampo);
  const nome = rotulo ?? campo?.rotulo ?? chave;
  const vazio = valor === null || valor === undefined || String(valor).trim() === "";

  const mutation = useMutation({
    mutationFn: async () => {
      const bruto = texto.trim();
      if (obrigatorio && !bruto) throw new Error("O nome do cliente é obrigatório.");
      const convertido = campo && bruto ? converterTextoDigitado(campo.chave, bruto) : null;
      await salvar(bruto ? (convertido?.valor ?? bruto) : null);
      return convertido?.avisos ?? [];
    },
    onSuccess: async (avisos) => {
      await sincronizar(EVENTOS.CLIENTE_ATUALIZADO);
      setEditando(false);
      if (avisos.length) toast.warning(avisos.join(" "));
      else toast.success(`${nome} atualizado.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const telefones = campo?.tipo === "telefone" ? extrairTelefones(valor) : [];
  const exibicao = campo
    ? formatarValor(campo.chave, valor)
    : vazio
      ? NAO_INFORMADO
      : String(valor);
  const naoInterpretado = campo && !vazio && !valorInterpretado(campo.chave, valor);

  return (
    <div className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(10rem,14rem)_1fr_auto] sm:items-center sm:gap-4">
      <dt className="text-xs font-medium text-muted-foreground">
        {nome}
        {obrigatorio ? <span className="text-danger"> *</span> : null}
      </dt>
      <dd className="min-w-0 text-sm">
        {editando ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <Input
              autoFocus
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="h-9"
              aria-label={nome}
              placeholder={
                campo?.tipo === "data"
                  ? "dd/mm/aaaa"
                  : campo?.tipo === "datahora"
                    ? "dd/mm/aaaa hh:mm:ss"
                    : ""
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditando(false);
              }}
            />
            <Button
              type="submit"
              size="icon"
              className="size-9 shrink-0"
              disabled={mutation.isPending}
              aria-label="Salvar"
            >
              <Check className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0"
              onClick={() => setEditando(false)}
              aria-label="Cancelar"
            >
              <X className="size-4" />
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "break-words",
                vazio ? "text-muted-foreground" : "font-medium text-foreground",
                campo?.tipo === "moeda" && !vazio && "tabular",
                campo?.tipo === "email" && "break-all",
              )}
            >
              {exibicao}
            </span>
            {naoInterpretado ? (
              <span
                className="inline-flex items-center gap-1 text-xs text-warning"
                title="Valor mantido como estava na planilha para correção posterior."
              >
                <AlertTriangle className="size-3.5" aria-hidden />
                verificar
              </span>
            ) : null}
            {telefones.map((t) => (
              <a
                key={t}
                href={`tel:${t}`}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground hover:bg-muted/70"
              >
                <Phone className="size-3" aria-hidden />
                {t}
              </a>
            ))}
          </div>
        )}
      </dd>
      {!editando ? (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start sm:justify-self-end"
          onClick={() => {
            setTexto(campo ? valorParaEdicao(campo.chave, valor) : (valor ?? ""));
            setEditando(true);
          }}
          aria-label={`Editar ${nome}`}
        >
          <Pencil className="size-3.5" aria-hidden />
          Editar
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Processos e atendimentos
// ---------------------------------------------------------------------------

/**
 * Conteúdo de um bloco: principais e secundárias preenchidas e, por último,
 * os campos vazios recolhidos em "Campos não preenchidos".
 */
function CamposDoBloco({
  campos,
  valor,
  renderizar,
}: {
  campos: ChaveCampo[];
  valor: (chave: ChaveCampo) => string | null | undefined;
  renderizar: (chave: ChaveCampo) => ReactNode;
}) {
  const org = organizarCampos(campos, valor);
  return (
    <dl className="divide-y divide-border">
      {[...org.principais, ...org.secundarios].map((c) => renderizar(c))}
      <CamposNaoPreenchidos
        campos={org.vazios}
        todosVazios={org.principais.length + org.secundarios.length === 0}
        renderizar={renderizar}
      />
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Blocos do cliente (Identificação e Contato)
// ---------------------------------------------------------------------------

function BlocoCliente({
  perfil,
  secao,
  inicialAberto,
}: {
  perfil: PerfilRF;
  secao: "identificacao" | "contato";
  inicialAberto?: boolean;
}) {
  const { cliente } = perfil;
  const bloco = blocoPerfil(secao);
  const valor = valorDoCliente(cliente);
  return (
    <BlocoExpansivel
      titulo={bloco.titulo}
      inicialAberto={inicialAberto}
      resumo={<ResumoLinhas itens={resumoDoBloco(bloco.campos, valor)} />}
    >
      <CamposDoBloco
        campos={bloco.campos}
        valor={valor}
        renderizar={(chave) => (
          <CampoEditavel
            key={chave}
            chave={chave}
            valor={valor(chave)}
            obrigatorio={chave === "nome"}
            salvar={(v) =>
              editarCampo({ entidade: "cliente", id: cliente.id, campo: chave, valor: v })
            }
          />
        )}
      />
    </BlocoExpansivel>
  );
}

// ---------------------------------------------------------------------------
// Processos (um cliente pode ter vários; cada um com a sua situação de pagamento)
// ---------------------------------------------------------------------------

function linhasPorRegistro(perfil: PerfilRF) {
  const m = new Map<string, PerfilRF["linhas"]>();
  for (const l of perfil.linhas) {
    if (!l.atendimento_id) continue;
    m.set(l.atendimento_id, [...(m.get(l.atendimento_id) ?? []), l]);
  }
  return m;
}

function salvarCampoRegistro(r: RegistroRF, chave: ChaveCampo) {
  return (v: string | null) =>
    editarCampo({
      entidade: "registro",
      id: r.id,
      campo: chave,
      valor: v,
      registro: dadosDoRegistro(r),
    });
}

const ROTULO_VISAO: Record<Visao, string> = { clientes: "CLIENTES", pagos: "JÁ PAGOS" };

function SecaoProcessos({
  perfil,
  visao,
  visiveis,
  foraDaVisao,
  semVisao,
  valoresSemProcesso,
  selecionado,
  selecionar,
  trocarVisao,
}: {
  perfil: PerfilRF;
  visao: Visao | undefined;
  /** Processos exibidos (os da visão de origem). */
  visiveis: RegistroRF[];
  /** Processos do cliente que estão na outra visão. */
  foraDaVisao: number;
  /** A visão pedida não tem processos (exibindo todos). */
  semVisao: boolean;
  valoresSemProcesso: number;
  selecionado: string | null;
  selecionar: (id: string) => void;
  trocarVisao: (visao: Visao | undefined) => void;
}) {
  const sincronizar = useSincronizar();
  const linhas = useMemo(() => linhasPorRegistro(perfil), [perfil]);
  const { cliente } = perfil;
  const registro = perfil.registros.find((r) => r.id === selecionado) ?? null;
  const outra: Visao = visao === "pagos" ? "clientes" : "pagos";

  const mutacaoCliente = useMutation({
    mutationFn: (pago: boolean) => definirClientePago(cliente.id, pago),
    onSuccess: async (_, pago) => {
      await sincronizar(EVENTOS.CLIENTE_MARCADO_COMO_PAGO);
      toast.success(pago ? "Cliente movido para JÁ PAGOS." : "Cliente voltou para CLIENTES.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const titulo =
    visao === "pagos"
      ? "Processos pagos"
      : visao === "clientes"
        ? "Processos em tramitação"
        : "Processos";

  return (
    <Card className="gap-0 p-0">
      <div className="flex flex-col gap-1 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">
          {titulo} ({visiveis.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          {perfil.registros.length === 0
            ? "Nenhum processo registrado para este cliente."
            : visiveis.length > 1
              ? "Selecione um processo pelo número. Todas as informações abaixo passam a mostrar somente o processo selecionado."
              : "As informações abaixo são somente deste processo."}
        </p>
        {semVisao ? (
          <p className="text-xs text-warning">
            Nenhum processo deste cliente está em {visao ? ROTULO_VISAO[visao] : ""} — exibindo
            todos os processos.
          </p>
        ) : null}
        {foraDaVisao > 0 && !semVisao ? (
          <p className="text-xs text-muted-foreground">
            Este cliente também tem {foraDaVisao} processo(s) em {ROTULO_VISAO[outra]} (mesmo
            cadastro).{" "}
            <button
              type="button"
              className="font-semibold text-primary underline-offset-2 hover:underline"
              onClick={() => trocarVisao(outra)}
            >
              Ver processos em {ROTULO_VISAO[outra]}
            </button>{" "}
            ·{" "}
            <button
              type="button"
              className="font-semibold text-primary underline-offset-2 hover:underline"
              onClick={() => trocarVisao(undefined)}
            >
              Ver todos
            </button>
          </p>
        ) : null}
      </div>

      {perfil.registros.length === 0 ? (
        <div className="flex flex-col gap-3 px-5 py-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            Cliente sem processo: a situação de pagamento é a do próprio cadastro (
            {cliente.status === "pago" ? "JÁ PAGOS" : "CLIENTES"}).
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={mutacaoCliente.isPending || Boolean(cliente.deleted_at)}
            onClick={() => mutacaoCliente.mutate(cliente.status !== "pago")}
          >
            {cliente.status === "pago" ? (
              <>
                <RotateCcw className="size-4" aria-hidden />
                Voltar para CLIENTES
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" aria-hidden />
                Marcar como pago
              </>
            )}
          </Button>
        </div>
      ) : null}

      {visiveis.length || valoresSemProcesso ? (
        <div
          role="tablist"
          aria-label="Processos do cliente"
          className="flex flex-wrap gap-2 border-b border-border px-5 py-4"
        >
          {visiveis.map((r) => {
            const d = dadosDoRegistro(r);
            const ativo = r.id === selecionado;
            return (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => selecionar(r.id)}
                className={cn(
                  "flex min-w-48 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  ativo
                    ? "border-primary bg-primary/10 shadow-[inset_3px_0_0_0_var(--primary)]"
                    : "border-border hover:bg-muted/50",
                )}
              >
                <span className={cn("tabular text-sm", ativo ? "font-bold" : "font-semibold")}>
                  {d.numero || "Sem número"}
                </span>
                {d.tipo_acao ? (
                  <span className="text-xs text-muted-foreground">{d.tipo_acao}</span>
                ) : null}
                <BadgeStatus
                  texto={r.pago ? "Pago" : "Em tramitação"}
                  tom={r.pago ? "sucesso" : "neutro"}
                />
              </button>
            );
          })}
          {valoresSemProcesso ? (
            <button
              type="button"
              role="tab"
              aria-selected={selecionado === SEM_PROCESSO}
              onClick={() => selecionar(SEM_PROCESSO)}
              className={cn(
                "flex min-w-48 flex-col items-start gap-1 rounded-lg border border-dashed px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selecionado === SEM_PROCESSO
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <span className="text-sm font-semibold">Valores sem processo</span>
              <span className="text-xs text-muted-foreground">
                {valoresSemProcesso} valor(es) ainda não vinculado(s)
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {registro ? (
        <ProcessoSelecionado
          key={registro.id}
          perfil={perfil}
          registro={registro}
          linhas={linhas.get(registro.id) ?? []}
        />
      ) : selecionado === SEM_PROCESSO ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          Valores recebidos que ainda não pertencem a nenhum processo. Eles não entram nos totais de
          nenhum processo — vincule cada valor ao processo correto em “Valores recebidos”.
        </p>
      ) : null}
    </Card>
  );
}

/** Dados e situação de pagamento do processo selecionado (somente dele). */
function ProcessoSelecionado({
  perfil,
  registro: r,
  linhas,
}: {
  perfil: PerfilRF;
  registro: RegistroRF;
  linhas: PerfilRF["linhas"];
}) {
  const sincronizar = useSincronizar();
  const bloco = blocoPerfil("processo");
  const d = dadosDoRegistro(r);
  const mutacao = useMutation({
    mutationFn: (pago: boolean) => definirProcessoPago(r.id, pago),
    onSuccess: async (_, pago) => {
      await sincronizar(EVENTOS.CLIENTE_MARCADO_COMO_PAGO);
      toast.success(
        pago
          ? `Processo ${d.numero || "sem número"} movido para JÁ PAGOS. Os demais processos não foram alterados.`
          : `Processo ${d.numero || "sem número"} voltou para CLIENTES.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Processo selecionado
          </p>
          <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <span className="tabular">{d.numero || "Sem número"}</span>
            <BadgeEscritorio escritorio={r.escritorio} />
            <BadgeStatus
              texto={
                r.pago
                  ? `Pago${r.pago_em ? ` em ${formatDate(r.pago_em)}` : ""} · JÁ PAGOS`
                  : "Em tramitação · CLIENTES"
              }
              tom={r.pago ? "sucesso" : "neutro"}
            />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DialogPagamento
            clienteFixo={perfil.cliente}
            registro={{ id: r.id, rotulo: rotuloRegistro(r) }}
            trigger={
              <Button variant="outline" size="sm">
                <Plus className="size-4" aria-hidden />
                Registrar pagamento neste processo
              </Button>
            }
          />
          <Button
            size="sm"
            variant={r.pago ? "outline" : "default"}
            className={cn(!r.pago && "bg-success text-white hover:bg-success/90")}
            disabled={mutacao.isPending}
            onClick={() => mutacao.mutate(!r.pago)}
          >
            {r.pago ? (
              <>
                <RotateCcw className="size-4" aria-hidden />
                Voltar para CLIENTES
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4" aria-hidden />
                Marcar processo como pago
              </>
            )}
          </Button>
        </div>
      </div>
      {r.revisao_motivo ? (
        <div className="flex items-start gap-3 border-b border-border bg-warning-soft px-5 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            {r.revisao_motivo}. Este registro não foi unido a nenhum outro automaticamente —
            complete o número e o tipo de ação ou revise a associação.
          </p>
        </div>
      ) : null}
      <CamposDoBloco
        campos={bloco.campos}
        valor={(c) => d[c]}
        renderizar={(chave) => (
          <CampoEditavel
            key={`${r.id}-${chave}`}
            chave={chave}
            valor={d[chave]}
            salvar={salvarCampoRegistro(r, chave)}
          />
        )}
      />
      {Object.keys(r.informacoes_adicionais ?? {}).length || linhas.length ? (
        <div className="space-y-4 border-t border-border p-4">
          {Object.keys(r.informacoes_adicionais ?? {}).length ? (
            <Secao
              titulo="Informações adicionais"
              descricao="Colunas extras da planilha, preservadas como recebidas."
            >
              {Object.entries(r.informacoes_adicionais).map(([k, v]) => (
                <CampoEditavel
                  key={k}
                  chave={k}
                  rotulo={k}
                  valor={v}
                  salvar={(novo) =>
                    editarCampo({ entidade: "adicional", id: r.id, campo: k, valor: novo })
                  }
                />
              ))}
            </Secao>
          ) : null}
          {linhas.length ? <LinhasDeOrigem linhas={linhas} perfil={perfil} /> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Informações internas (do processo selecionado: pasta, captação, contrato, indicação)
// ---------------------------------------------------------------------------

function BlocoInterno({ registro: r }: { registro: RegistroRF }) {
  const bloco = blocoPerfil("interno");
  const d = dadosDoRegistro(r);
  const resumo = (
    <ResumoLinhas
      itens={
        resumoDoBloco(bloco.campos, (c) => d[c]).length
          ? resumoDoBloco(bloco.campos, (c) => d[c])
          : [`${d.numero || "Sem número"}: sem informações internas`]
      }
    />
  );
  return (
    <BlocoExpansivel titulo={`Informações Internas — ${d.numero || "Sem número"}`} resumo={resumo}>
      <CamposDoBloco
        campos={bloco.campos}
        valor={(c) => d[c]}
        renderizar={(chave) => (
          <CampoEditavel
            key={`${r.id}-${chave}`}
            chave={chave}
            valor={d[chave]}
            salvar={salvarCampoRegistro(r, chave)}
          />
        )}
      />
    </BlocoExpansivel>
  );
}

// ---------------------------------------------------------------------------
// Valores recebidos (entradas individuais; nunca o Valor Estimado do Processo)
// ---------------------------------------------------------------------------

const CATEGORIAS_OFICIAIS: ClassificacaoEntrada[] = ["contratuais", "atrasados", "sucumbencia"];

function origemDoPagamento(p: Pagamento): string {
  const o = (p.dados_origem ?? {}) as { arquivo?: string; linha?: number };
  if (p.importacao_id || p.chave_importacao)
    return `Importação${o.arquivo ? ` · ${o.arquivo}` : ""}${
      (o.linha ?? p.linha_importacao) ? `, linha ${o.linha ?? p.linha_importacao}` : ""
    }`;
  return p.usuario_cadastro ? `Lançamento manual · ${p.usuario_cadastro}` : "Lançamento manual";
}

/**
 * Valores recebidos SOMENTE do processo selecionado (ou os valores ainda sem
 * processo). Valores de processos diferentes nunca são somados juntos.
 */
function BlocoValoresRecebidos({
  perfil,
  pagamentos,
  registro,
  semProcesso,
}: {
  perfil: PerfilRF;
  pagamentos: Pagamento[];
  registro: RegistroRF | null;
  semProcesso: boolean;
}) {
  const { registros } = perfil;
  const numeroSel = registro ? dadosDoRegistro(registro).numero || "Sem número" : null;
  const alvoFrase = registro
    ? "este processo"
    : semProcesso
      ? "os valores sem processo"
      : "este cliente";
  const resumo = resumirEntradas(pagamentos);
  const semCategoria = resumo.porClassificacao.sem_classificacao;
  const registroPorId = new Map(registros.map((r) => [r.id, r]));
  const ordenados = [...pagamentos].sort(
    (a, b) =>
      a.data_pagamento.localeCompare(b.data_pagamento) ||
      (a.linha_importacao ?? 0) - (b.linha_importacao ?? 0),
  );

  const linhasResumo =
    pagamentos.length === 0
      ? ["Nenhum valor recebido registrado."]
      : [
          `Total recebido: ${formatBRL(resumo.total)}`,
          fraseQuantidadeEntradas(resumo.quantidade, alvoFrase),
          ...CATEGORIAS_OFICIAIS.filter((c) => resumo.porClassificacao[c].quantidade > 0).map(
            (c) => `${ROTULO_CLASSIFICACAO[c]}: ${formatBRL(resumo.porClassificacao[c].valor)}`,
          ),
          ...(semCategoria.quantidade
            ? [
                `Sem categoria: ${formatBRL(semCategoria.valor)} (${semCategoria.quantidade} a classificar)`,
              ]
            : []),
        ];

  return (
    <BlocoExpansivel
      titulo={
        numeroSel
          ? `Valores recebidos — processo ${numeroSel}`
          : semProcesso
            ? "Valores recebidos — sem processo vinculado"
            : "Valores recebidos"
      }
      inicialAberto={semCategoria.quantidade > 0 || semProcesso}
      resumo={<ResumoLinhas itens={linhasResumo} />}
    >
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Total recebido
            </p>
            <p className="tabular text-lg font-bold text-money">{formatBRL(resumo.total)}</p>
            <p className="text-xs text-muted-foreground">
              {fraseQuantidadeEntradas(resumo.quantidade, alvoFrase)}
            </p>
          </div>
          {CATEGORIAS_OFICIAIS.map((c) => (
            <div key={c} className="rounded-lg border border-border px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {ROTULO_CLASSIFICACAO[c]}
              </p>
              <p className="tabular text-base font-semibold">
                {formatBRL(resumo.porClassificacao[c].valor)}
              </p>
              <p className="text-xs text-muted-foreground">
                {resumo.porClassificacao[c].quantidade} valor(es)
              </p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Somente valores efetivamente recebidos, cada um com sua própria categoria. O “Valor
            Estimado do Processo” é uma estimativa e não entra aqui.
          </p>
          {!semProcesso ? (
            <DialogPagamento
              clienteFixo={perfil.cliente}
              registro={
                registro ? { id: registro.id, rotulo: rotuloRegistro(registro) } : undefined
              }
              trigger={
                <Button variant="outline" size="sm">
                  <Plus className="size-4" aria-hidden />
                  {registro ? "Lançar valor recebido neste processo" : "Lançar valor recebido"}
                </Button>
              }
            />
          ) : null}
        </div>
        {pagamentos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum valor recebido registrado
            {registro
              ? registro.pago
                ? " para este processo — ele está em JÁ PAGOS sem valor informado. Use “Lançar valor recebido neste processo” para informar os valores."
                : " para este processo."
              : perfil.cliente.status === "pago"
                ? " — o cliente está em JÁ PAGOS sem valor informado. Use “Lançar valor recebido” para informar os valores."
                : "."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="min-w-44">Tipo do valor</TableHead>
                  <TableHead>Processo</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Observação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordenados.map((p) => {
                  const reg = p.atendimento_id ? registroPorId.get(p.atendimento_id) : null;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="tabular text-sm">
                        {formatDate(p.data_pagamento)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Valor valor={p.valor} />
                      </TableCell>
                      <TableCell>
                        <SeletorCategoria pagamento={p} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {semProcesso && registros.length ? (
                          <VincularProcesso pagamento={p} registros={registros} />
                        ) : reg ? (
                          rotuloRegistro(reg)
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {origemDoPagamento(p)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.observacao || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </BlocoExpansivel>
  );
}

/** Vincula um valor sem processo a um processo do mesmo cliente. */
function VincularProcesso({
  pagamento,
  registros,
}: {
  pagamento: Pagamento;
  registros: RegistroRF[];
}) {
  const sincronizar = useSincronizar();
  const mutation = useMutation({
    mutationFn: (id: string) => vincularEntradaProcesso(pagamento.id, id),
    onSuccess: async () => {
      await sincronizar(EVENTOS.ENTRADA_CLASSIFICADA);
      toast.success("Valor vinculado ao processo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Select value="" disabled={mutation.isPending} onValueChange={(v) => mutation.mutate(v)}>
      <SelectTrigger
        className="h-8 min-w-44 border-warning text-warning"
        aria-label={`Vincular o valor de ${formatBRL(pagamento.valor)} a um processo`}
      >
        <SelectValue placeholder="Vincular a processo…" />
      </SelectTrigger>
      <SelectContent>
        {registros.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {rotuloRegistro(r)}
            {r.pago ? " (pago)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Categoria de UM valor: alterar só atualiza a entrada (nunca cria outra). */
function SeletorCategoria({ pagamento }: { pagamento: Pagamento }) {
  const sincronizar = useSincronizar();
  const mutation = useMutation({
    mutationFn: (c: ClassificacaoEntrada | null) => classificarEntrada(pagamento.id, c),
    onSuccess: async () => {
      await sincronizar(EVENTOS.ENTRADA_CLASSIFICADA);
      toast.success("Categoria do valor atualizada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const atual =
    pagamento.classificacao && CATEGORIAS_OFICIAIS.includes(pagamento.classificacao)
      ? pagamento.classificacao
      : "nenhuma";
  return (
    <Select
      value={atual}
      disabled={mutation.isPending}
      onValueChange={(v) => mutation.mutate(v === "nenhuma" ? null : (v as ClassificacaoEntrada))}
    >
      <SelectTrigger
        className={cn("h-8", atual === "nenhuma" && "border-warning text-warning")}
        aria-label={`Tipo do valor de ${formatBRL(pagamento.valor)}`}
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
  );
}

function LinhasDeOrigem({ linhas, perfil }: { linhas: PerfilRF["linhas"]; perfil: PerfilRF }) {
  const [aberta, setAberta] = useState<string | null>(linhas.length === 1 ? null : null);
  return (
    <Secao
      titulo={`Linhas da planilha neste registro (${linhas.length})`}
      descricao={
        linhas.length > 1
          ? "Linhas com o mesmo número e tipo de ação foram reunidas aqui. Cada linha mantém seus próprios valores."
          : "Conteúdo original recebido na importação."
      }
    >
      {linhas.map((l) => {
        const imp = l.importacao_id ? perfil.importacoes.get(l.importacao_id) : null;
        const expandida = aberta === l.id;
        return (
          <div key={l.id} className="px-5 py-3">
            <button
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm"
              onClick={() => setAberta(expandida ? null : l.id)}
              aria-expanded={expandida}
            >
              <span className="inline-flex items-center gap-2 font-medium">
                <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
                {l.arquivo_nome ?? "Arquivo"} · aba {l.aba ?? "—"} · linha {l.linha}
              </span>
              <span className="text-xs text-muted-foreground">
                Importada em {formatDateTime(imp?.created_at ?? l.created_at)} ·{" "}
                {expandida ? "ocultar" : "ver valores"}
              </span>
            </button>
            {expandida ? (
              <div className="mt-3 grid gap-x-6 gap-y-1 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-2">
                {Object.entries(l.valores).map(([k, v]) => (
                  <p key={k}>
                    <span className="text-muted-foreground">{rotuloCampo(k)}:</span> {v}
                  </p>
                ))}
                {Object.entries(l.extras).map(([k, v]) => (
                  <p key={`x-${k}`}>
                    <span className="text-muted-foreground">{k} (adicional):</span> {v}
                  </p>
                ))}
                {l.avisos.length ? (
                  <p className="text-warning sm:col-span-2">Avisos: {l.avisos.join(" ")}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </Secao>
  );
}

// ---------------------------------------------------------------------------
// Revisões
// ---------------------------------------------------------------------------

function Revisoes({ perfil, revisoes }: { perfil: PerfilRF; revisoes: RevisaoRF[] }) {
  const sincronizar = useSincronizar();
  const mutation = useMutation({
    mutationFn: ({ r, acao }: { r: RevisaoRF; acao: "aplicar" | "manter" | "revisado" }) =>
      resolverRevisao(r, acao),
    onSuccess: async () => {
      await sincronizar(EVENTOS.CLIENTE_ATUALIZADO);
      toast.success("Revisão registrada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const registroPorId = new Map(perfil.registros.map((r) => [r.id, r]));

  return (
    <Card className="gap-0 border-warning/40 p-0">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <AlertTriangle className="size-4 text-warning" aria-hidden />
        <h2 className="text-base font-semibold">Itens para revisar ({revisoes.length})</h2>
      </div>
      <ul className="divide-y divide-border">
        {revisoes.map((r) => {
          const outro = r.outro_cliente_id ? perfil.outrosClientes.get(r.outro_cliente_id) : null;
          const reg = r.atendimento_id ? registroPorId.get(r.atendimento_id) : null;
          return (
            <li
              key={r.id}
              className="flex flex-col gap-3 px-5 py-3 text-sm lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="min-w-0 space-y-0.5">
                {r.tipo === "divergencia" ? (
                  <>
                    <p className="font-medium">
                      {rotuloCampo(r.campo ?? "")} divergente
                      {reg ? (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {rotuloRegistro(reg)}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground">
                      Atual:{" "}
                      <span className="text-foreground">
                        {formatarValor(r.campo ?? "", r.valor_atual)}
                      </span>{" "}
                      · Na linha {r.origem?.linha ?? "?"}:{" "}
                      <span className="font-semibold text-foreground">
                        {formatarValor(r.campo ?? "", r.valor_novo)}
                      </span>
                    </p>
                  </>
                ) : r.tipo === "duplicidade" ? (
                  <>
                    <p className="font-medium">Possível duplicidade</p>
                    <p className="text-muted-foreground">
                      {r.descricao}{" "}
                      {outro ? (
                        <Link
                          to="/clientes/$clienteId"
                          params={{ clienteId: outro.id }}
                          className="font-medium text-foreground underline"
                        >
                          {outro.nome} (CPF: {outro.cpf || NAO_INFORMADO})
                        </Link>
                      ) : null}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">
                      Associação a revisar{reg ? ` · ${rotuloRegistro(reg)}` : ""}
                    </p>
                    <p className="text-muted-foreground">{r.descricao}</p>
                  </>
                )}
                {r.origem?.arquivo ? (
                  <p className="text-xs text-muted-foreground">
                    Origem: {r.origem.arquivo}, aba {r.origem.aba ?? "—"}, linha{" "}
                    {r.origem.linha ?? "—"}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {r.tipo === "divergencia" ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ r, acao: "manter" })}
                    >
                      Manter atual
                    </Button>
                    <Button
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate({ r, acao: "aplicar" })}
                    >
                      Usar valor da linha
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ r, acao: "revisado" })}
                  >
                    Marcar como revisado
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Origem e histórico
// ---------------------------------------------------------------------------

function OrigemEHistorico({ perfil, registro }: { perfil: PerfilRF; registro: RegistroRF | null }) {
  const { cliente } = perfil;
  // Com processo selecionado: só as linhas e o histórico DELE (+ alterações do cadastro do cliente).
  const linhas = registro
    ? perfil.linhas.filter((l) => l.atendimento_id === registro.id)
    : perfil.linhas;
  const historico = registro
    ? perfil.historico.filter((h) => !h.atendimento_id || h.atendimento_id === registro.id)
    : perfil.historico;
  const arquivos = [...new Set(linhas.map((l) => l.arquivo_nome).filter(Boolean))] as string[];
  const primeira = linhas[0];
  const imp = primeira?.importacao_id ? perfil.importacoes.get(primeira.importacao_id) : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Secao titulo="Origem da importação">
        <Linha
          rotulo="Origem"
          valor={ROTULO_ORIGEM[cliente.escritorio_origem] ?? cliente.origem_importacao}
        />
        <Linha rotulo="Nome do arquivo importado" valor={arquivos.join("; ")} />
        <Linha
          rotulo="Aba e linha de origem"
          valor={
            linhas.length
              ? linhas.map((l) => `aba ${l.aba ?? "—"}, linha ${l.linha}`).join("; ")
              : null
          }
        />
        <Linha
          rotulo="Data da importação"
          valor={
            imp
              ? formatDateTime(imp.created_at)
              : cliente.data_importacao
                ? formatDateTime(cliente.data_importacao)
                : null
          }
        />
        <Linha rotulo="Cadastrado em" valor={formatDateTime(cliente.created_at)} />
      </Secao>

      <Secao
        titulo="Histórico de complementações e alterações"
        acao={<History className="size-4 text-muted-foreground" aria-hidden />}
      >
        {historico.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            Nenhum registro no histórico.
          </div>
        ) : (
          <ol className="max-h-[28rem] divide-y divide-border overflow-y-auto">
            {historico.map((h) => (
              <li
                key={h.id}
                className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-start sm:gap-3"
              >
                <span className="shrink-0 tabular text-xs text-muted-foreground sm:w-32">
                  {formatDateTime(h.created_at)}
                </span>
                <span className="shrink-0">
                  <BadgeStatus
                    texto={ROTULO_HISTORICO[h.categoria] ?? h.categoria}
                    tom={
                      h.categoria === "alteracao"
                        ? "alerta"
                        : h.categoria === "importacao"
                          ? "sucesso"
                          : "neutro"
                    }
                  />
                </span>
                <span className="min-w-0 break-words">{traduzirCampos(h.texto)}</span>
              </li>
            ))}
          </ol>
        )}
      </Secao>
    </div>
  );
}

/** Troca a chave técnica do campo pelo rótulo ("valor_captacao" → "Valor da captação"). */
function traduzirCampos(texto: string): string {
  return texto.replace(
    /Campo "([^"]+)"/g,
    (_, c: string) => `Campo "${rotuloCampo(c === "cpf_reclamante" ? "cpf_reclamante" : c)}"`,
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  const vazio = !valor || !String(valor).trim();
  return (
    <div className="grid gap-1 px-5 py-3 sm:grid-cols-[minmax(10rem,14rem)_1fr] sm:gap-4">
      <dt className="text-xs font-medium text-muted-foreground">{rotulo}</dt>
      <dd className={cn("text-sm", vazio ? "text-muted-foreground" : "font-medium")}>
        {vazio ? NAO_INFORMADO : valor}
      </dd>
    </div>
  );
}
