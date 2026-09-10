/**
 * Motor determinístico de comparação de nomes.
 *
 * Regra central de segurança: este módulo NUNCA une clientes.
 * Ele apenas calcula um percentual auditável de similaridade e uma
 * classificação sugerida. A união definitiva depende sempre de
 * confirmação manual do usuário.
 *
 * Algoritmos combinados:
 *  - Levenshtein (distância de edição) sobre o nome normalizado completo
 *  - Jaro-Winkler (favorece prefixos iguais, bom para nomes próprios)
 *  - Similaridade por tokens (palavras em comum, ignorando ordem)
 */

export type Classificacao = "igual" | "muito_parecido" | "possivel";

export interface LimiaresSimilaridade {
  /** correspondência exata */
  igual: number;
  /** a partir deste percentual: MUITO PARECIDO */
  muito_parecido: number;
  /** a partir deste percentual: POSSÍVEL CORRESPONDÊNCIA */
  possivel: number;
  /** abaixo deste percentual a correspondência é descartada */
  minimo: number;
}

export const LIMIARES_PADRAO: LimiaresSimilaridade = {
  igual: 100,
  muito_parecido: 90,
  possivel: 75,
  minimo: 60,
};

/** Partículas que não ajudam a distinguir pessoas. */
const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "du", "del", "la"]);

/**
 * Normaliza um CPF para apenas dígitos, para comparação exata.
 * Retorna null se não sobrarem 11 dígitos (evita falso-positivo com lixo de planilha).
 */
export function normalizarCPF(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const digitos = valor.replace(/\D/g, "");
  return digitos.length === 11 ? digitos : null;
}

/**
 * Normaliza um nome: minúsculas, sem acentos, sem pontuação,
 * sem caracteres especiais e sem espaços duplicados.
 * O nome original NUNCA é alterado — apenas a chave de comparação.
 */
export function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokensDoNome(nomeNormalizado: string): string[] {
  return nomeNormalizado.split(" ").filter((token) => token.length > 0 && !PARTICULAS.has(token));
}

/** Distância de Levenshtein (implementação iterativa, O(n*m) memória O(m)). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length]!;
}

export function levenshteinRatio(a: string, b: string): number {
  const maior = Math.max(a.length, b.length);
  if (maior === 0) return 1;
  return 1 - levenshtein(a, b) / maior;
}

/** Jaro-Winkler: bom para nomes próprios com pequenas trocas de letras. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  transpositions /= 2;

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
    if (a[i] === b[i]) prefix += 1;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Similaridade por palavras: quantas palavras (ou quase-palavras) coincidem. */
export function tokenSimilarity(a: string, b: string): number {
  const tokensA = tokensDoNome(a);
  const tokensB = tokensDoNome(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const disponiveis = [...tokensB];
  let soma = 0;

  for (const tokenA of tokensA) {
    let melhor = 0;
    let melhorIndice = -1;
    disponiveis.forEach((tokenB, index) => {
      // Iniciais (ex.: "J" vs "Joao") contam como correspondência parcial.
      const parcial =
        (tokenA.length === 1 || tokenB.length === 1) && tokenA[0] === tokenB[0]
          ? 0.6
          : jaroWinkler(tokenA, tokenB);
      if (parcial > melhor) {
        melhor = parcial;
        melhorIndice = index;
      }
    });
    if (melhorIndice >= 0 && melhor > 0.85) disponiveis.splice(melhorIndice, 1);
    soma += melhor;
  }

  return soma / Math.max(tokensA.length, tokensB.length);
}

export interface ResultadoSimilaridade {
  percentual: number;
  classificacao: Classificacao | null;
  detalhes: {
    levenshtein: number;
    jaroWinkler: number;
    tokens: number;
  };
}

/**
 * Calcula o percentual final combinando os três algoritmos.
 * Pesos favorecem a comparação por palavras, que lida melhor com
 * nomes invertidos ou abreviados.
 */
export function compararNomes(
  nomeNormalizadoA: string,
  nomeNormalizadoB: string,
  limiares: LimiaresSimilaridade = LIMIARES_PADRAO,
): ResultadoSimilaridade {
  const lev = levenshteinRatio(nomeNormalizadoA, nomeNormalizadoB);
  const jw = jaroWinkler(nomeNormalizadoA, nomeNormalizadoB);
  const tokens = tokenSimilarity(nomeNormalizadoA, nomeNormalizadoB);

  const bruto = nomeNormalizadoA === nomeNormalizadoB ? 1 : lev * 0.3 + jw * 0.25 + tokens * 0.45;

  const percentual = Math.round(Math.min(1, Math.max(0, bruto)) * 10000) / 100;

  let classificacao: Classificacao | null = null;
  if (percentual >= limiares.igual || nomeNormalizadoA === nomeNormalizadoB) {
    classificacao = "igual";
  } else if (percentual >= limiares.muito_parecido) {
    classificacao = "muito_parecido";
  } else if (percentual >= limiares.possivel) {
    classificacao = "possivel";
  } else if (percentual >= limiares.minimo) {
    classificacao = "possivel";
  }

  return {
    percentual,
    classificacao,
    detalhes: {
      levenshtein: Math.round(lev * 10000) / 100,
      jaroWinkler: Math.round(jw * 10000) / 100,
      tokens: Math.round(tokens * 10000) / 100,
    },
  };
}

export const ROTULO_CLASSIFICACAO: Record<Classificacao, string> = {
  igual: "IGUAL",
  muito_parecido: "MUITO PARECIDO",
  possivel: "POSSÍVEL CORRESPONDÊNCIA",
};

/** Chave canônica de um par rejeitado (ordem alfabética para evitar duplicidade). */
export function chaveParRejeitado(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}
