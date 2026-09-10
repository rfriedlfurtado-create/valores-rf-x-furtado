import { createFileRoute } from "@tanstack/react-router";

import { ImportadorClientes } from "@/components/ImportadorClientes";
import { PageHeader } from "@/components/layout/AppShell";

export const Route = createFileRoute("/importar")({
  head: () => ({
    meta: [
      { title: "Importar clientes — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Importe uma nova listagem de clientes por arquivo ou colagem manual e compare automaticamente com a base histórica.",
      },
      { property: "og:title", content: "Importar clientes — Base de Pagamentos" },
      {
        property: "og:description",
        content: "Importação de clientes com comparação automática de nomes.",
      },
    ],
  }),
  component: ImportarPage,
});

function ImportarPage() {
  return (
    <div>
      <PageHeader titulo="Importar clientes" />
      <ImportadorClientes />
    </div>
  );
}
