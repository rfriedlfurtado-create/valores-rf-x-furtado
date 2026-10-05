import { AlertTriangle } from "lucide-react";

import { NAO_INFORMADO } from "@/lib/rf/campos";
import { cpfUnificado } from "@/lib/rf/perfil";

/**
 * CPF único do cliente nas listas (mesma regra do PERFIL DO CLIENTE): CPF do
 * cadastro ou, na falta dele, a coluna "CPF" da planilha. Divergência entre os
 * dois é apenas sinalizada para conferência.
 */
export function CpfCliente({
  cliente,
}: {
  cliente: { cpf: string | null; dados_rf?: { cpf_cnpj?: string | null } | null };
}) {
  const cpf = cpfUnificado(cliente);
  if (!cpf.cpf) return <span className="text-muted-foreground">{NAO_INFORMADO}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="tabular">{cpf.cpf}</span>
      {cpf.divergente ? (
        <span
          className="inline-flex items-center gap-1 text-xs text-warning"
          title={`CPF divergente: a coluna "CPF" da planilha traz ${cpf.outro}. Confira no perfil.`}
        >
          <AlertTriangle className="size-3.5" aria-hidden />
          divergente
        </span>
      ) : null}
    </span>
  );
}
