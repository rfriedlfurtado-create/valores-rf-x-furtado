/**
 * Transição da importação de clientes e do perfil do cliente.
 *
 * Os modelos antigos de importação (Furtado Advogados e Ricardo Friedl /
 * Modelo Documento) e a tela antiga do perfil foram removidos. Enquanto a nova
 * estrutura não é definida, todo botão ou link que abriria essas telas usa os
 * componentes abaixo e exibe apenas "Funcionalidade em atualização.".
 *
 * Nenhum dado é alterado ou removido por estes componentes.
 */

import { Link } from "@tanstack/react-router";
import { ArrowLeft, Construction } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const MENSAGEM_EM_ATUALIZACAO = "Funcionalidade em atualização.";

export function avisarEmAtualizacao(): void {
  toast.info(MENSAGEM_EM_ATUALIZACAO, { id: "em-atualizacao" });
}

/** Botão visualmente desativado que, ao ser clicado, só exibe o aviso. */
export function BotaoEmAtualizacao({
  children,
  className,
  ...rest
}: Omit<ComponentProps<typeof Button>, "onClick" | "asChild">) {
  return (
    <Button
      {...rest}
      type="button"
      aria-disabled
      title={MENSAGEM_EM_ATUALIZACAO}
      className={cn("cursor-not-allowed opacity-50", className)}
      onClick={(e) => {
        e.stopPropagation();
        avisarEmAtualizacao();
      }}
    >
      {children}
    </Button>
  );
}

/**
 * Substitui um link para o perfil antigo: mostra o texto (ex.: nome do
 * cliente) sem navegar e exibe o aviso ao clicar.
 */
export function TextoPerfilEmAtualizacao({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={MENSAGEM_EM_ATUALIZACAO}
      className={cn("cursor-default text-left font-semibold", className)}
      onClick={(e) => {
        e.stopPropagation();
        avisarEmAtualizacao();
      }}
    >
      {children}
    </button>
  );
}

/** Conteúdo das rotas antigas (acesso direto pela URL ou favoritos). */
export function PaginaEmAtualizacao({
  voltarPara = "/",
  rotuloVoltar = "Voltar ao início",
}: {
  voltarPara?: string;
  rotuloVoltar?: string;
}) {
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to={voltarPara}>
          <ArrowLeft className="size-4" aria-hidden />
          {rotuloVoltar}
        </Link>
      </Button>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
        <Construction className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-base font-semibold text-foreground">{MENSAGEM_EM_ATUALIZACAO}</p>
      </div>
    </div>
  );
}
