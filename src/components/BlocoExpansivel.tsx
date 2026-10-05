import { ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface BlocoExpansivelProps {
  titulo: ReactNode;
  /** Informações principais exibidas com o bloco recolhido. */
  resumo?: ReactNode | undefined;
  /** Conteúdo completo (principais + secundárias), exibido ao expandir. */
  children: ReactNode;
  /** Estado inicial quando não controlado. */
  inicialAberto?: boolean | undefined;
  /** Modo controlado (opcional). */
  aberto?: boolean | undefined;
  aoAlternar?: ((aberto: boolean) => void) | undefined;
  /** Ações no cabeçalho (fora do botão de expandir). */
  acao?: ReactNode | undefined;
  /** Bloco dentro de outro bloco (ex.: cada processo). */
  aninhado?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Bloco do perfil que abre e fecha sem recarregar a página. Recolhido: título
 * + resumo (informações principais). Expandido: conteúdo completo.
 */
export function BlocoExpansivel({
  titulo,
  resumo,
  children,
  inicialAberto = false,
  aberto: abertoControlado,
  aoAlternar,
  acao,
  aninhado,
  className,
}: BlocoExpansivelProps) {
  const [abertoInterno, setAbertoInterno] = useState(inicialAberto);
  const aberto = abertoControlado ?? abertoInterno;
  const id = useId();

  function alternar() {
    const novo = !aberto;
    if (abertoControlado === undefined) setAbertoInterno(novo);
    aoAlternar?.(novo);
  }

  const conteudo = (
    <>
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          aria-controls={id}
          data-state={aberto ? "aberto" : "recolhido"}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            aninhado
              ? "rounded-lg px-4 py-3 hover:bg-muted/40"
              : "rounded-xl px-5 py-4 hover:bg-muted/40",
          )}
        >
          <ChevronRight
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              aberto && "rotate-90",
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block font-semibold",
                aninhado ? "text-sm" : "text-xs uppercase tracking-wide text-foreground",
              )}
            >
              {titulo}
            </span>
            {resumo && !aberto ? (
              <span className="mt-1 block text-sm text-muted-foreground">{resumo}</span>
            ) : null}
          </span>
          <span className="sr-only">{aberto ? "Recolher" : "Expandir"}</span>
        </button>
        {acao ? <div className={cn("shrink-0", aninhado ? "p-2" : "p-3")}>{acao}</div> : null}
      </div>
      <div
        id={id}
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: aberto ? "1fr" : "0fr" }}
        inert={!aberto}
        aria-hidden={!aberto}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-border">{children}</div>
        </div>
      </div>
    </>
  );

  if (aninhado) {
    return (
      <div className={cn("rounded-lg border border-border bg-card", className)}>{conteudo}</div>
    );
  }
  return <Card className={cn("gap-0 p-0", className)}>{conteudo}</Card>;
}

/** Resumo em linhas curtas (uma informação principal por linha). */
export function ResumoLinhas({ itens }: { itens: string[] }) {
  if (itens.length === 0) return <span>Sem informações principais preenchidas.</span>;
  return (
    <>
      {itens.map((t, i) => (
        <span key={i} className="block break-words text-foreground/80">
          {t}
        </span>
      ))}
    </>
  );
}
