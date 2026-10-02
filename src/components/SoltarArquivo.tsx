/**
 * Arrastar e soltar planilhas em qualquer ponto da página.
 *
 * - `useSoltarArquivo(aoSoltar)` escuta a janela inteira e devolve se há um
 *   arquivo sendo arrastado (para exibir o destaque).
 * - `SobreposicaoSoltar` é o destaque visual em tela cheia.
 * - `arquivoParaImportar` guarda o arquivo solto na página CLIENTES até a
 *   página de importação abri-lo (sem recarregar a página).
 */

import { FileSpreadsheet } from "lucide-react";
import { useEffect, useRef, useState } from "react";

let arquivoPendente: File | null = null;

export const arquivoParaImportar = {
  definir(arquivo: File) {
    arquivoPendente = arquivo;
  },
  retirar(): File | null {
    const a = arquivoPendente;
    arquivoPendente = null;
    return a;
  },
};

const EXTENSOES = /\.(xlsx|xls|xlsm)$/i;

export function ehPlanilha(arquivo: File): boolean {
  return EXTENSOES.test(arquivo.name);
}

function temArquivo(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function useSoltarArquivo(aoSoltar: (arquivo: File) => void, ativo = true): boolean {
  const [arrastando, setArrastando] = useState(false);
  const contador = useRef(0);
  const callback = useRef(aoSoltar);
  callback.current = aoSoltar;

  useEffect(() => {
    if (!ativo || typeof window === "undefined") return;
    const entrar = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      contador.current += 1;
      setArrastando(true);
    };
    const sobre = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault(); // impede o navegador de abrir o arquivo
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const sair = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      contador.current = Math.max(0, contador.current - 1);
      if (contador.current === 0) setArrastando(false);
    };
    const soltar = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      contador.current = 0;
      setArrastando(false);
      const arquivo = e.dataTransfer?.files?.[0];
      if (arquivo) callback.current(arquivo);
    };
    window.addEventListener("dragenter", entrar);
    window.addEventListener("dragover", sobre);
    window.addEventListener("dragleave", sair);
    window.addEventListener("drop", soltar);
    return () => {
      window.removeEventListener("dragenter", entrar);
      window.removeEventListener("dragover", sobre);
      window.removeEventListener("dragleave", sair);
      window.removeEventListener("drop", soltar);
      contador.current = 0;
      setArrastando(false);
    };
  }, [ativo]);

  return arrastando;
}

export function SobreposicaoSoltar({ visivel }: { visivel: boolean }) {
  if (!visivel) return null;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary bg-card px-10 py-12 text-center shadow-lg">
        <FileSpreadsheet className="size-12 text-primary" aria-hidden />
        <p className="text-lg font-semibold">Solte a planilha para importar clientes</p>
        <p className="text-sm text-muted-foreground">Arquivo Excel (.xlsx ou .xls)</p>
      </div>
    </div>
  );
}
