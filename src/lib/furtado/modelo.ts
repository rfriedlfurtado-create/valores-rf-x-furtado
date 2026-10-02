/**
 * Tipos do importador Furtado Advogados (análise → plano → gravação).
 */

import type { DataLida, NomeExtraido } from "./texto";

export const MODELO_FURTADO = "furtado_planilha_execucao_v1";
export const MODELO_RICARDO = "modelo_documento_atlas_v1";

export type Escritorio = "furtado" | "ricardo_friedl";
export type EscritorioOrigem = Escritorio | "a_confirmar";

export const ROTULO_ESCRITORIO: Record<EscritorioOrigem, string> = {
  furtado: "Furtado Advogados",
  ricardo_friedl: "Ricardo Friedl",
  a_confirmar: "Origem a confirmar",
};

/** Destino rastreável obrigatório de toda célula preenchida. */
export type Destino =
  "campo" | "historico" | "informacao_adicional" | "resumo_arquivo" | "pendencia_revisao";

export type SituacaoCelula =
  "interpretado" | "incerto" | "pendente" | "resolvido" | "elemento_arquivo";

export const ROTULO_DESTINO: Record<Destino, string> = {
  campo: "Campo estruturado",
  historico: "Histórico / observação",
  informacao_adicional: "Informação adicional",
  resumo_arquivo: "Resumo geral do arquivo",
  pendencia_revisao: "Pendência de revisão",
};

export interface DestinoCelula {
  destino: Destino;
  /** Entidade/campo de destino, ex.: "lancamento:honorarios_contratuais". */
  ref: string;
  situacao: SituacaoCelula;
  interpretado?: unknown;
  blocoRef: string | null;
}

/** Estratégia de leitura de cada aba. */
export type EstrategiaAba =
  | "rotulos_verticais"
  | "campos_em_celula"
  | "tabela_cabecalho"
  | "linhas_registro"
  | "somente_preservar";

export type PerfilAba =
  | "previsao_execucao"
  | "cumprimento"
  | "implantacao_judicial"
  | "implantacao_administrativa"
  | "pedido_ted"
  | "acordos"
  | "precatorio"
  | "cobrancas"
  | "desconhecida";

export interface MapeamentoAba {
  aba: string;
  perfil: PerfilAba;
  estrategia: EstrategiaAba;
  conhecida: boolean;
  /** Para abas novas: precisa de confirmação do usuário antes de gravar. */
  requerConfirmacao: boolean;
}

export type CategoriaFinanceira =
  | "valor_total"
  | "atrasados"
  | "valor_cliente"
  | "repasse_cliente"
  | "honorarios_contratuais"
  | "honorarios_implantacao"
  | "honorarios_sucumbenciais"
  | "honorarios_execucao"
  | "honorarios_tutela"
  | "honorarios_administrativos"
  | "outros_honorarios"
  | "calculo_inss"
  | "valor_a_receber"
  | "ajuste";

export const ROTULO_CATEGORIA: Record<CategoriaFinanceira, string> = {
  valor_total: "Valor total",
  atrasados: "Atrasados",
  valor_cliente: "Valor destinado ao cliente",
  repasse_cliente: "Repasse ao cliente",
  honorarios_contratuais: "Honorários contratuais",
  honorarios_implantacao: "Honorários de implantação",
  honorarios_sucumbenciais: "Honorários sucumbenciais",
  honorarios_execucao: "Honorários da execução",
  honorarios_tutela: "Honorários de tutela antecipada",
  honorarios_administrativos: "Honorários administrativos",
  outros_honorarios: "Outros honorários",
  calculo_inss: "Cálculo do INSS",
  valor_a_receber: "Valores a receber (cliente)",
  ajuste: "Ajustes",
};

export const CATEGORIAS_HONORARIOS: CategoriaFinanceira[] = [
  "honorarios_contratuais",
  "honorarios_implantacao",
  "honorarios_sucumbenciais",
  "honorarios_execucao",
  "honorarios_tutela",
  "honorarios_administrativos",
  "outros_honorarios",
];

export type NaturezaLancamento = "previsto" | "devido" | "informativo" | "recebido";

export interface LancamentoRascunho {
  categoria: CategoriaFinanceira;
  natureza: NaturezaLancamento;
  valor: number | null;
  valorTexto: string | null;
  percentual: number | null;
  baseCalculo: string | null;
  quantidadeBeneficios: number | null;
  ausenciaDeclarada: string | null;
  rotuloOriginal: string;
  /** 1 = coluna principal de valores; >1 = colunas laterais. */
  versao: number;
  coluna: string;
  dataReferencia: string | null;
  situacaoTexto: string | null;
  observacao: string | null;
  celulas: string[]; // "ABA!B12"
  principal: boolean;
}

export interface BeneficioRascunho {
  especie: string | null;
  especieCodigo: string | null;
  nb: string | null;
  nbDigitos: string | null;
  dib: DataLida | null;
  dibTexto: string | null;
  dibOrigemTexto: string | null;
  dip: DataLida | null;
  dipTexto: string | null;
  dcb: DataLida | null;
  dcbTexto: string | null;
  rmi: number | null;
  rmiTexto: string | null;
  rma: number | null;
  rmaTexto: string | null;
  previsaoPagamentoTexto: string | null;
  transito: DataLida | null;
  transitoTexto: string | null;
  dataRequerimentoTexto: string | null;
  dataConcessaoTexto: string | null;
  prorrogacaoTexto: string | null;
  revisaoTexto: string | null;
  implantacaoTexto: string | null;
  atrasadosTexto: string | null;
  honorariosRegra: string | null;
  comunicacaoTexto: string | null;
  historico: { campo: string; texto: string; celula: string }[];
  celulas: string[];
}

export type TipoRequisicao = "rpv" | "precatorio" | "ted" | "alvara" | "nao_definido";

export interface RequisicaoRascunho {
  tipo: TipoRequisicao;
  numeroProcesso: string | null;
  expedicaoTexto: string | null;
  anoPrevisto: number | null;
  previsaoTexto: string | null;
  valor: number | null;
  valorTexto: string | null;
  tipoValor: string | null;
  contaIndicada: string | null;
  titular: string | null;
  situacao: string | null;
  situacaoTexto: string | null;
  dataTexto: string | null;
  retificacao: string | null;
  venda: boolean;
  observacoes: string | null;
  celulas: string[];
}

export interface AcordoRascunho {
  numeroProcesso: string | null;
  aceitacao: "sim" | "nao" | null;
  aceitacaoTexto: string | null;
  percentual: number | null;
  beneficio: string | null;
  dib: DataLida | null;
  dibTexto: string | null;
  dip: DataLida | null;
  dipTexto: string | null;
  dcb: DataLida | null;
  dcbTexto: string | null;
  dcbPrazoDias: number | null;
  sucumbenciaPercentual: number | null;
  sucumbenciaTexto: string | null;
  deAcordoLaudo: string | null;
  prorrogacao: string | null;
  reabilitacao: string | null;
  observacoes: string | null;
  celulas: string[];
}

export interface ParcelaRascunho {
  numero: number;
  valor: number;
  vencimento: string | null;
  vencimentoTexto: string | null;
}

export interface CobrancaRascunho {
  descricao: string;
  valorContratado: number | null;
  entrada: number | null;
  quantidadeParcelas: number | null;
  valorParcela: number | null;
  vencimentoInicial: string | null;
  vencimentoTexto: string | null;
  situacao: "pendente" | "parcial" | "quitada" | "a_confirmar";
  responsavel: string | null;
  prestacaoContas: string | null;
  historico: string;
  divergencia: string | null;
  completar: string | null;
  parcelas: ParcelaRascunho[];
  celulas: string[];
}

export interface BancarioRascunho {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  operacao: string | null;
  tipoConta: string | null;
  titular: string | null;
  cpfTitular: string | null;
  textoOriginal: string;
  consistente: boolean;
  observacao: string | null;
  celulas: string[];
}

export interface RepresentanteRascunho {
  nome: string | null;
  relacao: string | null;
  textoOriginal: string;
  celulas: string[];
}

export interface HistoricoRascunho {
  categoria: string;
  texto: string;
  dataTexto: string | null;
  celulas: string[];
}

export interface PagamentoIdentificado {
  texto: string;
  celula: string;
  valor: number | null;
  data: DataLida | null;
  categoria: CategoriaFinanceira | null;
  /** O texto não diz com clareza qual valor foi pago ou quem recebeu. */
  indefinido: boolean;
}

export type TipoPendencia =
  | "associacao_cliente"
  | "bloco_sem_identificacao"
  | "associacao_conteudo"
  | "possivel_mesma_pessoa"
  | "separacao_nome"
  | "nome_incompleto"
  | "divergencia_percentual"
  | "valor_malformado"
  | "conflito_valor"
  | "conflito_dado"
  | "parcelamento_divergente"
  | "parcelamento_incompleto"
  | "confirmar_recebimento"
  | "conta_inconsistente"
  | "total_divergente"
  | "formula_erro"
  | "nova_aba"
  | "mencao_pessoa";

export const ROTULO_PENDENCIA: Record<TipoPendencia, string> = {
  associacao_cliente: "Associação com cliente",
  bloco_sem_identificacao: "Bloco sem identificação",
  associacao_conteudo: "Conteúdo com associação incerta",
  possivel_mesma_pessoa: "Possível mesma pessoa no arquivo",
  separacao_nome: "Separação de nome e complemento",
  nome_incompleto: "Nome incompleto",
  divergencia_percentual: "Percentual × valor divergentes",
  valor_malformado: "Valor malformado",
  conflito_valor: "Conflito de valores",
  conflito_dado: "Conflito de dados",
  parcelamento_divergente: "Parcelamento divergente",
  parcelamento_incompleto: "Parcelamento incompleto",
  confirmar_recebimento: "Pagamento a confirmar",
  conta_inconsistente: "Dados bancários incompletos",
  total_divergente: "Total da planilha divergente",
  formula_erro: "Erro em fórmula",
  nova_aba: "Aba nova (mapeamento)",
  mencao_pessoa: "Pessoa mencionada",
};

export interface PendenciaRascunho {
  tipo: TipoPendencia;
  bloqueante: boolean;
  descricao: string;
  celulas: string[];
  dados?: Record<string, unknown>;
  blocoRef?: string | null;
  pessoaRef?: string | null;
}

export type TipoBloco =
  "cliente" | "linha_tabela" | "elemento_arquivo" | "modelo_vazio" | "sem_identificacao";

export interface DadosBloco {
  processos: { numero: string; digitos: string; sufixo: string | null; celula: string }[];
  tribunais: string[];
  cpfs: string[];
  nbs: string[];
  natureza: "judicial" | "administrativo" | null;
  servico: string | null;
  situacao: string | null;
  lancamentos: LancamentoRascunho[];
  beneficios: BeneficioRascunho[];
  requisicoes: RequisicaoRascunho[];
  acordos: AcordoRascunho[];
  cobrancas: CobrancaRascunho[];
  bancarios: BancarioRascunho[];
  representantes: RepresentanteRascunho[];
  historico: HistoricoRascunho[];
  pagamentos: PagamentoIdentificado[];
  parceria: string | null;
  secao: string | null;
}

export interface Bloco {
  ref: string;
  aba: string;
  perfil: PerfilAba;
  tipo: TipoBloco;
  linhaInicio: number;
  linhaFim: number;
  colunaBase: number;
  intervalo: string;
  nome: NomeExtraido | null;
  /** Célula de onde veio o nome. */
  celulaNome: string | null;
  /** Ordem do bloco dentro da aba (estável entre reimportações do mesmo layout). */
  ordem: number;
  celulas: string[];
  dados: DadosBloco;
  pendencias: PendenciaRascunho[];
}

export interface TotalPlanilha {
  aba: string;
  celula: string;
  rotulo: string | null;
  categoria: CategoriaFinanceira | "total_geral" | null;
  formula: string | null;
  armazenado: number | string | null;
  recalculado: number | string | null;
  erroFormula: string | null;
  apurado: number | null;
  diferenca: number | null;
  omitidas: string[];
  estranhas: string[];
  observacao: string | null;
}

export interface ResumoAba {
  aba: string;
  mapeamento: MapeamentoAba;
  celulasPreenchidas: number;
  blocos: number;
  porDestino: Record<Destino, number>;
  ocultas: number;
  mescladas: number;
  formulas: number;
}

export interface AnaliseFurtado {
  modelo: typeof MODELO_FURTADO;
  abas: ResumoAba[];
  blocos: Bloco[];
  destinos: Map<string, DestinoCelula>; // chave "ABA!REF"
  totais: TotalPlanilha[];
  pendenciasArquivo: PendenciaRascunho[];
  celulasTotal: number;
}

export function chaveCelula(aba: string, ref: string): string {
  return `${aba}!${ref}`;
}

export function dadosBlocoVazio(): DadosBloco {
  return {
    processos: [],
    tribunais: [],
    cpfs: [],
    nbs: [],
    natureza: null,
    servico: null,
    situacao: null,
    lancamentos: [],
    beneficios: [],
    requisicoes: [],
    acordos: [],
    cobrancas: [],
    bancarios: [],
    representantes: [],
    historico: [],
    pagamentos: [],
    parceria: null,
    secao: null,
  };
}

export function beneficioVazio(): BeneficioRascunho {
  return {
    especie: null,
    especieCodigo: null,
    nb: null,
    nbDigitos: null,
    dib: null,
    dibTexto: null,
    dibOrigemTexto: null,
    dip: null,
    dipTexto: null,
    dcb: null,
    dcbTexto: null,
    rmi: null,
    rmiTexto: null,
    rma: null,
    rmaTexto: null,
    previsaoPagamentoTexto: null,
    transito: null,
    transitoTexto: null,
    dataRequerimentoTexto: null,
    dataConcessaoTexto: null,
    prorrogacaoTexto: null,
    revisaoTexto: null,
    implantacaoTexto: null,
    atrasadosTexto: null,
    honorariosRegra: null,
    comunicacaoTexto: null,
    historico: [],
    celulas: [],
  };
}

export function requisicaoVazia(tipo: TipoRequisicao = "nao_definido"): RequisicaoRascunho {
  return {
    tipo,
    numeroProcesso: null,
    expedicaoTexto: null,
    anoPrevisto: null,
    previsaoTexto: null,
    valor: null,
    valorTexto: null,
    tipoValor: null,
    contaIndicada: null,
    titular: null,
    situacao: null,
    situacaoTexto: null,
    dataTexto: null,
    retificacao: null,
    venda: false,
    observacoes: null,
    celulas: [],
  };
}
