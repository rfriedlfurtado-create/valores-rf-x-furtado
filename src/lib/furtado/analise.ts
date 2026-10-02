/**
 * ANÁLISE da planilha Furtado Advogados — orquestra a leitura integral:
 *
 *   arquivo → todas as abas/células → totais gerais (fórmulas) →
 *   segmentação em blocos por aba → interpretação → destino de cada célula
 *   → conferência dos totais → resumo por aba.
 *
 * Módulo puro (sem banco). Imports relativos para rodar fora do Vite.
 */

import * as XLSX from "xlsx";

import { Contexto, k } from "./contexto";
import { analisarCamposEmCelula } from "./estrategiaCampos";
import { analisarLinhasRegistro, analisarTabela } from "./estrategiaLinhas";
import { analisarRotulosVerticais } from "./estrategiaVertical";
import { recalcular, referenciasDaFormula } from "./formulas";
import {
  lerWorkbook,
  letraColuna,
  OPCOES_LEITURA,
  type Aba,
  type Celula,
  type PlanilhaLida,
} from "./planilha";
import {
  MODELO_FURTADO,
  ROTULO_CATEGORIA,
  type AnaliseFurtado,
  type Destino,
  type EstrategiaAba,
  type MapeamentoAba,
  type PerfilAba,
  type ResumoAba,
  type TotalPlanilha,
} from "./modelo";
import { categoriaDoTotal, lerRotuloFinanceiro } from "./rotulos";
import { chaveTexto } from "./texto";

// ---------------------------------------------------------------------------
// Mapeamento das abas
// ---------------------------------------------------------------------------

const ABAS_CONHECIDAS: [RegExp, PerfilAba, EstrategiaAba][] = [
  [/^PREVISAO EXECUCAO$/, "previsao_execucao", "rotulos_verticais"],
  [/^CUMP RPV-?PRECATORIO$/, "cumprimento", "rotulos_verticais"],
  [/^IMPLANTACAO ADMINISTRATIVA$/, "implantacao_administrativa", "campos_em_celula"],
  [/^IMPLANTACAO$/, "implantacao_judicial", "campos_em_celula"],
  [/^PEDIDO DE TED$/, "pedido_ted", "linhas_registro"],
  [/^ACORDOS$/, "acordos", "tabela_cabecalho"],
  [/^PRECATORIO\b/, "precatorio", "rotulos_verticais"],
  [/^COBRAR CLIENTES\b/, "cobrancas", "linhas_registro"],
];

/** Reconhece a aba pelo nome normalizado (o nome original nunca é alterado). */
export function mapearAba(aba: Aba): MapeamentoAba {
  const nome = chaveTexto(aba.nome.trim());
  for (const [re, perfil, estrategia] of ABAS_CONHECIDAS) {
    if (re.test(nome))
      return { aba: aba.nome, perfil, estrategia, conhecida: true, requerConfirmacao: false };
  }
  return {
    aba: aba.nome,
    perfil: "desconhecida",
    estrategia: detectarEstrategia(aba),
    conhecida: false,
    requerConfirmacao: true,
  };
}

/** Para abas novas: escolhe a estratégia pelo conteúdo. */
export function detectarEstrategia(aba: Aba): EstrategiaAba {
  if (!aba.celulas.length) return "somente_preservar";
  let rotulos = 0;
  let campos = 0;
  const porLinha = new Map<number, number>();
  for (const c of aba.celulas) {
    porLinha.set(c.linha, (porLinha.get(c.linha) ?? 0) + 1);
    if (typeof c.bruto !== "string") continue;
    if (c.coluna === 1 && lerRotuloFinanceiro(c.texto, false)) rotulos++;
    if (/^\s*(BENEF[IÍ]CIO|DIB|DIP|DCB|RMI|RMA|HONOR[ÁA]RIOS|CLIENTE)\s*:/i.test(c.texto)) campos++;
  }
  const primeira = [...porLinha.entries()].sort((a, b) => a[0] - b[0])[0];
  if (primeira && primeira[1] >= 4 && rotulos < 3) return "tabela_cabecalho";
  if (rotulos >= 3) return "rotulos_verticais";
  if (campos >= 5) return "campos_em_celula";
  return "linhas_registro";
}

// ---------------------------------------------------------------------------
// Totais gerais (fórmulas que somam vários blocos)
// ---------------------------------------------------------------------------

function rotuloAEsquerda(aba: Aba, cel: Celula): Celula | null {
  for (let c = cel.coluna - 1; c >= Math.max(1, cel.coluna - 3); c--) {
    const x = aba.porRef.get(`${letraColuna(c)}${cel.linha}`);
    if (x && typeof x.bruto === "string") return x;
  }
  return null;
}

function detectarTotaisGerais(aba: Aba, ctx: Contexto): TotalPlanilha[] {
  const totais: TotalPlanilha[] = [];
  const formulas = aba.celulas.filter((c) => c.formula);
  const ehTotal = new Set<string>();
  // 1ª passada: somas espalhadas por muitas linhas
  for (const c of formulas) {
    const refs = referenciasDaFormula(c.formula!);
    const linhas = refs.map((r) => Number(r.replace(/^\D+/, "")));
    const espalhada =
      refs.length >= 2 &&
      new Set(linhas).size >= 2 &&
      Math.max(...linhas) - Math.min(...linhas) > 20;
    const temErro = /#REF!/.test(c.formula!);
    if (espalhada || (temErro && refs.length >= 3)) ehTotal.add(c.ref);
  }
  // 2ª passada: totais de totais
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const c of formulas) {
      if (ehTotal.has(c.ref)) continue;
      const refs = referenciasDaFormula(c.formula!);
      if (refs.length && refs.every((r) => ehTotal.has(r))) {
        ehTotal.add(c.ref);
        mudou = true;
      }
    }
  }
  for (const ref of ehTotal) {
    const c = aba.porRef.get(ref)!;
    const rotulo = rotuloAEsquerda(aba, c);
    const recalc = recalcular(aba, c);
    const armazenado =
      c.tipo === "e"
        ? String(c.bruto)
        : typeof c.bruto === "number"
          ? Math.round(c.bruto * 100) / 100
          : c.texto;
    totais.push({
      aba: aba.nome,
      celula: ref,
      rotulo: rotulo?.texto.trim() ?? null,
      categoria:
        categoriaDoTotal(rotulo?.texto ?? null) ??
        (referenciasDaFormula(c.formula!).every((r) => ehTotal.has(r)) ? "total_geral" : null),
      formula: c.formula,
      armazenado: c.exibido === "#REF!" ? "#REF!" : armazenado,
      recalculado: recalc.valor,
      erroFormula: recalc.erro ?? (c.exibido === "#REF!" ? "#REF!" : null),
      apurado: null,
      diferenca: null,
      omitidas: [],
      estranhas: [],
      observacao: recalc.suportada ? null : "Fórmula não recalculada (não suportada)",
    });
    ctx.reservadas.add(k(c));
    ctx.destinar(c, "resumo_arquivo", "total_geral", "elemento_arquivo", {
      formula: c.formula,
      armazenado,
      recalculado: recalc.valor,
    });
    if (rotulo) {
      ctx.reservadas.add(k(rotulo));
      ctx.destinar(rotulo, "resumo_arquivo", "total_geral:rotulo", "elemento_arquivo", {
        rotulo: rotulo.texto.trim(),
      });
      // Cabeçalho do quadro de totais (ex.: ano "2024" acima dos rótulos)
      for (let l = rotulo.linha - 1; l >= rotulo.linha - 1; l--) {
        const acima = aba.porRef.get(`${letraColuna(rotulo.coluna)}${l}`);
        if (
          acima &&
          !ctx.reservadas.has(k(acima)) &&
          (typeof acima.bruto === "number" || acima.texto.length < 12)
        ) {
          const acimaEhTotal =
            ehTotal.has(`${letraColuna(c.coluna)}${l}`) || rotuloAEsquerda(aba, acima) === null;
          if (acimaEhTotal || /^\d{4}$/.test(acima.texto.trim())) {
            ctx.reservadas.add(k(acima));
            ctx.destinar(acima, "resumo_arquivo", "total_geral:cabecalho", "elemento_arquivo", {
              texto: acima.texto,
            });
          }
        }
      }
    }
  }
  return totais;
}

/** Confere cada total com a soma dos valores identificados nos blocos. */
function conferirTotais(aba: Aba, totais: TotalPlanilha[], ctx: Contexto): void {
  const blocos = ctx.blocos.filter((b) => b.aba === aba.nome);
  for (const t of totais) {
    if (!t.categoria) continue;
    const cel = aba.porRef.get(t.celula)!;
    const refs = referenciasDaFormula(cel.formula!);
    if (t.categoria === "total_geral") {
      const partes = totais.filter((x) => refs.includes(x.celula));
      if (partes.length && partes.every((p) => p.apurado !== null)) {
        t.apurado = Math.round(partes.reduce((s, p) => s + p.apurado!, 0) * 100) / 100;
      }
    } else {
      const linhasRef = refs.map((r) => Number(r.replace(/^\D+/, "")));
      const ini = Math.min(...linhasRef);
      const fim = Math.max(...linhasRef);
      // Células com valor principal da categoria dentro do intervalo coberto pela fórmula
      const celulasCat: { ref: string; valor: number }[] = [];
      for (const b of blocos) {
        for (const l of b.dados.lancamentos) {
          if (!l.principal || l.categoria !== t.categoria || l.valor === null) continue;
          const valorCel = l.celulas
            .map((c) => c.split("!")[1]!)
            .find((r) => r.startsWith(l.coluna));
          if (!valorCel) continue;
          const linha = Number(valorCel.replace(/^\D+/, ""));
          if (linha >= ini - 3 && linha <= fim + 3)
            celulasCat.push({ ref: valorCel, valor: l.valor });
        }
      }
      t.apurado = Math.round(celulasCat.reduce((s, c) => s + c.valor, 0) * 100) / 100;
      t.omitidas = celulasCat.filter((c) => !refs.includes(c.ref)).map((c) => c.ref);
      t.estranhas = refs.filter((r) => !celulasCat.some((c) => c.ref === r) && aba.porRef.has(r));
    }
    const base = typeof t.armazenado === "number" ? t.armazenado : null;
    if (t.apurado !== null && base !== null)
      t.diferenca = Math.round((base - t.apurado) * 100) / 100;
    const rotulo = t.categoria === "total_geral" ? "Total geral" : ROTULO_CATEGORIA[t.categoria];
    if (t.erroFormula) {
      ctx.pendencia(null, {
        tipo: "formula_erro",
        bloqueante: false,
        descricao: `${aba.nome}!${t.celula} (${rotulo}): a fórmula contém erro (${t.erroFormula}). Valor armazenado: ${t.armazenado ?? "—"}; total apurado nos registros: ${t.apurado?.toFixed(2) ?? "—"}.`,
        celulas: [`${aba.nome}!${t.celula}`],
        dados: { ...t },
      });
    } else if (t.diferenca !== null && Math.abs(t.diferenca) > 0.01) {
      ctx.pendencia(null, {
        tipo: "total_divergente",
        bloqueante: false,
        descricao: `${aba.nome}!${t.celula} (${rotulo}): total da planilha ${base!.toFixed(2)} × apurado ${t.apurado!.toFixed(2)} (diferença ${t.diferenca.toFixed(2)}).${
          t.omitidas.length ? ` Células não incluídas na fórmula: ${t.omitidas.join(", ")}.` : ""
        }${t.estranhas.length ? ` Referências fora da categoria: ${t.estranhas.join(", ")}.` : ""} Nenhum registro foi alterado.`,
        celulas: [`${aba.nome}!${t.celula}`],
        dados: { ...t },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Orquestração
// ---------------------------------------------------------------------------

export function analisarPlanilhaLida(
  planilha: PlanilhaLida,
  opcoes: { estrategias?: Record<string, EstrategiaAba> } = {},
): AnaliseFurtado {
  const ctx = new Contexto();
  const resumos: ResumoAba[] = [];
  const totais: TotalPlanilha[] = [];

  for (const aba of planilha.abas) {
    const mapeamento = mapearAba(aba);
    const escolhida = opcoes.estrategias?.[aba.nome];
    if (escolhida) {
      mapeamento.estrategia = escolhida;
      mapeamento.requerConfirmacao = false;
    }
    if (!mapeamento.conhecida && !escolhida) {
      ctx.pendencia(null, {
        tipo: "nova_aba",
        bloqueante: false,
        descricao: `A aba "${aba.nome}" não faz parte do modelo conhecido. Leitura sugerida: ${mapeamento.estrategia}. Todo o conteúdo foi preservado; confirme o mapeamento antes de gravar.`,
        celulas: [],
        dados: { aba: aba.nome, estrategia: mapeamento.estrategia },
      });
    }
    const totaisAba = detectarTotaisGerais(aba, ctx);
    totais.push(...totaisAba);

    switch (mapeamento.estrategia) {
      case "rotulos_verticais":
        analisarRotulosVerticais(aba, mapeamento.perfil, ctx);
        break;
      case "campos_em_celula":
        analisarCamposEmCelula(aba, mapeamento.perfil, ctx);
        break;
      case "tabela_cabecalho":
        analisarTabela(aba, mapeamento.perfil, ctx);
        break;
      case "linhas_registro":
        analisarLinhasRegistro(aba, mapeamento.perfil, ctx);
        break;
      default:
        break;
    }

    // Varredura final: nenhuma célula fica sem destino.
    for (const c of aba.celulas) {
      if (ctx.temDestino(c)) continue;
      const bloco = ctx.blocos.find((b) => b.celulas.includes(k(c))) ?? null;
      ctx.destinar(
        c,
        "informacao_adicional",
        mapeamento.estrategia === "somente_preservar" ? "preservado" : "sem_classificacao",
        mapeamento.estrategia === "somente_preservar" ? "interpretado" : "pendente",
        undefined,
        bloco?.ref ?? null,
      );
    }
    conferirTotais(aba, totaisAba, ctx);

    const porDestino: Record<Destino, number> = {
      campo: 0,
      historico: 0,
      informacao_adicional: 0,
      resumo_arquivo: 0,
      pendencia_revisao: 0,
    };
    for (const c of aba.celulas) porDestino[ctx.destinos.get(k(c))!.destino] += 1;
    resumos.push({
      aba: aba.nome,
      mapeamento,
      celulasPreenchidas: aba.celulas.length,
      blocos: ctx.blocos.filter(
        (b) => b.aba === aba.nome && (b.tipo === "cliente" || b.tipo === "linha_tabela"),
      ).length,
      porDestino,
      ocultas: aba.celulas.filter((c) => c.oculta).length,
      mescladas: aba.mescladas.length,
      formulas: aba.celulas.filter((c) => c.formula).length,
    });
  }

  // Blocos sem identificação com conteúdo: pendência bloqueante.
  for (const b of ctx.blocos) {
    if (b.tipo === "sem_identificacao") {
      ctx.pendencia(b, {
        tipo: "bloco_sem_identificacao",
        bloqueante: true,
        descricao: `Bloco ${b.aba}!${b.intervalo} sem cliente identificado. O conteúdo foi preservado no lote; associe a um cliente ou mantenha apenas como registro do arquivo.`,
        celulas: b.celulas.slice(0, 20),
      });
    }
  }

  return {
    modelo: MODELO_FURTADO,
    abas: resumos,
    blocos: ctx.blocos,
    destinos: ctx.destinos,
    totais,
    pendenciasArquivo: ctx.pendenciasArquivo,
    celulasTotal: planilha.abas.reduce((s, a) => s + a.celulas.length, 0),
  };
}

export function analisarWorkbookFurtado(
  workbook: XLSX.WorkBook,
  opcoes: { estrategias?: Record<string, EstrategiaAba> } = {},
): { planilha: PlanilhaLida; analise: AnaliseFurtado } {
  const planilha = lerWorkbook(workbook);
  return { planilha, analise: analisarPlanilhaLida(planilha, opcoes) };
}

export function analisarBinarioFurtado(
  dados: ArrayBuffer | Uint8Array,
  opcoes: { estrategias?: Record<string, EstrategiaAba> } = {},
): { planilha: PlanilhaLida; analise: AnaliseFurtado } {
  return analisarWorkbookFurtado(XLSX.read(dados, { type: "array", ...OPCOES_LEITURA }), opcoes);
}
