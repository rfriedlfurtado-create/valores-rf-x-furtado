import { FileSpreadsheet, PenLine } from "lucide-react";
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
 * Coluna genérica do modal: um título e um seletor arquivo/manual. Cada
 * coluna guarda seu próprio `modo` (useState local), então as duas colunas
 * nunca compartilham estado — importar por arquivo dos dois lados ou
 * cadastrar manualmente só um dos dois funciona de forma independente.
 */
function ColunaImportacao({
  titulo,
  descricao,
  conteudoArquivo,
  conteudoManual,
}: {
  titulo: string;
  descricao: string;
  conteudoArquivo: ReactNode;
  conteudoManual: ReactNode;
}) {
  const [modo, setModo] = useState<Modo>("arquivo");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">{titulo}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{descricao}</p>
      </div>

      <Tabs value={modo} onValueChange={(valor) => setModo(valor as Modo)}>
        <TabsList className="w-full">
          <TabsTrigger value="arquivo" className="flex-1 gap-1.5">
            <FileSpreadsheet className="size-3.5" aria-hidden />
            Importar por arquivo
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex-1 gap-1.5">
            <PenLine className="size-3.5" aria-hidden />
            Adicionar manualmente
          </TabsTrigger>
        </TabsList>
        <TabsContent value="arquivo">{conteudoArquivo}</TabsContent>
        <TabsContent value="manual">{conteudoManual}</TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Modal de importação de clientes, usado a partir da página Clientes.
 *
 * Dividido em duas colunas totalmente independentes — Clientes Novos e
 * Clientes que Pagaram — cada uma com sua própria escolha entre importar
 * por arquivo ou cadastrar manualmente. As duas nunca compartilham estado:
 * importar um arquivo de um lado não interfere no outro, e cada lado tem
 * seu próprio loading, erro e mensagem de sucesso.
 *
 * Nenhuma lógica de importação é duplicada aqui — os dois lados reaproveitam
 * o mesmo motor de leitura de arquivo (`src/lib/leitorArquivo.ts`) e as
 * mesmas ações de escrita (`importarNomes`, `importarPagamentos`,
 * `registrarPagamento`) já usadas no restante do sistema.
 */
export function DialogImportadorClientes({ trigger }: DialogImportadorClientesProps) {
  const [aberto, setAberto] = useState(false);
  const { base } = useSistema();

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importar Clientes</DialogTitle>
          <DialogDescription>
            Clientes Novos e Clientes que Pagaram são importados separadamente. As listagens são
            atualizadas automaticamente assim que cada importação terminar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2 md:divide-x md:divide-border">
          <div className="md:pr-6">
            <ColunaImportacao
              titulo="Clientes Novos"
              descricao="Nomes que ainda não estão na base — comparados automaticamente com o histórico."
              conteudoArquivo={<ImportadorArquivoClientesNovos />}
              conteudoManual={<FormularioClienteNovoManual />}
            />
          </div>

          <Separator className="md:hidden" />

          <div className="md:pl-0">
            <ColunaImportacao
              titulo="Clientes que Pagaram"
              descricao="Pagamentos de clientes já existentes na base — nenhum cliente novo é criado aqui."
              conteudoArquivo={<ImportadorArquivoPagamentos />}
              conteudoManual={<FormularioPagamentoManual clientes={base?.clientes ?? []} />}
            />
          </div>
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <Button variant="outline" onClick={() => setAberto(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
