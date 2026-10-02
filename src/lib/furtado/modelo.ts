/**
 * Tipos de domínio dos registros financeiros (escritório de origem e
 * categorias de lançamentos), usados pelos módulos de consulta e cálculo.
 *
 * As regras e os tipos de leitura/mapeamento de planilhas dos modelos antigos
 * de importação foram removidos.
 */

export type Escritorio = "furtado" | "ricardo_friedl";
export type EscritorioOrigem = Escritorio | "a_confirmar";

export const ROTULO_ESCRITORIO: Record<EscritorioOrigem, string> = {
  furtado: "Furtado Advogados",
  ricardo_friedl: "Ricardo Friedl",
  a_confirmar: "Origem a confirmar",
};

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
