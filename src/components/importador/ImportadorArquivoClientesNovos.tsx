import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ResumoResultado } from "@/components/ImportadorClientes";
import { MapeamentoColunas } from "@/components/importador/MapeamentoColunas";
import { PreviaRegistros } from "@/components/importador/PreviaRegistros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSistema } from "@/hooks/useSistema";
import { importarNomes, type LinhaImportacao, type ResultadoImportacao } from "@/lib/acoes";
import { parseBRL } from "@/lib/format";
import {
  adivinharCampoBase,
  interpretarLinhaLivre,
  lerDocx,
  lerPlanilha,
  parseDataCell,
  relerComCabecalho,
  ROTULO_CAMPO_BASE,
  type CampoBase,
  type PlanilhaLida,
} from "@/lib/leitorArquivo";

const CAMPOS: readonly CampoBase[] = ["nome", "cpf", "valor", "data", "ignorar"];

export interface ImportadorArquivoClientesNovosProps {
  onImportado?: (resultado: ResultadoImportacao) => void;
}

/**
 * Importação por arquivo de Clientes Novos, usada dentro do lado esquerdo
 * do modal "Importar Clientes". Reaproveita o mesmo motor de leitura de
 * arquivo e a mesma ação `importarNomes` do importador de página inteira
 * (/importar) — só a apresentação é mais compacta para caber na coluna.
 */
export function ImportadorArquivoClientesNovos({
  onImportado,
}: ImportadorArquivoClientesNovosProps) {
  const { base, variacoes, rejeicoes, limiares, carregando } = useSistema();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null);
  const [mapeamento, setMapeamento] = useState<CampoBase[]>([]);
  const [registrosDocx, setRegistrosDocx] = useState<LinhaImportacao[] | null>(null);
  const [lendo, setLendo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  const ehDocx = !!arquivo && /\.docx$/i.test(arquivo.name);
  const indiceColunaNome = mapeamento.indexOf("nome");

  const registrosDoArquivo = useMemo<LinhaImportacao[]>(() => {
    if (!planilha || indiceColunaNome === -1) return [];
    return planilha.linhas
      .map((linha): LinhaImportacao => {
        const registro: LinhaImportacao = { nome: "", cpf: null, valor: null, data: null };
        mapeamento.forEach((campo, indice) => {
          const bruto = linha[indice];
          if (campo === "nome") registro.nome = bruto == null ? "" : String(bruto).trim();
          if (campo === "cpf") registro.cpf = bruto == null ? null : String(bruto).trim() || null;
          if (campo === "valor")
            registro.valor = parseBRL(bruto == null ? "" : String(bruto)) || null;
          if (campo === "data") registro.data = parseDataCell(bruto);
        });
        return registro;
      })
      .filter((registro) => registro.nome.length > 0);
  }, [planilha, mapeamento, indiceColunaNome]);

  const registros = ehDocx ? (registrosDocx ?? []) : registrosDoArquivo;
  const temColunaNome = ehDocx || indiceColunaNome !== -1;

  async function aoSelecionarArquivo(event: React.ChangeEvent<HTMLInputElement>) {
    const selecionado = event.target.files?.[0] ?? null;
    setArquivo(selecionado);
    setPlanilha(null);
    setMapeamento([]);
    setRegistrosDocx(null);
    setResultado(null);
    if (!selecionado) return;

    setLendo(true);
    try {
      if (/\.docx$/i.test(selecionado.name)) {
        const linhas = await lerDocx(selecionado);
        const extraidos = linhas.map(interpretarLinhaLivre).filter((r) => r.nome.length > 0);
        setRegistrosDocx(extraidos);
        if (extraidos.length === 0) toast.error("Não encontrei nomes nesse documento.");
      } else {
        const lida = await lerPlanilha(selecionado);
        setPlanilha(lida);
        setMapeamento(lida.cabecalhos.map((c) => adivinharCampoBase(c)));
        if (lida.linhas.length === 0) toast.error("Não encontrei linhas com dados nesse arquivo.");
      }
    } catch {
      toast.error(
        "Não consegui ler esse arquivo. Confirme se é um .xlsx, .xls, .csv ou .docx válido.",
      );
      setArquivo(null);
    } finally {
      setLendo(false);
    }
  }

  function limpar() {
    setArquivo(null);
    setPlanilha(null);
    setMapeamento([]);
    setRegistrosDocx(null);
    setResultado(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function alterarCabecalho(usa: boolean) {
    if (!arquivo) return;
    setLendo(true);
    try {
      const relida = await relerComCabecalho(arquivo, usa);
      setPlanilha(relida);
      setMapeamento(relida.cabecalhos.map((c) => (usa ? adivinharCampoBase(c) : "ignorar")));
    } finally {
      setLendo(false);
    }
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!base || !limiares) throw new Error("Base ainda carregando, tente novamente.");
      if (registros.length === 0) throw new Error("Nenhum nome para importar.");
      return importarNomes({
        registros,
        nomeImportacao: `Clientes Novos — ${arquivo?.name ?? new Date().toLocaleDateString("pt-BR")}`,
        origemArquivo: arquivo?.name ?? null,
        tipoOrigem: "arquivo",
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
      toast.success(`${resultado.totalNomes} cliente(s) novo(s) importado(s) com sucesso.`);
      await queryClient.invalidateQueries();
      setResultado(resultado);
      onImportado?.(resultado);
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <p className="text-xs text-muted-foreground">
          Formatos aceitos: .xlsx, .xls, .csv ou .docx.
        </p>
        <Input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.docx"
          onChange={aoSelecionarArquivo}
        />
        {lendo ? <p className="text-xs text-muted-foreground">Lendo arquivo...</p> : null}
        {arquivo && (planilha || registrosDocx) ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              {ehDocx ? (
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : null}
              <strong className="tabular">
                {ehDocx ? (registrosDocx?.length ?? 0) : (planilha?.linhas.length ?? 0)}
              </strong>{" "}
              {ehDocx ? "nome(s) reconhecido(s) em" : "linha(s) em"} {arquivo.name}
            </span>
            <Button variant="ghost" size="sm" onClick={limpar}>
              Remover
            </Button>
          </div>
        ) : null}
      </div>

      {arquivo && ehDocx && registrosDocx && registrosDocx.length > 0 ? (
        <PreviaRegistros registros={registrosDocx} />
      ) : null}

      {arquivo && !ehDocx && planilha && planilha.linhas.length > 0 ? (
        <div className="grid gap-2">
          <MapeamentoColunas
            planilha={planilha}
            mapeamento={mapeamento}
            campos={CAMPOS}
            rotulos={ROTULO_CAMPO_BASE}
            campoPadrao="ignorar"
            onMudarCampo={(indice, campo) =>
              setMapeamento((atual) => atual.map((c, i) => (i === indice ? campo : c)))
            }
            onMudarCabecalho={alterarCabecalho}
          />
          {!temColunaNome ? (
            <p className="text-sm font-medium text-danger">
              Marque qual coluna é o "Nome" para poder importar.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button
          onClick={() => mutation.mutate()}
          disabled={
            mutation.isPending || carregando || lendo || !temColunaNome || registros.length === 0
          }
        >
          <Upload className="size-4" aria-hidden />
          {mutation.isPending
            ? "Importando e comparando..."
            : `Importar ${registros.length || ""} cliente(s) novo(s)`.trim()}
        </Button>
        {registros.length === 0 && arquivo ? (
          <span className="text-xs text-muted-foreground">Nenhum registro reconhecido ainda.</span>
        ) : null}
      </div>

      {resultado ? <ResumoResultado resultado={resultado} /> : null}
    </div>
  );
}
