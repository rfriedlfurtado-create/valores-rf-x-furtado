import { createFileRoute } from "@tanstack/react-router";

import { CardModeloDocumento, EscolhaDeImportacao } from "@/components/DialogImportadorClientes";
import { PageHeader } from "@/components/layout/AppShell";

export const Route = createFileRoute("/importar")({
  head: () => ({
    meta: [
      { title: "Importar clientes — Base de Pagamentos" },
      {
        name: "description",
        content: "Importação de clientes por escritório: Furtado Advogados ou Ricardo Friedl.",
      },
      { property: "og:title", content: "Importar clientes — Base de Pagamentos" },
      {
        property: "og:description",
        content: "Importação de clientes por escritório.",
      },
    ],
  }),
  component: ImportarPage,
});

/** Mesmas opções do botão "Importar Clientes" (mantida para links existentes). */
function ImportarPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        titulo="Importar clientes"
        descricao="Escolha o escritório e o modelo do arquivo."
      />
      <EscolhaDeImportacao />
      <CardModeloDocumento />
    </div>
  );
}
