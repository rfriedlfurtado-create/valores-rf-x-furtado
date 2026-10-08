import { useMutation } from "@tanstack/react-query";
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
import {
  CLASSIFICACOES_ENTRADA,
  ROTULO_CLASSIFICACAO,
  TIPOS_PAGAMENTO,
  type ClassificacaoEntrada,
  type ClienteComTotais,
  type TipoPagamento,
} from "@/lib/tipos";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";

export interface DialogPagamentoProps {
  /** Quando informado, o cliente fica fixo (uso no perfil). */
  clienteFixo?: Pick<ClienteComTotais, "id" | "nome">;
  /** Processo/atendimento do pagamento (perfil do cliente). */
  registro?: { id: string; rotulo: string } | undefined;
  /** Lista para seleção quando não há cliente fixo. */
  clientes?: ClienteComTotais[];
  /** Categoria já escolhida ao abrir (ex.: botão "Registrar" de um card). */
  categoriaInicial?: ClassificacaoEntrada | undefined;
  /** Categorias que não aceitam recebimento (ex.: sucumbência com "Não haverá"). */
  categoriasBloqueadas?: Partial<Record<ClassificacaoEntrada, string>> | undefined;
  trigger: ReactNode;
}

export function DialogPagamento({
  clienteFixo,
  registro,
  clientes = [],
  categoriaInicial,
  categoriasBloqueadas,
  trigger,
}: DialogPagamentoProps) {
  const [aberto, setAberto] = useState(false);
  const [clienteId, setClienteId] = useState(clienteFixo?.id ?? "");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(todayISO());
  const [tipo, setTipo] = useState<TipoPagamento>("pix");
  const [observacao, setObservacao] = useState("");
  const [usuario, setUsuario] = useState("");
  const [classificacao, setClassificacao] = useState<ClassificacaoEntrada | "nenhuma">(
    categoriaInicial ?? "nenhuma",
  );
  // No processo, a categoria é obrigatória: é ela que define o card atualizado.
  const exigeCategoria = Boolean(registro);

  const sincronizar = useSincronizar();

  const mutation = useMutation({
    mutationFn: async () => {
      if (exigeCategoria && classificacao === "nenhuma")
        throw new Error(
          "Escolha a categoria do recebimento: Atrasados, Contratual ou Sucumbência.",
        );
      const bloqueio =
        classificacao !== "nenhuma" ? categoriasBloqueadas?.[classificacao] : undefined;
      if (bloqueio) throw new Error(bloqueio);
      await registrarPagamento({
        cliente_id: clienteFixo?.id ?? clienteId,
        valor: parseBRL(valor),
        data_pagamento: data,
        tipo,
        observacao,
        usuario_cadastro: usuario,
        atendimento_id: registro?.id ?? null,
        classificacao: classificacao === "nenhuma" ? null : classificacao,
      });
    },
    onSuccess: async () => {
      await sincronizar(EVENTOS.PAGAMENTO_REGISTRADO);
      toast.success(
        classificacao !== "nenhuma"
          ? `Recebimento registrado em ${ROTULO_CLASSIFICACAO[classificacao]}.`
          : "Recebimento registrado com sucesso.",
      );
      setAberto(false);
      setValor("");
      setObservacao("");
      setData(todayISO());
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        setAberto(v);
        if (v) setClassificacao(categoriaInicial ?? "nenhuma");
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar recebimento</DialogTitle>
          <DialogDescription>
            O histórico é sempre acumulado — nenhum registro anterior é substituído.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {clienteFixo ? (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">Cliente</p>
              <p className="text-sm font-semibold">{clienteFixo.nome}</p>
              {registro ? (
                <p className="mt-1 text-xs text-muted-foreground">Registro: {registro.rotulo}</p>
              ) : null}
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
              <Label htmlFor="pagamento-data">Data do recebimento</Label>
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
            <Select
              value={tipo}
              onValueChange={(valorSelecionado) => setTipo(valorSelecionado as TipoPagamento)}
            >
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

          {registro ? (
            <div className="grid gap-2">
              <Label htmlFor="pagamento-classificacao">Categoria do recebimento</Label>
              <Select
                value={exigeCategoria && classificacao === "nenhuma" ? "" : classificacao}
                onValueChange={(v) => setClassificacao(v as ClassificacaoEntrada | "nenhuma")}
              >
                <SelectTrigger id="pagamento-classificacao">
                  <SelectValue placeholder="Escolha a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {exigeCategoria ? null : <SelectItem value="nenhuma">Sem categoria</SelectItem>}
                  {CLASSIFICACOES_ENTRADA.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={item.value}
                      disabled={Boolean(categoriasBloqueadas?.[item.value])}
                    >
                      {item.label}
                      {categoriasBloqueadas?.[item.value] ? " (não haverá)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                O valor entra no card da categoria escolhida, somente deste processo.
              </p>
            </div>
          ) : null}

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
            {mutation.isPending ? "Registrando..." : "Registrar recebimento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
