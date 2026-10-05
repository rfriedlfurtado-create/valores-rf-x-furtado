import type { KeyboardEvent, MouseEvent } from "react";

/**
 * Linha de tabela que abre o perfil ao clicar em QUALQUER ponto dela
 * (padrão das páginas CLIENTES e JÁ PAGOS).
 *
 * Cliques em elementos interativos dentro da linha (botões, links, menus,
 * caixas de seleção, campos) executam só a própria ação — e também os
 * cliques vindos de diálogos/menus abertos a partir da linha (portais).
 */
const INTERATIVOS =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="checkbox"], [role="switch"], [role="combobox"], [role="tab"], [contenteditable="true"], [data-sem-abrir-linha]';

export function cliqueDentroDeInterativo(linha: Element, alvo: EventTarget | null): boolean {
  if (!(alvo instanceof Element)) return true;
  // Clique em diálogo/menu aberto pela linha (portal): não pertence à linha no DOM.
  if (!linha.contains(alvo)) return true;
  const interativo = alvo.closest(INTERATIVOS);
  return Boolean(interativo && interativo !== linha && linha.contains(interativo));
}

export function propsLinhaClicavel(params: {
  rotulo: string;
  abrir: () => void;
  /** Endereço do perfil (Ctrl/⌘ + clique ou clique do meio abre em nova aba). */
  href?: string;
}) {
  const { rotulo, abrir, href } = params;
  return {
    role: "link" as const,
    tabIndex: 0,
    "aria-label": rotulo,
    className: "cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none",
    onClick: (e: MouseEvent<HTMLTableRowElement>) => {
      if (cliqueDentroDeInterativo(e.currentTarget, e.target)) return;
      if (window.getSelection()?.toString()) return; // seleção de texto não abre o perfil
      if (href && (e.ctrlKey || e.metaKey)) {
        window.open(href, "_blank", "noopener");
        return;
      }
      abrir();
    },
    onAuxClick: (e: MouseEvent<HTMLTableRowElement>) => {
      if (e.button !== 1 || !href) return;
      if (cliqueDentroDeInterativo(e.currentTarget, e.target)) return;
      window.open(href, "_blank", "noopener");
    },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        abrir();
      }
    },
  };
}
