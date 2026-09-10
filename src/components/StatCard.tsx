import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type TomStatCard = "neutro" | "money" | "warning" | "info" | "danger";

const TONS: Record<TomStatCard, { icone: string; valor: string }> = {
  neutro: { icone: "bg-secondary text-secondary-foreground", valor: "text-foreground" },
  money: { icone: "bg-money-soft text-money", valor: "text-money" },
  warning: { icone: "bg-warning-soft text-warning", valor: "text-warning" },
  info: { icone: "bg-info-soft text-info", valor: "text-info" },
  danger: { icone: "bg-danger-soft text-danger", valor: "text-danger" },
};

export interface StatCardProps {
  titulo: string;
  valor: ReactNode;
  descricao?: string;
  icone: LucideIcon;
  tom?: TomStatCard;
  className?: string;
}

export function StatCard({
  titulo,
  valor,
  descricao,
  icone: Icone,
  tom = "neutro",
  className,
}: StatCardProps) {
  const estilo = TONS[tom];
  return (
    <Card className={cn("gap-0 p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo}
        </p>
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", estilo.icone)}>
          <Icone className="size-4" aria-hidden />
        </span>
      </div>
      <div className={cn("mt-3 text-2xl font-bold tabular tracking-tight", estilo.valor)}>{valor}</div>
      {descricao ? <p className="mt-1 text-xs text-muted-foreground">{descricao}</p> : null}
    </Card>
  );
}
