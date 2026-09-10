import { Eye } from "lucide-react";

import { BadgeSimilaridade, BadgeStatus } from "@/components/BadgeSimilaridade";
import { Valor } from "@/components/Valor";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import type { CorrespondenciaDetalhada, StatusCorrespondencia } from "@/lib/tipos";

const ROTULO_STATUS: Record<StatusCorrespondencia, { texto: string; tom: "neutro" | "sucesso" | "alerta" | "perigo" }> = {
  pendente: { texto: "Pendente", tom: "alerta" },
  confirmado: { texto: "Confirmado", tom: "sucesso" },
  rejeitado: { texto: "Pessoas diferentes", tom: "perigo" },
  analisar_depois: { texto: "Analisar depois", tom: "neutro" },
};

export interface TabelaCorrespondenciasProps {
  itens: CorrespondenciaDetalhada[];
  onAbrir: (item: CorrespondenciaDetalhada) => void;
  mostrarStatus?: boolean;
}

export function TabelaCorrespondencias({
  itens,
  onAbrir,
  mostrarStatus = true,
}: TabelaCorrespondenciasProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-44">Nome inserido</TableHead>
            <TableHead className="min-w-44">Nome na base</TableHead>
            <TableHead>Similaridade</TableHead>
            <TableHead className="text-right">Total já recebido</TableHead>
            <TableHead className="text-center">Pagamentos</TableHead>
            <TableHead>Último pagamento</TableHead>
            {mostrarStatus ? <TableHead>Status</TableHead> : null}
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((item) => {
            const status = ROTULO_STATUS[item.correspondencia.status];
            return (
              <TableRow key={item.correspondencia.id}>
                <TableCell className="font-semibold">{item.importado.nome_original}</TableCell>
                <TableCell className="text-muted-foreground">
                  {item.clienteEncontrado.nome}
                </TableCell>
                <TableCell>
                  <BadgeSimilaridade
                    classificacao={item.correspondencia.classificacao}
                    percentual={item.correspondencia.percentual_similaridade}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Valor valor={item.clienteEncontrado.totalRecebido} tamanho="lg" />
                </TableCell>
                <TableCell className="text-center tabular font-semibold">
                  {item.clienteEncontrado.quantidadePagamentos}
                </TableCell>
                <TableCell className="tabular text-sm">
                  {formatDate(item.clienteEncontrado.ultimoPagamento)}
                </TableCell>
                {mostrarStatus ? (
                  <TableCell>
                    <BadgeStatus texto={status.texto} tom={status.tom} />
                  </TableCell>
                ) : null}
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => onAbrir(item)}>
                    <Eye className="size-4" aria-hidden />
                    Ver histórico
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
