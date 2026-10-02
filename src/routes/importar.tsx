import { createFileRoute } from "@tanstack/react-router";

import { PaginaEmAtualizacao } from "@/components/EmAtualizacao";

/**
 * Rota mantida apenas para links e favoritos antigos. A tela anterior foi
 * removida; a nova estrutura será definida posteriormente.
 */
export const Route = createFileRoute("/importar")({
  head: () => ({
    meta: [{ title: "Importar clientes — Base de Pagamentos" }],
  }),
  component: () => <PaginaEmAtualizacao voltarPara="/clientes" rotuloVoltar="Clientes" />,
});
