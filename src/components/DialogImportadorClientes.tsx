import { Link } from "@tanstack/react-router";
import { ArrowRight, Building2, FileCheck2, FileSpreadsheet } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ImportadorModeloDocumento } from "@/components/importador/ImportadorModeloDocumento";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface DialogImportadorClientesProps {
  trigger: ReactNode;
}

/**
 * Modal "Importar Clientes" — duas modalidades, separadas por escritório:
 *
 *  - Furtado Advogados: planilha de controle da execução (várias abas, blocos
 *    por cliente). Abre o importador completo, com revisão antes de gravar.
 *  - Ricardo Friedl: Modelo Documento (ATLAS_CLIENTES_V1) — formato, campos,
 *    funcionamento e regras preservados.
 */
export function DialogImportadorClientes({ trigger }: DialogImportadorClientesProps) {
  const [aberto, setAberto] = useState(false);
  const [modo, setModo] = useState<"escolha" | "ricardo">("escolha");

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (!v) setModo("escolha");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Clientes</DialogTitle>
          <DialogDescription>Escolha o escritório e o modelo do arquivo.</DialogDescription>
        </DialogHeader>
        {modo === "escolha" ? (
          <EscolhaDeImportacao
            onRicardo={() => setModo("ricardo")}
            onNavegar={() => setAberto(false)}
          />
        ) : (
          <div className="grid gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => setModo("escolha")}
            >
              ← Voltar às opções
            </Button>
            <CardModeloDocumento onConcluido={() => setAberto(false)} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** As duas opções, reaproveitadas no modal e na rota /importar. */
export function EscolhaDeImportacao({
  onRicardo,
  onNavegar,
}: {
  onRicardo?: () => void;
  onNavegar?: () => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-xl border border-sky-300/60 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/30">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-5 text-sky-700 dark:text-sky-300" aria-hidden />
          <h3 className="text-sm font-bold">Importar clientes — Furtado Advogados</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Planilha de controle (previsão de execução, RPV/precatório, implantação, TED, acordos e
          cobranças). Lê todas as abas e mostra uma revisão antes de gravar. Os registros recebem a
          origem <strong>Furtado Advogados</strong>.
        </p>
        <Button asChild className="mt-auto">
          <Link to="/importar/furtado" onClick={onNavegar}>
            Abrir importador
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
      <div className="flex flex-col gap-3 rounded-xl border border-violet-300/60 bg-violet-50/60 p-4 dark:border-violet-900 dark:bg-violet-950/30">
        <div className="flex items-center gap-2">
          <Building2 className="size-5 text-violet-700 dark:text-violet-300" aria-hidden />
          <h3 className="text-sm font-bold">Importar clientes — Ricardo Friedl</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Modelo Documento (ATLAS_CLIENTES_V1), no formato atual. Os novos registros recebem a
          origem <strong>Ricardo Friedl</strong>.
        </p>
        {onRicardo ? (
          <Button variant="outline" className="mt-auto" onClick={onRicardo}>
            Importar pelo Modelo Documento
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Card da modalidade Ricardo Friedl (Modelo Documento), reaproveitado em /importar. */
export function CardModeloDocumento({
  onConcluido,
}: { onConcluido?: (() => void) | undefined } = {}) {
  return (
    <div className="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-3">
        <FileCheck2 className="size-5 shrink-0 text-primary" aria-hidden />
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
          Importar clientes — Ricardo Friedl (Modelo Documento)
        </h3>
      </div>
      <ImportadorModeloDocumento onConcluido={onConcluido} />
    </div>
  );
}
