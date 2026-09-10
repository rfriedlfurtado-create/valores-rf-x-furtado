import { cn } from "@/lib/utils";
import { ROTULO_CLASSIFICACAO, type Classificacao } from "@/lib/similarity";

const ESTILOS: Record<Classificacao, string> = {
  igual: "bg-danger-soft text-danger",
  muito_parecido: "bg-warning-soft text-warning",
  possivel: "bg-info-soft text-info",
};

export function BadgeSimilaridade({
  classificacao,
  percentual,
  className,
}: {
  classificacao: Classificacao;
  percentual?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
        ESTILOS[classificacao],
        className,
      )}
    >
      {ROTULO_CLASSIFICACAO[classificacao]}
      {typeof percentual === "number" ? (
        <span className="tabular opacity-80">{percentual.toFixed(0)}%</span>
      ) : null}
    </span>
  );
}

export function BadgeStatus({
  texto,
  tom = "neutro",
}: {
  texto: string;
  tom?: "neutro" | "sucesso" | "alerta" | "perigo";
}) {
  const estilos = {
    neutro: "bg-secondary text-secondary-foreground",
    sucesso: "bg-success-soft text-success",
    alerta: "bg-warning-soft text-warning",
    perigo: "bg-danger-soft text-danger",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        estilos[tom],
      )}
    >
      {texto}
    </span>
  );
}
