/**
 * Linhas do LOTE de importação (puro, sem banco): o que é gravado em
 * import_pessoas, import_pendencias, import_blocos e import_celulas.
 * Usado pela tela (via Supabase) e pelos testes de integração (via SQL).
 */

import { recalcular } from "./formulas";
import type { PlanilhaLida } from "./planilha";
import { chaveCelula, type AnaliseFurtado, type PendenciaRascunho } from "./modelo";
import type { PlanoFurtado } from "./planejador";

export interface LinhaPessoa {
  lote_id: string;
  ref: string;
  nome: string;
  nome_normalizado: string;
  acao: "criar" | "vincular" | "pendente" | "ignorar";
  cliente_id: string | null;
  status: "pendente" | "ignorado";
  motivo: string;
  candidatos: unknown;
  payload: unknown;
}

export interface LinhaPendencia {
  lote_id: string;
  pessoa_ref: string | null;
  bloco_ref: string | null;
  tipo: string;
  bloqueante: boolean;
  descricao: string;
  celulas: string[];
  dados: unknown;
}

export interface LinhaBloco {
  lote_id: string;
  ref: string;
  aba: string;
  intervalo: string;
  tipo: string;
  nome_original: string | null;
  nome_detectado: string | null;
  pessoa_ref: string | null;
  status: string;
  dados: unknown;
}

export interface LinhaCelula {
  lote_id: string;
  aba: string;
  celula: string;
  linha: number;
  coluna: number;
  valor_original: string;
  tipo: string;
  formula: string | null;
  resultado_armazenado: string | null;
  resultado_recalculado: string | null;
  formato: string | null;
  metadados: unknown;
  bloco_ref: string | null;
  valor_interpretado: unknown;
  destino: string;
  destino_ref: string;
  situacao: string;
}

export function linhasPessoas(loteId: string, plano: PlanoFurtado): LinhaPessoa[] {
  return plano.pessoas.map((p) => ({
    lote_id: loteId,
    ref: p.ref,
    nome: p.nome,
    nome_normalizado: p.nomeNormalizado,
    acao: p.pronta ? p.acao : p.acao === "ignorar" ? "ignorar" : "pendente",
    cliente_id: p.pronta && p.acao === "vincular" ? p.clienteId : null,
    status: p.acao === "ignorar" ? "ignorado" : "pendente",
    motivo: p.motivo,
    candidatos: p.candidatos,
    payload: {
      ...p.payload,
      blocos: p.blocos,
      sugestao: p.clienteId,
      correspondencia: p.correspondencia,
      resumo: p.resumo,
    },
  }));
}

export function linhasPendencias(loteId: string, plano: PlanoFurtado): LinhaPendencia[] {
  const vistas = new Set<string>();
  const out: LinhaPendencia[] = [];
  const add = (p: PendenciaRascunho) => {
    const k = `${p.tipo}|${p.pessoaRef ?? ""}|${p.blocoRef ?? ""}|${p.descricao}`;
    if (vistas.has(k)) return;
    vistas.add(k);
    out.push({
      lote_id: loteId,
      pessoa_ref: p.pessoaRef ?? null,
      bloco_ref: p.blocoRef ?? null,
      tipo: p.tipo,
      bloqueante: p.bloqueante,
      descricao: p.descricao,
      celulas: p.celulas,
      dados: p.dados ?? {},
    });
  };
  for (const p of plano.pendencias) add(p);
  return out;
}

export function linhasBlocos(
  loteId: string,
  analise: AnaliseFurtado,
  plano: PlanoFurtado,
): LinhaBloco[] {
  const pessoaDoBloco = new Map<string, string>();
  for (const p of plano.pessoas) for (const b of p.blocos) pessoaDoBloco.set(b, p.ref);
  return analise.blocos.map((b) => ({
    lote_id: loteId,
    ref: b.ref,
    aba: b.aba,
    intervalo: b.intervalo,
    tipo: b.tipo,
    nome_original: b.nome?.original ?? null,
    nome_detectado: b.nome?.nome ?? null,
    pessoa_ref: pessoaDoBloco.get(b.ref) ?? null,
    status: b.tipo === "modelo_vazio" ? "elemento_arquivo" : "pendente",
    dados: {
      perfil: b.perfil,
      servico: b.dados.servico,
      tribunais: b.dados.tribunais,
      processos: b.dados.processos.map((p) => p.numero),
      secao: b.dados.secao,
      complemento: b.nome?.complemento ?? null,
      celulas: b.celulas.length,
      pendencias: b.pendencias.length,
    },
  }));
}

export function linhasCelulas(
  loteId: string,
  planilha: PlanilhaLida,
  analise: AnaliseFurtado,
): LinhaCelula[] {
  const out: LinhaCelula[] = [];
  for (const aba of planilha.abas) {
    for (const c of aba.celulas) {
      const d = analise.destinos.get(chaveCelula(aba.nome, c.ref));
      let recalculado: string | null = null;
      if (c.formula) {
        const r = recalcular(aba, c);
        recalculado = r.suportada
          ? r.erro
            ? `erro: ${r.erro}`
            : String(r.valor ?? "")
          : `não recalculada: ${r.erro ?? ""}`;
      }
      out.push({
        lote_id: loteId,
        aba: aba.nome,
        celula: c.ref,
        linha: c.linha,
        coluna: c.coluna,
        valor_original: c.texto,
        tipo: c.tipo,
        formula: c.formula,
        resultado_armazenado: c.formula ? (c.exibido === "#REF!" ? "#REF!" : c.texto) : null,
        resultado_recalculado: recalculado,
        formato: c.formato,
        metadados: {
          exibido: c.exibido,
          cor: c.cor,
          oculta: c.oculta || undefined,
          mesclada: c.mesclada ?? undefined,
          comentario: c.comentario ?? undefined,
          data: c.data ?? undefined,
        },
        bloco_ref: d?.blocoRef ?? null,
        valor_interpretado: (d?.interpretado as unknown) ?? null,
        destino: d?.destino ?? "informacao_adicional",
        destino_ref: d?.ref ?? "sem_classificacao",
        situacao: d?.situacao ?? "pendente",
      });
    }
  }
  return out;
}

export function resumoDoLote(
  analise: AnaliseFurtado,
  plano: PlanoFurtado,
): Record<string, unknown> {
  return {
    plano: plano.resumo,
    celulas: analise.celulasTotal,
    blocos: analise.blocos.length,
    porDestino: analise.abas.reduce<Record<string, number>>((acc, a) => {
      for (const [k, v] of Object.entries(a.porDestino)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {}),
  };
}

export function abasDoLote(analise: AnaliseFurtado): unknown[] {
  return analise.abas.map((a) => ({
    aba: a.aba,
    perfil: a.mapeamento.perfil,
    estrategia: a.mapeamento.estrategia,
    conhecida: a.mapeamento.conhecida,
    celulas: a.celulasPreenchidas,
    blocos: a.blocos,
    porDestino: a.porDestino,
    ocultas: a.ocultas,
    mescladas: a.mescladas,
    formulas: a.formulas,
  }));
}
