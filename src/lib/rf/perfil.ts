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

import { CAMPO_POR_CHAVE, type ChaveCampo } from "./campos";
import type { DadosRF } from "./dados";
import { formatarValor } from "./valores";

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
