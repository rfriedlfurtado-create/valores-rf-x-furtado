/**
 * Modal IMPORTAR CLIENTES (páginas CLIENTES e JÁ PAGOS), dividido em duas
 * modalidades independentes:
 *
 *   ┌──────────────────────────┬───────────────────────────────┐
 *   │ Importação de clientes   │ Clientes com valores recebidos │
 *   │ (modelo atual: cadastro  │ (identifica o cliente existente│
 *   │  de clientes/processos)  │  e registra os recebimentos)   │
 *   └──────────────────────────┴───────────────────────────────┘
 *
 * Cada lado aceita escolher o arquivo ou arrastar e soltar. Uma planilha
 * solta em qualquer ponto da página abre este modal para o usuário escolher
 * a modalidade (nunca é importada na modalidade errada por suposição).
 */

import { useNavigate } from "@tanstack/react-router";
import { BadgeDollarSign, FileSpreadsheet, Upload, UserPlus } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";

import {
  arquivoParaImportar,
  ehPlanilha,
  SobreposicaoSoltar,
  useSoltarArquivo,
} from "@/components/SoltarArquivo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ModalidadeImportacao = "clientes" | "recebimentos";

const DESTINO: Record<ModalidadeImportacao, "/importar" | "/importar/recebimentos"> = {
  clientes: "/importar",
  recebimentos: "/importar/recebimentos",
};

/** Botão "Importar clientes" + modal + soltar planilha na página. */
export function BotaoImportarClientes({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  const [arquivoSolto, setArquivoSolto] = useState<File | null>(null);

  // Soltar na página (com o modal fechado) abre o modal com o arquivo.
  const arrastando = useSoltarArquivo((arquivo) => {
    if (!ehPlanilha(arquivo)) {
      toast.error(`"${arquivo.name}" não é uma planilha Excel (.xlsx ou .xls).`);
      return;
    }
    setArquivoSolto(arquivo);
    setAberto(true);
  }, !aberto);

  function importar(modalidade: ModalidadeImportacao, arquivo: File) {
    if (!ehPlanilha(arquivo)) {
      toast.error(`"${arquivo.name}" não é uma planilha Excel (.xlsx ou .xls).`);
      return;
    }
    arquivoParaImportar.definir(arquivo);
    setAberto(false);
    setArquivoSolto(null);
    void navigate({ to: DESTINO[modalidade] });
  }

  return (
    <>
      <SobreposicaoSoltar visivel={arrastando} />
      <Button
        onClick={() => {
          setArquivoSolto(null);
          setAberto(true);
        }}
      >
        {children ?? (
          <>
            <Upload className="size-4" aria-hidden />
            Importar clientes
          </>
        )}
      </Button>
      <DialogImportar
        aberto={aberto}
        aoMudar={(v) => {
          setAberto(v);
          if (!v) setArquivoSolto(null);
        }}
        arquivoSolto={arquivoSolto}
        importar={importar}
      />
    </>
  );
}

export function DialogImportar({
  aberto,
  aoMudar,
  arquivoSolto,
  importar,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  arquivoSolto: File | null;
  importar: (modalidade: ModalidadeImportacao, arquivo: File) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-4xl"
        // Soltar fora das áreas não abre o arquivo no navegador.
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Importar clientes</DialogTitle>
          <DialogDescription>
            Escolha a modalidade de importação.
            {arquivoSolto ? (
              <>
                {" "}
                Arquivo: <strong className="text-foreground">{arquivoSolto.name}</strong>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2 md:gap-0 md:divide-x md:divide-border">
          <AreaModalidade
            modalidade="clientes"
            tom="primario"
            icone={<UserPlus className="size-6" aria-hidden />}
            titulo="Importação de clientes"
            subtitulo="Modelo atual de importação"
            descricao="Cadastra e atualiza clientes e processos pela planilha CLIENTES RF - ESPAIDER (22 colunas). Não registra valores recebidos."
            arquivoSolto={arquivoSolto}
            importar={importar}
          />
          <AreaModalidade
            modalidade="recebimentos"
            tom="dinheiro"
            icone={<BadgeDollarSign className="size-6" aria-hidden />}
            titulo="Clientes com valores recebidos"
            subtitulo="Nova modalidade de importação"
            descricao="Importe clientes que já possuem valores recebidos e vincule os recebimentos ao perfil existente."
            arquivoSolto={arquivoSolto}
            importar={importar}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AreaModalidade({
  modalidade,
  tom,
  icone,
  titulo,
  subtitulo,
  descricao,
  arquivoSolto,
  importar,
}: {
  modalidade: ModalidadeImportacao;
  tom: "primario" | "dinheiro";
  icone: ReactNode;
  titulo: string;
  subtitulo: string;
  descricao: string;
  arquivoSolto: File | null;
  importar: (modalidade: ModalidadeImportacao, arquivo: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);
  const cores =
    tom === "primario"
      ? {
          caixa: "border-primary/30 bg-primary/5",
          icone: "bg-primary text-primary-foreground",
          zona: "border-primary/40 hover:bg-primary/10",
          ativa: "border-primary bg-primary/10",
          botao: "",
        }
      : {
          caixa: "border-success/40 bg-success-soft",
          icone: "bg-success text-white",
          zona: "border-success/50 hover:bg-success/10",
          ativa: "border-success bg-success/15",
          botao: "bg-success text-white hover:bg-success/90",
        };

  const soltar = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSobre(false);
    const arquivo = e.dataTransfer.files?.[0];
    if (arquivo) importar(modalidade, arquivo);
  };

  return (
    <section
      className="md:px-5 md:first:pl-0 md:last:pr-0"
      aria-labelledby={`titulo-${modalidade}`}
      data-modalidade={modalidade}
    >
      <div className={cn("flex h-full flex-col gap-4 rounded-xl border p-5", cores.caixa)}>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-lg",
              cores.icone,
            )}
          >
            {icone}
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {subtitulo}
            </p>
            <h3 id={`titulo-${modalidade}`} className="text-base font-bold uppercase">
              {titulo}
            </h3>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{descricao}</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSobre(true);
          }}
          onDragLeave={() => setSobre(false)}
          onDrop={soltar}
          className={cn(
            "mt-auto flex flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-background/60 px-4 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            sobre ? cores.ativa : cores.zona,
          )}
        >
          <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden />
          <span className="text-sm font-semibold">Arraste e solte a planilha aqui</span>
          <span className="text-xs text-muted-foreground">
            ou clique para escolher · .xlsx ou .xls
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) importar(modalidade, f);
          }}
        />
        {arquivoSolto ? (
          <Button className={cores.botao} onClick={() => importar(modalidade, arquivoSolto)}>
            <Upload className="size-4" aria-hidden />
            Importar “{arquivoSolto.name}” aqui
          </Button>
        ) : (
          <Button
            variant={tom === "primario" ? "default" : "default"}
            className={cores.botao}
            onClick={() => input.current?.click()}
          >
            <Upload className="size-4" aria-hidden />
            Selecionar arquivo
          </Button>
        )}
      </div>
    </section>
  );
}
