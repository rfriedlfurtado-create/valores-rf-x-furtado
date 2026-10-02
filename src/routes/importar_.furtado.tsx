import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { ImportadorFurtado } from "@/components/importador/furtado/ImportadorFurtado";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/importar_/furtado")({
  head: () => ({
    meta: [
      { title: "Importar clientes — Furtado Advogados" },
      {
        name: "description",
        content:
          "Importação da planilha de controle da Furtado Advogados, com revisão antes da gravação.",
      },
    ],
  }),
  component: ImportarFurtadoPage,
});

function ImportarFurtadoPage() {
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link to="/importar">
          <ArrowLeft className="size-4" aria-hidden />
          Opções de importação
        </Link>
      </Button>
      <PageHeader
        titulo="Importar clientes — Furtado Advogados"
        descricao="Leitura integral da planilha, revisão das associações e gravação rastreável por lote."
      />
      <ImportadorFurtado />
    </div>
  );
}
