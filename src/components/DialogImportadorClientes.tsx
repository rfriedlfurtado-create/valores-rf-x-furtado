import { useState, type ReactNode } from "react";

import { ImportadorClientes } from "@/components/ImportadorClientes";
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
 * Modal de importação de clientes, usado a partir da página Clientes.
 * Reaproveita integralmente o componente ImportadorClientes — nenhuma
 * lógica de importação é duplicada aqui, só o encaixe visual em modal.
 */
export function DialogImportadorClientes({ trigger }: DialogImportadorClientesProps) {
  const [aberto, setAberto] = useState(false);

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Clientes</DialogTitle>
          <DialogDescription>
            Envie um arquivo ou cole os nomes manualmente. A listagem de clientes é atualizada
            automaticamente assim que a importação terminar.
          </DialogDescription>
        </DialogHeader>

        <ImportadorClientes />

        <div className="flex justify-end border-t border-border pt-4">
          <Button variant="outline" onClick={() => setAberto(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
