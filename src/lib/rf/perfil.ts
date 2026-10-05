/**
 * Organização dos campos nos blocos do perfil do cliente (funções puras —
 * testadas em tests/perfil-blocos.test.ts).
 *
 * Regras:
 *  - campo PRINCIPAL preenchido → sempre visível (também no resumo do bloco recolhido);
 *  - campo secundário preenchido → aparece ao expandir o bloco;
 *  - campo vazio (principal ou secundário) → fica escondido em "Campos não
 *    preenchidos", dentro do bloco expandido, para poder ser preenchido depois;
 *  - campo legado (modelo anterior) só aparece quando tem informação.
 */

import { blocoPerfil, CAMPO_POR_CHAVE, type ChaveCampo } from "./campos";
import type { DadosRF } from "./dados";
import { formatarValor, somenteDigitos } from "./valores";

/** Qualquer texto não vazio é informação ("0", "Não" e "Sem registro" contam). */
export function campoPreenchido(valor: string | null | undefined): boolean {
  return valor !== null && valor !== undefined && String(valor).trim() !== "";
}

export interface CamposOrganizados {
  principais: ChaveCampo[];
  secundarios: ChaveCampo[];
  vazios: ChaveCampo[];
}

export function organizarCampos(
  campos: ChaveCampo[],
  valor: (chave: ChaveCampo) => string | null | undefined,
): CamposOrganizados {
  const out: CamposOrganizados = { principais: [], secundarios: [], vazios: [] };
  for (const chave of campos) {
    const def = CAMPO_POR_CHAVE.get(chave);
    if (!campoPreenchido(valor(chave))) {
      if (!def?.legado) out.vazios.push(chave);
    } else if (def?.principal) out.principais.push(chave);
    else out.secundarios.push(chave);
  }
  return out;
}

/** Valores dos campos principais preenchidos, já formatados (resumo do bloco recolhido). */
export function resumoDoBloco(
  campos: ChaveCampo[],
  valor: (chave: ChaveCampo) => string | null | undefined,
): string[] {
  return organizarCampos(campos, valor).principais.map((c) => formatarValor(c, valor(c)));
}

/** Leitura dos campos do cliente: nome e CPF têm colunas próprias; os demais estão em dados_rf. */
export function valorDoCliente(cliente: {
  nome: string;
  cpf: string | null;
  dados_rf: DadosRF;
}): (chave: ChaveCampo) => string | null | undefined {
  return (chave) =>
    chave === "nome"
      ? cliente.nome
      : chave === "cpf_reclamante"
        ? cliente.cpf
        : cliente.dados_rf?.[chave];
}

// ---------------------------------------------------------------------------
// PERFIL DO CLIENTE (seção única: antiga "Identificação do Cliente" + cabeçalho)
// ---------------------------------------------------------------------------

/**
 * Campos exibidos ao expandir o PERFIL DO CLIENTE. Nome (Reclamante) e CPF
 * ficam sempre visíveis no topo e por isso não se repetem aqui; a coluna
 * "CPF" da planilha (`cpf_cnpj`) também não se repete — continua guardada e
 * só aparece quando diverge do CPF do cadastro.
 */
export const CAMPOS_PERFIL_CLIENTE: ChaveCampo[] = blocoPerfil("identificacao").campos.filter(
  (c) => c !== "nome" && c !== "cpf_reclamante" && c !== "cpf_cnpj",
);

export interface CpfUnificado {
  /** CPF exibido (único). */
  cpf: string | null;
  /** De onde veio o CPF exibido. */
  origem: "cadastro" | "coluna_cpf" | null;
  /** CPF do cadastro e coluna "CPF" da planilha com valores diferentes. */
  divergente: boolean;
  /** Valor da coluna "CPF" quando diverge (para conferência). */
  outro: string | null;
}

/**
 * CPF único do cliente: o do cadastro (`clientes.cpf`, coluna "CPF
 * Reclamante") e, na falta dele, o da coluna "CPF" da planilha. Valores
 * diferentes são sinalizados — nunca sobrescritos automaticamente.
 */
export function cpfUnificado(cliente: {
  cpf: string | null;
  dados_rf?: { cpf_cnpj?: string | null } | null;
}): CpfUnificado {
  const principal = cliente.cpf?.trim() || null;
  const coluna = cliente.dados_rf?.cpf_cnpj?.trim() || null;
  if (principal && coluna) {
    const diferente = somenteDigitos(principal) !== somenteDigitos(coluna);
    return {
      cpf: principal,
      origem: "cadastro",
      divergente: diferente,
      outro: diferente ? coluna : null,
    };
  }
  if (principal) return { cpf: principal, origem: "cadastro", divergente: false, outro: null };
  if (coluna) return { cpf: coluna, origem: "coluna_cpf", divergente: false, outro: null };
  return { cpf: null, origem: null, divergente: false, outro: null };
}
