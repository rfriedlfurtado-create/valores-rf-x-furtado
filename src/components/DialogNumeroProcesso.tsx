import { useMutation } from "@tanstack/react-query";
import { useId, useState, type ReactNode } from "react";
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
  mascararCNJ,
  naturezaDoProcesso,
  normalizarNumeroProcesso,
  NATUREZAS_PROCESSO,
  ROTULO_NATUREZA,
  type NaturezaProcesso,
} from "@/lib/numeroProcesso";
import { criarProcesso, definirNumeroProcesso } from "@/lib/rf/dados";
import { EVENTOS, useSincronizar } from "@/lib/sincronizacao";
import { cn } from "@/lib/utils";

const DICA: Record<NaturezaProcesso, string> = {
  judicial: "Numeração única CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos).",
  administrativo: "Número do protocolo, requerimento, NB ou procedimento administrativo.",
};

const EXEMPLO: Record<NaturezaProcesso, string> = {
  judicial: "0000000-00.0000.0.00.0000",
  administrativo: "Ex.: Protocolo 123456789 / NB 123.456.789-0",
};

type Props =
  | {
      modo: "editar";
      /** Processo editado (somente ele é alterado). */
      processo: {
        id: string;
        numero: string | null | undefined;
        natureza: string | null | undefined;
        tipoAcao: string | null | undefined;
      };
      trigger: ReactNode;
    }
  | {
      modo: "cadastrar";
      clienteId: string;
      trigger: ReactNode;
      /** Chamado com o id do processo criado (ex.: selecioná-lo no perfil). */
      aoCriar?: (id: string) => void;
    };

/**
 * Cadastro e edição do número do processo — judicial (CNJ) ou
 * administrativo (protocolo/procedimento). Cada processo tem o seu número.
 */
export function DialogNumeroProcesso(props: Props) {
  const sincronizar = useSincronizar();
  const ids = { natureza: useId(), numero: useId(), tipo: useId(), erro: useId() };
  const [aberto, setAberto] = useState(false);
  const [natureza, setNatureza] = useState<NaturezaProcesso>("judicial");
  const [numero, setNumero] = useState("");
  const [tipoAcao, setTipoAcao] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  function abrir(v: boolean) {
    setAberto(v);
    if (!v) return;
    setErro(null);
    if (props.modo === "editar") {
      const nat = naturezaDoProcesso(props.processo.natureza, props.processo.numero);
      // Sem natureza gravada e número fora do padrão CNJ → administrativo
      // (não força um número antigo a virar CNJ).
      const efetiva: NaturezaProcesso =
        nat ?? (props.processo.numero ? "administrativo" : "judicial");
      setNatureza(efetiva);
      setNumero(props.processo.numero ?? "");
    } else {
      setNatureza("judicial");
      setNumero("");
      setTipoAcao("");
    }
  }

  function trocarNatureza(n: NaturezaProcesso) {
    setNatureza(n);
    setErro(null);
    if (n === "judicial" && numero && !/[a-z]/i.test(numero)) setNumero(mascararCNJ(numero));
  }

  const mutacao = useMutation({
    mutationFn: async () => {
      const r = normalizarNumeroProcesso(natureza, numero);
      if (!r.ok) throw new Error(r.erro);
      if (props.modo === "editar") {
        await definirNumeroProcesso({
          id: props.processo.id,
          natureza,
          numero: r.valor,
          tipoAcao: props.processo.tipoAcao ?? null,
        });
        return { id: props.processo.id, numero: r.valor };
      }
      const id = await criarProcesso({
        clienteId: props.clienteId,
        natureza,
        numero: r.valor,
        tipoAcao: tipoAcao.trim() || null,
      });
      return { id, numero: r.valor };
    },
    onSuccess: async ({ id, numero: salvo }) => {
      await sincronizar(
        props.modo === "editar" ? EVENTOS.CLIENTE_ATUALIZADO : EVENTOS.CLIENTE_CRIADO,
      );
      toast.success(
        props.modo === "editar"
          ? `Número do processo atualizado${salvo ? `: ${salvo}` : " (sem número)"}.`
          : `Processo cadastrado${salvo ? `: ${salvo}` : " (sem número)"}.`,
      );
      setAberto(false);
      if (props.modo === "cadastrar") props.aoCriar?.(id);
    },
    onError: (e: Error) => setErro(e.message),
  });

  const titulo = props.modo === "editar" ? "Número do processo" : "Cadastrar processo";

  return (
    <Dialog open={aberto} onOpenChange={abrir}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutacao.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>
              {props.modo === "editar"
                ? "A alteração vale somente para este processo; os demais processos do cliente não mudam."
                : "O novo processo fica no perfil deste cliente, com número e situação próprios."}
            </DialogDescription>
          </DialogHeader>

          <fieldset className="flex flex-col gap-2">
            <legend id={ids.natureza} className="mb-2 text-sm font-medium">
              Tipo de processo
            </legend>
            <div
              role="radiogroup"
              aria-labelledby={ids.natureza}
              className="grid grid-cols-2 gap-2"
            >
              {NATUREZAS_PROCESSO.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={natureza === n}
                  onClick={() => trocarNatureza(n)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    natureza === n
                      ? "border-primary bg-primary/10 font-semibold"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  {ROTULO_NATUREZA[n]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.numero}>
              {natureza === "judicial"
                ? "Número do processo (CNJ)"
                : "Número do protocolo ou procedimento"}
            </Label>
            <Input
              id={ids.numero}
              autoFocus
              value={numero}
              inputMode={natureza === "judicial" ? "numeric" : "text"}
              placeholder={EXEMPLO[natureza]}
              className="tabular"
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? ids.erro : undefined}
              onChange={(e) => {
                setErro(null);
                setNumero(natureza === "judicial" ? mascararCNJ(e.target.value) : e.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              {DICA[natureza]} Deixe em branco para “Sem número”.
            </p>
          </div>

          {props.modo === "cadastrar" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.tipo}>Tipo de ação</Label>
              <Input
                id={ids.tipo}
                value={tipoAcao}
                placeholder="Ex.: Restabelecimento Auxílio Doença"
                onChange={(e) => setTipoAcao(e.target.value)}
              />
            </div>
          ) : null}

          {erro ? (
            <p id={ids.erro} role="alert" className="text-sm text-danger">
              {erro}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutacao.isPending}>
              {mutacao.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
