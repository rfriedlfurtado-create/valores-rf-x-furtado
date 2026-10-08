/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas/funções novas ainda sem tipos gerados (types.ts) */
/**
 * Acesso ao banco da modalidade "Clientes com Valores Recebidos": leitura da
 * base para identificação e gravação (prévia com rollback / gravação em lotes)
 * pela função `aplicar_importacao_recebimentos`.
 */

import { db } from "@/lib/furtado/persistencia";
import { somenteDigitos } from "@/lib/rf/valores";

import type {
  ClienteBase,
  ItemRecebimento,
  ProcessoBase,
  ResumoPrevia,
  VariacaoBase,
} from "./identificacao";

function falha(msg: string): never {
  throw new Error(msg);
}

async function todas<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: any }>,
): Promise<T[]> {
  const out: T[] = [];
  const passo = 1000;
  for (let de = 0; ; de += passo) {
    const { data, error } = await consulta(de, de + passo - 1);
    if (error) falha(error.message);
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < passo) return out;
  }
}

export interface BaseIdentificacao {
  clientes: ClienteBase[];
  variacoes: VariacaoBase[];
  processos: ProcessoBase[];
}

/** NB guardado no processo (campos "NB"/"nb" dos dados ou informações adicionais). */
function nbDoRegistro(a: any): string | null {
  for (const fonte of [a.dados_rf ?? {}, a.informacoes_adicionais ?? {}])
    for (const [k, v] of Object.entries(fonte as Record<string, unknown>))
      if (/^nb\b|n[uú]mero do benef/i.test(k) && typeof v === "string") {
        const d = somenteDigitos(v);
        if (d.length >= 9) return d;
      }
  return null;
}

/** Lê a base atual (sempre do banco, sem cache) para identificar os clientes. */
export async function carregarBaseIdentificacao(): Promise<BaseIdentificacao> {
  const [clientes, variacoes, atendimentos] = await Promise.all([
    todas<ClienteBase>((de, ate) =>
      db
        .from("clientes")
        .select("id,nome,cpf,status,deleted_at,arquivado")
        .is("deleted_at", null)
        .order("id")
        .range(de, ate),
    ),
    todas<VariacaoBase>((de, ate) =>
      db.from("variacoes_nome").select("cliente_id,nome_variacao").order("id").range(de, ate),
    ),
    todas<any>((de, ate) =>
      db
        .from("atendimentos")
        .select(
          "id,cliente_id,processo_digitos,numero_processo,servico,dados_rf,informacoes_adicionais,pago",
        )
        .is("deleted_at", null)
        .order("id")
        .range(de, ate),
    ),
  ]);
  const processos: ProcessoBase[] = atendimentos.map((a) => ({
    id: a.id,
    cliente_id: a.cliente_id,
    numero_digitos:
      a.processo_digitos || somenteDigitos(a.dados_rf?.numero ?? a.numero_processo ?? "") || null,
    pasta: a.dados_rf?.pasta ?? null,
    numero: a.dados_rf?.numero || a.numero_processo || null,
    tipo_acao: a.dados_rf?.tipo_acao || a.servico || null,
    pago: Boolean(a.pago),
    nb_digitos: nbDoRegistro(a),
  }));
  return { clientes, variacoes, processos };
}

export type ResultadoRecebimento =
  | "inserido"
  | "ja_registrado"
  | "possivel_duplicado"
  | "cliente_indisponivel"
  | "valor_invalido"
  | "marcado_pago"
  | "ja_pago"
  | "processo_nao_definido"
  | "sem_valor"
  | "conflito_nao_havera";

export interface LinhaResultado {
  linha: number;
  cliente_id: string;
  chave: string;
  resultado: ResultadoRecebimento;
  /** O processo (ou o cliente sem processo) foi para JÁ PAGOS. */
  movido: boolean;
  pagamento_id: string | null;
  atendimento_id?: string | null;
}

export const ROTULO_RESULTADO: Record<ResultadoRecebimento, string> = {
  inserido: "Novo valor",
  ja_registrado: "Já registrado (não duplica)",
  possivel_duplicado: "Valor igual já lançado manualmente",
  cliente_indisponivel: "Cliente indisponível",
  valor_invalido: "Valor inválido",
  marcado_pago: "Sem valor — lançar no perfil",
  ja_pago: "Sem valor — processo já estava em JÁ PAGOS",
  processo_nao_definido: "Escolha o processo",
  sem_valor: "Sem valor — lançar no perfil",
  conflito_nao_havera: "Não lançado: processo marcado “Não haverá sucumbência”",
};

/** Itens por chamada (cada chamada é uma transação). */
export const ITENS_POR_LOTE = 250;

async function chamar(
  itens: ItemRecebimento[],
  arquivo: string,
  aba: string,
  simular: boolean,
  importacaoId: string | null,
): Promise<{ importacao_id: string | null; linhas: LinhaResultado[] }> {
  const { data, error } = await db.rpc("aplicar_importacao_recebimentos", {
    p_itens: itens,
    p_arquivo: arquivo,
    p_aba: aba,
    p_simular: simular,
    p_importacao_id: importacaoId,
  });
  if (error) falha(error.message);
  return data as { importacao_id: string | null; linhas: LinhaResultado[] };
}

function partes<T>(lista: T[], tamanho: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) out.push(lista.slice(i, i + tamanho));
  return out;
}

/** Prévia: mesmas regras da gravação, tudo desfeito no banco. */
export async function simularRecebimentos(
  itens: ItemRecebimento[],
  arquivo: string,
  aba: string,
): Promise<LinhaResultado[]> {
  if (itens.length === 0) return [];
  const out: LinhaResultado[] = [];
  for (const bloco of partes(itens, 1500))
    out.push(...(await chamar(bloco, arquivo, aba, true, null)).linhas);
  return out;
}

/** Gravação em partes sequenciais (idempotente: repetir após falha não duplica). */
export async function gravarRecebimentos(
  itens: ItemRecebimento[],
  arquivo: string,
  aba: string,
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<{ importacaoId: string | null; linhas: LinhaResultado[] }> {
  let importacaoId: string | null = null;
  const out: LinhaResultado[] = [];
  for (const bloco of partes(itens, ITENS_POR_LOTE)) {
    const r = await chamar(bloco, arquivo, aba, false, importacaoId);
    importacaoId = r.importacao_id;
    out.push(...r.linhas);
    aoProgredir?.(out.length, itens.length);
  }
  return { importacaoId, linhas: out };
}

export async function registrarResumoRecebimentos(
  importacaoId: string,
  resumo: ResumoPrevia,
  revisao: { linha: number; reclamante: string; motivo: string }[],
): Promise<void> {
  const { error } = await db
    .from("importacoes")
    .update({
      resumo: { ...resumo, revisao },
      quantidade_clientes: resumo.clientesIdentificados,
      quantidade_possiveis: resumo.revisao,
    })
    .eq("id", importacaoId);
  if (error) falha(error.message);
}
