/**
 * PLANEJADOR da importação Furtado: transforma a análise (blocos) em
 * PESSOAS, identifica o cliente correspondente na base, evita duplicidades
 * (dentro do arquivo, entre abas e em reimportações) e monta o payload que
 * o banco grava de forma idempotente.
 *
 * Regras de identificação (em ordem):
 *   CPF · número do processo · NB → correspondência segura (se o nome for compatível)
 *   cliente já vinculado à Furtado com o mesmo nome → segura (reimportação)
 *   nome idêntico → candidato (requer confirmação; homônimos existem)
 *   nome semelhante → candidatos para revisão
 *   nenhum → novo cliente
 * Nome igual ou parecido, sozinho, NUNCA une automaticamente.
 */

import {
  compararNomes,
  LIMIARES_PADRAO,
  normalizarNome,
  tokensDoNome,
  type LimiaresSimilaridade,
} from "../similarity";
import {
  CATEGORIAS_HONORARIOS,
  type AnaliseFurtado,
  type Bloco,
  type CategoriaFinanceira,
  type LancamentoRascunho,
  type PendenciaRascunho,
  type PerfilAba,
} from "./modelo";
import { centavos, chaveTexto, hashTexto } from "./texto";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ClienteBaseFurtado {
  id: string;
  nome: string;
  nome_normalizado: string;
  cpf: string | null;
  numero_processo: string | null;
  escritorio_origem?: string | null;
}

export interface BaseFurtado {
  clientes: ClienteBaseFurtado[];
  variacoes: { cliente_id: string; nome_normalizado: string }[];
  /** Clientes já vinculados ao escritório Furtado. */
  vinculosFurtado: string[];
  processos: { cliente_id: string; processo_digitos: string }[];
  nbs: { cliente_id: string; nb_digitos: string }[];
  rejeicoes?: { nome_1_normalizado: string; nome_2_normalizado: string }[];
  /** Registros já existentes (por chave_origem), para conflitos/reimportação. */
  existentes?: RegistroExistente[];
}

export interface RegistroExistente {
  tabela: string;
  id: string;
  chave_origem: string;
  campos: Record<string, unknown>;
}

export type AcaoPessoa = "criar" | "vincular" | "pendente" | "ignorar";

export interface DecisaoPessoa {
  acao: AcaoPessoa;
  clienteId?: string | null;
  nome?: string | null;
}

export interface DecisoesFurtado {
  pessoas?: Record<string, DecisaoPessoa>;
  /** pessoaRef → pessoaRef de destino (unir pessoas do arquivo). */
  unioes?: Record<string, string>;
}

export type TipoCorrespondencia =
  | "cpf"
  | "processo"
  | "nb"
  | "furtado_anterior"
  | "nome_identico"
  | "semelhante"
  | "nenhuma"
  | "conflito"
  | "decisao";

export interface Candidato {
  clienteId: string;
  nome: string;
  percentual: number;
  motivo: string;
  escritorio: string | null;
}

export interface PayloadPessoa {
  cliente: { cpf: string | null; numero_processo: string | null; origem_importacao: string };
  variacoes: { nome: string; nome_normalizado: string }[];
  atendimentos: Record<string, unknown>[];
  beneficios: Record<string, unknown>[];
  lancamentos_financeiros: Record<string, unknown>[];
  requisicoes: Record<string, unknown>[];
  acordos: Record<string, unknown>[];
  cobrancas: Record<string, unknown>[];
  dados_bancarios: Record<string, unknown>[];
  representantes: Record<string, unknown>[];
  historico_cliente: Record<string, unknown>[];
}

export interface PessoaPlano {
  ref: string;
  nome: string;
  nomeNormalizado: string;
  nomesOriginais: string[];
  blocos: string[];
  abas: string[];
  cpfs: string[];
  processos: string[];
  nbs: string[];
  incompleto: boolean;
  semIdentificacao: boolean;
  acao: AcaoPessoa;
  clienteId: string | null;
  clienteNome: string | null;
  correspondencia: TipoCorrespondencia;
  pronta: boolean;
  motivo: string;
  candidatos: Candidato[];
  pendencias: PendenciaRascunho[];
  payload: PayloadPessoa;
  resumo: ResumoPessoa;
}

export interface ResumoPessoa {
  atendimentos: number;
  beneficios: number;
  lancamentos: number;
  requisicoes: number;
  acordos: number;
  cobrancas: number;
  parcelas: number;
  pagamentosIdentificados: number;
  porCategoria: Partial<Record<CategoriaFinanceira, number>>;
  jaExistentes: number;
}

export interface PlanoFurtado {
  pessoas: PessoaPlano[];
  pendencias: PendenciaRascunho[];
  resumo: {
    pessoas: number;
    novos: number;
    complementar: number;
    revisar: number;
    ignoradas: number;
    semIdentificacao: number;
    atendimentos: number;
    beneficios: number;
    lancamentos: number;
    requisicoes: number;
    acordos: number;
    cobrancas: number;
    parcelas: number;
    pagamentosIdentificados: number;
    porCategoria: Partial<Record<CategoriaFinanceira, number>>;
    informacoesAdicionais: number;
    conflitos: number;
    pendenciasAbertas: number;
    pendenciasBloqueantes: number;
    jaExistentes: number;
  };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

class UniaoBusca {
  private pai = new Map<string, string>();
  achar(x: string): string {
    if (!this.pai.has(x)) this.pai.set(x, x);
    const p = this.pai.get(x)!;
    if (p === x) return x;
    const r = this.achar(p);
    this.pai.set(x, r);
    return r;
  }
  unir(a: string, b: string): void {
    const ra = this.achar(a);
    const rb = this.achar(b);
    if (ra !== rb) this.pai.set(rb, ra);
  }
}

const PERFIS_EXECUCAO: PerfilAba[] = ["previsao_execucao", "cumprimento", "precatorio"];

function digitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function nomesCompativeis(a: string, b: string, limiares: LimiaresSimilaridade): boolean {
  if (a === b) return true;
  const ta = tokensDoNome(a);
  const tb = tokensDoNome(b);
  const [menor, maior] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (menor.length >= 2 && menor.every((t) => maior.includes(t))) return true;
  return compararNomes(a, b, limiares).percentual >= limiares.possivel;
}

function iso(d: { iso: string | null } | null): string | null {
  return d?.iso ?? null;
}

function semCelulas<T extends { celulas?: string[] }>(x: T): Omit<T, "celulas"> {
  const { celulas: _c, ...resto } = x;
  return resto;
}

// ---------------------------------------------------------------------------
// Agrupamento de blocos em pessoas
// ---------------------------------------------------------------------------

interface GrupoInterno {
  ref: string;
  blocos: Bloco[];
  nomeNormalizado: string;
  nome: string;
}

function refPessoa(nomeNormalizado: string): string {
  return `p:${nomeNormalizado.replace(/\s+/g, "-")}`;
}

/** Processo "próprio" do bloco: o que está em célula de processo (não só mencionado). */
function processosProprios(b: Bloco, analise: AnaliseFurtado): string[] {
  return b.dados.processos
    .filter((p) => {
      const d = analise.destinos.get(p.celula);
      return (
        d?.ref === "atendimento.numero_processo" ||
        b.perfil === "pedido_ted" ||
        b.perfil === "acordos"
      );
    })
    .map((p) => p.digitos);
}

export function agruparPessoas(
  analise: AnaliseFurtado,
  decisoes: DecisoesFurtado,
  limiares: LimiaresSimilaridade,
): { grupos: GrupoInterno[]; pendencias: PendenciaRascunho[] } {
  const pendencias: PendenciaRascunho[] = [];
  const uf = new UniaoBusca();
  const porRef = new Map<string, Bloco[]>();
  const nomeDaRef = new Map<string, string>();

  for (const b of analise.blocos) {
    if (b.tipo === "modelo_vazio" || b.tipo === "elemento_arquivo") continue;
    let ref: string;
    let nome: string;
    if (b.nome) {
      nome = b.nome.nome;
      const nn = normalizarNome(nome);
      ref = refPessoa(nn);
    } else {
      ref = `b:${b.ref}`;
      nome = `(sem identificação) ${b.aba.trim()}!${b.intervalo}`;
    }
    const lista = porRef.get(ref) ?? [];
    lista.push(b);
    porRef.set(ref, lista);
    if (!nomeDaRef.has(ref) || nome.length > nomeDaRef.get(ref)!.length) nomeDaRef.set(ref, nome);
    uf.achar(ref);
  }

  // Uniões automáticas seguras: mesmo processo (ou NB) com nomes compatíveis.
  const porProcesso = new Map<string, Set<string>>();
  const porNB = new Map<string, Set<string>>();
  for (const [ref, blocos] of porRef) {
    if (ref.startsWith("b:")) continue;
    for (const b of blocos) {
      for (const p of processosProprios(b, analise)) {
        const s = porProcesso.get(p) ?? new Set();
        s.add(ref);
        porProcesso.set(p, s);
      }
      for (const nb of b.dados.nbs) {
        const d = digitos(nb);
        const s = porNB.get(d) ?? new Set();
        s.add(ref);
        porNB.set(d, s);
      }
    }
  }
  for (const [ident, refs] of [...porProcesso.entries(), ...porNB.entries()]) {
    const lista = [...refs];
    for (let i = 1; i < lista.length; i++) {
      const a = lista[0]!;
      const b = lista[i]!;
      const na = normalizarNome(nomeDaRef.get(a)!);
      const nb = normalizarNome(nomeDaRef.get(b)!);
      if (nomesCompativeis(na, nb, limiares)) {
        uf.unir(a, b);
      } else {
        pendencias.push({
          tipo: "conflito_dado",
          bloqueante: false,
          descricao: `O identificador ${ident} aparece para nomes diferentes: "${nomeDaRef.get(a)}" e "${nomeDaRef.get(b)}". Não foram unidos.`,
          celulas: [],
          pessoaRef: b,
          dados: { identificador: ident, pessoas: [a, b] },
        });
      }
    }
  }
  // Uniões decididas pelo usuário
  for (const [de, para] of Object.entries(decisoes.unioes ?? {})) {
    if (porRef.has(de) && porRef.has(para)) uf.unir(para, de);
  }

  const grupos = new Map<string, GrupoInterno>();
  for (const [ref, blocos] of porRef) {
    const raiz = uf.achar(ref);
    const g = grupos.get(raiz) ?? { ref: raiz, blocos: [], nomeNormalizado: "", nome: "" };
    g.blocos.push(...blocos);
    grupos.set(raiz, g);
  }
  for (const g of grupos.values()) {
    // Nome mais completo do grupo (preserva a grafia original)
    const nomes = g.blocos.filter((b) => b.nome).map((b) => b.nome!.nome);
    const escolhido =
      decisoes.pessoas?.[g.ref]?.nome?.trim() ||
      (nomes.length
        ? [...nomes].sort(
            (a, b) =>
              tokensDoNome(normalizarNome(b)).length - tokensDoNome(normalizarNome(a)).length ||
              b.length - a.length,
          )[0]!
        : nomeDaRef.get(g.ref)!);
    g.nome = escolhido;
    g.nomeNormalizado = normalizarNome(escolhido);
    g.blocos.sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  }
  return { grupos: [...grupos.values()], pendencias };
}

// ---------------------------------------------------------------------------
// Correspondência com a base
// ---------------------------------------------------------------------------

interface ResultadoCorrespondencia {
  tipo: TipoCorrespondencia;
  clienteId: string | null;
  candidatos: Candidato[];
  motivo: string;
  segura: boolean;
}

export function corresponder(
  g: GrupoInterno,
  ids: { cpfs: string[]; processos: string[]; nbs: string[] },
  base: BaseFurtado,
  limiares: LimiaresSimilaridade,
  indices: IndicesBase,
): ResultadoCorrespondencia {
  const nome = g.nomeNormalizado;
  const fortes = new Map<string, string[]>(); // clienteId → motivos
  const add = (id: string, motivo: string) => fortes.set(id, [...(fortes.get(id) ?? []), motivo]);
  for (const c of ids.cpfs)
    for (const id of indices.porCpf.get(digitos(c)) ?? []) add(id, `CPF ${c}`);
  for (const p of ids.processos)
    for (const id of indices.porProcesso.get(p) ?? []) add(id, `processo ${p}`);
  for (const nb of ids.nbs)
    for (const id of indices.porNB.get(digitos(nb)) ?? []) add(id, `NB ${nb}`);

  const candidato = (id: string, motivo: string): Candidato => {
    const c = indices.porId.get(id)!;
    return {
      clienteId: id,
      nome: c.nome,
      percentual: compararNomes(nome, c.nome_normalizado, limiares).percentual,
      motivo,
      escritorio: c.escritorio_origem ?? null,
    };
  };

  if (fortes.size === 1) {
    const [id, motivos] = [...fortes.entries()][0]!;
    const cli = indices.porId.get(id)!;
    const variacoes = indices.variacoesPorCliente.get(id) ?? [];
    const compat =
      nomesCompativeis(nome, cli.nome_normalizado, limiares) ||
      variacoes.some((v) => nomesCompativeis(nome, v, limiares));
    const tipo: TipoCorrespondencia = motivos[0]!.startsWith("CPF")
      ? "cpf"
      : motivos[0]!.startsWith("processo")
        ? "processo"
        : "nb";
    if (compat) {
      return {
        tipo,
        clienteId: id,
        candidatos: [candidato(id, motivos.join(", "))],
        motivo: `Mesmo ${motivos.join(", ")}`,
        segura: true,
      };
    }
    return {
      tipo: "conflito",
      clienteId: null,
      candidatos: [candidato(id, motivos.join(", "))],
      motivo: `${motivos.join(", ")} pertence a "${cli.nome}", com nome diferente. Verifique.`,
      segura: false,
    };
  }
  if (fortes.size > 1) {
    // Um identificador compartilhado (ex.: NB copiado por engano) não deve
    // impedir a escolha quando o nome é idêntico e há outro identificador exclusivo.
    const iguais = [...fortes.entries()].filter(([id]) => {
      const cli = indices.porId.get(id)!;
      return (
        cli.nome_normalizado === nome || (indices.variacoesPorCliente.get(id) ?? []).includes(nome)
      );
    });
    if (iguais.length === 1) {
      const [id, motivos] = iguais[0]!;
      const outros = new Set([...fortes.entries()].filter(([o]) => o !== id).flatMap(([, m]) => m));
      const exclusivos = motivos.filter((m) => !outros.has(m));
      if (exclusivos.length) {
        return {
          tipo: exclusivos[0]!.startsWith("CPF")
            ? "cpf"
            : exclusivos[0]!.startsWith("processo")
              ? "processo"
              : "nb",
          clienteId: id,
          candidatos: [...fortes.entries()].map(([cid, m]) => candidato(cid, m.join(", "))),
          motivo: `Mesmo nome e ${exclusivos.join(", ")} (outro identificador é compartilhado com outro cadastro — verifique)`,
          segura: true,
        };
      }
    }
    return {
      tipo: "conflito",
      clienteId: null,
      candidatos: [...fortes.entries()].map(([id, m]) => candidato(id, m.join(", "))),
      motivo: "Identificadores apontam para cadastros diferentes.",
      segura: false,
    };
  }

  // Já importado anteriormente pela Furtado com este nome (reimportação)
  const variantes = [
    nome,
    ...g.blocos.filter((b) => b.nome).map((b) => normalizarNome(b.nome!.nome)),
  ];
  const identicos = new Set(
    variantes.flatMap((v) => [
      ...(indices.porNome.get(v) ?? []),
      ...(indices.porVariacao.get(v) ?? []),
    ]),
  );
  const furtado = [...identicos].filter((id) => indices.vinculosFurtado.has(id));
  if (furtado.length === 1) {
    return {
      tipo: "furtado_anterior",
      clienteId: furtado[0]!,
      candidatos: [candidato(furtado[0]!, "já vinculado à Furtado Advogados com este nome")],
      motivo: "Cliente já identificado em importação anterior da Furtado Advogados",
      segura: true,
    };
  }
  if (identicos.size >= 1) {
    const lista = [...identicos].map((id) => candidato(id, "nome idêntico"));
    return {
      tipo: "nome_identico",
      clienteId: identicos.size === 1 ? lista[0]!.clienteId : null,
      candidatos: lista,
      motivo:
        identicos.size === 1
          ? "Nome idêntico a um cadastro existente — confirme se é a mesma pessoa"
          : `${identicos.size} cadastros com o mesmo nome (homônimos) — escolha o correto`,
      segura: false,
    };
  }
  // Semelhantes
  const tokens = tokensDoNome(nome);
  const vistos = new Set<string>();
  const sem: Candidato[] = [];
  for (const t of tokens) {
    for (const id of indices.porToken.get(t) ?? []) {
      if (vistos.has(id)) continue;
      vistos.add(id);
      const cli = indices.porId.get(id)!;
      if (indices.rejeitados.has(`${nome}|${cli.nome_normalizado}`)) continue;
      const r = compararNomes(nome, cli.nome_normalizado, limiares);
      const subconjunto = nomesCompativeis(nome, cli.nome_normalizado, {
        ...limiares,
        possivel: 101,
      });
      if (r.percentual >= limiares.possivel || subconjunto) {
        sem.push({
          clienteId: id,
          nome: cli.nome,
          percentual: r.percentual,
          motivo: subconjunto ? "nome contido" : "nome semelhante",
          escritorio: cli.escritorio_origem ?? null,
        });
      }
    }
  }
  if (sem.length) {
    sem.sort((a, b) => b.percentual - a.percentual);
    return {
      tipo: "semelhante",
      clienteId: null,
      candidatos: sem.slice(0, 6),
      motivo:
        "Há cadastros com nome semelhante — confirme se é a mesma pessoa ou crie um novo cliente",
      segura: false,
    };
  }
  return {
    tipo: "nenhuma",
    clienteId: null,
    candidatos: [],
    motivo: "Nenhum cadastro correspondente: novo cliente",
    segura: true,
  };
}

export interface IndicesBase {
  porId: Map<string, ClienteBaseFurtado>;
  porCpf: Map<string, string[]>;
  porProcesso: Map<string, string[]>;
  porNB: Map<string, string[]>;
  porNome: Map<string, string[]>;
  porVariacao: Map<string, string[]>;
  porToken: Map<string, string[]>;
  variacoesPorCliente: Map<string, string[]>;
  vinculosFurtado: Set<string>;
  rejeitados: Set<string>;
  existentesPorChave: Map<string, RegistroExistente>;
}

export function indexarBase(base: BaseFurtado): IndicesBase {
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    if (!k) return;
    const l = m.get(k) ?? [];
    if (!l.includes(v)) l.push(v);
    m.set(k, l);
  };
  const ind: IndicesBase = {
    porId: new Map(),
    porCpf: new Map(),
    porProcesso: new Map(),
    porNB: new Map(),
    porNome: new Map(),
    porVariacao: new Map(),
    porToken: new Map(),
    variacoesPorCliente: new Map(),
    vinculosFurtado: new Set(base.vinculosFurtado),
    rejeitados: new Set(),
    existentesPorChave: new Map(
      (base.existentes ?? []).map((e) => [`${e.tabela}:${e.chave_origem}`, e]),
    ),
  };
  for (const c of base.clientes) {
    ind.porId.set(c.id, c);
    const cpf = digitos(c.cpf);
    if (cpf.length === 11) push(ind.porCpf, cpf, c.id);
    const proc = digitos(c.numero_processo);
    if (proc.length === 20) push(ind.porProcesso, proc, c.id);
    push(ind.porNome, c.nome_normalizado, c.id);
    for (const t of tokensDoNome(c.nome_normalizado)) push(ind.porToken, t, c.id);
  }
  for (const v of base.variacoes) {
    if (!ind.porId.has(v.cliente_id)) continue;
    push(ind.porVariacao, v.nome_normalizado, v.cliente_id);
    push(ind.variacoesPorCliente, v.cliente_id, v.nome_normalizado);
  }
  for (const p of base.processos)
    if (ind.porId.has(p.cliente_id)) push(ind.porProcesso, p.processo_digitos, p.cliente_id);
  for (const n of base.nbs)
    if (ind.porId.has(n.cliente_id)) push(ind.porNB, n.nb_digitos, n.cliente_id);
  for (const r of base.rejeicoes ?? []) {
    ind.rejeitados.add(`${r.nome_1_normalizado}|${r.nome_2_normalizado}`);
    ind.rejeitados.add(`${r.nome_2_normalizado}|${r.nome_1_normalizado}`);
  }
  return ind;
}

// ---------------------------------------------------------------------------
// Montagem do payload (deduplicado)
// ---------------------------------------------------------------------------

function chaveAtendimento(
  b: Bloco,
  ordemNaAba: number,
  analise: AnaliseFurtado,
  ancoras: Map<Bloco, string>,
): string | null {
  const proprios = processosProprios(b, analise);
  if (proprios.length) return `proc:${proprios[0]}`;
  if (PERFIS_EXECUCAO.includes(b.perfil))
    return ancoras.get(b) ?? `exec:${chaveTexto(b.aba)}:o${ordemNaAba}`;
  const ben = b.dados.beneficios[0];
  const benKey = ben
    ? ben.nb
      ? digitos(ben.nb)
      : ben.especieCodigo && (ben.dib?.iso || ben.dibTexto)
        ? `${ben.especieCodigo}:${ben.dib?.iso ?? hashTexto(ben.dibTexto!)}`
        : null
    : null;
  if (b.perfil === "implantacao_judicial") return `impl:${benKey ?? `o${ordemNaAba}`}`;
  if (b.perfil === "implantacao_administrativa") return `adm:${benKey ?? `o${ordemNaAba}`}`;
  if (b.perfil === "acordos") return `acordo:o${ordemNaAba}`;
  if (b.perfil === "pedido_ted") return `ted:o${ordemNaAba}`;
  if (b.perfil === "cobrancas") return null;
  const temConteudo =
    b.dados.lancamentos.length || b.dados.beneficios.length || b.dados.requisicoes.length;
  return temConteudo ? `aba:${hashTexto(b.aba)}:o${ordemNaAba}` : null;
}

/** Une blocos de execução da mesma pessoa que compartilham valores (mesmo processo em abas diferentes). */
function ancorasExecucao(blocos: Bloco[]): Map<Bloco, string> {
  const exec = blocos.filter((b) => PERFIS_EXECUCAO.includes(b.perfil));
  const uf = new UniaoBusca();
  const valores = (b: Bloco) =>
    b.dados.lancamentos
      .filter(
        (l) =>
          l.principal &&
          l.valor !== null &&
          l.valor > 0 &&
          ["valor_cliente", "atrasados", "valor_total"].includes(l.categoria),
      )
      .map((l) => centavos(l.valor!));
  const porValor = new Map<number, Bloco[]>();
  for (const b of exec) {
    uf.achar(b.ref);
    for (const v of valores(b)) porValor.set(v, [...(porValor.get(v) ?? []), b]);
  }
  for (const lista of porValor.values())
    for (let i = 1; i < lista.length; i++) uf.unir(lista[0]!.ref, lista[i]!.ref);
  const grupos = new Map<string, Bloco[]>();
  for (const b of exec) grupos.set(uf.achar(b.ref), [...(grupos.get(uf.achar(b.ref)) ?? []), b]);
  const out = new Map<Bloco, string>();
  for (const lista of grupos.values()) {
    const todos = lista.flatMap(valores);
    if (!todos.length) continue;
    const k = `exec:${Math.min(...todos)}`;
    for (const b of lista) out.set(b, k);
  }
  return out;
}

function montarPayload(
  g: GrupoInterno,
  analise: AnaliseFurtado,
  arquivoNome: string,
  pendencias: PendenciaRascunho[],
): { payload: PayloadPessoa; resumo: ResumoPessoa } {
  const p: PayloadPessoa = {
    cliente: {
      cpf: null,
      numero_processo: null,
      origem_importacao: `Furtado Advogados — ${arquivoNome}`,
    },
    variacoes: [],
    atendimentos: [],
    beneficios: [],
    lancamentos_financeiros: [],
    requisicoes: [],
    acordos: [],
    cobrancas: [],
    dados_bancarios: [],
    representantes: [],
    historico_cliente: [],
  };
  const ancoras = ancorasExecucao(g.blocos);
  const ordemPorAba = new Map<string, number>();
  const atendimentos = new Map<string, Record<string, unknown>>();
  const lancPorChave = new Map<string, { item: Record<string, unknown>; bloco: string }>();
  const benPorChave = new Map<string, Record<string, unknown>>();
  const reqPorChave = new Map<string, Record<string, unknown>>();
  const chavesUsadas = new Set<string>();
  const unica = (base: string) => {
    let k = base;
    let i = 2;
    while (chavesUsadas.has(k)) k = `${base}#${i++}`;
    chavesUsadas.add(k);
    return k;
  };
  const porCategoria: Partial<Record<CategoriaFinanceira, number>> = {};

  // CPF único do grupo
  const cpfs = [
    ...new Set(g.blocos.flatMap((b) => [...b.dados.cpfs, ...(b.nome?.cpf ? [b.nome.cpf] : [])])),
  ];
  if (cpfs.length === 1) p.cliente.cpf = cpfs[0]!;
  else if (cpfs.length > 1) {
    pendencias.push({
      tipo: "conflito_dado",
      bloqueante: true,
      descricao: `Foram encontrados ${cpfs.length} CPFs diferentes para "${g.nome}": ${cpfs.join(", ")}. Confirme a identificação.`,
      celulas: [],
      pessoaRef: g.ref,
    });
  }
  // Variações de grafia
  const vistosNomes = new Set([g.nomeNormalizado]);
  for (const b of g.blocos) {
    if (!b.nome) continue;
    const nn = normalizarNome(b.nome.nome);
    if (!vistosNomes.has(nn)) {
      vistosNomes.add(nn);
      p.variacoes.push({ nome: b.nome.nome, nome_normalizado: nn });
    }
  }

  for (const b of g.blocos) {
    const ordem = (ordemPorAba.get(b.aba) ?? 0) + 1;
    ordemPorAba.set(b.aba, ordem);
    const atKey = chaveAtendimento(b, ordem, analise, ancoras);
    const origemNome = b.celulaNome ? [b.celulaNome] : b.celulas.slice(0, 1);

    // Atendimento
    if (atKey) {
      const proprios = processosProprios(b, analise);
      const proc = proprios[0]
        ? b.dados.processos.find((x) => x.digitos === proprios[0])
        : undefined;
      const existente = atendimentos.get(atKey);
      const req = b.dados.requisicoes[0];
      const situacao = req?.situacao ?? b.dados.situacao ?? null;
      const especie = b.dados.beneficios[0]?.especie ?? null;
      if (existente) {
        const trib = new Set([
          ...String(existente["tribunal"] ?? "")
            .split(" / ")
            .filter(Boolean),
          ...b.dados.tribunais,
        ]);
        existente["tribunal"] = [...trib].join(" / ") || null;
        existente["origens"] = [...(existente["origens"] as string[]), ...origemNome];
        if (b.dados.servico && !String(existente["servico"] ?? "").includes(b.dados.servico)) {
          existente["servico"] = [existente["servico"], b.dados.servico]
            .filter(Boolean)
            .join(" / ");
        }
        existente["situacao"] = existente["situacao"] ?? situacao;
        existente["beneficio"] = existente["beneficio"] ?? especie;
        existente["parceria"] =
          [existente["parceria"], b.dados.parceria].filter(Boolean).join(" | ") || null;
        if (!existente["numero_processo"] && proc) {
          existente["numero_processo"] = proc.numero;
          existente["processo_digitos"] = proc.digitos;
        }
      } else {
        atendimentos.set(atKey, {
          chave: atKey,
          numero_processo: proc ? proc.numero + (proc.sufixo ? ` ${proc.sufixo}` : "") : null,
          processo_digitos: proc?.digitos ?? null,
          tribunal: b.dados.tribunais.join(" / ") || null,
          natureza: b.dados.natureza,
          servico: b.dados.servico,
          beneficio: especie,
          situacao,
          parceria: b.dados.parceria,
          origens: origemNome,
        });
      }
    }

    // Lançamentos
    for (const l of b.dados.lancamentos) {
      const tipo = l.principal ? "p" : `l:${hashTexto(b.aba)}:${l.coluna}${l.versao}`;
      const base = `${atKey ?? `sem:${hashTexto(b.aba)}:o${ordem}`}|${l.categoria}|${tipo}`;
      const item = lancamentoPayload(l, atKey, b);
      const ja = lancPorChave.get(base);
      if (ja) {
        const valorJa = ja.item["valor"] as number | null;
        if (
          (valorJa ?? null) === (l.valor ?? null) ||
          (valorJa !== null && l.valor !== null && centavos(valorJa) === centavos(l.valor))
        ) {
          ja.item["origens"] = [...(ja.item["origens"] as string[]), ...l.celulas];
          continue;
        }
        if (ja.bloco !== b.ref && l.principal && valorJa !== null && l.valor !== null) {
          pendencias.push({
            tipo: "conflito_valor",
            bloqueante: false,
            descricao: `${ROTULO_LANC[l.categoria] ?? l.categoria}: valores diferentes para o mesmo atendimento — ${valorJa.toFixed(2)} e ${l.valor.toFixed(2)} (${b.aba}). Os dois foram preservados; nenhum foi somado.`,
            celulas: l.celulas,
            pessoaRef: g.ref,
            blocoRef: b.ref,
          });
        }
      }
      const chave = unica(base);
      item["chave"] = chave;
      lancPorChave.set(chave, { item, bloco: b.ref });
      if (ja && (item["valor"] ?? null) !== (ja.item["valor"] ?? null))
        item["observacao"] = [item["observacao"], "Valor alternativo (ver conflito)"]
          .filter(Boolean)
          .join(" | ");
      p.lancamentos_financeiros.push(item);
      if (l.principal && l.valor !== null && l.natureza !== "informativo" && !ja) {
        porCategoria[l.categoria] =
          Math.round(((porCategoria[l.categoria] ?? 0) + l.valor) * 100) / 100;
      }
    }

    // Benefícios
    b.dados.beneficios.forEach((ben, i) => {
      const k = ben.nb
        ? `nb:${digitos(ben.nb)}`
        : (ben.especieCodigo || ben.especie) && (ben.dib?.iso || ben.dibTexto)
          ? `esp:${ben.especieCodigo ?? hashTexto(ben.especie!)}:${ben.dib?.iso ?? hashTexto(ben.dibTexto!)}`
          : `${atKey ?? "sem"}:b${ordem}.${i}`;
      const item: Record<string, unknown> = {
        chave: k,
        atendimento_chave: atKey,
        especie: ben.especie,
        especie_codigo: ben.especieCodigo,
        nb: ben.nb,
        nb_digitos: ben.nb ? digitos(ben.nb) : null,
        dib: iso(ben.dib),
        dib_texto: ben.dibTexto,
        dib_origem_texto: ben.dibOrigemTexto,
        dip: iso(ben.dip),
        dip_texto: ben.dipTexto,
        dcb: iso(ben.dcb),
        dcb_texto: ben.dcbTexto,
        rmi: ben.rmi,
        rmi_texto: ben.rmiTexto,
        rma: ben.rma,
        rma_texto: ben.rmaTexto,
        previsao_pagamento_texto: ben.previsaoPagamentoTexto,
        transito_julgado: iso(ben.transito),
        transito_texto: ben.transitoTexto,
        data_requerimento_texto: ben.dataRequerimentoTexto,
        data_concessao_texto: ben.dataConcessaoTexto,
        prorrogacao_texto: ben.prorrogacaoTexto,
        revisao_texto: ben.revisaoTexto,
        implantacao_texto: ben.implantacaoTexto,
        atrasados_texto: ben.atrasadosTexto,
        honorarios_regra: ben.honorariosRegra,
        comunicacao_texto: ben.comunicacaoTexto,
        historico: ben.historico,
        origens: ben.celulas.slice(0, 30),
      };
      const ja = benPorChave.get(k);
      if (!ja) {
        benPorChave.set(k, item);
        p.beneficios.push(item);
        return;
      }
      // Mesmo benefício em outra aba/coluna: complementa e aponta conflitos.
      const divergentes: string[] = [];
      for (const campo of [
        "dib",
        "dip",
        "dcb",
        "rmi",
        "rma",
        "especie_codigo",
        "transito_julgado",
      ]) {
        const a = ja[campo];
        const n = item[campo];
        if (a === null || a === undefined) ja[campo] = n;
        else if (n !== null && n !== undefined && String(a) !== String(n))
          divergentes.push(`${campo.toUpperCase()}: ${a} × ${n}`);
      }
      for (const campo of Object.keys(item))
        if ((ja[campo] === null || ja[campo] === undefined) && item[campo] !== null)
          ja[campo] = item[campo];
      ja["historico"] = [
        ...(ja["historico"] as unknown[]),
        ...ben.historico,
        ...(divergentes.length
          ? [
              {
                campo: "Divergência entre registros",
                texto: divergentes.join("; "),
                celula: ben.celulas[0] ?? "",
              },
            ]
          : []),
      ];
      ja["origens"] = [...(ja["origens"] as string[]), ...ben.celulas.slice(0, 30)];
      if (divergentes.length) {
        pendencias.push({
          tipo: "conflito_dado",
          bloqueante: false,
          descricao: `Benefício de "${g.nome}" com dados divergentes entre registros (${b.aba}): ${divergentes.join("; ")}. O primeiro valor foi mantido e a divergência registrada no histórico.`,
          celulas: ben.celulas.slice(0, 10),
          pessoaRef: g.ref,
          blocoRef: b.ref,
        });
      }
    });

    // Requisições (RPV/precatório/TED)
    b.dados.requisicoes.forEach((r, i) => {
      if (!r) return;
      const k =
        r.tipo === "ted"
          ? `${atKey ?? "sem"}|ted:${hashTexto(b.aba)}:o${ordem}.${i}`
          : `${atKey ?? `sem:o${ordem}`}|req`;
      const item: Record<string, unknown> = {
        chave: k,
        atendimento_chave: atKey,
        tipo: r.tipo,
        numero_processo: r.numeroProcesso,
        expedicao_texto: r.expedicaoTexto,
        ano_previsto: r.anoPrevisto,
        previsao_texto: r.previsaoTexto,
        valor: r.valor,
        valor_texto: r.valorTexto,
        tipo_valor: r.tipoValor,
        conta_indicada: r.contaIndicada,
        titular: r.titular,
        situacao: r.situacao,
        situacao_texto: r.situacaoTexto,
        data_texto: r.dataTexto,
        retificacao: r.retificacao,
        venda: r.venda,
        observacoes: r.observacoes,
        origens: r.celulas,
      };
      const ja = reqPorChave.get(k);
      if (!ja) {
        reqPorChave.set(k, item);
        p.requisicoes.push(item);
        return;
      }
      if (
        ja["ano_previsto"] &&
        item["ano_previsto"] &&
        ja["ano_previsto"] !== item["ano_previsto"]
      ) {
        pendencias.push({
          tipo: "conflito_dado",
          bloqueante: false,
          descricao: `Ano previsto de pagamento divergente entre abas: ${ja["ano_previsto"]} × ${item["ano_previsto"]} (${b.aba}).`,
          celulas: r.celulas,
          pessoaRef: g.ref,
          blocoRef: b.ref,
        });
      }
      for (const campo of Object.keys(item))
        if ((ja[campo] === null || ja[campo] === undefined || ja[campo] === false) && item[campo])
          ja[campo] = item[campo];
      ja["situacao_texto"] =
        [ja["situacao_texto"], item["situacao_texto"]].filter(Boolean).join(" | ") || null;
      ja["origens"] = [...(ja["origens"] as string[]), ...r.celulas];
    });

    // Acordos
    b.dados.acordos.forEach((a, i) => {
      const proc = digitos(a.numeroProcesso);
      p.acordos.push({
        chave: `acordo:${proc || `o${ordem}.${i}`}`,
        atendimento_chave: atKey,
        numero_processo: a.numeroProcesso,
        aceitacao: a.aceitacao,
        aceitacao_texto: a.aceitacaoTexto,
        percentual: a.percentual,
        beneficio: a.beneficio,
        dib: iso(a.dib),
        dib_texto: a.dibTexto,
        dip: iso(a.dip),
        dip_texto: a.dipTexto,
        dcb: iso(a.dcb),
        dcb_texto: a.dcbTexto,
        dcb_prazo_dias: a.dcbPrazoDias,
        sucumbencia_percentual: a.sucumbenciaPercentual,
        sucumbencia_texto: a.sucumbenciaTexto,
        de_acordo_laudo: a.deAcordoLaudo,
        prorrogacao: a.prorrogacao,
        reabilitacao: a.reabilitacao,
        observacoes: a.observacoes,
        origens: a.celulas,
      });
    });

    // Cobranças e parcelas
    b.dados.cobrancas.forEach((c, i) => {
      const k = `cob:${hashTexto(b.aba)}:o${ordem}.${i}`;
      p.cobrancas.push({
        chave: k,
        atendimento_chave: atKey,
        descricao: c.descricao,
        valor_contratado: c.valorContratado,
        entrada: c.entrada,
        quantidade_parcelas: c.quantidadeParcelas,
        valor_parcela: c.valorParcela,
        vencimento_inicial: c.vencimentoInicial,
        vencimento_texto: c.vencimentoTexto,
        situacao: c.situacao,
        responsavel: c.responsavel,
        prestacao_contas: c.prestacaoContas,
        historico: c.historico,
        divergencia: c.divergencia,
        completar: c.completar,
        origens: c.celulas,
        parcelas: c.parcelas.map((x) => ({
          chave: `${k}:p${x.numero}`,
          numero: x.numero,
          valor: x.valor,
          vencimento: x.vencimento,
          vencimento_texto: x.vencimentoTexto,
        })),
      });
    });

    // Dados bancários
    for (const d of b.dados.bancarios) {
      const k = `banco:${hashTexto(`${digitos(d.agencia)}|${digitos(d.conta)}` === "|" ? d.textoOriginal : `${digitos(d.agencia)}|${digitos(d.conta)}`)}`;
      if (p.dados_bancarios.some((x) => x["chave"] === k)) continue;
      p.dados_bancarios.push({
        chave: k,
        banco: d.banco,
        agencia: d.agencia,
        conta: d.conta,
        operacao: d.operacao,
        tipo_conta: d.tipoConta,
        titular: d.titular,
        cpf_titular: d.cpfTitular,
        texto_original: d.textoOriginal,
        consistente: d.consistente,
        observacao: d.observacao,
        origens: d.celulas,
      });
    }

    // Representantes
    for (const r of b.dados.representantes) {
      const k = `rep:${hashTexto(`${r.relacao}|${r.nome ?? r.textoOriginal}`)}`;
      if (p.representantes.some((x) => x["chave"] === k)) continue;
      p.representantes.push({
        chave: k,
        nome: r.nome,
        relacao: r.relacao,
        texto_original: r.textoOriginal,
        origens: r.celulas,
      });
    }

    // Histórico (texto idêntico na mesma aba não se repete)
    for (const h of b.dados.historico) {
      const k = `hist:${hashTexto(`${b.aba}|${h.texto}`)}`;
      if (p.historico_cliente.some((x) => x["chave"] === k)) continue;
      p.historico_cliente.push({
        chave: k,
        atendimento_chave: atKey,
        categoria: h.categoria,
        texto: h.texto,
        aba: b.aba,
        celulas: h.celulas.map((c) => c.split("!")[1]).join(", "),
        data_texto: h.dataTexto,
        origens: h.celulas,
      });
    }
  }
  p.atendimentos = [...atendimentos.values()];

  const resumo: ResumoPessoa = {
    atendimentos: p.atendimentos.length,
    beneficios: p.beneficios.length,
    lancamentos: p.lancamentos_financeiros.length,
    requisicoes: p.requisicoes.length,
    acordos: p.acordos.length,
    cobrancas: p.cobrancas.length,
    parcelas: p.cobrancas.reduce((s, c) => s + (c["parcelas"] as unknown[]).length, 0),
    pagamentosIdentificados: g.blocos.reduce((s, b) => s + b.dados.pagamentos.length, 0),
    porCategoria,
    jaExistentes: 0,
  };
  return { payload: p, resumo };
}

const ROTULO_LANC: Partial<Record<CategoriaFinanceira, string>> = {
  atrasados: "Atrasados",
  valor_total: "Valor total",
  valor_cliente: "Valor do cliente",
  honorarios_contratuais: "Honorários contratuais",
  honorarios_sucumbenciais: "Honorários sucumbenciais",
  honorarios_execucao: "Honorários da execução",
  honorarios_implantacao: "Honorários de implantação",
};

function lancamentoPayload(
  l: LancamentoRascunho,
  atKey: string | null,
  b: Bloco,
): Record<string, unknown> {
  return {
    atendimento_chave: atKey,
    categoria: l.categoria,
    natureza: l.natureza,
    valor: l.valor,
    valor_texto: l.valorTexto,
    percentual: l.percentual,
    base_calculo: l.baseCalculo,
    quantidade_beneficios: l.quantidadeBeneficios,
    ausencia_declarada: l.ausenciaDeclarada,
    rotulo_original: l.rotuloOriginal,
    versao: l.versao,
    coluna: l.coluna,
    data_referencia_texto: l.dataReferencia,
    situacao_texto: l.situacaoTexto,
    observacao:
      [l.observacao, b.dados.secao ? `Seção ${b.dados.secao}` : null].filter(Boolean).join(" | ") ||
      null,
    origens: l.celulas,
  };
}

// ---------------------------------------------------------------------------
// Plano completo
// ---------------------------------------------------------------------------

/** Chaves que o banco usa (prefixo = id do cliente) para detectar o que já existe. */
function chaveBanco(clienteId: string, chave: string): string {
  return `${clienteId}|${chave}`;
}

export function planejarImportacaoFurtado(params: {
  analise: AnaliseFurtado;
  base: BaseFurtado;
  decisoes?: DecisoesFurtado;
  arquivoNome: string;
  limiares?: LimiaresSimilaridade;
}): PlanoFurtado {
  const limiares = params.limiares ?? LIMIARES_PADRAO;
  const decisoes = params.decisoes ?? {};
  const indices = indexarBase(params.base);
  const { grupos, pendencias: pendGrupos } = agruparPessoas(params.analise, decisoes, limiares);
  const pessoas: PessoaPlano[] = [];
  const todas: PendenciaRascunho[] = [...params.analise.pendenciasArquivo, ...pendGrupos];

  // Mesmo CPF em pessoas diferentes do arquivo
  const cpfPessoas = new Map<string, Set<string>>();
  for (const g of grupos) {
    for (const b of g.blocos)
      for (const c of [...b.dados.cpfs, ...(b.nome?.cpf ? [b.nome.cpf] : [])]) {
        const s = cpfPessoas.get(digitos(c)) ?? new Set();
        s.add(g.ref);
        cpfPessoas.set(digitos(c), s);
      }
  }

  for (const g of grupos) {
    const pend: PendenciaRascunho[] = [];
    const ids = {
      cpfs: [
        ...new Set(
          g.blocos.flatMap((b) => [...b.dados.cpfs, ...(b.nome?.cpf ? [b.nome.cpf] : [])]),
        ),
      ],
      processos: [...new Set(g.blocos.flatMap((b) => processosProprios(b, params.analise)))],
      nbs: [...new Set(g.blocos.flatMap((b) => b.dados.nbs))],
    };
    const semId = g.ref.startsWith("b:");
    const incompleto = !semId && g.blocos.every((b) => b.nome?.incompleto);
    const papel = g.blocos.find((b) => b.nome?.papel)?.nome ?? null;

    let corr = semId
      ? {
          tipo: "nenhuma" as TipoCorrespondencia,
          clienteId: null,
          candidatos: [] as Candidato[],
          motivo: "Bloco sem cliente identificado",
          segura: false,
        }
      : corresponder(g, ids, params.base, limiares, indices);

    // Mesmo CPF para nomes diferentes no arquivo
    for (const c of ids.cpfs) {
      const outros = [...(cpfPessoas.get(digitos(c)) ?? [])].filter((r) => r !== g.ref);
      if (outros.length) {
        pend.push({
          tipo: "conflito_dado",
          bloqueante: true,
          descricao: `O CPF ${c} aparece para "${g.nome}" e também para ${outros.map((o) => `"${grupos.find((x) => x.ref === o)?.nome}"`).join(", ")}. Confirme a identificação antes de gravar.`,
          celulas: [],
          pessoaRef: g.ref,
        });
        corr = { ...corr, segura: false };
      }
    }
    // Candidatos para nome incompleto: pessoas do arquivo e cadastros com o mesmo primeiro nome
    if (incompleto && corr.tipo !== "furtado_anterior") {
      const primeiro = tokensDoNome(g.nomeNormalizado)[0] ?? "";
      const daBase = [...indices.porId.values()]
        .filter((c) => tokensDoNome(c.nome_normalizado)[0] === primeiro)
        .slice(0, 8)
        .map((c) => ({
          clienteId: c.id,
          nome: c.nome,
          percentual: 0,
          motivo: "mesmo primeiro nome",
          escritorio: c.escritorio_origem ?? null,
        }));
      corr = {
        tipo: "semelhante",
        clienteId: null,
        candidatos: daBase,
        motivo: "Nome incompleto: não identifica a pessoa com segurança",
        segura: false,
      };
      const doArquivo = grupos.filter(
        (x) =>
          x.ref !== g.ref &&
          tokensDoNome(x.nomeNormalizado)[0] === primeiro &&
          tokensDoNome(x.nomeNormalizado).length > 1,
      );
      pend.push({
        tipo: "nome_incompleto",
        bloqueante: true,
        descricao: `"${g.nome}" é um nome incompleto.${doArquivo.length ? ` No arquivo há: ${doArquivo.map((x) => x.nome).join(", ")}.` : ""} Escolha o cliente correto ou informe o nome completo.`,
        celulas: g.blocos.flatMap((b) => (b.celulaNome ? [b.celulaNome] : [])),
        pessoaRef: g.ref,
        dados: { pessoasArquivo: doArquivo.map((x) => ({ ref: x.ref, nome: x.nome })) },
      });
    }
    if (papel) {
      pend.push({
        tipo: "separacao_nome",
        bloqueante: true,
        descricao: `"${papel.original.trim()}": o texto menciona "${papel.papel}". O nome do cliente foi separado como "${papel.nome}" e o complemento "${papel.complemento}" foi preservado. Confirme a separação e se esta pessoa é o cliente.`,
        celulas: g.blocos.flatMap((b) => (b.celulaNome ? [b.celulaNome] : [])),
        pessoaRef: g.ref,
      });
    }

    const { payload, resumo } = montarPayload(g, params.analise, params.arquivoNome, pend);
    if (payload.cliente.cpf && (cpfPessoas.get(digitos(payload.cliente.cpf))?.size ?? 0) > 1) {
      // CPF em conflito entre pessoas do arquivo: não é gravado no cadastro (fica no histórico).
      payload.historico_cliente.push({
        chave: `hist:cpf:${digitos(payload.cliente.cpf)}`,
        atendimento_chave: null,
        categoria: "pendencia",
        texto: `CPF ${payload.cliente.cpf} citado na planilha, também atribuído a outra pessoa — não gravado no cadastro até confirmação.`,
        aba: null,
        celulas: null,
        data_texto: null,
        origens: [],
      });
      payload.cliente.cpf = null;
    }
    for (const b of g.blocos)
      for (const pp of b.pendencias) pend.push({ ...pp, pessoaRef: g.ref, blocoRef: b.ref });

    // Decisão do usuário prevalece
    const decisao = decisoes.pessoas?.[g.ref];
    let acao: AcaoPessoa;
    let clienteId: string | null = null;
    let pronta: boolean;
    let correspondencia: TipoCorrespondencia = corr.tipo;
    const bloqueios = pend.filter((x) => x.bloqueante);
    if (decisao && decisao.acao !== "pendente") {
      acao = decisao.acao;
      clienteId = decisao.acao === "vincular" ? (decisao.clienteId ?? null) : null;
      if (
        (acao === "vincular" && (!clienteId || !indices.porId.has(clienteId))) ||
        (acao === "criar" && semId && !decisao.nome)
      ) {
        acao = "pendente";
        pronta = false;
      } else {
        pronta = true;
        correspondencia = "decisao";
      }
    } else if (semId) {
      acao = "pendente";
      pronta = false;
    } else if (corr.segura && !bloqueios.length) {
      acao = corr.clienteId ? "vincular" : "criar";
      clienteId = corr.clienteId;
      pronta = true;
    } else {
      acao = "pendente";
      clienteId = corr.clienteId;
      pronta = false;
    }
    if (!pronta && !semId && !incompleto && !papel) {
      pend.unshift({
        tipo: "associacao_cliente",
        bloqueante: true,
        descricao: `${g.nome}: ${corr.motivo}.`,
        celulas: g.blocos.flatMap((b) => (b.celulaNome ? [b.celulaNome] : [])).slice(0, 10),
        pessoaRef: g.ref,
        dados: { candidatos: corr.candidatos, sugestao: corr.clienteId },
      });
    }

    // Conflitos com dados já cadastrados (importação complementar)
    if (clienteId) {
      const cli = indices.porId.get(clienteId)!;
      if (payload.cliente.cpf && cli.cpf && digitos(cli.cpf) !== digitos(payload.cliente.cpf)) {
        pend.push({
          tipo: "conflito_dado",
          bloqueante: false,
          descricao: `CPF cadastrado (${cli.cpf}) difere do CPF da planilha (${payload.cliente.cpf}). O cadastro foi preservado.`,
          celulas: [],
          pessoaRef: g.ref,
          dados: {
            tabela: "clientes",
            registroId: clienteId,
            campo: "cpf",
            existente: cli.cpf,
            importado: payload.cliente.cpf,
          },
        });
      }
      resumo.jaExistentes = compararExistentes(clienteId, payload, indices, pend, g.ref);
    }

    pessoas.push({
      ref: g.ref,
      nome: g.nome,
      nomeNormalizado: g.nomeNormalizado,
      nomesOriginais: [...new Set(g.blocos.map((b) => b.nome?.original ?? "").filter(Boolean))],
      blocos: g.blocos.map((b) => b.ref),
      abas: [...new Set(g.blocos.map((b) => b.aba))],
      cpfs: ids.cpfs,
      processos: ids.processos,
      nbs: ids.nbs,
      incompleto,
      semIdentificacao: semId,
      acao,
      clienteId,
      clienteNome: clienteId ? (indices.porId.get(clienteId)?.nome ?? null) : null,
      correspondencia,
      pronta,
      motivo: decisao && decisao.acao !== "pendente" ? "Decisão do usuário" : corr.motivo,
      candidatos: corr.candidatos,
      pendencias: pend,
      payload,
      resumo,
    });
    todas.push(...pend);
  }

  // Possível mesma pessoa no arquivo (nomes muito parecidos, sem identificador comum)
  const comNome = pessoas.filter((x) => !x.semIdentificacao && !x.incompleto);
  const porToken = new Map<string, PessoaPlano[]>();
  for (const x of comNome)
    for (const t of tokensDoNome(x.nomeNormalizado))
      porToken.set(t, [...(porToken.get(t) ?? []), x]);
  const avaliados = new Set<string>();
  for (const a of comNome) {
    for (const t of tokensDoNome(a.nomeNormalizado)) {
      for (const b of porToken.get(t) ?? []) {
        if (a === b || a.ref > b.ref) continue;
        const par = `${a.ref}|${b.ref}`;
        if (avaliados.has(par)) continue;
        avaliados.add(par);
        const r = compararNomes(a.nomeNormalizado, b.nomeNormalizado, limiares);
        const contido = nomesCompativeis(a.nomeNormalizado, b.nomeNormalizado, {
          ...limiares,
          possivel: 101,
        });
        if (r.percentual >= limiares.muito_parecido || contido) {
          const p: PendenciaRascunho = {
            tipo: "possivel_mesma_pessoa",
            bloqueante: false,
            descricao: `"${a.nome}" e "${b.nome}" podem ser a mesma pessoa (${contido ? "nome contido" : `${r.percentual.toFixed(0)}%`}). Una os registros se forem a mesma pessoa, ou confirme que são pessoas diferentes.`,
            celulas: [],
            pessoaRef: b.ref,
            dados: { pessoas: [a.ref, b.ref], nomes: [a.nome, b.nome] },
          };
          b.pendencias.push(p);
          todas.push(p);
          if (!decisoes.pessoas?.[b.ref] && !decisoes.pessoas?.[a.ref]) {
            p.bloqueante = true;
            b.pronta = false;
            b.acao = "pendente";
          }
        }
      }
    }
  }

  // Resumo geral
  const soma = (f: (p: PessoaPlano) => number) => pessoas.reduce((s, p) => s + f(p), 0);
  const porCategoria: Partial<Record<CategoriaFinanceira, number>> = {};
  for (const p of pessoas)
    for (const [c, v] of Object.entries(p.resumo.porCategoria)) {
      porCategoria[c as CategoriaFinanceira] =
        Math.round(((porCategoria[c as CategoriaFinanceira] ?? 0) + (v ?? 0)) * 100) / 100;
    }
  let informacoesAdicionais = 0;
  for (const d of params.analise.destinos.values())
    if (d.destino === "informacao_adicional") informacoesAdicionais++;
  return {
    pessoas: pessoas.sort(
      (a, b) => Number(a.pronta) - Number(b.pronta) || a.nome.localeCompare(b.nome, "pt-BR"),
    ),
    pendencias: todas,
    resumo: {
      pessoas: pessoas.length,
      novos: pessoas.filter((p) => p.pronta && p.acao === "criar").length,
      complementar: pessoas.filter((p) => p.pronta && p.acao === "vincular").length,
      revisar: pessoas.filter((p) => !p.pronta).length,
      ignoradas: pessoas.filter((p) => p.acao === "ignorar").length,
      semIdentificacao: pessoas.filter((p) => p.semIdentificacao).length,
      atendimentos: soma((p) => p.resumo.atendimentos),
      beneficios: soma((p) => p.resumo.beneficios),
      lancamentos: soma((p) => p.resumo.lancamentos),
      requisicoes: soma((p) => p.resumo.requisicoes),
      acordos: soma((p) => p.resumo.acordos),
      cobrancas: soma((p) => p.resumo.cobrancas),
      parcelas: soma((p) => p.resumo.parcelas),
      pagamentosIdentificados: soma((p) => p.resumo.pagamentosIdentificados),
      porCategoria,
      informacoesAdicionais,
      conflitos: todas.filter((x) => x.tipo === "conflito_valor" || x.tipo === "conflito_dado")
        .length,
      pendenciasAbertas: todas.length,
      pendenciasBloqueantes: todas.filter((x) => x.bloqueante).length,
      jaExistentes: soma((p) => p.resumo.jaExistentes),
    },
  };
}

const CAMPOS_COMPARADOS: Record<string, string[]> = {
  lancamentos_financeiros: ["valor"],
  beneficios: ["dib", "dip", "dcb", "rmi", "rma", "nb"],
  acordos: ["aceitacao", "percentual", "dib", "dip", "dcb", "sucumbencia_percentual"],
  requisicoes: ["ano_previsto", "situacao", "valor"],
};

/** Compara com o que já existe: conta duplicados evitados e registra conflitos. */
function compararExistentes(
  clienteId: string,
  payload: PayloadPessoa,
  indices: IndicesBase,
  pend: PendenciaRascunho[],
  pessoaRef: string,
): number {
  let existentes = 0;
  const tabelas: (keyof PayloadPessoa)[] = [
    "atendimentos",
    "beneficios",
    "lancamentos_financeiros",
    "requisicoes",
    "acordos",
    "cobrancas",
    "dados_bancarios",
    "representantes",
    "historico_cliente",
  ];
  for (const t of tabelas) {
    for (const item of payload[t] as Record<string, unknown>[]) {
      const reg = indices.existentesPorChave.get(
        `${t}:${chaveBanco(clienteId, String(item["chave"]))}`,
      );
      if (!reg) continue;
      existentes++;
      for (const campo of CAMPOS_COMPARADOS[t] ?? []) {
        const atual = reg.campos[campo];
        const novo = item[campo];
        const igual =
          atual === novo ||
          (atual !== null &&
            novo !== null &&
            atual !== undefined &&
            novo !== undefined &&
            String(Number(atual)) !== "NaN" &&
            Number(atual) === Number(novo)) ||
          String(atual ?? "") === String(novo ?? "");
        if (!igual && novo !== null && novo !== undefined) {
          pend.push({
            tipo: t === "lancamentos_financeiros" ? "conflito_valor" : "conflito_dado",
            bloqueante: false,
            descricao: `Já cadastrado: ${campo} = ${atual ?? "vazio"}; nesta planilha: ${novo}. O valor cadastrado foi preservado — escolha qual manter.`,
            celulas: (item["origens"] as string[] | undefined)?.slice(0, 5) ?? [],
            pessoaRef,
            dados: {
              tabela: t,
              registroId: reg.id,
              campo,
              existente: atual ?? null,
              importado: novo,
            },
          });
        }
      }
    }
  }
  return existentes;
}

export { CATEGORIAS_HONORARIOS, semCelulas };
