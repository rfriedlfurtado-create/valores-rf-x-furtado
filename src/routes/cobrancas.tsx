import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Página descontinuada: clientes e valores são controlados somente em
 * CLIENTES e JÁ PAGOS (os dados estão no perfil de cada cliente).
 * Endereços antigos levam à página CLIENTES.
 */
export const Route = createFileRoute("/cobrancas")({
  beforeLoad: () => {
    throw redirect({ to: "/clientes", replace: true });
  },
});
