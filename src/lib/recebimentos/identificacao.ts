/**
 * Identificação do cliente EXISTENTE para cada linha de valores recebidos e
 * montagem dos recebimentos enviados ao banco (funções puras — testadas em
 * tests/importacao-recebimentos.test.ts).
 *
 * Regras (identificação; o cliente que não existe é criado à parte, em
 * CLIENTES, por criar_clientes_valores — nunca vincula por semelhança):
 *  1. CPF válido na planilha → cliente com o mesmo CPF.
 *  2. Sem CPF (ou CPF sem cadastro) → Reclamante idêntico após normalização
 *     (maiúsculas, acentos, espaços e pontuação) ao nome do cliente ou a uma
 *     variação de nome já confirmada.
 *  3. Mais de um cliente possível, CPF diferente do cadastro, cliente
 *     arquivado ou nenhum cliente → REVISÃO (nada é gravado para a linha).
 *  4. Vínculo manual feito pelo usuário na prévia tem prioridade.
 */

import { somenteDigitos } from "@/lib/rf/valores";
import { normalizarTexto } from "@/lib/situacao";
import type { ClassificacaoEntrada } from "@/lib/tipos";

import type { LinhaRecebimento } from "./modelo";

export interface ClienteBase {
  id: string;
  nome: string;
  cpf: string | null;
  status: string;
  deleted_at: string | null;
  arquivado?: boolean | null;
}

export interface VariacaoBase {
  cliente_id: string;
  nome_variacao: string;
}

export type StatusIdentificacao =
  "encontrado" | "nao_encontrado" | "ambiguo" | "cpf_divergente" | "arquivado";

export interface Identificacao {
  status: StatusIdentificacao;
  cliente_id: string | null;
  via: "cpf" | "nome" | "variacao" | "manual" | null;
  /** Clientes envolvidos (ambíguo / CPF divergente). */
  candidatos: string[];
  motivo: string;
}

export const ROTULO_IDENTIFICACAO: Record<StatusIdentificacao, string> = {
  encontrado: "Cliente identificado",
  nao_encontrado: "Cliente não encontrado na base",
  ambiguo: "Mais de um cliente possível",
  cpf_divergente: "CPF diferente do cadastro",
  arquivado: "Cliente arquivado",
};

export interface IndiceClientes {
  porId: Map<string, ClienteBase>;
  porCpf: Map<string, string[]>;
  porNome: Map<string, { id: string; via: "nome" | "variacao" }[]>;
}

function adicionar<T>(m: Map<string, T[]>, k: string, v: T) {
  if (!k) return;
  m.set(k, [...(m.get(k) ?? []), v]);
}

export function indexarClientes(
  clientes: readonly ClienteBase[],
  variacoes: readonly VariacaoBase[] = [],
): IndiceClientes {
  const porId = new Map<string, ClienteBase>();
  const porCpf = new Map<string, string[]>();
  const porNome = new Map<string, { id: string; via: "nome" | "variacao" }[]>();
  for (const c of clientes) {
    if (c.deleted_at) continue; // excluídos não participam
    porId.set(c.id, c);
    const d = somenteDigitos(c.cpf);
    if (d.length === 11 || d.length === 14) adicionar(porCpf, d, c.id);
    adicionar(porNome, normalizarTexto(c.nome), { id: c.id, via: "nome" as const });
  }
  for (const v of variacoes) {
    if (!porId.has(v.cliente_id)) continue;
    const k = normalizarTexto(v.nome_variacao);
    if ((porNome.get(k) ?? []).some((x) => x.id === v.cliente_id)) continue;
    adicionar(porNome, k, { id: v.cliente_id, via: "variacao" as const });
  }
  return { porId, porCpf, porNome };
}

const arquivado = (c: ClienteBase) => Boolean(c.arquivado) || c.status === "arquivado";

function resultado(
  status: StatusIdentificacao,
  motivo: string,
  extra: Partial<Identificacao> = {},
): Identificacao {
  return { status, cliente_id: null, via: null, candidatos: [], motivo, ...extra };
}

export function identificarLinha(
  linha: Pick<LinhaRecebimento, "reclamante" | "cpf_digitos" | "cpf_valido">,
  indice: IndiceClientes,
  vinculoManual?: string | null,
): Identificacao {
  const encontrado = (id: string, via: Identificacao["via"], motivo: string): Identificacao => {
    const c = indice.porId.get(id)!;
    if (arquivado(c))
      return resultado(
        "arquivado",
        "O cliente está arquivado. Reative-o antes de lançar valores.",
        {
          candidatos: [id],
        },
      );
    return { status: "encontrado", cliente_id: id, via, candidatos: [id], motivo };
  };

  if (vinculoManual && indice.porId.has(vinculoManual))
    return encontrado(vinculoManual, "manual", "Vinculado manualmente na prévia.");

  const nome = normalizarTexto(linha.reclamante);
  const porNome = [...new Map((indice.porNome.get(nome) ?? []).map((x) => [x.id, x])).values()];

  if (linha.cpf_valido && linha.cpf_digitos) {
    const ids = indice.porCpf.get(linha.cpf_digitos) ?? [];
    if (ids.length === 1) return encontrado(ids[0]!, "cpf", "Identificado pelo CPF.");
    if (ids.length > 1)
      return resultado("ambiguo", "Mais de um cliente cadastrado com este CPF.", {
        candidatos: ids,
      });
    // CPF sem cadastro: o nome só identifica cliente que NÃO tem outro CPF.
    const comOutroCpf = porNome.filter((x) => somenteDigitos(indice.porId.get(x.id)!.cpf) !== "");
    if (comOutroCpf.length)
      return resultado(
        "cpf_divergente",
        "O nome confere, mas o CPF da planilha é diferente do CPF cadastrado.",
        { candidatos: comOutroCpf.map((x) => x.id) },
      );
  }

  if (porNome.length === 1)
    return encontrado(
      porNome[0]!.id,
      porNome[0]!.via,
      porNome[0]!.via === "variacao"
        ? "Identificado por variação de nome confirmada."
        : "Identificado pelo nome do Reclamante.",
    );
  if (porNome.length > 1)
    return resultado(
      "ambiguo",
      "Existe mais de um cliente com este nome. Vincule manualmente o cliente correto.",
      { candidatos: porNome.map((x) => x.id) },
    );
  return resultado(
    "nao_encontrado",
    "Nenhum cliente cadastrado com este nome ou CPF. Nenhum cliente é criado automaticamente.",
  );
}

/** Sugestões para vínculo manual (apenas exibidas — nunca aplicadas sozinhas). */
export function sugerirClientes(reclamante: string, indice: IndiceClientes, limite = 5): string[] {
  const tokens = normalizarTexto(reclamante)
    .split(" ")
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return [];
  const pontos: [string, number][] = [];
  for (const c of indice.porId.values()) {
    const ct = new Set(normalizarTexto(c.nome).split(" "));
    const comuns = tokens.filter((t) => ct.has(t)).length;
    if (comuns >= Math.min(2, tokens.length)) pontos.push([c.id, comuns]);
  }
  return pontos
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// Vínculo com o processo e montagem dos recebimentos
// ---------------------------------------------------------------------------

export interface ProcessoBase {
  id: string;
  cliente_id: string;
  numero_digitos: string | null;
  pasta: string | null;
  /** Número como exibido (para escolher o processo na prévia). */
  numero?: string | null;
  tipo_acao?: string | null;
  /** Situação de pagamento do processo. */
  pago?: boolean;
  /** NB do benefício, quando registrado no processo (só dígitos). */
  nb_digitos?: string | null;
}

/**
 * Processo que recebe a linha (pagamento é marcado POR PROCESSO):
 *  1. escolha do usuário na prévia (sempre prevalece);
 *  2. Pasta ou Número exatos da planilha;
 *  3. o único processo do cliente.
 * Cliente com vários processos e nenhum identificado → null (o usuário escolhe).
 */
export function processoDoItem(
  linha: Pick<LinhaRecebimento, "numero_digitos" | "pasta" | "linha">,
  clienteId: string,
  processos: readonly ProcessoBase[],
  escolhidos: Map<number, string> = new Map(),
): string | null {
  const doCliente = processos.filter((p) => p.cliente_id === clienteId);
  const escolhido = escolhidos.get(linha.linha);
  if (escolhido && doCliente.some((p) => p.id === escolhido)) return escolhido;
  const exato = processoDaLinha(linha, clienteId, processos);
  if (exato) return exato;
  return doCliente.length === 1 ? doCliente[0]!.id : null;
}

/** Processo do cliente com o mesmo número ou a mesma pasta (nunca por suposição). */
export function processoDaLinha(
  linha: Pick<LinhaRecebimento, "numero_digitos" | "pasta">,
  clienteId: string,
  processos: readonly ProcessoBase[],
): string | null {
  const doCliente = processos.filter((p) => p.cliente_id === clienteId);
  if (linha.pasta) {
    const p = doCliente.find(
      (x) => x.pasta && x.pasta.trim().toUpperCase() === linha.pasta!.trim().toUpperCase(),
    );
    if (p) return p.id;
  }
  if (linha.numero_digitos) {
    const ps = doCliente.filter((x) => x.numero_digitos === linha.numero_digitos);
    if (ps.length === 1) return ps[0]!.id;
  }
  return null;
}

/**
 * Item enviado à função `aplicar_importacao_recebimentos`: um por
 * recebimento, ou um item `sem_valor` para a linha sem valor (nada é lançado;
 * os valores vão depois no perfil). A importação nunca finaliza processo:
 * PAGO / FINALIZADO depende dos três cards (Atrasados, Contratual, Sucumbência).
 */
export interface ItemRecebimento {
  linha: number;
  /** Posição do valor dentro da linha (0, 1, 2…). */
  indice: number;
  cliente_id: string;
  /** null quando `sem_valor`. */
  valor: number | null;
  sem_valor: boolean;
  data: string | null;
  classificacao: ClassificacaoEntrada | null;
  atendimento_id: string | null;
  chave: string;
  observacao: string | null;
  /** Total a receber da categoria (só completa o card se estiver vazio). */
  total_previsto?: number | null;
  /** Recebimento integral informado na planilha. */
  integral?: boolean;
  dados_origem: Record<string, unknown>;
}

/**
 * Chave de idempotência do recebimento, por cliente:
 *   rv:<data|sd>:<centavos>:<ocorrência>
 * A ocorrência conta valores iguais (mesma data e valor) do mesmo cliente no
 * arquivo — reimportar o mesmo arquivo gera as mesmas chaves (nada duplica),
 * enquanto vários recebimentos legítimos iguais no arquivo continuam
 * distintos. A categoria não entra na chave: reclassificar nunca duplica.
 */
export function montarItens(
  linhas: readonly LinhaRecebimento[],
  identificacoes: Map<number, Identificacao>,
  processos: readonly ProcessoBase[],
  classificacoes: Map<string, ClassificacaoEntrada | null> = new Map(),
  arquivo = "",
  escolhidos: Map<number, string> = new Map(),
): ItemRecebimento[] {
  const ocorrencias = new Map<string, number>();
  const itens: ItemRecebimento[] = [];
  for (const l of linhas) {
    const ident = identificacoes.get(l.linha);
    if (!ident || ident.status !== "encontrado" || !ident.cliente_id) continue;
    const atendimento = processoDoItem(l, ident.cliente_id, processos, escolhidos);
    if (l.entradas.length === 0) {
      itens.push({
        linha: l.linha,
        indice: 0,
        cliente_id: ident.cliente_id,
        valor: null,
        sem_valor: true,
        data: l.data,
        classificacao: null,
        atendimento_id: atendimento,
        chave: `rv:sv:${l.linha}`,
        observacao: l.observacao,
        dados_origem: { arquivo, linha: l.linha, identificacao: ident.via, valores: l.original },
      });
      continue;
    }
    l.entradas.forEach((e, indice) => {
      const centavos = Math.round(e.valor * 100);
      const base = `${ident.cliente_id}|${l.data ?? "sd"}|${centavos}`;
      const n = (ocorrencias.get(base) ?? 0) + 1;
      ocorrencias.set(base, n);
      const k = chaveClassificacao(l.linha, indice);
      itens.push({
        linha: l.linha,
        indice,
        cliente_id: ident.cliente_id!,
        valor: e.valor,
        sem_valor: false,
        data: l.data,
        classificacao: classificacoes.has(k) ? (classificacoes.get(k) ?? null) : e.classificacao,
        atendimento_id: atendimento,
        chave: `rv:${l.data ?? "sd"}:${centavos}:${n}`,
        observacao: l.observacao,
        total_previsto: l.total_previsto,
        integral: l.integral,
        dados_origem: {
          arquivo,
          linha: l.linha,
          coluna: e.coluna,
          categoria_planilha: e.categoriaTexto,
          identificacao: ident.via,
          valores: l.original,
        },
      });
    });
  }
  return itens;
}

export const chaveClassificacao = (linha: number, indice: number) => `${linha}:${indice}`;

// ---------------------------------------------------------------------------
// Resumo da prévia / do relatório
// ---------------------------------------------------------------------------

export interface ResultadoItem {
  linha: number;
  cliente_id: string;
  chave: string;
  resultado: string;
  movido: boolean;
}

export interface ResumoPrevia {
  linhas: number;
  valores: number;
  clientesIdentificados: number;
  /** Clientes Ricardo Friedl que passam para JÁ PAGOS (primeiro recebimento confirmado). */
  clientesMovidos: number;
  clientesJaPagos: number;
  /** Linhas sem valor com cliente identificado (valor a lançar no perfil). */
  clientesSemValor: number;
  valoresNovos: number;
  valoresJaRegistrados: number;
  possiveisDuplicados: number;
  totalNovo: number;
  semCategoria: number;
  revisao: number;
  pendentes: number;
}

export const chaveItem = (i: { cliente_id: string; chave: string }) => `${i.cliente_id}|${i.chave}`;

export function resumirPrevia(params: {
  linhas: readonly LinhaRecebimento[];
  pendentes: number;
  identificacoes: Map<number, Identificacao>;
  itens: readonly ItemRecebimento[];
  resultados: readonly ResultadoItem[];
  statusCliente: (id: string) => string | undefined;
}): ResumoPrevia {
  const { linhas, identificacoes, itens, resultados } = params;
  const porChave = new Map(resultados.map((r) => [chaveItem(r), r]));
  const clientes = new Set<string>();
  const movidos = new Set<string>();
  const jaPagos = new Set<string>();
  const semValor = new Set<number>();
  let novos = 0,
    jaReg = 0,
    dup = 0,
    total = 0,
    semCat = 0;
  for (const i of itens) {
    clientes.add(i.cliente_id);
    const r = porChave.get(chaveItem(i));
    if (i.sem_valor) semValor.add(i.linha);
    else if (r?.resultado === "inserido") {
      novos += 1;
      total = Math.round((total + (i.valor ?? 0)) * 100) / 100;
      if (!i.classificacao) semCat += 1;
    } else if (r?.resultado === "ja_registrado") jaReg += 1;
    else if (r?.resultado === "possivel_duplicado") dup += 1;
    // Cliente (Ricardo Friedl) que passa para JÁ PAGOS com este recebimento.
    if (r?.movido) movidos.add(i.cliente_id);
  }
  for (const id of clientes) if (params.statusCliente(id) === "pago") jaPagos.add(id);
  let revisao = 0;
  for (const l of linhas) if (identificacoes.get(l.linha)?.status !== "encontrado") revisao += 1;
  return {
    linhas: linhas.length + params.pendentes,
    valores: linhas.reduce((s, l) => s + l.entradas.length, 0),
    clientesIdentificados: clientes.size,
    clientesMovidos: movidos.size,
    clientesJaPagos: jaPagos.size,
    clientesSemValor: semValor.size,
    valoresNovos: novos,
    valoresJaRegistrados: jaReg,
    possiveisDuplicados: dup,
    totalNovo: total,
    semCategoria: semCat,
    revisao,
    pendentes: params.pendentes,
  };
}
