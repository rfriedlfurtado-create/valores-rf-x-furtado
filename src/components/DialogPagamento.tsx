import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { registrarPagamento } from "@/lib/acoes";
import { parseBRL, todayISO } from "@/lib/format";
import { TIPOS_PAGAMENTO, type ClienteComTotais, type TipoPagamento } from "@/lib/tipos";

export interface DialogPagamentoProps {
  /** Quando informado, o cliente fica fixo (uso no perfil). */
  clienteFixo?: ClienteComTotais;
  /** Lista para seleção quando não há cliente fixo. */
  clientes?: ClienteComTotais[];
  trigger: ReactNode;
}

export function DialogPagamento({ clienteFixo, clientes = [], trigger }: DialogPagamentoProps) {
  const [aberto, setAberto] = useState(false);
  const [clienteId, setClienteId] = useState(clienteFixo?.id ?? "");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(todayISO());
  const [tipo, setTipo] = useState<TipoPagamento>("pix");
  const [observacao, setObservacao] = useState("");
  const [usuario, setUsuario] = useState("");

  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      await registrarPagamento({
        cliente_id: clienteFixo?.id ?? clienteId,
        valor: parseBRL(valor),
        data_pagamento: data,
        tipo,
        observacao,
        usuario_cadastro: usuario,
      });
    },
    onSuccess: async () => {
      toast.success("Pagamento registrado com sucesso.");
      await queryClient.invalidateQueries();
      setAberto(false);
      setValor("");
      setObservacao("");
      setData(todayISO());
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            O histórico é sempre acumulado — nenhum registro anterior é substituído.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {clienteFixo ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">Cliente</p>
              <p className="text-sm font-semibold">{clienteFixo.nome}</p>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="pagamento-cliente">Cliente</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger id="pagamento-cliente">
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {clientes.map((cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>
                      {cliente.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pagamento-valor">Valor (R$)</Label>
              <Input
                id="pagamento-valor"
                inputMode="decimal"
                placeholder="1.250,00"
                value={valor}
                onChange={(evento) => setValor(evento.target.value)}
                className="tabular text-lg font-semibold"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pagamento-data">Data do pagamento</Label>
              <Input
                id="pagamento-data"
                type="date"
                value={data}
                onChange={(evento) => setData(evento.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pagamento-tipo">Tipo do pagamento</Label>
            <Select value={tipo} onValueChange={(valorSelecionado) => setTipo(valorSelecionado as TipoPagamento)}>
              <SelectTrigger id="pagamento-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_PAGAMENTO.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pagamento-usuario">Usuário que cadastrou</Label>
            <Input
              id="pagamento-usuario"
              placeholder="Seu nome"
              value={usuario}
              onChange={(evento) => setUsuario(evento.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pagamento-observacao">Observação</Label>
            <Textarea
              id="pagamento-observacao"
              rows={2}
              value={observacao}
              onChange={(evento) => setObservacao(evento.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Registrando..." : "Registrar pagamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
