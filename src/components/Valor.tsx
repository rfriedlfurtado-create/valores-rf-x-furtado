import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";

type Tamanho = "sm" | "md" | "lg" | "xl";

const TAMANHOS: Record<Tamanho, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
  xl: "text-3xl sm:text-4xl",
};

export interface ValorProps {
  valor: number | string | null | undefined;
  tamanho?: Tamanho;
  /** Valores zerados ficam discretos para não competir com valores reais. */
  neutroSeZero?: boolean;
  className?: string;
}

/**
 * Todo valor financeiro do sistema passa por aqui.
 * Regra de interface: nunca esconder valores em texto pequeno.
 */
export function Valor({ valor, tamanho = "md", neutroSeZero = true, className }: ValorProps) {
  const numerico = typeof valor === "string" ? Number(valor) : (valor ?? 0);
  const zero = !numerico;

  return (
    <span
      className={cn(
        "valor-destaque",
        TAMANHOS[tamanho],
        zero && neutroSeZero && "font-medium text-muted-foreground",
        className,
      )}
    >
      {formatBRL(numerico)}
    </span>
  );
}
