import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlanilhaLida } from "@/lib/leitorArquivo";

/**
 * Tabela de mapeamento de colunas, compartilhada por todos os importadores
 * baseados em planilha. Genérica sobre o conjunto de campos (`TCampo`) para
 * que cada importador (clientes novos, pagamentos, ...) defina seu próprio
 * vocabulário sem duplicar esta tabela.
 */
export function MapeamentoColunas<TCampo extends string>({
  planilha,
  mapeamento,
  campos,
  rotulos,
  campoPadrao,
  onMudarCampo,
  onMudarCabecalho,
  descricao = 'Diga o que cada coluna representa. Uma coluna precisa ser "Nome".',
}: {
  planilha: PlanilhaLida;
  mapeamento: TCampo[];
  campos: readonly TCampo[];
  rotulos: Record<TCampo, string>;
  /** Valor usado quando uma coluna ainda não tem campo definido. */
  campoPadrao: TCampo;
  onMudarCampo: (indice: number, campo: TCampo) => void;
  onMudarCabecalho: (usa: boolean) => void;
  descricao?: string;
}) {
  const preview = planilha.linhas.slice(0, 5);

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Mapear colunas</p>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={planilha.temCabecalho}
            onCheckedChange={onMudarCabecalho}
            id="tem-cabecalho"
          />
          <Label htmlFor="tem-cabecalho" className="text-xs text-muted-foreground">
            Primeira linha é cabeçalho
          </Label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {planilha.cabecalhos.map((cabecalho, indice) => (
                <TableHead key={indice} className="min-w-40">
                  <div className="space-y-1.5 py-1">
                    <p className="truncate text-xs font-semibold text-foreground" title={cabecalho}>
                      {cabecalho}
                    </p>
                    <Select
                      value={mapeamento[indice] ?? campoPadrao}
                      onValueChange={(valor) => onMudarCampo(indice, valor as TCampo)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {campos.map((campo) => (
                          <SelectItem key={campo} value={campo}>
                            {rotulos[campo]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.map((linha, indiceLinha) => (
              <TableRow key={indiceLinha}>
                {planilha.cabecalhos.map((_, indiceColuna) => (
                  <TableCell key={indiceColuna} className="text-sm text-muted-foreground">
                    {linha[indiceColuna] instanceof Date
                      ? (linha[indiceColuna] as Date).toLocaleDateString("pt-BR")
                      : String(linha[indiceColuna] ?? "—")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Mostrando {preview.length} de {planilha.linhas.length} linha(s).
      </p>
    </Card>
  );
}
