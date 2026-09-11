import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { registrarPagamento } from "@/lib/acoes";
import { parseBRL, todayISO } from "@/lib/format";
import { TIPOS_PAGAMENTO, type ClienteComTotais, type TipoPagamento } from "@/lib/tipos";

export interface FormularioPagamentoManualProps {
  /** Base de clientes já existentes — o pagamento sempre é vinculado a um deles. */
  clientes: ClienteComTotais[];
  /** Chamado após um pagamento registrado com sucesso. */
  onRegistrado?: () => void;
  /** Chamado quando o usuário cancela e quer voltar à escolha arquivo/manual. */
  onCancelar?: () => void;
}

/**
 * Cadastro manual de UM pagamento de cliente já existente. Reaproveita a
 * mesma ação `registrarPagamento` usada pelo botão "Registrar pagamento" da
 * página Clientes — nenhuma regra de negócio é duplicada aqui, só a UI
 * embutida (sem modal próprio) para caber no lado direito do importador.
 */
export function FormularioPagamentoManual({
  clientes,
  onRegistrado,
  onCancelar,
}: FormularioPagamentoManualProps) {
  const [clienteId, setClienteId] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(todayISO());
  const [tipo, setTipo] = useState<TipoPagamento>("pix");
  const [observacao, setObservacao] = useState("");
  const [usuario, setUsuario] = useState("");

  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      registrarPagamento({
        cliente_id: clienteId,
        valor: parseBRL(valor),
        data_pagamento: data,
        tipo,
        observacao,
        usuario_cadastro: usuario,
      }),
    onSuccess: async () => {
      const cliente = clientes.find((c) => c.id === clienteId);
      toast.success(`Pagamento de ${cliente?.nome ?? "cliente"} registrado com sucesso.`);
      await queryClient.invalidateQueries();
      setClienteId("");
      setValor("");
      setObservacao("");
      setData(todayISO());
      onRegistrado?.();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="pagamento-manual-cliente">Cliente</Label>
        <Select value={clienteId} onValueChange={setClienteId}>
          <SelectTrigger id="pagamento-manual-cliente">
            <SelectValue placeholder="Selecione o cliente que pagou" />
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="pagamento-manual-valor">Valor (R$)</Label>
          <Input
            id="pagamento-manual-valor"
            inputMode="decimal"
            placeholder="1.250,00"
            value={valor}
            onChange={(evento) => setValor(evento.target.value)}
            className="tabular text-lg font-semibold"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pagamento-manual-data">Data do pagamento</Label>
          <Input
            id="pagamento-manual-data"
            type="date"
            value={data}
            onChange={(evento) => setData(evento.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pagamento-manual-tipo">Tipo do pagamento</Label>
        <Select
          value={tipo}
          onValueChange={(valorSelecionado) => setTipo(valorSelecionado as TipoPagamento)}
        >
          <SelectTrigger id="pagamento-manual-tipo">
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
        <Label htmlFor="pagamento-manual-usuario">Usuário que cadastrou</Label>
        <Input
          id="pagamento-manual-usuario"
          placeholder="Seu nome"
          value={usuario}
          onChange={(evento) => setUsuario(evento.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pagamento-manual-observacao">Observação</Label>
        <Textarea
          id="pagamento-manual-observacao"
          rows={2}
          value={observacao}
          onChange={(evento) => setObservacao(evento.target.value)}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        {onCancelar ? (
          <Button type="button" variant="ghost" onClick={onCancelar}>
            Voltar
          </Button>
        ) : (
          <span />
        )}
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !clienteId || !valor || !data}
        >
          {mutation.isPending ? "Registrando..." : "Registrar pagamento"}
        </Button>
      </div>
    </div>
  );
}
