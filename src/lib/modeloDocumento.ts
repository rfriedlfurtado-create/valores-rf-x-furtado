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
    ["6. Não renomeie nem apague as abas deste arquivo."],
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

  // Duplicidades dentro do próprio arquivo.
  for (let i = 0; i < linhas.length; i++) {
    const atual = linhas[i]!;
    if (!atual.nomeNormalizado) continue;
    for (let j = 0; j < i; j++) {
      const anterior = linhas[j]!;
      const mesmoCpf = !!atual.cpfNormalizado && atual.cpfNormalizado === anterior.cpfNormalizado;
      const mesmoNomeSemCpf =
        (!atual.cpfNormalizado || !anterior.cpfNormalizado) &&
        atual.nomeNormalizado === anterior.nomeNormalizado;
      if (mesmoCpf || mesmoNomeSemCpf) {
        atual.erros.push(
          `Registro duplicado no arquivo (mesmo ${mesmoCpf ? "CPF" : "nome"} da linha ${anterior.numeroLinha}).`,
        );
        break;
      }
    }
  }

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
  observacao: string | null;
}

export type AcaoModelo =
  | "criar" // NÃO PAGO, cliente novo
  | "atualizar" // NÃO PAGO, cliente existente com dados a completar
  | "sem_alteracao" // já está exatamente como o arquivo pede
  | "marcar_pago" // PAGO, cliente existente → JÁ PAGOS
  | "nao_encontrado" // PAGO sem cliente correspondente seguro
  | "erro"; // linha inválida

export interface ItemPlano {
  linha: LinhaModelo;
  acao: AcaoModelo;
  clienteId: string | null;
  clienteNome: string | null;
  /** Campos a gravar no cliente (somente os permitidos). */
  alteracoes: { cpf?: string; numero_processo?: string; status?: StatusCliente };
  /** Valor de pagamento a registrar (PAGO com valor, ainda não registrado). */
  registrarValor: number | null;
  motivo: string | null;
  aviso: string | null;
}

export interface ResumoPlano {
  total: number;
  emTramitacao: number;
  novos: number;
  existentes: number;
  pagosIdentificados: number;
  pagosNaoEncontrados: number;
  erros: number;
}

export interface PlanoModelo {
  itens: ItemPlano[];
  resumo: ResumoPlano;
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
  linha: LinhaModelo,
  porCpf: Map<string, ClienteBaseModelo>,
  porNome: Map<string, ClienteBaseModelo[]>,
  porVariacao: Map<string, ClienteBaseModelo[]>,
): Localizacao {
  if (linha.cpfNormalizado) {
    const cliente = porCpf.get(linha.cpfNormalizado);
    if (cliente) return { tipo: "encontrado", cliente, via: "cpf" };
  }

  for (const [mapa, via] of [
    [porNome, "nome"],
    [porVariacao, "variacao"],
  ] as const) {
    const candidatos = (mapa.get(linha.nomeNormalizado) ?? []).filter(
      (c) => !linha.cpfNormalizado || !normalizarCPF(c.cpf),
    );
    const comOutroCpf = (mapa.get(linha.nomeNormalizado) ?? []).filter(
      (c) =>
        !!linha.cpfNormalizado &&
        !!normalizarCPF(c.cpf) &&
        normalizarCPF(c.cpf) !== linha.cpfNormalizado,
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

function sugestaoParecida(linha: LinhaModelo, clientes: ClienteBaseModelo[]): string | null {
  let melhor: { nome: string; percentual: number } | null = null;
  for (const c of clientes) {
    const r = compararNomes(linha.nomeNormalizado, c.nome_normalizado, LIMIARES_PADRAO);
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

export function planejarImportacaoModelo(params: {
  linhas: LinhaModelo[];
  clientes: ClienteBaseModelo[];
  variacoes: { cliente_id: string; nome_normalizado: string }[];
  pagamentos: PagamentoBaseModelo[];
}): PlanoModelo {
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
  const pagamentosModelo = new Map<string, number[]>();
  for (const p of params.pagamentos) {
    if (p.observacao !== MARCA_PAGAMENTO_MODELO) continue;
    pagamentosModelo.set(p.cliente_id, [...(pagamentosModelo.get(p.cliente_id) ?? []), p.valor]);
  }

  const clientesUsados = new Map<string, number>();
  const itens: ItemPlano[] = [];

  for (const linha of params.linhas) {
    const base: ItemPlano = {
      linha,
      acao: "erro",
      clienteId: null,
      clienteNome: null,
      alteracoes: {},
      registrarValor: null,
      motivo: null,
      aviso: null,
    };

    if (linha.erros.length > 0 || !linha.situacao) {
      itens.push({ ...base, motivo: linha.erros.join(" ") || "Linha inválida." });
      continue;
    }

    const loc = localizar(linha, porCpf, porNome, porVariacao);

    if (loc.tipo === "encontrado") {
      const anterior = clientesUsados.get(loc.cliente.id);
      if (anterior) {
        itens.push({
          ...base,
          motivo: `Refere-se ao mesmo cliente da linha ${anterior} ("${loc.cliente.nome}").`,
        });
        continue;
      }
      clientesUsados.set(loc.cliente.id, linha.numeroLinha);
    }

    // Dados complementares: só preenche o que está vazio (nunca sobrescreve).
    const complementar = (c: ClienteBaseModelo) => {
      const alt: ItemPlano["alteracoes"] = {};
      if (linha.cpf && linha.cpfNormalizado && !normalizarCPF(c.cpf)) alt.cpf = linha.cpf;
      if (linha.processo && !c.numero_processo?.trim()) alt.numero_processo = linha.processo;
      return alt;
    };

    if (linha.situacao === "NAO_PAGO") {
      if (loc.tipo === "ambiguo" || loc.tipo === "conflito") {
        itens.push({ ...base, motivo: loc.motivo });
        continue;
      }
      if (loc.tipo === "nenhum") {
        itens.push({ ...base, acao: "criar", aviso: null });
        continue;
      }
      const c = loc.cliente;
      const alteracoes = complementar(c);
      let aviso: string | null = null;
      if (c.status === "pago") {
        aviso =
          "Cliente já consta em JÁ PAGOS — mantido como pago (o status não é revertido automaticamente).";
      } else if (c.status !== "ativo") {
        alteracoes.status = "ativo";
      }
      if (c.numero_processo && linha.processo && c.numero_processo.trim() !== linha.processo) {
        aviso = `Número do processo diferente do cadastrado (${c.numero_processo}) — mantido o cadastrado.`;
      }
      itens.push({
        ...base,
        acao: Object.keys(alteracoes).length > 0 ? "atualizar" : "sem_alteracao",
        clienteId: c.id,
        clienteNome: c.nome,
        alteracoes,
        aviso,
      });
      continue;
    }

    // PAGO
    if (loc.tipo !== "encontrado") {
      const motivo =
        loc.tipo === "nenhum"
          ? "Cliente não encontrado na base."
          : `Cliente não encontrado na base. ${loc.motivo}`;
      itens.push({
        ...base,
        acao: "nao_encontrado",
        motivo,
        aviso: loc.tipo === "nenhum" ? sugestaoParecida(linha, params.clientes) : null,
      });
      continue;
    }

    const c = loc.cliente;
    const alteracoes = complementar(c);
    if (c.status !== "pago") alteracoes.status = "pago";

    const jaRegistrados = pagamentosModelo.get(c.id) ?? [];
    const registrarValor =
      linha.valor != null &&
      linha.valor > 0 &&
      !jaRegistrados.some((v) => Math.abs(v - linha.valor!) < 0.005)
        ? linha.valor
        : null;

    itens.push({
      ...base,
      acao:
        Object.keys(alteracoes).length > 0 || registrarValor != null
          ? "marcar_pago"
          : "sem_alteracao",
      clienteId: c.id,
      clienteNome: c.nome,
      alteracoes,
      registrarValor,
      aviso:
        loc.via === "variacao"
          ? `Identificado pela variação de nome confirmada de "${c.nome}".`
          : linha.valor != null && registrarValor == null && linha.valor > 0
            ? "Valor já registrado em importação anterior — não será duplicado."
            : null,
    });
  }

  const resumo: ResumoPlano = {
    total: itens.length,
    emTramitacao: itens.filter((i) => i.linha.situacao === "NAO_PAGO" && i.acao !== "erro").length,
    novos: itens.filter((i) => i.acao === "criar").length,
    existentes: itens.filter(
      (i) =>
        i.linha.situacao === "NAO_PAGO" && (i.acao === "atualizar" || i.acao === "sem_alteracao"),
    ).length,
    pagosIdentificados: itens.filter(
      (i) =>
        i.linha.situacao === "PAGO" && (i.acao === "marcar_pago" || i.acao === "sem_alteracao"),
    ).length,
    pagosNaoEncontrados: itens.filter((i) => i.acao === "nao_encontrado").length,
    erros: itens.filter((i) => i.acao === "erro").length,
  };

  return { itens, resumo };
}

// ---------------------------------------------------------------------------
// 5. Payload para a função transacional `aplicar_importacao_modelo`
// ---------------------------------------------------------------------------

export interface ItemPayloadModelo {
  acao: "criar" | "atualizar" | "marcar_pago";
  linha: number;
  nome?: string;
  nome_normalizado?: string;
  cpf?: string | null;
  numero_processo?: string | null;
  cliente_id?: string;
  alteracoes?: ItemPlano["alteracoes"];
  valor?: number | null;
}

/** Converte o plano revisado no payload gravado numa única transação. */
export function montarPayloadImportacao(plano: PlanoModelo): ItemPayloadModelo[] {
  const itens: ItemPayloadModelo[] = [];
  for (const item of plano.itens) {
    if (item.acao === "criar") {
      itens.push({
        acao: "criar",
        linha: item.linha.numeroLinha,
        nome: item.linha.nome,
        nome_normalizado: item.linha.nomeNormalizado,
        cpf: item.linha.cpfNormalizado ? item.linha.cpf : null,
        numero_processo: item.linha.processo,
      });
    } else if (item.acao === "atualizar" || item.acao === "marcar_pago") {
      itens.push({
        acao: item.acao,
        linha: item.linha.numeroLinha,
        cliente_id: item.clienteId!,
        alteracoes: item.alteracoes,
        valor: item.registrarValor,
      });
    }
  }
  return itens;
}
