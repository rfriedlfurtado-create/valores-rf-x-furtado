import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSistema } from "@/hooks/useSistema";
import { importarNomes, type ResultadoImportacao } from "@/lib/acoes";
import { parseBRL, todayISO } from "@/lib/format";

export interface FormularioClienteNovoManualProps {
  /** Chamado após um cliente novo importado com sucesso. */
  onImportado?: (resultado: ResultadoImportacao) => void;
  /** Chamado quando o usuário cancela e quer voltar à escolha arquivo/manual. */
  onCancelar?: () => void;
}

/**
 * Cadastro manual de UM cliente novo por vez. Reaproveita a mesma ação
 * `importarNomes` usada pela importação por arquivo — o registro digitado
 * aqui passa pela mesma comparação automática com a base histórica, então
 * nenhuma regra de negócio é duplicada.
 */
export function FormularioClienteNovoManual({
  onImportado,
  onCancelar,
}: FormularioClienteNovoManualProps) {
  const { base, variacoes, rejeicoes, limiares, carregando } = useSistema();
  const queryClient = useQueryClient();

  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!base || !limiares) throw new Error("Base ainda carregando, tente novamente.");
      const nomeLimpo = nome.trim();
      if (!nomeLimpo) throw new Error("Informe o nome do cliente.");

      return importarNomes({
        registros: [
          {
            nome: nomeLimpo,
            cpf: cpf.trim() || null,
            valor: valor.trim() ? parseBRL(valor) : null,
            data: data || null,
          },
        ],
        nomeImportacao: `Cadastro manual — ${new Date().toLocaleDateString("pt-BR")}`,
        origemArquivo: null,
        tipoOrigem: "manual",
        base: base.clientes,
        variacoes: variacoes.map((v) => ({
          cliente_id: v.cliente_id,
          nome_normalizado: v.nome_normalizado,
        })),
        rejeicoes: rejeicoes.map((r) => ({
          nome_1_normalizado: r.nome_1_normalizado,
          nome_2_normalizado: r.nome_2_normalizado,
        })),
        limiares,
      });
    },
    onSuccess: async (resultado) => {
      toast.success(`${nome.trim()} adicionado como cliente novo.`);
      await queryClient.invalidateQueries();
      setNome("");
      setCpf("");
      setValor("");
      setData("");
      onImportado?.(resultado);
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="cliente-novo-nome">Nome</Label>
        <Input
          id="cliente-novo-nome"
          placeholder="Nome completo do cliente"
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="cliente-novo-cpf">CPF (opcional)</Label>
          <Input
            id="cliente-novo-cpf"
            placeholder="123.456.789-00"
            value={cpf}
            onChange={(evento) => setCpf(evento.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cliente-novo-valor">Valor (opcional)</Label>
          <Input
            id="cliente-novo-valor"
            inputMode="decimal"
            placeholder="1.500,00"
            value={valor}
            onChange={(evento) => setValor(evento.target.value)}
            className="tabular"
          />
        </div>
      </div>

      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="cliente-novo-data">Data (opcional)</Label>
        <Input
          id="cliente-novo-data"
          type="date"
          value={data}
          onChange={(evento) => setData(evento.target.value)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        O nome é comparado automaticamente com toda a base histórica. Nomes parecidos geram apenas
        um alerta em "Correspondências" — nunca uma união automática.
      </p>

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
          disabled={mutation.isPending || carregando || !nome.trim()}
        >
          {mutation.isPending ? "Adicionando..." : "Adicionar cliente"}
        </Button>
      </div>
    </div>
  );
}
