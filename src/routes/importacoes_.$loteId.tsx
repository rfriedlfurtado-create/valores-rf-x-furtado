import { createFileRoute } from "@tanstack/react-router";

import { PaginaEmAtualizacao } from "@/components/EmAtualizacao";

/**
 * Rota mantida apenas para links e favoritos antigos. A tela anterior foi
 * removida; a nova estrutura será definida posteriormente.
 */
export const Route = createFileRoute("/importacoes_/$loteId")({
  head: () => ({
    meta: [{ title: "Lote de importação — Base de Pagamentos" }],
  }),
  component: () => (
    <PaginaEmAtualizacao voltarPara="/importacoes" rotuloVoltar="Histórico de importações" />
  ),
});
