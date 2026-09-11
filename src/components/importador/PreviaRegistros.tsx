import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
interface RegistroExibivel {
  nome: string;
  cpf?: string | null;
  valor?: number | null;
  data?: string | null;
}

/**
 * Prévia dos registros reconhecidos em um arquivo de texto livre (Word).
 * Compartilhado por todos os importadores — a extração de nome/CPF/valor/data
 * é sempre a mesma heurística, só o texto de contexto muda por caller.
 */
export function PreviaRegistros({
  registros,
  descricao = "Word é texto livre, então essa leitura é uma estimativa — confira antes de importar.",
}: {
  registros: RegistroExibivel[];
  descricao?: string;
}) {
  return (
    <Card className="gap-4 p-5">
      <div>
        <p className="text-sm font-semibold text-foreground">Prévia do que foi reconhecido</p>
        <p className="text-xs text-muted-foreground">{descricao}</p>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>CPF</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registros.map((registro, indice) => (
              <TableRow key={indice}>
                <TableCell className="text-sm">{registro.nome}</TableCell>
                <TableCell className="tabular text-sm text-muted-foreground">
                  {registro.cpf ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular text-sm text-muted-foreground">
                  {registro.valor != null ? registro.valor.toFixed(2) : "—"}
                </TableCell>
                <TableCell className="tabular text-sm text-muted-foreground">
                  {registro.data ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
