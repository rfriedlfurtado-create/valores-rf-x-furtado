import { Building2 } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OPCOES_FILTRO_ESCRITORIO,
  useFiltroEscritorio,
  type FiltroEscritorio,
} from "@/lib/escritorio";
import { cn } from "@/lib/utils";

/** Filtro "Escritório de origem" (compartilhado entre as telas). */
export function FiltroEscritorioSelect({ className }: { className?: string }) {
  const { filtro, setFiltro } = useFiltroEscritorio();
  return (
    <Select value={filtro} onValueChange={(v) => setFiltro(v as FiltroEscritorio)}>
      <SelectTrigger className={cn("h-12 lg:w-60", className)} aria-label="Escritório de origem">
        <Building2 className="size-4 text-muted-foreground" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPCOES_FILTRO_ESCRITORIO.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.value === "todos" ? "Escritório: todos" : o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
