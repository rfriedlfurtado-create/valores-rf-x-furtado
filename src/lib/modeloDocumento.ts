/**
 * MODELO DOCUMENTO — schema oficial e único para importação de clientes.
 *
 * Este arquivo é a FONTE ÚNICA da definição do modelo. O gerador (botão
 * "Modelo Documento") e o importador (parser) leem exatamente as mesmas
 * constantes daqui — nunca declare colunas em outro lugar.
 *
 *            Schema oficial (COLUNAS_MODELO)
 *                     ↓
 *            ┌────────┴────────┐
 *            ↓                 ↓
 *     gerarModeloDocumento   analisarModeloDocumento
 *
 * Um mesmo arquivo aceita, ao mesmo tempo, clientes em tramitação
 * ("NÃO PAGO") e clientes que já pagaram ("PAGO").
 *
 * Este módulo é puro (sem acesso ao banco): lê, valida e planeja. A
 * gravação fica em `executarPlanoModelo` (acoes.ts).
 *
 * Imports relativos de propósito — mantém o módulo testável fora do Vite.
 */

import * as XLSX from "xlsx";

import { parseBRL } from "./format";
import { compararNomes, LIMIARES_PADRAO, normalizarCPF, normalizarNome } from "./similarity";
import type { StatusCliente } from "./tipos";

// ---------------------------------------------------------------------------
// 1. Schema oficial
// ---------------------------------------------------------------------------

/** Versão interna do template. Mude ao alterar colunas/regras do modelo. */
export const VERSAO_MODELO = "ATLAS_CLIENTES_V1";

/** Nome da aba de dados e da aba de controle (onde fica a versão). */
export const ABA_DADOS = "Clientes";
export const ABA_INSTRUCOES = "Instruções";
export const ABA_CONTROLE = "Controle";

export type ChaveColuna = "nome" | "cpf" | "processo" | "situacao" | "valor";

export interface ColunaModelo {
  chave: ChaveColuna;
  cabecalho: string;
  obrigatorio: boolean;
  descricao: string;
  largura: number;
}

export const COLUNAS_MODELO: readonly ColunaModelo[] = [
  {
    chave: "nome",
    cabecalho: "Nome do Cliente",
    obrigatorio: true,
    descricao: "Obrigatório. Nome completo do cliente.",
    largura: 38,
  },
  {
    chave: "cpf",
    cabecalho: "CPF",
    obrigatorio: false,
    descricao:
      "Opcional. Com ou sem pontuação (000.000.000-00). Aumenta a segurança da identificação.",
    largura: 18,
  },
  {
    chave: "processo",
    cabecalho: "Número do Processo",
    obrigatorio: false,
    descricao: "Opcional. Ex.: 0000000-00.0000.0.00.0000",
    largura: 30,
  },
  {
    chave: "situacao",
    cabecalho: "Situação do Pagamento",
    obrigatorio: true,
    descricao: "Obrigatório. Use exatamente: NÃO PAGO ou PAGO.",
    largura: 24,
  },
  {
    chave: "valor",
    cabecalho: "Valor R$",
    obrigatorio: false,
    descricao: "Opcional. Principalmente para clientes PAGO. Ex.: 1500,00",
    largura: 14,
  },
] as const;

/**
 * Valores aceitos em "Situação do Pagamento" e o status gravado no banco.
 * Os status precisam respeitar a constraint `clientes_status_check`
 * ('ativo','inativo','arquivado','pago').
 */
export type SituacaoPagamento = "NAO_PAGO" | "PAGO";

export const SITUACOES_MODELO: readonly {
  valor: SituacaoPagamento;
  rotulo: string;
  status: StatusCliente;
}[] = [
  { valor: "NAO_PAGO", rotulo: "NÃO PAGO", status: "ativo" },
  { valor: "PAGO", rotulo: "PAGO", status: "pago" },
] as const;

/** Marca gravada na observação dos pagamentos criados por este importador. */
export const MARCA_PAGAMENTO_MODELO = `Importado via Modelo Documento (${VERSAO_MODELO})`;

/** Chave de comparação de cabeçalhos: sem acento, sem símbolos, minúsculas. */
function chaveCabecalho(texto: string): string {
  return normalizarNome(texto);
}

function interpretarSituacao(bruto: string): SituacaoPagamento | null {
  const chave = normalizarNome(bruto).toUpperCase();
  for (const s of SITUACOES_MODELO) {
    if (normalizarNome(s.rotulo).toUpperCase() === chave) return s.valor;
  }
  return null;
}

export function rotuloSituacao(valor: SituacaoPagamento): string {
  return SITUACOES_MODELO.find((s) => s.valor === valor)?.rotulo ?? valor;
}

export function statusDaSituacao(valor: SituacaoPagamento): StatusCliente {
  return SITUACOES_MODELO.find((s) => s.valor === valor)!.status;
}

// ---------------------------------------------------------------------------
// 2. Gerador
// ---------------------------------------------------------------------------

/** Monta o workbook oficial (sem baixar). Exportado para testes. */
export function montarWorkbookModelo(): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  // Aba de dados: apenas os cabeçalhos oficiais, pronta para preencher.
  const dados = XLSX.utils.aoa_to_sheet([COLUNAS_MODELO.map((c) => c.cabecalho)]);
  dados["!cols"] = COLUNAS_MODELO.map((c) => ({ wch: c.largura }));
  XLSX.utils.book_append_sheet(workbook, dados, ABA_DADOS);

  // Aba de instruções: regras e exemplos (esta aba NÃO é importada).
  const situacoes = SITUACOES_MODELO.map((s) => s.rotulo).join(" ou ");
  const instrucoes = XLSX.utils.aoa_to_sheet([
    [`Modelo oficial de importação de clientes — ${VERSAO_MODELO}`],
    [],
    ["Como usar"],
    [`1. Preencha a aba "${ABA_DADOS}", uma linha por cliente, sem alterar os cabeçalhos.`],
    [`2. Situação do Pagamento aceita somente: ${situacoes}.`],
    ["3. NÃO PAGO = cliente com processo em tramitação (aparece em CLIENTES)."],
    ["4. PAGO = cliente já existente que pagou (é movido para JÁ PAGOS)."],
    ["5. Os dois tipos podem ser misturados no mesmo arquivo."],
    [
      "6. Um cliente pode aparecer em várias linhas (um valor por linha): o sistema cria UM perfil e registra cada valor como uma entrada separada.",
    ],
    ["7. Informe o CPF quando houver homônimos — sem ele, linhas ambíguas vão para revisão."],
    ["8. Reimportar o mesmo arquivo não duplica clientes nem valores."],
    ["9. Não renomeie nem apague as abas deste arquivo."],
    [],
    ["Colunas", "Regra"],
    ...COLUNAS_MODELO.map((c) => [c.cabecalho, c.descricao]),
    [],
    ["Exemplo de preenchimento (não é importado)"],
    COLUNAS_MODELO.map((c) => c.cabecalho),
    ["João da Silva", "000.000.000-00", "0000000-00.0000.0.00.0000", "NÃO PAGO", ""],
    ["Maria Souza", "111.111.111-11", "1111111-11.1111.1.11.1111", "PAGO", "1500,00"],
  ]);
  instrucoes["!cols"] = [{ wch: 44 }, { wch: 80 }, { wch: 30 }, { wch: 24 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(workbook, instrucoes, ABA_INSTRUCOES);

  // Aba de controle: versão do template, usada na validação.
  const controle = XLSX.utils.aoa_to_sheet([
    ["versao_modelo", VERSAO_MODELO],
    ["colunas", COLUNAS_MODELO.map((c) => c.cabecalho).join(" | ")],
  ]);
  XLSX.utils.book_append_sheet(workbook, controle, ABA_CONTROLE);

  return workbook;
}

/** Gera e baixa o arquivo oficial do Modelo Documento. */
export function gerarModeloDocumento(): void {
  XLSX.writeFile(montarWorkbookModelo(), `Modelo_Clientes_${VERSAO_MODELO}.xlsx`);
}

// ---------------------------------------------------------------------------
// 3. Parser determinístico
// ---------------------------------------------------------------------------

export interface LinhaModelo {
  /** Número da linha na planilha (como o usuário vê no Excel). */
  numeroLinha: number;
  nome: string;
  nomeNormalizado: string;
  cpf: string | null;
  cpfNormalizado: string | null;
  processo: string | null;
  situacao: SituacaoPagamento | null;
  valor: number | null;
  erros: string[];
}

export interface AnaliseModelo {
  /** Problemas que impedem a importação inteira (formato, cabeçalhos...). */
  errosEstrutura: string[];
  avisos: string[];
  versao: string | null;
  linhas: LinhaModelo[];
}

const EXTENSOES_ACEITAS = [".xlsx", ".xls", ".csv"];

function textoCelula(valor: unknown): string {
  if (valor == null) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).replace(/\s+/g, " ").trim();
}

/** CPF numérico perde zeros à esquerda no Excel — recompõe para 11 dígitos. */
function textoCpf(valor: unknown): string {
  if (typeof valor === "number" && Number.isInteger(valor) && valor >= 0) {
    return String(valor).padStart(11, "0");
  }
  return textoCelula(valor);
}

function lerValor(valor: unknown): { valor: number | null; erro?: string } {
  if (valor == null || textoCelula(valor) === "") return { valor: null };
  if (typeof valor === "number") {
    if (!Number.isFinite(valor) || valor < 0) return { valor: null, erro: "Valor R$ inválido." };
    return { valor: Math.round(valor * 100) / 100 };
  }
  const texto = textoCelula(valor);
  if (!/^(R\$\s*)?-?[\d.,\s]+$/i.test(texto)) {
    return {
      valor: null,
      erro: `Valor R$ inválido: "${texto}". Use apenas números, ex.: 1500,00.`,
    };
  }
  const numero = parseBRL(texto);
  if (!(numero >= 0)) return { valor: null, erro: `Valor R$ inválido: "${texto}".` };
  return { valor: Math.round(numero * 100) / 100 };
}

/** Analisa um workbook já carregado. Separado de `analisarModeloDocumento` para testes. */
export function analisarWorkbookModelo(workbook: XLSX.WorkBook): AnaliseModelo {
  const errosEstrutura: string[] = [];
  const avisos: string[] = [];

  // Versão do template
  let versao: string | null = null;
  const controle = workbook.Sheets[ABA_CONTROLE];
  if (controle) {
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(controle, { header: 1, blankrows: false });
    const linhaVersao = linhas.find((l) => textoCelula(l?.[0]) === "versao_modelo");
    versao = linhaVersao ? textoCelula(linhaVersao[1]) || null : null;
    if (versao && versao !== VERSAO_MODELO) {
      errosEstrutura.push(
        `Versão do modelo incompatível: o arquivo é "${versao}", o sistema aceita "${VERSAO_MODELO}". Baixe o Modelo Documento novamente.`,
      );
    }
  } else {
    avisos.push(
      `Aba "${ABA_CONTROLE}" não encontrada — o arquivo não foi gerado pelo botão Modelo Documento. Os cabeçalhos serão validados mesmo assim.`,
    );
  }

  // Aba de dados: a aba oficial ou, na falta dela (ex.: CSV), a primeira.
  const nomeAba = workbook.SheetNames.includes(ABA_DADOS) ? ABA_DADOS : workbook.SheetNames[0];
  const folha = nomeAba ? workbook.Sheets[nomeAba] : undefined;
  if (!folha) {
    return {
      errosEstrutura: ["O arquivo não possui nenhuma planilha."],
      avisos,
      versao,
      linhas: [],
    };
  }

  const bruto = XLSX.utils.sheet_to_json<unknown[]>(folha, {
    header: 1,
    blankrows: true,
    defval: null,
    raw: true,
  });

  // Cabeçalho = primeira linha não vazia.
  const indiceCabecalho = bruto.findIndex(
    (l) => Array.isArray(l) && l.some((c) => textoCelula(c) !== ""),
  );
  if (indiceCabecalho < 0) {
    return { errosEstrutura: ["A planilha está vazia."], avisos, versao, linhas: [] };
  }

  const cabecalhos = (bruto[indiceCabecalho] ?? []).map((c) => textoCelula(c));
  const posicao = new Map<ChaveColuna, number>();
  const reconhecidos = new Set<number>();

  for (const coluna of COLUNAS_MODELO) {
    const indices = cabecalhos
      .map((h, i) => (chaveCabecalho(h) === chaveCabecalho(coluna.cabecalho) ? i : -1))
      .filter((i) => i >= 0);
    if (indices.length === 0) {
      errosEstrutura.push(
        `Coluna do modelo ausente: "${coluna.cabecalho}"${coluna.obrigatorio ? " (obrigatória)" : ""}.`,
      );
    } else if (indices.length > 1) {
      errosEstrutura.push(`A coluna "${coluna.cabecalho}" aparece mais de uma vez.`);
    } else {
      posicao.set(coluna.chave, indices[0]!);
      reconhecidos.add(indices[0]!);
    }
  }

  const desconhecidos = cabecalhos.filter((h, i) => h !== "" && !reconhecidos.has(i));
  if (desconhecidos.length > 0) {
    avisos.push(
      `Coluna(s) fora do modelo serão ignoradas: ${desconhecidos.map((h) => `"${h}"`).join(", ")}.`,
    );
  }

  if (errosEstrutura.length > 0) {
    errosEstrutura.push(
      `Cabeçalhos esperados: ${COLUNAS_MODELO.map((c) => `"${c.cabecalho}"`).join(", ")}.`,
    );
    return { errosEstrutura, avisos, versao, linhas: [] };
  }

  const celula = (linha: unknown[], chave: ChaveColuna): unknown => linha[posicao.get(chave)!];

  const linhas: LinhaModelo[] = [];
  let linhasVazias = 0;

  bruto.slice(indiceCabecalho + 1).forEach((linhaBruta, deslocamento) => {
    const linha = Array.isArray(linhaBruta) ? linhaBruta : [];
    const numeroLinha = indiceCabecalho + 2 + deslocamento;
    const vazia = COLUNAS_MODELO.every((c) => textoCelula(celula(linha, c.chave)) === "");
    if (vazia) {
      linhasVazias += 1;
      return;
    }

    const erros: string[] = [];

    const nome = textoCelula(celula(linha, "nome"));
    if (!nome) erros.push("Nome do Cliente é obrigatório.");

    const cpfBruto = textoCpf(celula(linha, "cpf"));
    const cpfNormalizado = normalizarCPF(cpfBruto);
    if (cpfBruto && !cpfNormalizado) {
      erros.push(`CPF inválido: "${cpfBruto}". Informe 11 dígitos ou deixe em branco.`);
    }

    const processo = textoCelula(celula(linha, "processo")) || null;

    const situacaoBruta = textoCelula(celula(linha, "situacao"));
    const situacao = situacaoBruta ? interpretarSituacao(situacaoBruta) : null;
    if (!situacaoBruta) {
      erros.push("Situação do Pagamento é obrigatória.");
    } else if (!situacao) {
      erros.push(
        `Situação do Pagamento inválida: "${situacaoBruta}". Use somente ${SITUACOES_MODELO.map((s) => s.rotulo).join(" ou ")}.`,
      );
    }

    const valorLido = lerValor(celula(linha, "valor"));
    if (valorLido.erro) erros.push(valorLido.erro);

    linhas.push({
      numeroLinha,
      nome,
      nomeNormalizado: normalizarNome(nome),
      cpf: cpfNormalizado ? formatarCPF(cpfNormalizado) : cpfBruto || null,
      cpfNormalizado,
      processo,
      situacao,
      valor: valorLido.valor,
      erros,
    });
  });

  // Linhas repetidas do mesmo cliente NÃO são erro: são agrupadas no
  // planejamento (1 cliente = 1 perfil, cada linha com valor = 1 entrada).

  if (linhasVazias > 0) avisos.push(`${linhasVazias} linha(s) vazia(s) ignorada(s).`);
  if (linhas.length === 0) errosEstrutura.push("O arquivo não possui nenhum cliente preenchido.");

  return { errosEstrutura, avisos, versao, linhas };
}

/** Lê o arquivo enviado pelo usuário e valida contra o schema oficial. */
export async function analisarModeloDocumento(arquivo: File): Promise<AnaliseModelo> {
  const nome = arquivo.name.toLowerCase();
  if (!EXTENSOES_ACEITAS.some((ext) => nome.endsWith(ext))) {
    return {
      errosEstrutura: [
        `Formato não aceito: "${arquivo.name}". Use o arquivo .xlsx gerado pelo botão Modelo Documento.`,
      ],
      avisos: [],
      versao: null,
      linhas: [],
    };
  }
  try {
    const buffer = await arquivo.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    return analisarWorkbookModelo(workbook);
  } catch {
    return {
      errosEstrutura: ["Não foi possível ler o arquivo. Verifique se é uma planilha válida."],
      avisos: [],
      versao: null,
      linhas: [],
    };
  }
}

export function formatarCPF(digitos: string): string {
  return digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}

// ---------------------------------------------------------------------------
// 4. Planejamento (decide a ação de cada linha, sem gravar nada)
// ---------------------------------------------------------------------------

export interface ClienteBaseModelo {
  id: string;
  nome: string;
  nome_normalizado: string;
  cpf: string | null;
  numero_processo?: string | null;
  status: StatusCliente;
}

export interface PagamentoBaseModelo {
  cliente_id: string;
  valor: number;
  chave_importacao?: string | null;
}

export type AcaoModelo =
  | "criar" // cliente novo (NÃO PAGO)
  | "atualizar" // cliente existente: completar dados e/ou novas entradas
  | "sem_alteracao" // nada a gravar (já está como o arquivo pede)
  | "marcar_pago" // cliente existente → PAGO / JÁ PAGOS
  | "nao_encontrado" // PAGO sem cliente correspondente seguro → revisão
  | "erro"; // linha inválida ou identificação insegura → revisão

/**
 * Situação de cada entrada financeira do arquivo:
 *  - nova: será registrada;
 *  - ja_registrada: a mesma entrada já veio numa importação anterior — não duplica;
 *  - forcada: o usuário confirmou na pré-visualização que é um valor NOVO,
 *    apesar de igual a um já registrado.
 */
export type StatusEntrada = "nova" | "ja_registrada" | "forcada";

export interface EntradaPlano {
  numeroLinha: number;
  valor: number;
  /** Chave anti-reimportação: `v<centavos>#<ocorrência do valor no cliente>`. */
  chave: string;
  status: StatusEntrada;
}

/**
 * Um item do plano = UM cliente (todas as linhas dele no arquivo), ou uma
 * linha inválida. Nunca um item por linha do mesmo cliente.
 */
export interface ItemPlano {
  /** Primeira linha do grupo (para exibição). */
  linha: LinhaModelo;
  /** Todas as linhas do arquivo que pertencem a este cliente. */
  linhas: LinhaModelo[];
  /** Situação consolidada do cliente no arquivo. */
  situacao: SituacaoPagamento | null;
  acao: AcaoModelo;
  clienteId: string | null;
  clienteNome: string | null;
  /** Campos a gravar no cliente (somente os permitidos). */
  alteracoes: { cpf?: string; numero_processo?: string; status?: StatusCliente };
  /** Entradas financeiras do arquivo para este cliente (uma por linha com valor). */
  entradas: EntradaPlano[];
  motivo: string | null;
  aviso: string | null;
}

export interface ResumoPlano {
  /** Linhas preenchidas no arquivo. */
  total: number;
  /** Clientes distintos identificados no arquivo (exclui linhas com erro). */
  clientes: number;
  emTramitacao: number;
  novos: number;
  existentes: number;
  pagosIdentificados: number;
  /** Clientes PAGO sem correspondência segura. */
  pagosNaoEncontrados: number;
  /** Linhas não importadas por erro/identificação insegura. */
  erros: number;
  /** Linhas a mais do mesmo cliente que foram agrupadas (não viram cliente novo). */
  linhasAgrupadas: number;
  entradasNovas: number;
  entradasJaRegistradas: number;
}

export interface PlanoModelo {
  itens: ItemPlano[];
  resumo: ResumoPlano;
}

/** Chave de entrada estável entre importações do mesmo conteúdo. */
export function chaveEntrada(valor: number, ocorrencia: number): string {
  return `v${Math.round(valor * 100)}#${ocorrencia}`;
}

type Localizacao =
  | { tipo: "encontrado"; cliente: ClienteBaseModelo; via: "cpf" | "nome" | "variacao" }
  | { tipo: "ambiguo"; motivo: string }
  | { tipo: "conflito"; motivo: string }
  | { tipo: "nenhum" };

/**
 * Localiza um cliente de forma segura (sem similaridade aproximada):
 *  1. CPF exato (quando informado);
 *  2. nome normalizado exato (maiúsculas/acentos/espaços ignorados);
 *  3. variação de nome já confirmada manualmente.
 * Se o nome bate mas o CPF cadastrado é outro, é OUTRA pessoa.
 */
function localizar(
  alvo: { cpfNormalizado: string | null; nomeNormalizado: string },
  porCpf: Map<string, ClienteBaseModelo>,
  porNome: Map<string, ClienteBaseModelo[]>,
  porVariacao: Map<string, ClienteBaseModelo[]>,
): Localizacao {
  if (alvo.cpfNormalizado) {
    const cliente = porCpf.get(alvo.cpfNormalizado);
    if (cliente) return { tipo: "encontrado", cliente, via: "cpf" };
  }

  for (const [mapa, via] of [
    [porNome, "nome"],
    [porVariacao, "variacao"],
  ] as const) {
    const candidatos = (mapa.get(alvo.nomeNormalizado) ?? []).filter(
      (c) => !alvo.cpfNormalizado || !normalizarCPF(c.cpf),
    );
    const comOutroCpf = (mapa.get(alvo.nomeNormalizado) ?? []).filter(
      (c) =>
        !!alvo.cpfNormalizado &&
        !!normalizarCPF(c.cpf) &&
        normalizarCPF(c.cpf) !== alvo.cpfNormalizado,
    );
    if (candidatos.length === 1) return { tipo: "encontrado", cliente: candidatos[0]!, via };
    if (candidatos.length > 1) {
      return {
        tipo: "ambiguo",
        motivo:
          "Há mais de um cliente com esse nome na base — informe o CPF para identificar qual.",
      };
    }
    if (comOutroCpf.length > 0 && via === "nome") {
      return {
        tipo: "conflito",
        motivo: "Existe cliente com esse nome, mas com outro CPF cadastrado — verifique o CPF.",
      };
    }
  }
  return { tipo: "nenhum" };
}

function sugestaoParecida(nomeNormalizado: string, clientes: ClienteBaseModelo[]): string | null {
  let melhor: { nome: string; percentual: number } | null = null;
  for (const c of clientes) {
    const r = compararNomes(nomeNormalizado, c.nome_normalizado, LIMIARES_PADRAO);
    if (
      r.percentual >= LIMIARES_PADRAO.muito_parecido &&
      (!melhor || r.percentual > melhor.percentual)
    ) {
      melhor = { nome: c.nome, percentual: r.percentual };
    }
  }
  return melhor
    ? `Nome parecido na base: "${melhor.nome}" (${Math.round(melhor.percentual)}%). Não associado automaticamente — revise.`
    : null;
}

const listaLinhas = (linhas: LinhaModelo[]) => linhas.map((l) => l.numeroLinha).join(", ");

/**
 * ETAPA 1 — agrupa as linhas válidas do arquivo por cliente.
 *
 *  - Mesmo CPF → mesmo cliente (mesmo com grafias de nome diferentes).
 *  - Sem CPF e mesmo nome normalizado → mesmo cliente.
 *  - Linha sem CPF cujo nome aparece no arquivo com UM único CPF → junta-se a ele.
 *  - Linha sem CPF cujo nome aparece com DOIS ou mais CPFs → identificação
 *    insegura (não dá para saber de qual pessoa é o valor): vai para revisão.
 *  - Mesmo nome com CPFs diferentes → pessoas diferentes.
 */
function agruparLinhas(validas: LinhaModelo[]): {
  grupos: LinhaModelo[][];
  inseguras: { linha: LinhaModelo; motivo: string }[];
} {
  const cpfsPorNome = new Map<string, Set<string>>();
  for (const l of validas) {
    if (!l.cpfNormalizado) continue;
    const set = cpfsPorNome.get(l.nomeNormalizado) ?? new Set<string>();
    set.add(l.cpfNormalizado);
    cpfsPorNome.set(l.nomeNormalizado, set);
  }

  const grupos = new Map<string, LinhaModelo[]>();
  const inseguras: { linha: LinhaModelo; motivo: string }[] = [];

  for (const l of validas) {
    let chave: string;
    if (l.cpfNormalizado) {
      chave = `cpf:${l.cpfNormalizado}`;
    } else {
      const cpfs = [...(cpfsPorNome.get(l.nomeNormalizado) ?? [])];
      if (cpfs.length === 1) {
        chave = `cpf:${cpfs[0]}`;
      } else if (cpfs.length > 1) {
        inseguras.push({
          linha: l,
          motivo: `Identificação insegura: o nome "${l.nome}" aparece no arquivo com ${cpfs.length} CPFs diferentes e esta linha não tem CPF. Informe o CPF para saber a quem pertence o valor.`,
        });
        continue;
      } else {
        chave = `nome:${l.nomeNormalizado}`;
      }
    }
    grupos.set(chave, [...(grupos.get(chave) ?? []), l]);
  }

  return { grupos: [...grupos.values()], inseguras };
}

function primeiroPreenchido<T>(linhas: LinhaModelo[], campo: (l: LinhaModelo) => T | null) {
  for (const l of linhas) {
    const v = campo(l);
    if (v != null && v !== "") return v;
  }
  return null;
}

export function planejarImportacaoModelo(params: {
  linhas: LinhaModelo[];
  clientes: ClienteBaseModelo[];
  variacoes: { cliente_id: string; nome_normalizado: string }[];
  pagamentos: PagamentoBaseModelo[];
  /** Linhas cujo valor o usuário confirmou como entrada nova (ver StatusEntrada). */
  forcarLinhas?: ReadonlySet<number>;
}): PlanoModelo {
  const forcar = params.forcarLinhas ?? new Set<number>();
  const porCpf = new Map<string, ClienteBaseModelo>();
  const porNome = new Map<string, ClienteBaseModelo[]>();
  const porId = new Map<string, ClienteBaseModelo>();
  for (const c of params.clientes) {
    porId.set(c.id, c);
    const cpf = normalizarCPF(c.cpf);
    if (cpf && !porCpf.has(cpf)) porCpf.set(cpf, c);
    porNome.set(c.nome_normalizado, [...(porNome.get(c.nome_normalizado) ?? []), c]);
  }
  const porVariacao = new Map<string, ClienteBaseModelo[]>();
  for (const v of params.variacoes) {
    const c = porId.get(v.cliente_id);
    if (!c) continue;
    const lista = porVariacao.get(v.nome_normalizado) ?? [];
    if (!lista.includes(c)) lista.push(c);
    porVariacao.set(v.nome_normalizado, lista);
  }
  const chavesPorCliente = new Map<string, Set<string>>();
  for (const p of params.pagamentos) {
    if (!p.chave_importacao) continue;
    const set = chavesPorCliente.get(p.cliente_id) ?? new Set<string>();
    set.add(p.chave_importacao);
    chavesPorCliente.set(p.cliente_id, set);
  }

  const vazio = (linha: LinhaModelo): ItemPlano => ({
    linha,
    linhas: [linha],
    situacao: linha.situacao,
    acao: "erro",
    clienteId: null,
    clienteNome: null,
    alteracoes: {},
    // Mantém o valor visível na revisão (não será gravado, mas não some).
    entradas:
      linha.valor != null && linha.valor > 0
        ? [
            {
              numeroLinha: linha.numeroLinha,
              valor: linha.valor,
              chave: chaveEntrada(linha.valor, 1),
              status: "nova",
            },
          ]
        : [],
    motivo: null,
    aviso: null,
  });

  const itens: ItemPlano[] = [];

  // Linhas inválidas: cada uma é um item de erro próprio.
  const validas: LinhaModelo[] = [];
  for (const linha of params.linhas) {
    if (linha.erros.length > 0 || !linha.situacao) {
      itens.push({ ...vazio(linha), motivo: linha.erros.join(" ") || "Linha inválida." });
    } else {
      validas.push(linha);
    }
  }

  const { grupos, inseguras } = agruparLinhas(validas);
  for (const { linha, motivo } of inseguras) itens.push({ ...vazio(linha), motivo });

  // ETAPA 2 — resolve cada grupo contra a base. Grupos diferentes que caem
  // no MESMO cliente da base (ex.: um pelo CPF, outro pela variação de nome)
  // são unidos — nunca geram dois perfis nem erro.
  const porClienteResolvido = new Map<string, ItemPlano>();
  const localizacoes = new Map<ItemPlano, Localizacao>();

  for (const grupo of grupos) {
    const primeira = grupo[0]!;
    const cpfNormalizado = primeiroPreenchido(grupo, (l) => l.cpfNormalizado);
    const loc = localizar(
      { cpfNormalizado, nomeNormalizado: primeira.nomeNormalizado },
      porCpf,
      porNome,
      porVariacao,
    );
    const avisos: string[] = [];
    if (loc.tipo === "encontrado" && loc.via === "variacao") {
      avisos.push(`Identificado pela variação de nome confirmada de "${loc.cliente.nome}".`);
    }

    if (loc.tipo === "encontrado") {
      const existente = porClienteResolvido.get(loc.cliente.id);
      if (existente) {
        existente.linhas.push(...grupo);
        existente.aviso = [existente.aviso, ...avisos].filter(Boolean).join(" ") || null;
        continue;
      }
    }

    const item: ItemPlano = {
      ...vazio(primeira),
      linhas: [...grupo],
      clienteId: loc.tipo === "encontrado" ? loc.cliente.id : null,
      clienteNome: loc.tipo === "encontrado" ? loc.cliente.nome : null,
      aviso: avisos.join(" ") || null,
    };
    localizacoes.set(item, loc);
    if (loc.tipo === "encontrado") porClienteResolvido.set(loc.cliente.id, item);
  }

  // ETAPA 3 — decide a ação e as entradas de cada cliente.
  for (const [item, loc] of localizacoes) {
    item.linhas.sort((a, b) => a.numeroLinha - b.numeroLinha);
    item.linha = item.linhas[0]!;

    const avisos: string[] = item.aviso ? [item.aviso] : [];
    if (item.linhas.length > 1) {
      avisos.push(
        `${item.linhas.length} linhas do mesmo cliente (linhas ${listaLinhas(item.linhas)}) — 1 único perfil.`,
      );
    }

    // Situação consolidada: basta uma linha PAGO para o cliente ser PAGO.
    const situacoes = new Set(item.linhas.map((l) => l.situacao));
    item.situacao = situacoes.has("PAGO") ? "PAGO" : "NAO_PAGO";
    if (situacoes.size > 1) {
      avisos.push("Situações diferentes nas linhas deste cliente — considerado PAGO.");
    }

    const nomes = new Set(item.linhas.map((l) => l.nomeNormalizado));
    if (nomes.size > 1) {
      avisos.push(
        `Mesmo CPF com grafias diferentes: ${[...new Set(item.linhas.map((l) => l.nome))].join(" / ")}.`,
      );
    }
    const cpfLinha = item.linhas.find((l) => l.cpfNormalizado);
    const processos = [...new Set(item.linhas.map((l) => l.processo).filter(Boolean))];
    if (processos.length > 1) {
      avisos.push(`Números de processo diferentes no arquivo — usado ${processos[0]}.`);
    }

    // Entradas: uma por linha com valor, na ordem do arquivo.
    const existentes = item.clienteId
      ? new Set(chavesPorCliente.get(item.clienteId) ?? [])
      : new Set<string>();
    const ocorrencias = new Map<number, number>();
    const usadas = new Set(existentes);
    const entradas: EntradaPlano[] = [];
    const pendentesForcar: EntradaPlano[] = [];
    for (const l of item.linhas) {
      if (l.valor == null || !(l.valor > 0)) continue;
      const centavos = Math.round(l.valor * 100);
      const n = (ocorrencias.get(centavos) ?? 0) + 1;
      ocorrencias.set(centavos, n);
      const chave = chaveEntrada(l.valor, n);
      const entrada: EntradaPlano = {
        numeroLinha: l.numeroLinha,
        valor: l.valor,
        chave,
        status: existentes.has(chave) ? "ja_registrada" : "nova",
      };
      usadas.add(chave);
      if (entrada.status === "ja_registrada" && forcar.has(l.numeroLinha)) {
        pendentesForcar.push(entrada);
      }
      entradas.push(entrada);
    }
    // Entradas forçadas recebem a próxima ocorrência livre (nunca colidem).
    for (const entrada of pendentesForcar) {
      let n = 1;
      while (usadas.has(chaveEntrada(entrada.valor, n))) n += 1;
      entrada.chave = chaveEntrada(entrada.valor, n);
      entrada.status = "forcada";
      usadas.add(entrada.chave);
    }
    item.entradas = entradas;
    const jaRegistradas = entradas.filter((e) => e.status === "ja_registrada").length;
    if (jaRegistradas) {
      avisos.push(
        `${jaRegistradas} valor(es) já registrado(s) em importação anterior — não serão duplicados.`,
      );
    }
    const gravaEntradas = entradas.some((e) => e.status !== "ja_registrada");

    // Dados complementares: só preenche o que está vazio (nunca sobrescreve).
    const complementar = (c: ClienteBaseModelo) => {
      const alt: ItemPlano["alteracoes"] = {};
      if (cpfLinha?.cpf && !normalizarCPF(c.cpf)) alt.cpf = cpfLinha.cpf;
      if (processos[0] && !c.numero_processo?.trim()) alt.numero_processo = processos[0]!;
      if (c.numero_processo && processos[0] && c.numero_processo.trim() !== processos[0]) {
        avisos.push(
          `Número do processo diferente do cadastrado (${c.numero_processo}) — mantido o cadastrado.`,
        );
      }
      return alt;
    };

    if (item.situacao === "NAO_PAGO") {
      if (loc.tipo === "ambiguo" || loc.tipo === "conflito") {
        item.acao = "erro";
        item.motivo = `Sem identificação segura. ${loc.motivo}`;
      } else if (loc.tipo === "nenhum") {
        item.acao = "criar";
        // cliente novo: nenhuma entrada pode estar "já registrada"
        for (const e of item.entradas) e.status = "nova";
      } else {
        const c = loc.cliente;
        const alteracoes = complementar(c);
        if (c.status === "pago") {
          avisos.push(
            "Cliente já consta em JÁ PAGOS — mantido como pago (o status não é revertido automaticamente).",
          );
        } else if (c.status !== "ativo") {
          alteracoes.status = "ativo";
        }
        item.alteracoes = alteracoes;
        item.acao =
          Object.keys(alteracoes).length > 0 || gravaEntradas ? "atualizar" : "sem_alteracao";
      }
    } else if (loc.tipo !== "encontrado") {
      item.acao = "nao_encontrado";
      item.motivo =
        loc.tipo === "nenhum"
          ? "Cliente não encontrado na base."
          : `Cliente não encontrado na base. ${loc.motivo}`;
      if (loc.tipo === "nenhum") {
        const sugestao = sugestaoParecida(item.linha.nomeNormalizado, params.clientes);
        if (sugestao) avisos.push(sugestao);
      }
    } else {
      const c = loc.cliente;
      const alteracoes = complementar(c);
      if (c.status !== "pago") alteracoes.status = "pago";
      item.alteracoes = alteracoes;
      item.acao =
        Object.keys(alteracoes).length > 0 || gravaEntradas ? "marcar_pago" : "sem_alteracao";
    }

    // Itens que não serão gravados não têm entradas "a registrar".
    if (item.acao === "erro" || item.acao === "nao_encontrado") {
      for (const e of item.entradas) e.status = "nova";
    }
    item.aviso = avisos.join(" ") || null;
    itens.push(item);
  }

  itens.sort((a, b) => a.linha.numeroLinha - b.linha.numeroLinha);

  const gravaveis = (i: ItemPlano) => i.acao !== "erro" && i.acao !== "nao_encontrado";
  const resumo: ResumoPlano = {
    total: params.linhas.length,
    clientes: itens.filter((i) => i.acao !== "erro").length,
    emTramitacao: itens.filter((i) => i.situacao === "NAO_PAGO" && i.acao !== "erro").length,
    novos: itens.filter((i) => i.acao === "criar").length,
    existentes: itens.filter(
      (i) => i.situacao === "NAO_PAGO" && (i.acao === "atualizar" || i.acao === "sem_alteracao"),
    ).length,
    pagosIdentificados: itens.filter(
      (i) => i.situacao === "PAGO" && (i.acao === "marcar_pago" || i.acao === "sem_alteracao"),
    ).length,
    pagosNaoEncontrados: itens.filter((i) => i.acao === "nao_encontrado").length,
    erros: itens.filter((i) => i.acao === "erro").reduce((s, i) => s + i.linhas.length, 0),
    linhasAgrupadas: itens
      .filter((i) => i.acao !== "erro")
      .reduce((s, i) => s + i.linhas.length - 1, 0),
    entradasNovas: itens
      .filter(gravaveis)
      .reduce((s, i) => s + i.entradas.filter((e) => e.status !== "ja_registrada").length, 0),
    entradasJaRegistradas: itens
      .filter(gravaveis)
      .reduce((s, i) => s + i.entradas.filter((e) => e.status === "ja_registrada").length, 0),
  };

  return { itens, resumo };
}

// ---------------------------------------------------------------------------
// 5. Payload para a função transacional `aplicar_importacao_modelo`
// ---------------------------------------------------------------------------

export interface EntradaPayload {
  valor: number;
  chave: string;
  linha: number;
}

export interface ItemPayloadModelo {
  acao: "criar" | "atualizar" | "marcar_pago";
  linha: number;
  linhas: number[];
  nome?: string;
  nome_normalizado?: string;
  cpf?: string | null;
  numero_processo?: string | null;
  cliente_id?: string;
  alteracoes?: ItemPlano["alteracoes"];
  /** Somente entradas a gravar (novas ou forçadas). */
  entradas: EntradaPayload[];
}

/** Converte o plano revisado no payload gravado numa única transação. */
export function montarPayloadImportacao(plano: PlanoModelo): ItemPayloadModelo[] {
  const itens: ItemPayloadModelo[] = [];
  for (const item of plano.itens) {
    if (item.acao !== "criar" && item.acao !== "atualizar" && item.acao !== "marcar_pago") {
      continue;
    }
    const entradas = item.entradas
      .filter((e) => e.status !== "ja_registrada")
      .map((e) => ({ valor: e.valor, chave: e.chave, linha: e.numeroLinha }));
    const linhas = item.linhas.map((l) => l.numeroLinha);
    if (item.acao === "criar") {
      const comCpf = item.linhas.find((l) => l.cpfNormalizado);
      itens.push({
        acao: "criar",
        linha: item.linha.numeroLinha,
        linhas,
        nome: item.linha.nome,
        nome_normalizado: item.linha.nomeNormalizado,
        cpf: comCpf ? comCpf.cpf : null,
        numero_processo: item.linhas.find((l) => l.processo)?.processo ?? null,
        entradas,
      });
    } else {
      itens.push({
        acao: item.acao,
        linha: item.linha.numeroLinha,
        linhas,
        cliente_id: item.clienteId!,
        alteracoes: item.alteracoes,
        entradas,
      });
    }
  }
  return itens;
}
