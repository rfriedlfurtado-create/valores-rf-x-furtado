/**
 * Modelo em BLOCOS — identificação dos clientes/processos e montagem dos
 * itens enviados a `aplicar_importacao_blocos` (funções puras, testadas em
 * tests/importacao-blocos.test.ts).
 *
 * Cliente:
 *  1. CPF válido → cliente com o mesmo CPF;
 *  2. nome idêntico (normalizado) ou variação confirmada;
 *  3. não encontrado → NOVO cliente em JÁ PAGOS — salvo quando há nome
 *     parecido na base ou no próprio arquivo: aí fica PENDENTE de decisão
 *     (nunca une por semelhança).
 * Processo/benefício:
 *  número do processo ou NB iguais → esse processo; sem número/NB e cliente
 *  com um único processo → ele; número/NB novo → cria o vínculo; vários
 *  processos e nada que identifique → pendência (valores ficam sem processo).
 */

import { compararNomes } from "@/lib/similarity";
import { somenteDigitos } from "@/lib/rf/valores";
import { normalizarTexto } from "@/lib/situacao";

import {
  ROTULO_ABA,
  ROTULO_NATUREZA,
  type BlocoLido,
  type LancamentoBloco,
  type LeituraBlocos,
} from "./blocos";
import {
  identificarLinha,
  indexarClientes,
  type ClienteBase,
  type Identificacao,
  type ProcessoBase,
  type VariacaoBase,
} from "./identificacao";

export type AcaoCliente =
  | { acao: "existente"; id: string; via: string }
  | { acao: "novo"; grupo: string }
  | { acao: "pendente"; motivo: string };

export type AcaoProcesso =
  | { acao: "existente"; id: string; via: string }
  | { acao: "novo"; chave: string }
  | { acao: "nenhum"; motivo: string };

export interface Sugestao {
  tipo: "cliente" | "grupo";
  id: string;
  nome: string;
  percentual: number;
}

export interface AnaliseBloco {
  bloco: BlocoLido;
  identificacao: Identificacao | null;
  cliente: AcaoCliente;
  processo: AcaoProcesso;
  sugestoes: Sugestao[];
  /** Grupo do novo cliente (mesmo CPF ou mesmo nome em vários blocos). */
  grupoNovo: string | null;
  avisos: string[];
}

export interface DecisaoUsuario {
  /** id de cliente existente, "novo" (criar) ou "grupo:<chave>" (mesmo cliente novo de outro bloco). */
  cliente?: string | undefined;
  /** id de processo existente, "nenhum" ou "novo". */
  processo?: string | undefined;
}

const LIMIAR_PENDENTE = 88;

/** Novo cliente = nome normalizado (o CPF, quando houver, acompanha o grupo). */
function grupoDe(b: BlocoLido): string {
  return `nome:${b.nomeNormalizado ?? b.id}`;
}

export function analisarBlocos(
  leitura: LeituraBlocos,
  clientes: readonly ClienteBase[],
  variacoes: readonly VariacaoBase[],
  processos: readonly ProcessoBase[],
): AnaliseBloco[] {
  const indice = indexarClientes(clientes, variacoes);
  const ativos = [...indice.porId.values()].map((c) => ({ c, n: normalizarTexto(c.nome) }));
  const blocos = leitura.blocos.filter((b) => !b.ignorado);

  // 1) cliente de cada bloco
  const analises: AnaliseBloco[] = blocos.map((bloco) => {
    const avisos: string[] = [];
    if (!bloco.nome)
      return {
        bloco,
        identificacao: null,
        cliente: { acao: "pendente", motivo: "Nome do cliente não identificado no bloco." },
        processo: { acao: "nenhum", motivo: "Cliente não identificado." },
        sugestoes: [],
        grupoNovo: null,
        avisos,
      };
    const ident = identificarLinha(
      {
        reclamante: bloco.nome,
        cpf_digitos: somenteDigitos(bloco.cpf) || null,
        cpf_valido: bloco.cpfValido,
      },
      indice,
    );
    if (bloco.cpf && !bloco.cpfValido)
      avisos.push(`CPF "${bloco.cpf}" inválido — identificação apenas pelo nome.`);
    if (!bloco.cpf) avisos.push("Bloco sem CPF.");
    let cliente: AcaoCliente;
    const sugestoes: Sugestao[] = [];
    if (ident.status === "encontrado" && ident.cliente_id) {
      cliente = { acao: "existente", id: ident.cliente_id, via: ident.via ?? "nome" };
    } else if (ident.status === "nao_encontrado") {
      for (const { c, n } of ativos) {
        const r = compararNomes(bloco.nomeNormalizado!, n);
        if (r.percentual >= 75)
          sugestoes.push({ tipo: "cliente", id: c.id, nome: c.nome, percentual: r.percentual });
      }
      sugestoes.sort((a, b) => b.percentual - a.percentual).splice(5);
      cliente = sugestoes.some((s) => s.percentual >= LIMIAR_PENDENTE)
        ? {
            acao: "pendente",
            motivo: "Nome parecido com cliente já cadastrado — confirme se é a mesma pessoa.",
          }
        : { acao: "novo", grupo: grupoDe(bloco) };
    } else {
      cliente = { acao: "pendente", motivo: ident.motivo };
      for (const id of ident.candidatos) {
        const c = indice.porId.get(id);
        if (c) sugestoes.push({ tipo: "cliente", id, nome: c.nome, percentual: 100 });
      }
    }
    return {
      bloco,
      identificacao: ident,
      cliente,
      processo: { acao: "nenhum", motivo: "" },
      sugestoes,
      grupoNovo: cliente.acao === "novo" ? cliente.grupo : null,
      avisos,
    };
  });

  // 2) novos clientes: mesmo nome com CPFs diferentes → pendente; nomes parecidos entre si → pendente
  const grupos = new Map<string, AnaliseBloco[]>();
  for (const a of analises)
    if (a.grupoNovo) grupos.set(a.grupoNovo, [...(grupos.get(a.grupoNovo) ?? []), a]);
  for (const [g, lista] of grupos) {
    const cpfs = new Set(
      lista.filter((x) => x.bloco.cpfValido).map((x) => somenteDigitos(x.bloco.cpf)),
    );
    if (cpfs.size > 1) {
      for (const x of lista)
        x.cliente = {
          acao: "pendente",
          motivo:
            "O mesmo nome aparece com CPFs diferentes no arquivo — confirme se são pessoas distintas.",
        };
      grupos.delete(g);
    }
  }
  const chaves = [...grupos.keys()];
  for (let i = 0; i < chaves.length; i++)
    for (let j = i + 1; j < chaves.length; j++) {
      const a = grupos.get(chaves[i]!)![0]!;
      const b = grupos.get(chaves[j]!)![0]!;
      const r = compararNomes(a.bloco.nomeNormalizado!, b.bloco.nomeNormalizado!);
      if (r.percentual < LIMIAR_PENDENTE) continue;
      for (const x of grupos.get(chaves[j]!)!) {
        x.sugestoes.push({
          tipo: "grupo",
          id: chaves[i]!,
          nome: a.bloco.nome!,
          percentual: r.percentual,
        });
        x.cliente = {
          acao: "pendente",
          motivo: `Nome parecido com "${a.bloco.nome}" em outro bloco do arquivo — confirme se é a mesma pessoa.`,
        };
      }
    }

  // 3) processo de cada bloco
  for (const a of analises) a.processo = processoDoBloco(a, processos);
  return analises;
}

function chaveProcessoNovo(b: BlocoLido): string | null {
  if (b.processoDigitos && b.processoDigitos.length >= 15) return `proc:${b.processoDigitos}`;
  const nb = somenteDigitos(b.nb);
  if (nb.length >= 9) return `nb:${nb}`;
  return null;
}

function processoDoBloco(a: AnaliseBloco, processos: readonly ProcessoBase[]): AcaoProcesso {
  const b = a.bloco;
  const novo = chaveProcessoNovo(b);
  if (a.cliente.acao === "novo")
    return novo
      ? { acao: "novo", chave: novo }
      : { acao: "nenhum", motivo: "Bloco sem número de processo ou NB." };
  if (a.cliente.acao !== "existente")
    return { acao: "nenhum", motivo: "Defina o cliente para vincular o processo." };
  const doCliente = processos.filter((p) => p.cliente_id === (a.cliente as { id: string }).id);
  if (b.processoDigitos) {
    const p = doCliente.find((x) => x.numero_digitos === b.processoDigitos);
    if (p) return { acao: "existente", id: p.id, via: "número do processo" };
  }
  const nb = somenteDigitos(b.nb);
  if (nb) {
    const p = doCliente.find((x) => x.nb_digitos === nb);
    if (p) return { acao: "existente", id: p.id, via: "NB" };
  }
  if (b.processoDigitos) return { acao: "novo", chave: novo! };
  if (doCliente.length === 1)
    return { acao: "existente", id: doCliente[0]!.id, via: "único processo do cliente" };
  if (novo) return { acao: "novo", chave: novo };
  if (!doCliente.length)
    return { acao: "nenhum", motivo: "Cliente sem processo cadastrado e bloco sem número/NB." };
  return {
    acao: "nenhum",
    motivo: "Cliente com vários processos e bloco sem número/NB — escolha o processo.",
  };
}

/** Aplica as decisões da prévia (escolhas do usuário prevalecem). */
export function aplicarDecisoes(
  analises: readonly AnaliseBloco[],
  decisoes: ReadonlyMap<string, DecisaoUsuario>,
  processos: readonly ProcessoBase[],
): AnaliseBloco[] {
  return analises.map((a) => {
    const d = decisoes.get(a.bloco.id);
    if (!d) return a;
    let x: AnaliseBloco = { ...a };
    if (d.cliente) {
      if (d.cliente === "novo")
        x = {
          ...x,
          cliente: { acao: "novo", grupo: grupoDe(a.bloco) },
          grupoNovo: grupoDe(a.bloco),
        };
      else if (d.cliente.startsWith("grupo:"))
        x = {
          ...x,
          cliente: { acao: "novo", grupo: d.cliente.slice(6) },
          grupoNovo: d.cliente.slice(6),
        };
      else
        x = { ...x, cliente: { acao: "existente", id: d.cliente, via: "manual" }, grupoNovo: null };
      x.processo = processoDoBloco(x, processos);
    }
    if (d.processo) {
      if (d.processo === "nenhum")
        x = { ...x, processo: { acao: "nenhum", motivo: "Definido na prévia." } };
      else if (d.processo === "novo") {
        const chave = chaveProcessoNovo(a.bloco);
        if (chave) x = { ...x, processo: { acao: "novo", chave } };
      } else x = { ...x, processo: { acao: "existente", id: d.processo, via: "manual" } };
    }
    return x;
  });
}

// ---------------------------------------------------------------------------
// Itens para o banco
// ---------------------------------------------------------------------------

export interface LancamentoItem {
  chave: string;
  categoria: string | null;
  natureza: string;
  descricao: string;
  origem: string;
  canal: string | null;
  destinatario: string;
  valor: number | null;
  valor_recebido?: number | null;
  situacao?: string;
  data: string | null;
  competencia: string | null;
  parcela: string | null;
  percentual: string | null;
  observacao: string | null;
  celulas: string;
  conferencia: string | null;
  dados: Record<string, unknown>;
}

export interface ItemBloco {
  bloco: string;
  aba: string;
  celulas: string;
  cliente:
    | { acao: "existente"; id: string }
    | { acao: "novo"; nome: string; nome_normalizado: string; cpf: string | null };
  processo:
    | { acao: "existente"; id: string }
    | { acao: "nenhum" }
    | {
        acao: "novo";
        numero: string | null;
        numero_digitos: string | null;
        nb: string | null;
        nb_digitos: string | null;
        especie: string | null;
        natureza: string;
        tribunal: string | null;
        info: Record<string, string>;
      };
  nao_havera_sucumbencia: boolean;
  recebimentos: LancamentoItem[];
  previstos: LancamentoItem[];
}

const cents = (v: number) => Math.round(v * 100);

function base(l: LancamentoBloco, b: BlocoLido): Omit<LancamentoItem, "chave" | "valor"> {
  return {
    categoria: l.categoria,
    natureza: l.natureza,
    descricao: ROTULO_NATUREZA[l.natureza],
    origem: l.origem,
    canal: l.canal,
    destinatario: l.destinatario,
    data: l.dataRecebimento,
    competencia: l.competencia,
    parcela: l.parcela,
    percentual: l.percentual,
    observacao: [l.rotulo, ...l.observacoes].filter(Boolean).join(" | ").slice(0, 2000) || null,
    celulas: `${ROTULO_ABA[b.aba]} ${l.celulas}`,
    conferencia: [...l.conferencia, ...b.conferencia].join(" ") || null,
    dados: {
      rotulo: l.rotulo,
      versoes: l.versoes,
      bloco: b.id,
      linhas: `${b.linhaInicial}-${b.linhaFinal}`,
      complementares: b.complementares.map((c) => ({
        rotulo: c.rotulo,
        valor: c.valor,
        celula: c.celula,
      })),
    },
  };
}

/** Itens prontos para o banco. Blocos com cliente pendente ficam de fora (constam no relatório). */
export function montarItensBlocos(analises: readonly AnaliseBloco[]): ItemBloco[] {
  const ocorr = new Map<string, number>();
  const prox = (k: string) => {
    const n = (ocorr.get(k) ?? 0) + 1;
    ocorr.set(k, n);
    return n;
  };
  // Dados do novo cliente por grupo: nome do bloco que originou o grupo; CPF válido de qualquer bloco ligado.
  const dadosGrupo = new Map<string, { nome: string; cpf: string | null }>();
  for (const a of analises) {
    if (a.cliente.acao !== "novo" || !a.bloco.nome || grupoDe(a.bloco) !== a.cliente.grupo)
      continue;
    const atual = dadosGrupo.get(a.cliente.grupo);
    dadosGrupo.set(a.cliente.grupo, {
      nome: atual?.nome ?? a.bloco.nome,
      cpf: atual?.cpf ?? (a.bloco.cpfValido ? a.bloco.cpf : null),
    });
  }
  for (const a of analises) {
    if (a.cliente.acao !== "novo" || !a.bloco.cpfValido) continue;
    const atual = dadosGrupo.get(a.cliente.grupo);
    if (atual && !atual.cpf) atual.cpf = a.bloco.cpf;
  }
  const itens: ItemBloco[] = [];
  for (const a of analises) {
    const b = a.bloco;
    if (a.cliente.acao === "pendente" || !b.nome) continue;
    const dono = a.cliente.acao === "existente" ? a.cliente.id : a.cliente.grupo;
    const procKey = b.processoDigitos || somenteDigitos(b.nb) || "sp";
    const recebimentos: LancamentoItem[] = [];
    const previstos: LancamentoItem[] = [];
    for (const l of b.lancamentos) {
      const raiz = `vb:${b.aba}:${l.categoria ?? "x"}:${l.natureza}`;
      const recebido =
        l.situacao === "recebido"
          ? (l.valorRecebido ?? l.valor)
          : l.situacao === "parcial"
            ? l.valorRecebido
            : null;
      if (recebido && recebido > 0)
        recebimentos.push({
          ...base(l, b),
          chave: `${raiz}:${cents(recebido)}:${prox(`${dono}|${raiz}:${cents(recebido)}`)}`,
          valor: recebido,
        });
      if (l.situacao === "recebido") continue;
      const saldo =
        l.valor === null
          ? null
          : Math.max(
              0,
              Math.round(
                (l.valor - (l.situacao === "parcial" ? (l.valorRecebido ?? 0) : 0)) * 100,
              ) / 100,
            );
      previstos.push({
        ...base(l, b),
        chave: `${raiz}:${procKey}:${prox(`${dono}|${raiz}:${procKey}`)}`,
        valor: l.valor,
        valor_recebido: l.situacao === "parcial" ? (l.valorRecebido ?? 0) : 0,
        situacao: l.situacao,
        dados: { ...base(l, b).dados, saldo },
      });
    }
    const info: Record<string, string> = { ...b.beneficio };
    if (b.nb) info["NB"] = b.nb;
    if (b.cpf) info["CPF"] = b.cpf;
    if (b.tribunal) info["Tribunal"] = b.tribunal;
    itens.push({
      bloco: b.id,
      aba: ROTULO_ABA[b.aba],
      celulas: `${b.coluna}${b.linhaInicial}:${b.coluna}${b.linhaFinal}`,
      cliente:
        a.cliente.acao === "existente"
          ? { acao: "existente", id: a.cliente.id }
          : (() => {
              const g = dadosGrupo.get(a.cliente.grupo) ?? {
                nome: b.nome!,
                cpf: b.cpfValido ? b.cpf : null,
              };
              return {
                acao: "novo" as const,
                nome: g.nome,
                nome_normalizado: normalizarTexto(g.nome),
                cpf: g.cpf,
              };
            })(),
      processo:
        a.processo.acao === "existente"
          ? { acao: "existente", id: a.processo.id }
          : a.processo.acao === "novo"
            ? {
                acao: "novo",
                numero: b.processo,
                numero_digitos: b.processoDigitos,
                nb: b.nb,
                nb_digitos: somenteDigitos(b.nb) || null,
                especie: b.especie,
                natureza: b.aba === "administrativa" ? "administrativo" : "judicial",
                tribunal: b.tribunal,
                info,
              }
            : { acao: "nenhum" },
      nao_havera_sucumbencia: b.naoHaveraSucumbencia,
      recebimentos,
      previstos,
    });
  }
  return itens;
}

// ---------------------------------------------------------------------------
// Resumo da prévia
// ---------------------------------------------------------------------------

export interface TotaisCategoria {
  recebido: number;
  previsto: number;
}

export interface ResumoBlocos {
  blocosPorAba: Record<string, number>;
  clientesExistentes: number;
  clientesNovos: number;
  pendentes: number;
  processosVinculados: number;
  processosNovos: number;
  semProcesso: number;
  recebimentos: number;
  previstos: number;
  conferencia: number;
  duplicidadesEvitadas: number;
  ignoradas: number;
  /** categoria|origem → totais */
  totais: Record<string, TotaisCategoria>;
}

export function resumirBlocos(
  leitura: LeituraBlocos,
  analises: readonly AnaliseBloco[],
): ResumoBlocos {
  const itens = montarItensBlocos(analises);
  const totais: Record<string, TotaisCategoria> = {};
  const somar = (k: string, campo: keyof TotaisCategoria, v: number | null) => {
    totais[k] = totais[k] ?? { recebido: 0, previsto: 0 };
    totais[k]![campo] = Math.round((totais[k]![campo] + (v ?? 0)) * 100) / 100;
  };
  for (const i of itens) {
    for (const r of i.recebimentos)
      somar(`${r.categoria ?? "conferencia"}|${r.origem}`, "recebido", r.valor);
    for (const p of i.previstos) {
      const saldo = (p.dados as { saldo?: number | null }).saldo ?? null;
      somar(`${p.categoria ?? "conferencia"}|${p.origem}`, "previsto", saldo);
    }
  }
  const novos = new Set(
    itens
      .filter((i) => i.cliente.acao === "novo")
      .map((i) => (i.cliente as { nome_normalizado: string }).nome_normalizado),
  );
  const existentes = new Set(
    itens
      .filter((i) => i.cliente.acao === "existente")
      .map((i) => (i.cliente as { id: string }).id),
  );
  return {
    blocosPorAba: Object.fromEntries(leitura.abas.map((a) => [a.nome, a.blocos])),
    clientesExistentes: existentes.size,
    clientesNovos: novos.size,
    pendentes: analises.filter((a) => a.cliente.acao === "pendente").length,
    processosVinculados: analises.filter(
      (a) => a.cliente.acao !== "pendente" && a.processo.acao === "existente",
    ).length,
    processosNovos: new Set(
      analises
        .filter((a) => a.cliente.acao !== "pendente" && a.processo.acao === "novo")
        .map(
          (a) =>
            `${a.cliente.acao === "existente" ? a.cliente.id : a.grupoNovo}|${(a.processo as { chave: string }).chave}`,
        ),
    ).size,
    semProcesso: analises.filter(
      (a) =>
        a.cliente.acao !== "pendente" && a.processo.acao === "nenhum" && a.bloco.lancamentos.length,
    ).length,
    recebimentos: itens.reduce((s, i) => s + i.recebimentos.length, 0),
    previstos: itens.reduce((s, i) => s + i.previstos.length, 0),
    conferencia: analises.reduce(
      (s, a) =>
        s +
        a.bloco.lancamentos.filter((l) => l.conferencia.length).length +
        (a.bloco.conferencia.length ? 1 : 0),
      0,
    ),
    duplicidadesEvitadas: leitura.duplicidades.length,
    ignoradas: leitura.ignoradas.length,
    totais,
  };
}
