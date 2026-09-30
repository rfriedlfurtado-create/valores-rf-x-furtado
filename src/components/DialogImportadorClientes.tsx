import { FileCheck2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ImportadorModeloDocumento } from "@/components/importador/ImportadorModeloDocumento";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface DialogImportadorClientesProps {
  trigger: ReactNode;
}

/**
 * Modal "Importar Clientes" — ENTRADA ÚNICA de clientes no sistema.
 *
 * Todo cadastro/atualização em lote (em tramitação, não pagos e já pagos)
 * passa exclusivamente pelo arquivo padronizado do Modelo Documento
 * (ATLAS_CLIENTES_V1). Os antigos fluxos de importação livre e de
 * cadastro manual foram removidos para não existir caminho duplicado.
 */
export function DialogImportadorClientes({ trigger }: DialogImportadorClientesProps) {
  const [aberto, setAberto] = useState(false);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Clientes</DialogTitle>
        </DialogHeader>
        <CardModeloDocumento onConcluido={() => setAberto(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Card único de importação, reaproveitado também na rota /importar. */
export function CardModeloDocumento({
  onConcluido,
}: { onConcluido?: (() => void) | undefined } = {}) {
  return (
    <div className="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-3">
        <FileCheck2 className="size-5 shrink-0 text-primary" aria-hidden />
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
          Importar pelo Modelo Documento (recomendado)
        </h3>
      </div>
      <ImportadorModeloDocumento onConcluido={onConcluido} />
    </div>
  );
}
