/**
 * MAPEAMENTO OFICIAL DO IMPORTADOR — Ricardo Friedl (relatório Espaider).
 *
 * Referência oficial: planilha "CLIENTES RF - ESPAIDER" (22 colunas). Este
 * arquivo é o ÚNICO lugar com a correspondência
 *
 *   COLUNA DA PLANILHA → CAMPO INTERNO (chave) → ENTIDADE → BLOCO DO PERFIL
 *
 * O reconhecimento é feito pelo CABEÇALHO (não pela posição nem pelo nome do
 * arquivo), tolerando diferenças de espaços, maiúsculas, acentos e separadores.
 *
 * Armazenamento (sem colunas novas — ver supabase/migrations/20261002200000):
 *  - entidade "cliente"  → clientes.dados_rf[chave] (nome → clientes.nome,
 *    CPF Reclamante → clientes.cpf / cpf_digitos)
 *  - entidade "registro" → atendimentos.dados_rf[chave] (um registro por
 *    processo: o mesmo cliente pode ter vários)
 *
 * Campos "legados" vieram do modelo anterior (28/29 colunas). Não fazem parte
 * do modelo oficial nem do modelo vazio para download, mas continuam
 * reconhecidos e exibidos para não perder dados já importados.
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

/** Blocos do perfil do cliente. */
export type SecaoPerfil = "identificacao" | "contato" | "processo" | "interno";

export type ChaveCampo =
  // modelo oficial (CLIENTES RF - ESPAIDER)
  | "numero"
  | "nome"
  | "adverso"
  | "tipo_acao"
  | "celular"
  | "cidade"
  | "distribuido_em"
  | "categoria"
  | "captador"
  | "captado_em"
  | "valor_estimado"
  | "data_inicio_contrato"
  | "situacao"
  | "telefone_cliente"
  | "telefone_residencial"
  | "data_nascimento"
  | "email"
  | "cpf_cnpj"
  | "indicacao"
  | "cep"
  | "cpf_reclamante"
  | "pasta"
  // legados (modelo anterior)
  | "valor"
  | "comarca"
  | "uf_comarca"
  | "valor_captacao"
  | "juizo"
  | "perc_honorario"
  | "requisicao"
  | "fase"
  | "comarca_x"
  | "salario";

export interface CampoModelo {
  chave: ChaveCampo;
  /** Cabeçalho oficial, exatamente como na planilha. */
  cabecalho: string;
  /** Nome do campo no sistema (rótulo do perfil). */
  rotulo: string;
  entidade: EntidadeCampo;
  tipo: TipoCampo;
  /** Bloco do perfil onde o campo aparece. */
  secao: SecaoPerfil;
  /**
   * Informação principal do bloco: fica sempre visível (inclusive com o bloco
   * recolhido). As demais aparecem ao expandir. Prioridade provisória — a
   * definição final será feita depois, alterando só esta marcação.
   */
  principal?: boolean;
  obrigatorio?: boolean;
  /** Campo do modelo anterior (fora do modelo oficial). */
  legado?: boolean;
  /** Outras grafias aceitas (já normalizadas por `normalizarCabecalho`). */
  aliases?: string[];
}

/**
 * Ordem oficial = ordem das colunas da planilha "CLIENTES RF - ESPAIDER"
 * (é a ordem do modelo vazio para download). Os legados vêm depois.
 */
export const CAMPOS_MODELO: CampoModelo[] = [
  {
    chave: "numero",
    cabecalho: "Número",
    rotulo: "Número do processo",
    entidade: "registro",
    tipo: "processo",
    secao: "processo",
    principal: true,
    aliases: ["numero do processo", "processo", "n processo"],
  },
  {
    chave: "nome",
    cabecalho: "Reclamante",
    rotulo: "Reclamante",
    entidade: "cliente",
    tipo: "nome",
    secao: "identificacao",
    principal: true,
    obrigatorio: true,
    aliases: ["nome do cliente", "cliente", "nome"],
  },
  {
    chave: "adverso",
    cabecalho: "Adverso",
    rotulo: "Adverso",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    aliases: ["parte adversa"],
  },
  {
    chave: "tipo_acao",
    cabecalho: "Tipo de Ação",
    rotulo: "Tipo de Ação",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    principal: true,
    aliases: ["tipo acao", "tipo da acao"],
  },
  {
    chave: "celular",
    cabecalho: "Celular",
    rotulo: "Celular",
    entidade: "cliente",
    tipo: "telefone",
    secao: "contato",
    principal: true,
  },
  {
    chave: "cidade",
    cabecalho: "Cidade",
    rotulo: "Cidade",
    entidade: "cliente",
    tipo: "texto",
    secao: "identificacao",
    principal: true,
    aliases: ["municipio"],
  },
  {
    chave: "distribuido_em",
    cabecalho: "Distribuído em",
    rotulo: "Distribuído em",
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
    secao: "interno",
    principal: true,
  },
  {
    chave: "captado_em",
    cabecalho: "Captado em",
    rotulo: "Captado em",
    entidade: "registro",
    tipo: "datahora",
    secao: "interno",
    aliases: ["data da captacao", "captacao"],
  },
  {
    chave: "valor_estimado",
    cabecalho: "Valor Estimado do Processo",
    rotulo: "Valor Estimado do Processo",
    entidade: "registro",
    tipo: "moeda",
    secao: "processo",
    aliases: ["valor estimado", "valor estimado processo"],
  },
  {
    chave: "data_inicio_contrato",
    cabecalho: "Data inicio contrato",
    rotulo: "Data início contrato",
    entidade: "registro",
    tipo: "data",
    secao: "interno",
    aliases: ["data de inicio do contrato", "data inicio do contrato", "inicio do contrato"],
  },
  {
    chave: "situacao",
    cabecalho: "Situação",
    rotulo: "Situação",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    principal: true,
  },
  {
    chave: "telefone_cliente",
    cabecalho: "Telefone Cliente",
    rotulo: "Telefone Cliente",
    entidade: "cliente",
    tipo: "telefone",
    secao: "contato",
    aliases: ["telefone do cliente"],
  },
  {
    chave: "telefone_residencial",
    cabecalho: "Telefone Residencial",
    rotulo: "Telefone Residencial",
    entidade: "cliente",
    tipo: "telefone",
    secao: "contato",
  },
  {
    chave: "data_nascimento",
    cabecalho: "Data de nascimento cliente",
    rotulo: "Data de nascimento",
    entidade: "cliente",
    tipo: "data",
    secao: "identificacao",
    aliases: ["data de nascimento", "data de nascimento do cliente", "nascimento"],
  },
  {
    chave: "email",
    cabecalho: "E-mail",
    rotulo: "E-mail",
    entidade: "cliente",
    tipo: "email",
    secao: "contato",
    principal: true,
    aliases: ["email"],
  },
  {
    chave: "cpf_cnpj",
    cabecalho: "CPF",
    rotulo: "CPF (coluna CPF)",
    entidade: "cliente",
    tipo: "documento",
    secao: "identificacao",
    aliases: ["cpf\\cnpj", "cpf cnpj", "cnpj", "cpf ou cnpj"],
  },
  {
    chave: "indicacao",
    cabecalho: "Indicação",
    rotulo: "Indicação",
    entidade: "registro",
    tipo: "texto",
    secao: "interno",
  },
  {
    chave: "cep",
    cabecalho: "CEP",
    rotulo: "CEP",
    entidade: "cliente",
    tipo: "cep",
    secao: "identificacao",
  },
  {
    chave: "cpf_reclamante",
    cabecalho: "CPF Reclamante",
    rotulo: "CPF",
    entidade: "cliente",
    tipo: "documento",
    secao: "identificacao",
    principal: true,
    aliases: ["cpf do reclamante", "cpf cliente", "cpf do cliente"],
  },
  {
    chave: "pasta",
    cabecalho: "Pasta",
    rotulo: "Pasta",
    entidade: "registro",
    tipo: "pasta",
    secao: "interno",
    principal: true,
    aliases: ["codigo da pasta", "cod pasta"],
  },

  // ---- Legados (modelo anterior). Mantidos para exibir/editar dados já gravados.
  {
    chave: "valor",
    cabecalho: "Valor",
    rotulo: "Valor informado (modelo anterior)",
    entidade: "registro",
    tipo: "moeda",
    secao: "processo",
    legado: true,
    aliases: ["valor da causa"],
  },
  {
    chave: "comarca",
    cabecalho: "Comarca",
    rotulo: "Comarca",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    legado: true,
  },
  {
    chave: "uf_comarca",
    cabecalho: "UF Comarca",
    rotulo: "UF da comarca",
    entidade: "registro",
    tipo: "uf",
    secao: "processo",
    legado: true,
    aliases: ["uf da comarca", "uf"],
  },
  {
    chave: "juizo",
    cabecalho: "Juízo",
    rotulo: "Juízo",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    legado: true,
  },
  {
    chave: "requisicao",
    cabecalho: "Requisição",
    rotulo: "Requisição",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    legado: true,
  },
  {
    chave: "fase",
    cabecalho: "Fase",
    rotulo: "Fase",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    legado: true,
  },
  {
    chave: "comarca_x",
    cabecalho: "Comarca",
    rotulo: "Comarca (2ª coluna)",
    entidade: "registro",
    tipo: "texto",
    secao: "processo",
    legado: true,
  },
  {
    chave: "valor_captacao",
    cabecalho: "Valor Captação",
    rotulo: "Valor da captação",
    entidade: "registro",
    tipo: "moeda",
    secao: "interno",
    legado: true,
    aliases: ["valor da captacao"],
  },
  {
    chave: "perc_honorario",
    cabecalho: "% Honorário",
    rotulo: "Percentual de honorários",
    entidade: "registro",
    tipo: "percentual",
    secao: "interno",
    legado: true,
    aliases: [
      "honorario",
      "honorarios",
      "percentual honorario",
      "percentual de honorarios",
      "honorario %",
    ],
  },
  {
    chave: "salario",
    cabecalho: "Salário",
    rotulo: "Salário",
    entidade: "cliente",
    tipo: "moeda",
    secao: "identificacao",
    legado: true,
  },
];

/** As 22 colunas do modelo oficial, na ordem da planilha. */
export const CAMPOS_OFICIAIS: CampoModelo[] = CAMPOS_MODELO.filter((c) => !c.legado);

export const CAMPO_POR_CHAVE = new Map(CAMPOS_MODELO.map((c) => [c.chave, c]));

export function campo(chave: ChaveCampo): CampoModelo {
  return CAMPO_POR_CHAVE.get(chave)!;
}

/** Blocos do perfil e a ordem dos campos em cada um (oficiais e, por último, legados). */
export const BLOCOS_PERFIL: { secao: SecaoPerfil; titulo: string; campos: ChaveCampo[] }[] = (
  [
    ["identificacao", "Identificação do Cliente"],
    ["contato", "Contato"],
    ["processo", "Processo"],
    ["interno", "Informações Internas"],
  ] as const
).map(([secao, titulo]) => ({
  secao,
  titulo,
  campos: [
    ...CAMPOS_MODELO.filter((c) => c.secao === secao && !c.legado),
    ...CAMPOS_MODELO.filter((c) => c.secao === secao && c.legado),
  ].map((c) => c.chave),
}));

export function blocoPerfil(secao: SecaoPerfil) {
  return BLOCOS_PERFIL.find((b) => b.secao === secao)!;
}

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
  /** Campos do modelo OFICIAL ausentes no arquivo (todos opcionais, exceto Reclamante). */
  ausentes: ChaveCampo[];
}

/**
 * Reconhece as colunas pelo cabeçalho. Cada campo é usado uma única vez;
 * quando um cabeçalho se repete (ex.: duas "Comarca" do modelo anterior), a
 * próxima ocorrência vai para o próximo campo compatível.
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

  const ausentes = CAMPOS_OFICIAIS.map((c) => c.chave).filter((c) => !usados.has(c));
  return { campos, extras, cabecalhos: originais, ausentes };
}
