import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { InputMoeda } from "@/components/InputMoeda";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, parseBRL, todayISO, valorParaCampoMoeda } from "@/lib/format";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import { receberValorPrevisto, saldoPrevisto, type ValorPrevisto } from "@/lib/valoresPrevistos";
import { mensagemReabertura } from "@/lib/valoresProcesso";

/** Registra o recebimento (total ou parcela) de um valor previsto. */
export function DialogReceberPrevisto({
  previsto: v,
  compacto,
}: {
  previsto: ValorPrevisto;
  compacto?: boolean;
}) {
  const sincronizar = useSincronizar();
  const [aberto, setAberto] = useState(false);
  const saldo = saldoPrevisto(v);
  const [valor, setValor] = useState(saldo ? valorParaCampoMoeda(saldo) : "");
  const [data, setData] = useState(todayISO());
  const [quitado, setQuitado] = useState(true);
  const mutation = useMutation({
    mutationFn: () => receberValorPrevisto(v.id, parseBRL(valor), data, quitado),
    onSuccess: async (processos) => {
      await sincronizar(EVENTOS.PAGAMENTO_REGISTRADO);
      toast.success("Recebimento registrado — o valor passou para VALORES RECEBIDOS.");
      const r = mensagemReabertura(processos);
      if (r) toast.warning(r);
      setAberto(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CheckCircle2 className="size-4" aria-hidden />
          {compacto ? "Receber" : "Registrar recebimento"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar recebimento</DialogTitle>
          <DialogDescription>
            {v.descricao ?? "Valor previsto"} — saldo {formatBRL(saldo)}. O recebimento entra no
            card do processo; o previsto fica registrado como recebido (ou parcial).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor={`rv-${v.id}`}>Valor recebido (R$)</Label>
            <InputMoeda id={`rv-${v.id}`} value={valor} onChange={setValor} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`rd-${v.id}`}>Data do recebimento</Label>
            <Input
              id={`rd-${v.id}`}
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={quitado} onCheckedChange={(c) => setQuitado(c === true)} />
            Quitado (não há mais nada a receber deste valor)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
