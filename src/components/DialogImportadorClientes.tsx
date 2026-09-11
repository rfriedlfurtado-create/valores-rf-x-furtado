import { CheckCircle2, FileSpreadsheet, PenLine } from "lucide-react";
import { useState, type ReactNode } from "react";

import { FormularioClienteNovoManual } from "@/components/importador/FormularioClienteNovoManual";
import { FormularioPagamentoManual } from "@/components/importador/FormularioPagamentoManual";
import { ImportadorArquivoClientesNovos } from "@/components/importador/ImportadorArquivoClientesNovos";
import { ImportadorArquivoPagamentos } from "@/components/importador/ImportadorArquivoPagamentos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSistema } from "@/hooks/useSistema";

export interface DialogImportadorClientesProps {
  trigger: ReactNode;
}

type Modo = "arquivo" | "manual";

/**
 * Seção de importação com alternância arquivo/manual.
 * Layout compacto para uso em coluna única, sequencial.
 */
function SecaoImportacao({
  numero,
  titulo,
  descricao,
  conteudoArquivo,
  conteudoManual,
}: {
  numero: number;
  titulo: string;
  descricao: string;
  conteudoArquivo: ReactNode;
  conteudoManual: ReactNode;
}) {
  const [modo, setModo] = useState<Modo>("arquivo");

  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
          aria-hidden
        >
          {numero}
        </span>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">{titulo}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{descricao}</p>
        </div>
      </div>

      <div className="pl-9">
        <Tabs value={modo} onValueChange={(valor) => setModo(valor as Modo)}>
          <TabsList className="w-full">
            <TabsTrigger value="arquivo" className="flex-1 gap-1.5">
              <FileSpreadsheet className="size-3.5" aria-hidden />
              Importar arquivo
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex-1 gap-1.5">
              <PenLine className="size-3.5" aria-hidden />
              Inserir manualmente
            </TabsTrigger>
          </TabsList>
          <TabsContent value="arquivo">{conteudoArquivo}</TabsContent>
          <TabsContent value="manual">{conteudoManual}</TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/**
 * Modal de importação de clientes — único ponto de entrada para essa
 * funcionalidade no sistema.
 *
 * Fluxo sequencial em coluna única:
 *   1. Clientes com processos em tramitação → base principal
 *   2. Clientes que já pagaram → lista de conferência
 *   → "Processar e cruzar dados" fecha o modal; o cruzamento já ocorreu
 *     automaticamente durante cada importação e pode ser conferido na
 *     listagem de Clientes.
 *
 * Nenhuma lógica de importação é duplicada aqui — as seções reaproveitam
 * os mesmos componentes e ações (`importarNomes`, `importarPagamentos`,
 * `registrarPagamento`) usados no restante do sistema.
 */
export function DialogImportadorClientes({ trigger }: DialogImportadorClientesProps) {
  const [aberto, setAberto] = useState(false);
  const { base } = useSistema();

  function processar() {
    setAberto(false);
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Clientes</DialogTitle>
          <DialogDescription>
            Informe os clientes com processos em tramitação e, em seguida, os que já pagaram. O
            sistema cruza os dados automaticamente e identifica as correspondências.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6">
          <SecaoImportacao
            numero={1}
            titulo="Clientes com processos em tramitação"
            descricao="Base principal — cria ou atualiza os clientes com processos em andamento."
            conteudoArquivo={<ImportadorArquivoClientesNovos />}
            conteudoManual={<FormularioClienteNovoManual />}
          />

          <Separator />

          <SecaoImportacao
            numero={2}
            titulo="Clientes que já pagaram"
            descricao="Lista de conferência — os nomes são cruzados com a base para identificar pagamentos."
            conteudoArquivo={<ImportadorArquivoPagamentos />}
            conteudoManual={<FormularioPagamentoManual clientes={base?.clientes ?? []} />}
          />

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={() => setAberto(false)}>
              Fechar
            </Button>
            <Button onClick={processar}>
              <CheckCircle2 className="size-4" aria-hidden />
              Processar e cruzar dados
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
