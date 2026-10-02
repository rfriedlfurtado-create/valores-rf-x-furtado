import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { excluirCliente } from "@/lib/acoes";
import type { ClienteComTotais } from "@/lib/tipos";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";

interface BotaoExcluirClienteProps {
  cliente: Pick<ClienteComTotais, "id" | "nome" | "quantidadePagamentos">;
}

/**
 * Botão de exclusão definitiva com diálogo de confirmação.
 *
 * Remove permanentemente o cliente e todos os dados vinculados
 * (pagamentos, variações, correspondências e registros importados).
 * O Dashboard e todos os indicadores são atualizados imediatamente via
 * invalidação do cache do React Query.
 */
export function BotaoExcluirCliente({ cliente }: BotaoExcluirClienteProps) {
  const sincronizar = useSincronizar();

  const mutation = useMutation({
    mutationFn: () => excluirCliente(cliente.id),
    onSuccess: async () => {
      toast.success(`${cliente.nome} excluído permanentemente.`);
      // Dashboard, contadores, listas e históricos são recalculados sem este cliente.
      await sincronizar(EVENTOS.CLIENTE_EXCLUIDO);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-danger"
          aria-label={`Excluir ${cliente.nome} permanentemente`}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir cliente permanentemente?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Todos os dados de <strong className="text-foreground">{cliente.nome}</strong> serão
                excluídos e deixarão de ser considerados nos indicadores e informações do sistema:
              </p>
              <ul className="ml-4 list-disc space-y-1">
                <li>Cadastro e dados do processo</li>
                <li>Histórico de pagamentos ({cliente.quantidadePagamentos} registro(s))</li>
                <li>Correspondências e variações de nome</li>
              </ul>
              <p className="font-medium text-foreground">Esta ação não poderá ser desfeita.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="bg-danger text-danger-foreground hover:bg-danger/90"
          >
            {mutation.isPending ? "Excluindo..." : "Excluir permanentemente"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
