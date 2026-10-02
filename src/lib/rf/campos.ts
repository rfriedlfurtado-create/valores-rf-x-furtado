/**
 * MODELO PERMANENTE DE IMPORTAÇÃO — Ricardo Friedl (relatório Espaider).
 *
 * Referência: planilha "CLIENTES RICARDO - PELO ESPAIDER". O reconhecimento é
 * feito pelo CABEÇALHO (não pela posição nem pelo nome do arquivo), tolerando
 * diferenças de espaços, maiúsculas, acentos e separadores.
 *
 * Único campo obrigatório: Reclamante.
 */

export type EntidadeCampo = "cliente" | "registro";

export type TipoCampo =
  | "texto"
  | "nome"
  | "documento" // CPF/CNPJ — sempre texto, zeros preservados
  | "processo"
  | "pasta"
  | "telefone"
  | "email"
  | "cep"
  | "data"
  | "datahora"
  | "moeda"
  | "percentual"
  | "uf";

export type SecaoPerfil = "pessoais" | "contatos" | "processo" | "captacao";

export type ChaveCampo =
  | "numero"
  | "nome"
  | "adverso"
  | "tipo_acao"
  | "valor"
  | "celular"
  | "comarca"
  | "uf_comarca"
  | "distribuido_em"
  | "categoria"
  | "captador"
  | "captado_em"
  | "valor_captacao"
  | "juizo"
  | "perc_honorario"
  | "requisicao"
  | "fase"
  | "situacao"
  | "telefone_cliente"
  | "telefone_residencial"
  | "data_nascimento"
  | "email"
  | "comarca_x"
  | "cpf_cnpj"
  | "indicacao"
  | "salario"
  | "cep"
  | "cpf_reclamante"
  | "pasta";

export interface CampoModelo {
  chave: ChaveCampo;
  /** Cabeçalho oficial, exatamente como no modelo. */
  cabecalho: string;
  /** Nome do campo no sistema (rótulo do perfil). */
  rotulo: string;
  entidade: EntidadeCampo;
  tipo: TipoCampo;
  secao: SecaoPerfil;
  obrigatorio?: boolean;
  /** Outras grafias aceitas (já normalizadas por `normalizarCabecalho`). */
  aliases?: string[];
}

/**
 * Ordem oficial do modelo (é a ordem do modelo Excel vazio para download).
 * As duas colunas "Comarca" são distintas: a 1ª ocorrência é a "Comarca —
 * coluna G" e a 2ª é a "Comarca — coluna X".
 */
export const CAMPOS_MODELO: CampoModelo[] = [
  {
    chave: "numero",
    cabecalho: "Número",
    rotulo: "Número do processo ou atendimento",
    entidade: "registro",
    tipo: "processo",
    secao: "processo",
    aliases: ["numero do processo", "processo", "n processo"],
  },
  {
    chave: "nome",
    cabecalho: "Reclamante",
    rotulo: "Nome do cliente",
    entidade: "cliente",
    tipo: "nome",
    secao: "pessoais",
    obrigatorio: true,
    aliases: ["nome do cliente", "cliente", "nome"],
  },
  {
    chave: "adverso",
    cabecalho: "Adverso",
    rotulo: "Parte adversa",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    aliases: ["parte adversa"],
  },
  {
    chave: "tipo_acao",
    cabecalho: "Tipo de Ação",
    rotulo: "Tipo de ação ou serviço",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    aliases: ["tipo acao", "tipo da acao"],
  },
  {
    chave: "valor",
    cabecalho: "Valor",
    rotulo: "Valor informado",
    entidade: "registro",
    tipo: "moeda",
    secao: "processo",
    aliases: ["valor da causa"],
  },
  {
    chave: "celular",
    cabecalho: "Celular",
    rotulo: "Celular",
    entidade: "cliente",
    tipo: "telefone",
    secao: "contatos",
  },
  {
    chave: "comarca",
    cabecalho: "Comarca",
    rotulo: "Comarca (coluna G)",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
  },
  {
    chave: "uf_comarca",
    cabecalho: "UF Comarca",
    rotulo: "UF da comarca",
    entidade: "registro",
    tipo: "uf",
    secao: "processo",
    aliases: ["uf da comarca", "uf"],
  },
  {
    chave: "distribuido_em",
    cabecalho: "Distribuído em",
    rotulo: "Data de distribuição",
    entidade: "registro",
    tipo: "data",
    secao: "processo",
    aliases: ["data de distribuicao", "distribuicao"],
  },
  {
    chave: "categoria",
    cabecalho: "Categoria",
    rotulo: "Categoria",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
  },
  {
    chave: "captador",
    cabecalho: "Captador",
    rotulo: "Captador",
    entidade: "registro",
    tipo: "texto",
    secao: "captacao",
  },
  {
    chave: "captado_em",
    cabecalho: "Captado em",
    rotulo: "Data e horário da captação",
    entidade: "registro",
    tipo: "datahora",
    secao: "captacao",
    aliases: ["data da captacao", "captacao"],
  },
  {
    chave: "valor_captacao",
    cabecalho: "Valor Captação",
    rotulo: "Valor da captação",
    entidade: "registro",
    tipo: "moeda",
    secao: "captacao",
    aliases: ["valor da captacao"],
  },
  {
    chave: "juizo",
    cabecalho: "Juízo",
    rotulo: "Juízo",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
  },
  {
    chave: "perc_honorario",
    cabecalho: "% Honorário",
    rotulo: "Percentual de honorários",
    entidade: "registro",
    tipo: "percentual",
    secao: "captacao",
    aliases: [
      "honorario",
      "honorarios",
      "percentual honorario",
      "percentual de honorarios",
      "honorario %",
    ],
  },
  {
    chave: "requisicao",
    cabecalho: "Requisição",
    rotulo: "Requisição",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
  },
  {
    chave: "fase",
    cabecalho: "Fase",
    rotulo: "Fase",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
  },
  {
    chave: "situacao",
    cabecalho: "Situação",
    rotulo: "Situação",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
  },
  {
    chave: "telefone_cliente",
    cabecalho: "Telefone Cliente",
    rotulo: "Telefone do cliente",
    entidade: "cliente",
    tipo: "telefone",
    secao: "contatos",
    aliases: ["telefone do cliente"],
  },
  {
    chave: "telefone_residencial",
    cabecalho: "Telefone Residencial",
    rotulo: "Telefone residencial",
    entidade: "cliente",
    tipo: "telefone",
    secao: "contatos",
  },
  {
    chave: "data_nascimento",
    cabecalho: "Data de nascimento cliente",
    rotulo: "Data de nascimento",
    entidade: "cliente",
    tipo: "data",
    secao: "pessoais",
    aliases: ["data de nascimento", "data de nascimento do cliente", "nascimento"],
  },
  {
    chave: "email",
    cabecalho: "E-mail",
    rotulo: "E-mail",
    entidade: "cliente",
    tipo: "email",
    secao: "contatos",
    aliases: ["email"],
  },
  {
    chave: "comarca_x",
    cabecalho: "Comarca",
    rotulo: "Comarca (coluna X)",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
  },
  {
    chave: "cpf_cnpj",
    cabecalho: "CPF\\CNPJ",
    rotulo: "CPF/CNPJ informado",
    entidade: "cliente",
    tipo: "documento",
    secao: "pessoais",
    aliases: ["cpf", "cnpj", "cpf ou cnpj"],
  },
  {
    chave: "indicacao",
    cabecalho: "Indicação",
    rotulo: "Indicação",
    entidade: "registro",
    tipo: "texto",
    secao: "captacao",
  },
  {
    chave: "salario",
    cabecalho: "Salário",
    rotulo: "Salário",
    entidade: "cliente",
    tipo: "moeda",
    secao: "pessoais",
  },
  {
    chave: "cep",
    cabecalho: "CEP",
    rotulo: "CEP",
    entidade: "cliente",
    tipo: "cep",
    secao: "pessoais",
  },
  {
    chave: "cpf_reclamante",
    cabecalho: "CPF Reclamante",
    rotulo: "CPF do reclamante",
    entidade: "cliente",
    tipo: "documento",
    secao: "pessoais",
    aliases: ["cpf do reclamante", "cpf cliente", "cpf do cliente"],
  },
  {
    chave: "pasta",
    cabecalho: "Pasta",
    rotulo: "Código da pasta",
    entidade: "registro",
    tipo: "pasta",
    secao: "processo",
    aliases: ["codigo da pasta", "cod pasta"],
  },
];

export const CAMPO_POR_CHAVE = new Map(CAMPOS_MODELO.map((c) => [c.chave, c]));

export function campo(chave: ChaveCampo): CampoModelo {
  return CAMPO_POR_CHAVE.get(chave)!;
}

/** Ordem de exibição no perfil, por seção (todas as colunas do modelo). */
export const SECOES_PERFIL: { secao: SecaoPerfil; titulo: string; campos: ChaveCampo[] }[] = [
  {
    secao: "pessoais",
    titulo: "Dados pessoais",
    campos: ["nome", "cpf_reclamante", "cpf_cnpj", "data_nascimento", "salario", "cep"],
  },
  {
    secao: "contatos",
    titulo: "Contatos",
    campos: ["celular", "telefone_cliente", "telefone_residencial", "email"],
  },
  {
    secao: "processo",
    titulo: "Processo ou atendimento",
    campos: [
      "numero",
      "adverso",
      "tipo_acao",
      "valor",
      "comarca",
      "uf_comarca",
      "distribuido_em",
      "categoria",
      "juizo",
      "requisicao",
      "fase",
      "situacao",
      "comarca_x",
      "pasta",
    ],
  },
  {
    secao: "captacao",
    titulo: "Captação e honorários",
    campos: ["captador", "captado_em", "valor_captacao", "indicacao", "perc_honorario"],
  },
];

/** Campos do cadastro guardados em `clientes.dados_rf` (nome e CPF têm colunas próprias). */
export const CAMPOS_DADOS_CLIENTE: ChaveCampo[] = CAMPOS_MODELO.filter(
  (c) => c.entidade === "cliente" && c.chave !== "nome" && c.chave !== "cpf_reclamante",
).map((c) => c.chave);

export const CAMPOS_REGISTRO: ChaveCampo[] = CAMPOS_MODELO.filter(
  (c) => c.entidade === "registro",
).map((c) => c.chave);

export const NAO_INFORMADO = "Não informado";

/** Normaliza um cabeçalho para comparação (sem alterar o original). */
export function normalizarCabecalho(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\\/|_\-.:;,()[\]*%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cabeçalho normalizado → campos possíveis (na ordem de preferência). */
const INDICE_CABECALHOS: Map<string, ChaveCampo[]> = (() => {
  const indice = new Map<string, ChaveCampo[]>();
  const add = (k: string, chave: ChaveCampo) => {
    const lista = indice.get(k) ?? [];
    if (!lista.includes(chave)) lista.push(chave);
    indice.set(k, lista);
  };
  for (const c of CAMPOS_MODELO) add(normalizarCabecalho(c.cabecalho), c.chave);
  for (const c of CAMPOS_MODELO)
    for (const a of c.aliases ?? []) add(normalizarCabecalho(a), c.chave);
  return indice;
})();

export interface MapeamentoColunas {
  /** índice da coluna → campo do modelo */
  campos: Map<number, ChaveCampo>;
  /** índice da coluna → cabeçalho original (colunas não reconhecidas) */
  extras: Map<number, string>;
  /** Cabeçalhos originais por índice (todas as colunas). */
  cabecalhos: string[];
  /** Campos do modelo ausentes no arquivo (todos opcionais, exceto Reclamante). */
  ausentes: ChaveCampo[];
}

/**
 * Reconhece as colunas pelo cabeçalho. Cada campo é usado uma única vez;
 * quando um cabeçalho se repete (ex.: duas "Comarca"), a próxima ocorrência
 * vai para o próximo campo compatível (Comarca G → Comarca X).
 */
export function mapearCabecalhos(cabecalhos: (string | null | undefined)[]): MapeamentoColunas {
  const campos = new Map<number, ChaveCampo>();
  const extras = new Map<number, string>();
  const usados = new Set<ChaveCampo>();
  const originais = cabecalhos.map((c) => (c == null ? "" : String(c)));

  // 1ª passada: cabeçalhos oficiais e aliases exatos.
  originais.forEach((original, indice) => {
    const norm = normalizarCabecalho(original);
    if (!norm) return;
    const candidatos = INDICE_CABECALHOS.get(norm) ?? [];
    const livre = candidatos.find((c) => !usados.has(c));
    if (livre) {
      campos.set(indice, livre);
      usados.add(livre);
    } else {
      extras.set(indice, original.trim());
    }
  });

  const ausentes = CAMPOS_MODELO.map((c) => c.chave).filter((c) => !usados.has(c));
  return { campos, extras, cabecalhos: originais, ausentes };
}
