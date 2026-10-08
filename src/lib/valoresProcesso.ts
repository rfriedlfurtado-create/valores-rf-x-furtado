/**
 * VALORES RECEBIDOS por PROCESSO — regras puras (testadas em
 * tests/valores-processo.test.ts). Espelham as funções do banco
 * (_pendencia_categoria / pendencias_finalizacao, migração
 * 20261006120000_valores_recebidos_por_categoria.sql), que são a garantia
 * final: aqui servem para mostrar a situação nos cards e avisar antes.
 *
 * - Cada card soma SOMENTE os recebimentos do processo selecionado e da
 *   categoria (nunca de outro processo, nunca pelo nome/CPF do cliente).
 * - Recebido = há recebimento E (recebimento integral confirmado OU
 *   recebido >= total a receber informado).
 * - Sucumbência também se resolve com "Não haverá sucumbência" (sem valor).
 * - Campo vazio nunca é valor recebido (só valores > 0 contam).
 */

import type { ClassificacaoEntrada, Pagamento } from "./tipos";

export const CATEGORIAS_PROCESSO: ClassificacaoEntrada[] = [
  "atrasados",
  "implantacao",
  "sucumbencia",
];

export const ROTULO_CATEGORIA_PROCESSO: Record<ClassificacaoEntrada, string> = {
  atrasados: "Atrasados",
  implantacao: "Contratual",
  sucumbencia: "Sucumbência",
};

/** Linha de `processo_categorias`. */
export interface CategoriaProcessoCfg {
  id?: string;
  atendimento_id: string;
  categoria: ClassificacaoEntrada;
  total_previsto: number | null;
  integral_confirmado: boolean;
  nao_havera: boolean;
  updated_at?: string;
}

export type StatusCategoria = "pendente" | "recebido" | "nao_havera";

export const ROTULO_STATUS_CATEGORIA: Record<StatusCategoria, string> = {
  pendente: "Pendente",
  recebido: "Recebido",
  nao_havera: "Não haverá sucumbência",
};

export interface SituacaoCategoria {
  /** Recebido pelo cliente (não entra no total do escritório). */
  totalCliente: number;
  /** Subtotais do escritório por origem (judicial / administrativo / não informada). */
  porOrigem: { judicial: number; administrativo: number; sem: number };
  /** Saldo pendente dos VALORES PREVISTOS desta categoria (não é recebido). */
  pendente: number;
  previstos: PrevistoMinimo[];
  categoria: ClassificacaoEntrada;
  status: StatusCategoria;
  /** Soma dos recebimentos (> 0) desta categoria neste processo. */
  total: number;
  quantidade: number;
  registros: Pagamento[];
  totalPrevisto: number | null;
  /** Saldo a receber (só quando há total a receber informado). */
  saldo: number | null;
  integralConfirmado: boolean;
  naoHavera: boolean;
  /** Há recebimento, mas ainda não integral. */
  parcial: boolean;
  /** Integral por ter alcançado o total a receber (sem confirmação manual). */
  integralPeloTotal: boolean;
  /** Texto da pendência (null = resolvida). */
  pendencia: string | null;
}

const arredondar = (v: number) => Math.round(v * 100) / 100;

const formatar = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Recebimentos do processo (somente dele), ordenados por data. */
export function recebimentosDoProcesso(
  pagamentos: readonly Pagamento[],
  atendimentoId: string,
): Pagamento[] {
  return pagamentos
    .filter((p) => p.atendimento_id === atendimentoId)
    .sort(
      (a, b) =>
        a.data_pagamento.localeCompare(b.data_pagamento) ||
        (a.linha_importacao ?? 0) - (b.linha_importacao ?? 0) ||
        a.created_at.localeCompare(b.created_at),
    );
}

/** Valor previsto mínimo para os cards (tabela valores_previstos). */
export interface PrevistoMinimo {
  id: string;
  atendimento_id: string | null;
  categoria: ClassificacaoEntrada | null;
  valor: number | null;
  valor_recebido: number;
  situacao: string;
  origem?: string | null;
}

const SITUACOES_PENDENTES_PREVISTO = ["a_receber", "parcial", "nao_confirmado"];

export function saldoDoPrevisto(v: PrevistoMinimo): number {
  if (!SITUACOES_PENDENTES_PREVISTO.includes(v.situacao) || v.valor === null) return 0;
  return Math.max(0, arredondar(Number(v.valor) - Number(v.valor_recebido ?? 0)));
}

export function situacaoCategoria(
  pagamentosDoProcesso: readonly Pagamento[],
  categoria: ClassificacaoEntrada,
  cfg: CategoriaProcessoCfg | null | undefined,
  previstosDoProcesso: readonly PrevistoMinimo[] = [],
): SituacaoCategoria {
  const registros = pagamentosDoProcesso.filter(
    (p) => p.classificacao === categoria && Number(p.valor) > 0,
  );
  // TOTAL do card = recebimentos do ESCRITÓRIO (valores recebidos pelo cliente ficam à parte).
  const doEscritorio = registros.filter((p) => p.destinatario !== "cliente");
  const total = arredondar(doEscritorio.reduce((s, p) => s + Number(p.valor), 0));
  const totalCliente = arredondar(
    registros.filter((p) => p.destinatario === "cliente").reduce((s, p) => s + Number(p.valor), 0),
  );
  const porOrigem = { judicial: 0, administrativo: 0, sem: 0 };
  for (const p of doEscritorio) {
    const k = p.origem === "judicial" || p.origem === "administrativo" ? p.origem : "sem";
    porOrigem[k] = arredondar(porOrigem[k] + Number(p.valor));
  }
  const previstos = previstosDoProcesso.filter((v) => v.categoria === categoria);
  const pendente = arredondar(previstos.reduce((s, v) => s + saldoDoPrevisto(v), 0));
  const quantidade = doEscritorio.length; // só recebimentos do escritório definem a situação
  const totalPrevisto = cfg?.total_previsto != null ? Number(cfg.total_previsto) : null;
  const integralConfirmado = Boolean(cfg?.integral_confirmado);
  const naoHavera = categoria === "sucumbencia" && Boolean(cfg?.nao_havera);
  const integralPeloTotal = quantidade > 0 && totalPrevisto !== null && total >= totalPrevisto;
  const saldo = totalPrevisto !== null ? Math.max(0, arredondar(totalPrevisto - total)) : null;
  const rotulo = ROTULO_CATEGORIA_PROCESSO[categoria];

  let status: StatusCategoria;
  let pendencia: string | null = null;
  if (naoHavera && quantidade === 0) {
    status = "nao_havera";
  } else if (quantidade === 0) {
    status = "pendente";
    pendencia =
      categoria === "sucumbencia"
        ? `${rotulo} (nenhum recebimento registrado e não marcado “Não haverá sucumbência”)`
        : `${rotulo} (nenhum recebimento registrado)`;
  } else if (integralConfirmado || integralPeloTotal) {
    status = "recebido";
  } else {
    status = "pendente";
    pendencia = `${rotulo} (recebimento parcial — falta confirmar o recebimento integral${
      saldo !== null ? `; saldo pendente ${formatar(saldo)}` : ""
    })`;
  }

  return {
    categoria,
    status,
    total,
    totalCliente,
    porOrigem,
    pendente,
    previstos,
    quantidade,
    registros,
    totalPrevisto,
    saldo,
    integralConfirmado,
    naoHavera,
    parcial: status === "pendente" && quantidade > 0,
    integralPeloTotal,
    pendencia,
  };
}

export interface ValoresDoProcesso {
  categorias: Record<ClassificacaoEntrada, SituacaoCategoria>;
  /** TOTAL RECEBIDO do processo = Atrasados + Contratual + Sucumbência (escritório). */
  totalRecebido: number;
  quantidadeRecebimentos: number;
  /** Saldo pendente dos valores previstos do processo (todas as categorias). */
  totalPendente: number;
  /** Recebimentos do processo sem categoria — para conferência. */
  semCategoria: Pagamento[];
  /** Pendências para finalizar (vazio = pode ser marcado como pago). */
  pendencias: string[];
  podeFinalizar: boolean;
}

export function valoresDoProcesso(
  pagamentos: readonly Pagamento[],
  cfgs: readonly CategoriaProcessoCfg[],
  atendimentoId: string,
  previstos: readonly PrevistoMinimo[] = [],
): ValoresDoProcesso {
  const doProcesso = recebimentosDoProcesso(pagamentos, atendimentoId);
  const previstosDoProcesso = previstos.filter((v) => v.atendimento_id === atendimentoId);
  const categorias = Object.fromEntries(
    CATEGORIAS_PROCESSO.map((c) => [
      c,
      situacaoCategoria(
        doProcesso,
        c,
        cfgs.find((x) => x.atendimento_id === atendimentoId && x.categoria === c),
        previstosDoProcesso,
      ),
    ]),
  ) as Record<ClassificacaoEntrada, SituacaoCategoria>;
  const pendencias = CATEGORIAS_PROCESSO.map((c) => categorias[c].pendencia).filter(
    (p): p is string => Boolean(p),
  );
  return {
    categorias,
    totalRecebido: arredondar(CATEGORIAS_PROCESSO.reduce((s, c) => s + categorias[c].total, 0)),
    quantidadeRecebimentos: CATEGORIAS_PROCESSO.reduce(
      (s, c) => s + categorias[c].registros.filter((p) => p.destinatario !== "cliente").length,
      0,
    ),
    totalPendente: arredondar(previstosDoProcesso.reduce((s, v) => s + saldoDoPrevisto(v), 0)),
    semCategoria: doProcesso.filter((p) => !p.classificacao && Number(p.valor) > 0),
    pendencias,
    podeFinalizar: pendencias.length === 0,
  };
}

/** Situação devolvida pelas ações do banco para cada processo afetado. */
export interface SituacaoProcessoBanco {
  atendimento_id: string;
  numero: string;
  pago: boolean;
  reaberto: boolean;
  pendencias: string[];
}

/** Mensagem quando um processo finalizado voltou para pendente (ou null). */
export function mensagemReabertura(processos: readonly SituacaoProcessoBanco[]): string | null {
  const reabertos = processos.filter((p) => p.reaberto);
  if (!reabertos.length) return null;
  return reabertos
    .map(
      (p) =>
        `Processo ${p.numero} voltou para PENDENTE (CLIENTES): deixou de cumprir os requisitos de finalização. Falta: ${p.pendencias.join("; ")}.`,
    )
    .join(" ");
}
