import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  FileSpreadsheet,
  History,
  Pencil,
  Phone,
  Plus,
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
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import {
  ROTULO_CLASSIFICACAO,
  ROTULO_TIPO_PAGAMENTO,
  type ClassificacaoEntrada,
  type Pagamento,
} from "@/lib/tipos";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/clientes/$clienteId")({
  validateSearch: (search: Record<string, unknown>): { registro?: string } =>
    typeof search["registro"] === "string" ? { registro: search["registro"] } : {},
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

function PerfilCliente() {
  const { clienteId } = Route.useParams();
  const { registro: registroSelecionado } = Route.useSearch();
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
        <Voltar />
        <SecaoVazia
          titulo={error ? "Não foi possível carregar o perfil" : "Cliente não encontrado"}
          descricao={error ? (error as Error).message : "O cliente pode ter sido excluído."}
        />
      </div>
    );
  }

  const { cliente } = perfil;
  const registroAtual =
    perfil.registros.find((r) => r.id === registroSelecionado) ?? perfil.registros[0] ?? null;
  const revisoesAbertas = perfil.revisoes.filter((r) => r.status === "aberta");

  return (
    <div className="space-y-6">
      <div>
        <Voltar />
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
              {cliente.status === "pago" ? <BadgeStatus texto="Já pago" tom="sucesso" /> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DialogPagamento
              clienteFixo={cliente}
              registro={
                registroAtual
                  ? { id: registroAtual.id, rotulo: rotuloRegistro(registroAtual) }
                  : undefined
              }
              trigger={
                <Button variant="outline">
                  <Plus className="size-4" aria-hidden />
                  Registrar pagamento
                </Button>
              }
            />
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

      {revisoesAbertas.length ? <Revisoes perfil={perfil} revisoes={revisoesAbertas} /> : null}

      {/* Blocos expansíveis: informações principais sempre visíveis; secundárias ao expandir. */}
      <BlocoCliente
        key={`${cliente.id}-identificacao`}
        perfil={perfil}
        secao="identificacao"
        inicialAberto
      />
      <BlocoCliente key={`${cliente.id}-contato`} perfil={perfil} secao="contato" />

      <BlocoProcessos
        key={`${cliente.id}-processos`}
        perfil={perfil}
        selecionado={registroAtual?.id ?? null}
        abertoInicial={registroSelecionado ?? null}
        selecionar={(id) =>
          void navigate({
            to: "/clientes/$clienteId",
            params: { clienteId },
            search: { registro: id },
            replace: true,
            resetScroll: false,
          })
        }
      />

      <BlocoInterno key={`${cliente.id}-interno`} perfil={perfil} />

      <BlocoEntradas key={`${cliente.id}-entradas`} perfil={perfil} />

      <OrigemEHistorico perfil={perfil} />
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

function Voltar() {
  return (
    <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
      <Link to="/clientes">
        <ArrowLeft className="size-4" aria-hidden />
        Clientes
      </Link>
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

const GRUPOS_PAGAMENTO: {
  chave: ClassificacaoEntrada | "outros_grupos" | "sem";
  titulo: string;
}[] = [
  { chave: "contratuais", titulo: "Contratuais" },
  { chave: "implantacao", titulo: "Implantação" },
  { chave: "sucumbencia", titulo: "Sucumbência" },
  { chave: "atrasados", titulo: "Atrasados" },
  { chave: "outros_grupos", titulo: "Outras categorias" },
  { chave: "sem", titulo: "Sem categoria" },
];

function grupoDoPagamento(p: Pagamento): (typeof GRUPOS_PAGAMENTO)[number]["chave"] {
  if (!p.classificacao) return "sem";
  if (
    p.classificacao === "contratuais" ||
    p.classificacao === "implantacao" ||
    p.classificacao === "sucumbencia" ||
    p.classificacao === "atrasados"
  )
    return p.classificacao;
  return "outros_grupos";
}

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
// Processos (um cliente pode ter vários)
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

function BlocoProcessos({
  perfil,
  selecionado,
  abertoInicial,
  selecionar,
}: {
  perfil: PerfilRF;
  /** Processo usado no botão "Registrar pagamento" do topo (destacado). */
  selecionado: string | null;
  /** Processo aberto ao carregar (link com ?registro=). */
  abertoInicial: string | null;
  selecionar: (id: string) => void;
}) {
  const bloco = blocoPerfil("processo");
  const linhas = useMemo(() => linhasPorRegistro(perfil), [perfil]);
  const [abertos, setAbertos] = useState<Set<string>>(
    () => new Set(abertoInicial ? [abertoInicial] : []),
  );
  const total = perfil.registros.length;

  const resumo =
    total === 0 ? (
      <span>Nenhum processo registrado.</span>
    ) : (
      <ResumoLinhas
        itens={[
          ...perfil.registros.slice(0, 3).map((r) => {
            const d = dadosDoRegistro(r);
            return resumoDoBloco(bloco.campos, (c) => d[c]).join(" · ") || "Sem número";
          }),
          ...(total > 3 ? [`+ ${total - 3} processo(s)`] : []),
        ]}
      />
    );

  return (
    <BlocoExpansivel titulo={`Processos (${total})`} inicialAberto resumo={resumo}>
      {total === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          Nenhum processo ou atendimento registrado.
        </div>
      ) : (
        <div className="space-y-3 p-4">
          {total > 1 ? (
            <p className="px-1 text-xs text-muted-foreground">
              Cada processo (número + tipo de ação) é um registro próprio dentro da mesma pasta do
              cliente.
            </p>
          ) : null}
          {perfil.registros.map((r) => {
            const d = dadosDoRegistro(r);
            const qtdLinhas = linhas.get(r.id)?.length ?? 0;
            const aberto = abertos.has(r.id);
            const pagamentos = perfil.pagamentos.filter((p) => p.atendimento_id === r.id);
            return (
              <BlocoExpansivel
                key={r.id}
                aninhado
                aberto={aberto}
                aoAlternar={(novo) => {
                  setAbertos((atual) => {
                    const n = new Set(atual);
                    if (novo) n.add(r.id);
                    else n.delete(r.id);
                    return n;
                  });
                  if (novo) selecionar(r.id);
                }}
                className={cn(
                  r.id === selecionado && "border-primary shadow-[inset_3px_0_0_0_var(--primary)]",
                )}
                titulo={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="tabular">{d.numero || "Sem número"}</span>
                    <BadgeEscritorio escritorio={r.escritorio} />
                    {r.revisao_motivo ? (
                      <BadgeStatus texto="Revisar associação" tom="alerta" />
                    ) : null}
                    {qtdLinhas > 1 ? (
                      <BadgeStatus texto={`${qtdLinhas} linhas`} tom="neutro" />
                    ) : null}
                    {pagamentos.length ? (
                      <BadgeStatus
                        texto={`${pagamentos.length} entrada(s) de valor`}
                        tom="sucesso"
                      />
                    ) : null}
                  </span>
                }
                resumo={
                  <ResumoLinhas
                    itens={organizarCampos(bloco.campos, (c) => d[c])
                      .principais.filter((c) => c !== "numero")
                      .map((c) => formatarValor(c, d[c]))}
                  />
                }
              >
                {r.revisao_motivo ? (
                  <div className="flex items-start gap-3 border-b border-border bg-warning-soft px-4 py-3 text-sm text-warning">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <p>
                      {r.revisao_motivo}. Este registro não foi unido a nenhum outro automaticamente
                      — complete o número e o tipo de ação ou revise a associação.
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
                <div className="space-y-4 border-t border-border p-4">
                  <div className="flex justify-end">
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
                  </div>
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
                  {qtdLinhas ? (
                    <LinhasDeOrigem linhas={linhas.get(r.id) ?? []} perfil={perfil} />
                  ) : null}
                </div>
              </BlocoExpansivel>
            );
          })}
        </div>
      )}
    </BlocoExpansivel>
  );
}

// ---------------------------------------------------------------------------
// Informações internas (por processo: pasta, captação, contrato, indicação)
// ---------------------------------------------------------------------------

function BlocoInterno({ perfil }: { perfil: PerfilRF }) {
  const bloco = blocoPerfil("interno");
  const registros = perfil.registros;
  const resumo =
    registros.length === 0 ? (
      <span>Sem processos registrados.</span>
    ) : (
      <ResumoLinhas
        itens={[
          ...registros.slice(0, 3).map((r) => {
            const d = dadosDoRegistro(r);
            return (
              resumoDoBloco(bloco.campos, (c) => d[c]).join(" · ") ||
              `${d.numero || "Sem número"}: sem informações internas`
            );
          }),
          ...(registros.length > 3 ? [`+ ${registros.length - 3} processo(s)`] : []),
        ]}
      />
    );

  return (
    <BlocoExpansivel titulo="Informações Internas" resumo={resumo}>
      {registros.length === 0 ? (
        <div className="px-5 py-6 text-sm text-muted-foreground">
          As informações internas (pasta, captação, contrato e indicação) ficam vinculadas a cada
          processo.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {registros.map((r) => {
            const d = dadosDoRegistro(r);
            return (
              <div key={r.id}>
                {registros.length > 1 ? (
                  <p className="bg-muted/30 px-5 py-2 text-xs font-semibold text-muted-foreground">
                    {rotuloRegistro(r)}
                  </p>
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
              </div>
            );
          })}
        </div>
      )}
    </BlocoExpansivel>
  );
}

// ---------------------------------------------------------------------------
// Entradas de valores (pagamentos efetivamente recebidos)
// ---------------------------------------------------------------------------

function BlocoEntradas({ perfil }: { perfil: PerfilRF }) {
  const { pagamentos, registros } = perfil;
  const total = pagamentos.reduce((s, p) => s + p.valor, 0);
  const porGrupo = GRUPOS_PAGAMENTO.map((g) => {
    const doGrupo = pagamentos.filter((p) => grupoDoPagamento(p) === g.chave);
    return { ...g, qtd: doGrupo.length, soma: doGrupo.reduce((s, p) => s + p.valor, 0) };
  }).filter((g) => g.qtd > 0);
  const idsRegistros = new Set(registros.map((r) => r.id));
  const semRegistro = pagamentos.filter(
    (p) => !p.atendimento_id || !idsRegistros.has(p.atendimento_id),
  );

  const resumo =
    pagamentos.length === 0 ? (
      <span>Nenhuma entrada de valor registrada.</span>
    ) : (
      <ResumoLinhas
        itens={[
          `${pagamentos.length} entrada(s) · Total ${formatBRL(total)}`,
          porGrupo.map((g) => `${g.titulo}: ${formatBRL(g.soma)}`).join(" · "),
        ]}
      />
    );

  return (
    <BlocoExpansivel titulo="Entradas de valores" resumo={resumo}>
      <div className="space-y-4 p-4">
        <p className="text-xs text-muted-foreground">
          Somente valores efetivamente recebidos. O “Valor Estimado do Processo” importado da
          planilha é uma estimativa e não entra aqui.
        </p>
        {pagamentos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma entrada de valor registrada.</p>
        ) : null}
        {registros.map((r) => {
          const doRegistro = pagamentos.filter((p) => p.atendimento_id === r.id);
          if (doRegistro.length === 0) return null;
          return (
            <PagamentosDoRegistro
              key={r.id}
              pagamentos={doRegistro}
              titulo={`Processo ${rotuloRegistro(r)}`}
            />
          );
        })}
        {semRegistro.length ? (
          <Secao
            titulo="Pagamentos sem processo vinculado"
            descricao="Registrados para o cliente sem indicar o processo (ou com processo removido)."
          >
            <TabelaPagamentos pagamentos={semRegistro} />
          </Secao>
        ) : null}
      </div>
    </BlocoExpansivel>
  );
}

function PagamentosDoRegistro({
  pagamentos,
  titulo = "Pagamentos deste registro",
}: {
  pagamentos: Pagamento[];
  titulo?: string;
}) {
  return (
    <Secao
      titulo={titulo}
      descricao="Somente valores efetivamente recebidos. O Valor Estimado do Processo e os demais valores da planilha não são pagamentos."
    >
      {pagamentos.length === 0 ? (
        <div className="px-5 py-6 text-sm text-muted-foreground">
          Nenhum pagamento registrado para este processo.
        </div>
      ) : (
        <div className="space-y-4 px-5 py-4">
          {pagamentos.length > 1 ? (
            <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info-soft px-3 py-2 text-sm font-medium text-info">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              Este benefício possui mais de um pagamento
            </div>
          ) : null}
          {GRUPOS_PAGAMENTO.map((g) => {
            const doGrupo = pagamentos.filter((p) => grupoDoPagamento(p) === g.chave);
            if (doGrupo.length === 0) return null;
            return (
              <div key={g.chave}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.titulo} ({doGrupo.length})
                </p>
                <TabelaPagamentos pagamentos={doGrupo} />
              </div>
            );
          })}
        </div>
      )}
    </Secao>
  );
}

function TabelaPagamentos({ pagamentos }: { pagamentos: Pagamento[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Data</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Forma</TableHead>
            <TableHead>Observação</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagamentos.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="tabular text-sm">{formatDate(p.data_pagamento)}</TableCell>
              <TableCell className="text-right">
                <Valor valor={p.valor} />
              </TableCell>
              <TableCell className="text-sm">
                {p.classificacao ? ROTULO_CLASSIFICACAO[p.classificacao] : "Sem categoria"}
              </TableCell>
              <TableCell className="text-sm">{ROTULO_TIPO_PAGAMENTO[p.tipo] ?? p.tipo}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{p.observacao || "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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

function OrigemEHistorico({ perfil }: { perfil: PerfilRF }) {
  const { cliente, linhas } = perfil;
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
        {perfil.historico.length === 0 ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            Nenhum registro no histórico.
          </div>
        ) : (
          <ol className="max-h-[28rem] divide-y divide-border overflow-y-auto">
            {perfil.historico.map((h) => (
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
