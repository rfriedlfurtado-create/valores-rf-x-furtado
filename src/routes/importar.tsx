import { createFileRoute } from "@tanstack/react-router";

import { CardModeloDocumento } from "@/components/DialogImportadorClientes";
import { PageHeader } from "@/components/layout/AppShell";

export const Route = createFileRoute("/importar")({
  head: () => ({
    meta: [
      { title: "Importar clientes — Base de Pagamentos" },
      {
        name: "description",
        content: "Importação de clientes exclusivamente pelo Modelo Documento.",
      },
      { property: "og:title", content: "Importar clientes — Base de Pagamentos" },
      {
        property: "og:description",
        content: "Importação de clientes pelo Modelo Documento.",
      },
    ],
  }),
  component: ImportarPage,
});

/** Mesma entrada única do botão "Importar Clientes" (mantida para links existentes). */
function ImportarPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader titulo="Importar clientes" />
      <CardModeloDocumento />
    </div>
  );
}
