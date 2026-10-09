import { naturezaDoProcesso } from "@/lib/numeroProcesso";
import { cn } from "@/lib/utils";
import type { ProcessoResumo } from "@/lib/tipos";

/** Números dos processos de uma visão (CLIENTES = não pagos; JÁ PAGOS = pagos). */
export function NumerosProcessos({
  processos,
  vazio,
  className,
}: {
  processos: readonly ProcessoResumo[];
  vazio?: string;
  className?: string;
}) {
  if (processos.length === 0)
    return <span className="text-xs text-muted-foreground">{vazio ?? "Sem processo"}</span>;
  const visiveis = processos.slice(0, 3);
  return (
    <span className={cn("flex flex-col gap-0.5", className)}>
      {visiveis.map((p) => (
        <span key={p.id} className="tabular text-xs">
          {p.numero || "Sem número"}
          {naturezaDoProcesso(p.natureza, p.numero) === "administrativo" ? (
            <span className="text-muted-foreground"> (adm.)</span>
          ) : null}
          {p.tipo_acao ? <span className="text-muted-foreground"> · {p.tipo_acao}</span> : null}
        </span>
      ))}
      {processos.length > 3 ? (
        <span className="text-xs text-muted-foreground">+ {processos.length - 3} processo(s)</span>
      ) : null}
    </span>
  );
}
