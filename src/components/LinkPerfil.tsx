import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Link para o perfil do cliente (usado em todas as listagens). */
export function LinkPerfil({
  clienteId,
  children,
  className,
}: {
  clienteId: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  if (!clienteId) return <span className={cn("font-semibold", className)}>{children}</span>;
  return (
    <Link
      to="/clientes/$clienteId"
      params={{ clienteId }}
      onClick={(e) => e.stopPropagation()}
      className={cn("text-left font-semibold hover:underline", className)}
    >
      {children}
    </Link>
  );
}
