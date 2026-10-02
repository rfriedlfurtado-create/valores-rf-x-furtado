/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda sem tipos gerados (types.ts) */
/**
 * Revisão das PESSOAS identificadas na planilha: escolha do cliente
 * correspondente, criação de novo cadastro, união de registros do mesmo
 * cliente e separação de nome/complemento.
 */

import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  Link2,
  Search,
  Users,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BadgeEscritorio } from "@/lib/escritorio";
import { formatBRL } from "@/lib/format";
import {
  ROTULO_CATEGORIA,
  type AnaliseFurtado,
  type CategoriaFinanceira,
} from "@/lib/furtado/modelo";
import type {
  ClienteBaseFurtado,
  DecisaoPessoa,
  DecisoesFurtado,
  PessoaPlano,
  PlanoFurtado,
} from "@/lib/furtado/planejador";
import { normalizarNome } from "@/lib/similarity";

import { BadgeCorrespondencia, IconePendencia, rotuloPendencia } from "./PartesRevisao";

type Filtro = "revisar" | "prontos" | "todos";

export function RevisaoPessoas({
  plano,
  clientes,
  decisoes,
  analise,
  onDecidir,
  onDecidirVarios,
  onUnir,
}: {
  plano: PlanoFurtado;
  clientes: ClienteBaseFurtado[];
  decisoes: DecisoesFurtado;
  analise: AnaliseFurtado;
  onDecidir: (ref: string, d: DecisaoPessoa | null) => void;
  onDecidirVarios: (lista: { ref: string; decisao: DecisaoPessoa }[]) => void;
  onUnir: (de: string, para: string | null) => void;
}) {
  const [filtro, setFiltro] = useState<Filtro>(plano.resumo.revisar ? "revisar" : "todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  const termo = normalizarNome(busca);
  const lista = plano.pessoas.filter((p) => {
    if (filtro === "revisar" && p.pronta) return false;
    if (filtro === "prontos" && !p.pronta) return false;
    if (
      termo &&
      !p.nomeNormalizado.includes(termo) &&
      !p.processos.some((x) => x.includes(busca.replace(/\D/g, "") || "§"))
    )
      return false;
    return true;
  });

  // Nome idêntico a um único cadastro e nenhuma outra pendência bloqueante
  const identicos = plano.pessoas.filter(
    (p) =>
      !p.pronta &&
      p.correspondencia === "nome_identico" &&
      p.candidatos.length === 1 &&
      p.pendencias.filter((x) => x.bloqueante).every((x) => x.tipo === "associacao_cliente"),
  );
  const semCadastro = plano.pessoas.filter(
    (p) =>
      !p.pronta &&
      !p.semIdentificacao &&
      !p.incompleto &&
      p.correspondencia === "semelhante" &&
      p.pendencias.filter((x) => x.bloqueante).every((x) => x.tipo === "associacao_cliente"),
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={filtro === "revisar" ? "secondary" : "ghost"}
            onClick={() => setFiltro("revisar")}
          >
            A revisar ({plano.resumo.revisar})
          </Button>
          <Button
            size="sm"
            variant={filtro === "prontos" ? "secondary" : "ghost"}
            onClick={() => setFiltro("prontos")}
          >
            Prontos ({plano.pessoas.length - plano.resumo.revisar})
          </Button>
          <Button
            size="sm"
            variant={filtro === "todos" ? "secondary" : "ghost"}
            onClick={() => setFiltro("todos")}
          >
            Todos ({plano.pessoas.length})
          </Button>
        </div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome ou processo..."
            className="h-9 pl-8"
          />
        </div>
      </div>

      {identicos.length || semCadastro.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
          <CircleAlert className="size-4 text-amber-600" aria-hidden />
          <span className="text-muted-foreground">
            Ações em lote (você continua podendo ajustar cada linha):
          </span>
          {identicos.length ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onDecidirVarios(
                  identicos.map((p) => ({
                    ref: p.ref,
                    decisao: { acao: "vincular", clienteId: p.candidatos[0]!.clienteId },
                  })),
                )
              }
            >
              <Link2 className="size-4" aria-hidden />
              Confirmar {identicos.length} nome(s) idêntico(s) como o mesmo cliente
            </Button>
          ) : null}
          {semCadastro.length ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onDecidirVarios(
                  semCadastro.map((p) => ({ ref: p.ref, decisao: { acao: "criar" } })),
                )
              }
            >
              Criar novo cadastro para {semCadastro.length} com nome apenas semelhante
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs">
            <tr>
              <th className="w-6 px-2 py-2" />
              <th className="px-2 py-2 font-semibold">Pessoa na planilha</th>
              <th className="px-2 py-2 font-semibold">Correspondência</th>
              <th className="min-w-72 px-2 py-2 font-semibold">Decisão</th>
              <th className="px-2 py-2 font-semibold">Conteúdo</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <Fragment key={p.ref}>
                <tr className="border-t border-border align-top">
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      aria-label="Detalhes"
                      onClick={() => setAberto(aberto === p.ref ? null : p.ref)}
                    >
                      {aberto === p.ref ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-start gap-1.5">
                      {p.pronta ? (
                        <CheckCircle2
                          className="mt-0.5 size-4 shrink-0 text-green-600"
                          aria-label="Pronto"
                        />
                      ) : (
                        <CircleAlert
                          className="mt-0.5 size-4 shrink-0 text-amber-600"
                          aria-label="A revisar"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold">{p.nome}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.abas.map((a) => a.trim()).join(" · ")} · {p.blocos.length} bloco(s)
                          {p.processos.length ? ` · ${p.processos.length} processo(s)` : ""}
                          {p.cpfs.length ? ` · CPF ${p.cpfs.join(", ")}` : ""}
                        </p>
                        {p.nomesOriginais.some((n) => n.trim() !== p.nome) ? (
                          <p className="text-[11px] text-muted-foreground">
                            Original:{" "}
                            {p.nomesOriginais
                              .slice(0, 3)
                              .map((n) => `"${n.replace(/\s+/g, " ").trim()}"`)
                              .join(", ")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <BadgeCorrespondencia tipo={p.correspondencia} />
                    <p className="mt-1 max-w-xs text-[11px] text-muted-foreground">{p.motivo}</p>
                  </td>
                  <td className="px-2 py-2">
                    <SeletorDecisao
                      pessoa={p}
                      clientes={clientes}
                      decisao={decisoes.pessoas?.[p.ref]}
                      onDecidir={onDecidir}
                    />
                    {p.pendencias
                      .filter((x) => x.tipo === "possivel_mesma_pessoa")
                      .map((x, i) => {
                        const outros = (
                          (x.dados?.["pessoas"] as string[] | undefined) ?? []
                        ).filter((r) => r !== p.ref);
                        const outro = outros[0];
                        if (!outro) return null;
                        const unido = decisoes.unioes?.[p.ref] === outro;
                        const nomeOutro =
                          plano.pessoas.find((y) => y.ref === outro)?.nome ??
                          (x.dados?.["nomes"] as string[] | undefined)?.find((n) => n !== p.nome) ??
                          outro;
                        return (
                          <div
                            key={i}
                            className="mt-1 flex flex-wrap items-center gap-1 text-[11px]"
                          >
                            <Users className="size-3.5 text-muted-foreground" aria-hidden />
                            Pode ser "{nomeOutro}".
                            <Button
                              size="sm"
                              variant={unido ? "secondary" : "outline"}
                              className="h-6 px-2 text-[11px]"
                              onClick={() => onUnir(p.ref, unido ? null : outro)}
                            >
                              {unido ? "Desfazer união" : "Unir (mesma pessoa)"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => onDecidir(p.ref, { acao: "criar" })}
                            >
                              São pessoas diferentes
                            </Button>
                          </div>
                        );
                      })}
                    {(p.incompleto ||
                      p.semIdentificacao ||
                      p.pendencias.some((x) => x.tipo === "separacao_nome")) &&
                    decisoes.pessoas?.[p.ref]?.acao === "criar" ? (
                      <Input
                        className="mt-1 h-8 text-xs"
                        placeholder="Nome completo do cliente"
                        defaultValue={
                          decisoes.pessoas?.[p.ref]?.nome ?? (p.semIdentificacao ? "" : p.nome)
                        }
                        onBlur={(e) =>
                          onDecidir(p.ref, { acao: "criar", nome: e.target.value.trim() || null })
                        }
                      />
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-muted-foreground">
                    {[
                      p.resumo.atendimentos && `${p.resumo.atendimentos} atendimento(s)`,
                      p.resumo.beneficios && `${p.resumo.beneficios} benefício(s)`,
                      p.resumo.lancamentos && `${p.resumo.lancamentos} valor(es)`,
                      p.resumo.requisicoes && `${p.resumo.requisicoes} RPV/prec./TED`,
                      p.resumo.cobrancas && `${p.resumo.cobrancas} cobrança(s)`,
                      p.resumo.jaExistentes && `${p.resumo.jaExistentes} já existente(s)`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {p.pendencias.length ? (
                      <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                        {p.pendencias.length} pendência(s)
                      </p>
                    ) : null}
                  </td>
                </tr>
                {aberto === p.ref ? (
                  <tr className="border-t border-border bg-muted/20">
                    <td />
                    <td colSpan={4} className="px-2 py-3">
                      <DetalhePessoa pessoa={p} analise={analise} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {lista.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            Nenhum registro neste filtro.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SeletorDecisao({
  pessoa,
  clientes,
  decisao,
  onDecidir,
}: {
  pessoa: PessoaPlano;
  clientes: ClienteBaseFurtado[];
  decisao: DecisaoPessoa | undefined;
  onDecidir: (ref: string, d: DecisaoPessoa | null) => void;
}) {
  const [buscando, setBuscando] = useState(false);
  const [termo, setTermo] = useState("");
  const valor = decisao
    ? decisao.acao === "vincular"
      ? `vincular:${decisao.clienteId}`
      : decisao.acao
    : pessoa.pronta
      ? pessoa.acao === "vincular"
        ? `vincular:${pessoa.clienteId}`
        : pessoa.acao
      : "pendente";
  const opcoes = new Map<string, string>();
  for (const c of pessoa.candidatos)
    opcoes.set(
      c.clienteId,
      `${c.nome} — ${c.motivo}${c.percentual ? ` (${c.percentual.toFixed(0)}%)` : ""}`,
    );
  if (decisao?.acao === "vincular" && decisao.clienteId && !opcoes.has(decisao.clienteId)) {
    opcoes.set(
      decisao.clienteId,
      clientes.find((c) => c.id === decisao.clienteId)?.nome ?? decisao.clienteId,
    );
  }
  const encontrados = useMemo(() => {
    const t = normalizarNome(termo);
    if (t.length < 3) return [];
    return clientes.filter((c) => c.nome_normalizado.includes(t)).slice(0, 12);
  }, [termo, clientes]);
  const candidato = pessoa.candidatos.find((c) => `vincular:${c.clienteId}` === valor);

  return (
    <div className="grid gap-1">
      <Select
        value={valor}
        onValueChange={(v) => {
          if (v === "pendente") onDecidir(pessoa.ref, null);
          else if (v === "criar" || v === "ignorar") onDecidir(pessoa.ref, { acao: v });
          else if (v === "__buscar") setBuscando(true);
          else onDecidir(pessoa.ref, { acao: "vincular", clienteId: v.replace("vincular:", "") });
        }}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pendente">Decidir depois (fica pendente no lote)</SelectItem>
          {!pessoa.semIdentificacao || decisao?.nome ? (
            <SelectItem value="criar">Criar novo cliente</SelectItem>
          ) : (
            <SelectItem value="criar">Criar novo cliente (informe o nome)</SelectItem>
          )}
          {[...opcoes.entries()].map(([id, rotulo]) => (
            <SelectItem key={id} value={`vincular:${id}`}>
              Vincular a {rotulo}
            </SelectItem>
          ))}
          <SelectItem value="__buscar">Escolher outro cliente...</SelectItem>
          <SelectItem value="ignorar">Manter só no lote (não associar)</SelectItem>
        </SelectContent>
      </Select>
      {candidato?.escritorio ? (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          Cadastro existente: <BadgeEscritorio escritorio={candidato.escritorio} /> — a origem dele
          não será alterada.
        </p>
      ) : null}
      {buscando ? (
        <div className="grid gap-1 rounded-md border border-border bg-background p-2">
          <Input
            autoFocus
            className="h-8 text-xs"
            placeholder="Digite parte do nome (3+ letras)"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
          />
          <div className="max-h-40 overflow-auto">
            {encontrados.map((c) => (
              <button
                key={c.id}
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                onClick={() => {
                  onDecidir(pessoa.ref, { acao: "vincular", clienteId: c.id });
                  setBuscando(false);
                  setTermo("");
                }}
              >
                {c.nome}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
            onClick={() => setBuscando(false)}
          >
            Fechar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DetalhePessoa({ pessoa, analise }: { pessoa: PessoaPlano; analise: AnaliseFurtado }) {
  const p = pessoa.payload;
  const blocos = analise.blocos.filter((b) => pessoa.blocos.includes(b.ref));
  const principais = (p.lancamentos_financeiros as Record<string, any>[]).filter(
    (l) => l["versao"] === 1,
  );
  return (
    <div className="grid gap-3 text-xs">
      <div>
        <p className="font-semibold">Blocos de origem</p>
        <ul className="mt-1 grid gap-0.5">
          {blocos.map((b) => (
            <li key={b.ref}>
              <span className="font-medium">
                {b.aba.trim()}!{b.intervalo}
              </span>
              {b.nome ? (
                <span className="text-muted-foreground">
                  {" "}
                  — "{b.nome.original.replace(/\s+/g, " ").trim()}"
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {p.atendimentos.length ? (
        <div>
          <p className="font-semibold">Processos e atendimentos</p>
          <ul className="mt-1 grid gap-0.5">
            {(p.atendimentos as Record<string, any>[]).map((a) => (
              <li key={a["chave"]}>
                {a["numero_processo"] ?? "sem número"} · {a["servico"] ?? "—"}{" "}
                {a["tribunal"] ? `· ${a["tribunal"]}` : ""}{" "}
                {a["situacao"] ? `· ${a["situacao"]}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {principais.length ? (
        <div>
          <p className="font-semibold">Valores (coluna principal)</p>
          <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
            {principais.map((l) => (
              <li key={l["chave"]}>
                {ROTULO_CATEGORIA[l["categoria"] as CategoriaFinanceira]}
                {l["percentual"] ? ` (${l["percentual"]}%)` : ""}:{" "}
                <strong className="tabular">
                  {l["valor"] !== null ? formatBRL(l["valor"]) : (l["ausencia_declarada"] ?? "—")}
                </strong>{" "}
                <span className="text-muted-foreground">[{l["natureza"]}]</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p.beneficios.length ? (
        <div>
          <p className="font-semibold">Benefícios</p>
          <ul className="mt-1 grid gap-0.5">
            {(p.beneficios as Record<string, any>[]).map((b) => (
              <li key={b["chave"]}>
                {b["especie"] ?? "—"} {b["nb"] ? `· NB ${b["nb"]}` : ""} · DIB{" "}
                {b["dib_texto"] ?? "—"} · DIP {b["dip_texto"] ?? "—"} · DCB {b["dcb_texto"] ?? "—"}{" "}
                · RMI {b["rmi_texto"] ?? "—"} · RMA {b["rma_texto"] ?? "—"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {pessoa.pendencias.length ? (
        <div>
          <p className="font-semibold">Pendências</p>
          <ul className="mt-1 grid gap-1">
            {pessoa.pendencias.map((x, i) => (
              <li key={i} className="flex gap-1.5">
                <IconePendencia bloqueante={x.bloqueante} />
                <span>
                  <strong>{rotuloPendencia(x.tipo)}:</strong> {x.descricao}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-muted-foreground">
        {p.historico_cliente.length} anotação(ões) irão para o histórico; {p.requisicoes.length}{" "}
        requisição(ões), {p.acordos.length} acordo(s), {p.cobrancas.length} cobrança(s),{" "}
        {p.dados_bancarios.length} dado(s) bancário(s), {p.representantes.length} representante(s).
      </p>
    </div>
  );
}
