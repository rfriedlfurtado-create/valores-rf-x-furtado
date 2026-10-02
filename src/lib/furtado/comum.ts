/**
 * Interpretação comum de textos livres dentro de um bloco (observações,
 * anotações laterais). Usada por todas as estratégias de leitura.
 */

import { Contexto, k } from "./contexto";
import {
  aplicarTextoRequisicao,
  detectarPagamento,
  detectarParceria,
  lerParcelamento,
  sinaisRequisicao,
  type ParcelamentoLido,
} from "./detectores";
import type { Celula } from "./planilha";
import type { Bloco, CategoriaFinanceira, LancamentoRascunho } from "./modelo";
import {
  arred,
  compactar,
  cpfsNoTexto,
  extrairNome,
  lerDadosBancarios,
  nbsNoTexto,
  primeiraData,
  processosNoTexto,
} from "./texto";

/** Parcelamentos encontrados no bloco, para montar cobranças no final. */
export interface ParcelamentoNoBloco {
  parcelamento: ParcelamentoLido;
  celula: string;
  categoria: CategoriaFinanceira | null;
  valorLinha: number | null;
}

const parcelamentosPorBloco = new WeakMap<Bloco, ParcelamentoNoBloco[]>();

export function parcelamentosDoBloco(bloco: Bloco): ParcelamentoNoBloco[] {
  return parcelamentosPorBloco.get(bloco) ?? [];
}

export function registrarIdentificadores(bloco: Bloco, texto: string, celula: string): void {
  for (const p of processosNoTexto(texto)) {
    if (!bloco.dados.processos.some((x) => x.digitos === p.digitos)) {
      bloco.dados.processos.push({
        numero: p.numero,
        digitos: p.digitos,
        sufixo: p.sufixo,
        celula,
      });
    }
  }
  for (const c of cpfsNoTexto(texto)) if (!bloco.dados.cpfs.includes(c)) bloco.dados.cpfs.push(c);
  for (const n of nbsNoTexto(texto))
    if (!bloco.dados.nbs.includes(n.nb)) bloco.dados.nbs.push(n.nb);
}

export interface OpcoesTextoLivre {
  /** Rótulo/campo da linha (para prefixar o histórico). */
  campoLinha?: string | null;
  categoriaLinha?: CategoriaFinanceira | null;
  valorLinha?: number | null;
  categoriaHistorico?: string;
  /** Texto pertence a uma coluna lateral. */
  lateral?: boolean;
}

/**
 * Interpreta um texto livre e define o destino da célula. Retorna true se o
 * texto foi levado a um campo estruturado (além do histórico).
 */
export function interpretarTextoLivre(
  ctx: Contexto,
  bloco: Bloco,
  cel: Celula,
  opcoes: OpcoesTextoLivre = {},
): void {
  const texto = cel.texto;
  const chave = ctx.incluir(bloco, cel);
  registrarIdentificadores(bloco, texto, chave);
  let estruturado: string | null = null;

  // Dados bancários
  if (/dados banc|banco|ag[êe]ncia|\bc\/c\b|conta corrente/i.test(texto)) {
    const banc = lerDadosBancarios(texto);
    if (banc && (banc.agencia || banc.conta)) {
      bloco.dados.bancarios.push({ ...banc, textoOriginal: compactar(texto), celulas: [chave] });
      estruturado = "dados_bancarios";
    }
  }

  // Requisição (RPV / precatório / TED)
  if (sinaisRequisicao(texto)) {
    bloco.dados.requisicoes[0] = aplicarTextoRequisicao(
      bloco.dados.requisicoes[0] ?? null,
      texto,
      chave,
      opcoes.categoriaLinha ?? null,
    )!;
    estruturado = estruturado ?? "requisicao";
  }

  // Pagamento mencionado
  const pag = detectarPagamento(texto, chave, {
    valor: opcoes.valorLinha ?? null,
    categoria: opcoes.categoriaLinha ?? null,
  });
  if (pag) {
    bloco.dados.pagamentos.push(pag);
    ctx.pendencia(bloco, {
      tipo: "confirmar_recebimento",
      bloqueante: false,
      descricao: `Pagamento mencionado: "${pag.texto}". ${
        pag.indefinido
          ? "Não está claro qual valor foi pago, quando ou quem recebeu — confirme antes de registrar."
          : "Confirme para registrar o recebimento."
      }`,
      celulas: [chave],
      dados: {
        valor: pag.valor,
        data: pag.data?.iso ?? null,
        dataTexto: pag.data?.texto ?? null,
        categoria: pag.categoria,
      },
    });
  }

  // Parcelamento
  const parc = lerParcelamento(texto);
  if (parc) {
    const lista = parcelamentosPorBloco.get(bloco) ?? [];
    lista.push({
      parcelamento: parc,
      celula: chave,
      categoria: opcoes.categoriaLinha ?? null,
      valorLinha: opcoes.valorLinha ?? null,
    });
    parcelamentosPorBloco.set(bloco, lista);
    estruturado = estruturado ?? "cobranca";
  }

  // Parceria / repasse a outros profissionais (somente preservado)
  if (detectarParceria(texto)) {
    bloco.dados.parceria = bloco.dados.parceria
      ? `${bloco.dados.parceria} | ${compactar(texto)}`
      : compactar(texto);
  }

  // Pessoa mencionada em coluna lateral (sem frase): revisar.
  if (opcoes.lateral) {
    const nome = extrairNome(texto);
    if (nome && !nome.complemento && !nome.incompleto && nome.nome.split(" ").length <= 5) {
      ctx.pendencia(bloco, {
        tipo: "mencao_pessoa",
        bloqueante: false,
        descricao: `Nome "${nome.nome}" anotado em coluna lateral. Verifique se é representante, dependente ou outra pessoa.`,
        celulas: [chave],
        dados: { nome: nome.nome },
      });
    }
  }

  const prefixo = opcoes.campoLinha ? `[${opcoes.campoLinha}] ` : "";
  bloco.dados.historico.push({
    categoria: opcoes.categoriaHistorico ?? (opcoes.lateral ? "anotacao" : "observacao"),
    texto: prefixo + texto.trim(),
    dataTexto: primeiraData(texto)?.texto ?? null,
    celulas: [chave],
  });
  ctx.destinar(
    cel,
    "historico",
    estruturado ? `historico+${estruturado}` : "historico",
    "interpretado",
    estruturado ? { estruturado } : undefined,
    bloco.ref,
  );
}

/** Lançamento padrão. */
export function lancamento(
  parcial: Partial<LancamentoRascunho> &
    Pick<LancamentoRascunho, "categoria" | "rotuloOriginal" | "celulas">,
): LancamentoRascunho {
  return {
    natureza: "devido",
    valor: null,
    valorTexto: null,
    percentual: null,
    baseCalculo: null,
    quantidadeBeneficios: null,
    ausenciaDeclarada: null,
    versao: 1,
    coluna: "B",
    dataReferencia: null,
    situacaoTexto: null,
    observacao: null,
    principal: true,
    ...parcial,
    ...(parcial.valor !== undefined && parcial.valor !== null
      ? { valor: arred(parcial.valor) }
      : {}),
  };
}

export { k };
