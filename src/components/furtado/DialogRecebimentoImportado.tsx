/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas novas ainda sem tipos gerados (types.ts) */
/**
 * Confirmação de um recebimento mencionado na planilha (ou registrado no
 * perfil). Um pagamento pode quitar várias parcelas: gera UM recebimento com
 * a distribuição entre as parcelas escolhidas.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL, formatDate, parseBRL } from "@/lib/format";
import { perfilCompletoQuery, type PendenciaLote } from "@/lib/furtado/consultas";
import type { CategoriaFinanceira } from "@/lib/furtado/modelo";
import { registrarRecebimentoImportado } from "@/lib/furtado/persistencia";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import { CLASSIFICACOES_ENTRADA, type ClassificacaoEntrada } from "@/lib/tipos";

const CLASSIFICACAO_DA_CATEGORIA: Partial<Record<CategoriaFinanceira, ClassificacaoEntrada>> = {
  honorarios_contratuais: "contratuais",
  honorarios_sucumbenciais: "sucumbencia",
  honorarios_implantacao: "implantacao",
  honorarios_execucao: "execucao",
  honorarios_administrativos: "administrativos",
  honorarios_tutela: "outros",
  outros_honorarios: "outros",
  atrasados: "atrasados",
};

export function DialogRecebimentoImportado({
  aberto,
  onFechar,
  clienteId,
  pendencia,
  loteId,
  lancamentoId,
}: {
  aberto: boolean;
  onFechar: () => void;
  clienteId: string;
  pendencia?: PendenciaLote | null;
  loteId?: string | null;
  lancamentoId?: string | null;
}) {
  const sincronizar = useSincronizar();
  const perfil = useQuery({ ...perfilCompletoQuery(clienteId), enabled: !!clienteId && aberto });
  const dados = pendencia?.dados ?? {};
  const [valorTxt, setValorTxt] = useState(
    dados["valor"] ? String(dados["valor"]).replace(".", ",") : "",
  );
  const [data, setData] = useState<string>(dados["data"] ?? "");
  const [classificacao, setClassificacao] = useState<string>(
    CLASSIFICACAO_DA_CATEGORIA[dados["categoria"] as CategoriaFinanceira] ?? "__sem",
  );
  const [obs, setObs] = useState(
    pendencia ? `Confirmado a partir da planilha: ${pendencia.descricao.slice(0, 240)}` : "",
  );
  const [selecionadas, setSelecionadas] = useState<string[]>([]);

  const valor = parseBRL(valorTxt);
  const abertas = useMemo(
    () =>
      (perfil.data?.parcelas ?? [])
        .filter((p) => p.situacao !== "paga")
        .sort((a, b) => a.numero - b.numero),
    [perfil.data],
  );
  // Distribuição em ordem, até o valor recebido.
  const distribuicao = useMemo(() => {
    let resto = Math.round(valor * 100);
    const out: { parcela_id: string; valor: number }[] = [];
    for (const p of abertas.filter((x) => selecionadas.includes(x.id))) {
      const falta = Math.round((p.valor - p.valor_pago) * 100);
      const parte = Math.min(falta, resto);
      if (parte > 0) out.push({ parcela_id: p.id, valor: parte / 100 });
      resto -= parte;
    }
    return { itens: out, sobra: resto / 100 };
  }, [abertas, selecionadas, valor]);

  const m = useMutation({
    mutationFn: () => {
      if (!(valor > 0)) throw new Error("Informe o valor recebido.");
      if (!data)
        throw new Error("Informe a data do recebimento (a planilha não traz data completa).");
      if (selecionadas.length && distribuicao.sobra > 0.005) {
        throw new Error(
          `O valor excede as parcelas selecionadas em ${formatBRL(distribuicao.sobra)}. Ajuste a seleção ou o valor.`,
        );
      }
      return registrarRecebimentoImportado({
        clienteId,
        valor,
        data,
        classificacao: classificacao === "__sem" ? null : classificacao,
        observacao: obs || null,
        lancamentoId: lancamentoId ?? null,
        distribuicao: selecionadas.length ? distribuicao.itens : [],
        pendenciaId: pendencia?.id ?? null,
        loteId: loteId ?? null,
      });
    },
    onSuccess: async () => {
      await sincronizar(EVENTOS.PAGAMENTO_REGISTRADO);
      toast.success("Recebimento registrado.");
      onFechar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar recebimento</DialogTitle>
          <DialogDescription>
            Confirme o que foi efetivamente recebido. Previsões, valores destinados ao cliente e
            honorários devidos não viram recebimento sem esta confirmação.
          </DialogDescription>
        </DialogHeader>
        {dados["dataTexto"] && !dados["data"] ? (
          <p className="text-xs text-amber-700">
            A planilha informa apenas "{dados["dataTexto"]}" — informe a data completa.
          </p>
        ) : null}
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="rec-valor">Valor recebido (R$)</Label>
              <Input
                id="rec-valor"
                value={valorTxt}
                onChange={(e) => setValorTxt(e.target.value)}
                placeholder="0,00"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="rec-data">Data</Label>
              <Input
                id="rec-data"
                type="date"
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Classificação</Label>
            <Select value={classificacao} onValueChange={setClassificacao}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__sem">Sem classificação</SelectItem>
                {CLASSIFICACOES_ENTRADA.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {abertas.length ? (
            <div className="grid gap-1">
              <Label>Quitar parcelas (opcional)</Label>
              <ul className="max-h-40 overflow-auto rounded-md border border-border p-2 text-xs">
                {abertas.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 py-0.5">
                    <Checkbox
                      checked={selecionadas.includes(p.id)}
                      onCheckedChange={(v) =>
                        setSelecionadas((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))
                      }
                    />
                    Parcela {p.numero} — {formatBRL(p.valor)}
                    {p.valor_pago ? ` (pago ${formatBRL(p.valor_pago)})` : ""} · venc.{" "}
                    {p.vencimento
                      ? formatDate(p.vencimento)
                      : (p.vencimento_texto ?? "não informado")}
                  </li>
                ))}
              </ul>
              {selecionadas.length ? (
                <p className="text-[11px] text-muted-foreground">
                  Distribuição:{" "}
                  {distribuicao.itens.map((d) => formatBRL(d.valor)).join(" + ") || "—"}
                  {distribuicao.sobra > 0.005
                    ? ` · excedente ${formatBRL(distribuicao.sobra)}`
                    : ""}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-1">
            <Label htmlFor="rec-obs">Observação</Label>
            <Textarea id="rec-obs" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? "Gravando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
