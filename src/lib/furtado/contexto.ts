/**
 * Contexto compartilhado da análise: registro de destinos das células,
 * criação de blocos e pendências. Garante que TODA célula preenchida termine
 * com um destino rastreável.
 */

import type { Aba, Celula } from "./planilha";
import {
  chaveCelula,
  dadosBlocoVazio,
  type Bloco,
  type Destino,
  type DestinoCelula,
  type PendenciaRascunho,
  type PerfilAba,
  type SituacaoCelula,
  type TipoBloco,
} from "./modelo";
import type { NomeExtraido } from "./texto";

/** Prioridade para não rebaixar um destino já atribuído. */
const PESO_DESTINO: Record<Destino, number> = {
  campo: 4,
  pendencia_revisao: 5,
  resumo_arquivo: 3,
  historico: 2,
  informacao_adicional: 1,
};

export class Contexto {
  readonly destinos = new Map<string, DestinoCelula>();
  readonly blocos: Bloco[] = [];
  readonly pendenciasArquivo: PendenciaRascunho[] = [];
  /** Células reservadas (ex.: totais gerais) que a segmentação deve ignorar. */
  readonly reservadas = new Set<string>();
  private contadorBlocos = new Map<string, number>();

  destinar(
    cel: Celula,
    destino: Destino,
    ref: string,
    situacao: SituacaoCelula = "interpretado",
    interpretado?: unknown,
    blocoRef: string | null = null,
    forcar = false,
  ): void {
    const k = chaveCelula(cel.aba, cel.ref);
    const atual = this.destinos.get(k);
    if (atual && !forcar && PESO_DESTINO[atual.destino] > PESO_DESTINO[destino]) {
      // Mantém o destino mais específico, mas registra a interpretação adicional.
      if (interpretado !== undefined && atual.interpretado === undefined)
        atual.interpretado = interpretado;
      if (!atual.blocoRef && blocoRef) atual.blocoRef = blocoRef;
      return;
    }
    this.destinos.set(k, {
      destino,
      ref,
      situacao,
      interpretado: interpretado ?? atual?.interpretado,
      blocoRef: blocoRef ?? atual?.blocoRef ?? null,
    });
  }

  temDestino(cel: Celula): boolean {
    return this.destinos.has(chaveCelula(cel.aba, cel.ref));
  }

  /** Marca como incerta (mantém o destino) e garante vínculo com o bloco. */
  marcarIncerta(cel: Celula): void {
    const d = this.destinos.get(chaveCelula(cel.aba, cel.ref));
    if (d && d.situacao === "interpretado") d.situacao = "incerto";
  }

  novoBloco(params: {
    aba: Aba;
    perfil: PerfilAba;
    tipo: TipoBloco;
    linhaInicio: number;
    colunaBase: number;
    nome?: NomeExtraido | null;
    celulaNome?: string | null;
  }): Bloco {
    const ordem = (this.contadorBlocos.get(params.aba.nome) ?? 0) + 1;
    this.contadorBlocos.set(params.aba.nome, ordem);
    const bloco: Bloco = {
      ref: `${params.aba.indice + 1}.${ordem}`,
      aba: params.aba.nome,
      perfil: params.perfil,
      tipo: params.tipo,
      linhaInicio: params.linhaInicio,
      linhaFim: params.linhaInicio,
      colunaBase: params.colunaBase,
      intervalo: "",
      nome: params.nome ?? null,
      celulaNome: params.celulaNome ?? null,
      ordem,
      celulas: [],
      dados: dadosBlocoVazio(),
      pendencias: [],
    };
    this.blocos.push(bloco);
    return bloco;
  }

  incluir(bloco: Bloco, cel: Celula): string {
    const k = chaveCelula(cel.aba, cel.ref);
    if (!bloco.celulas.includes(k)) bloco.celulas.push(k);
    bloco.linhaInicio = Math.min(bloco.linhaInicio, cel.linha);
    bloco.linhaFim = Math.max(bloco.linhaFim, cel.linha);
    return k;
  }

  pendencia(bloco: Bloco | null, p: PendenciaRascunho): void {
    const comBloco = { ...p, blocoRef: bloco?.ref ?? p.blocoRef ?? null };
    if (bloco) bloco.pendencias.push(comBloco);
    else this.pendenciasArquivo.push(comBloco);
    for (const k of p.celulas) {
      const d = this.destinos.get(k);
      if (d && d.situacao === "interpretado") d.situacao = "incerto";
    }
  }
}

export function k(cel: Celula): string {
  return chaveCelula(cel.aba, cel.ref);
}
