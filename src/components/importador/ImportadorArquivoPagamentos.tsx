import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, Upload, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MapeamentoColunas } from "@/components/importador/MapeamentoColunas";
import { PreviaRegistros } from "@/components/importador/PreviaRegistros";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSistema } from "@/hooks/useSistema";
import {
  importarPagamentos,
  type LinhaPagamento,
  type ResultadoImportacaoPagamentos,
} from "@/lib/acoes";
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
import { TIPOS_PAGAMENTO, type TipoPagamento } from "@/lib/tipos";

const CAMPOS: readonly CampoBase[] = ["nome", "cpf", "valor", "data", "ignorar"];

function ResumoImportacaoPagamentos({ resultado }: { resultado: ResultadoImportacaoPagamentos }) {
  return (
    <Card className="gap-4 p-5">
      <p className="text-sm font-semibold text-foreground">Importação de pagamentos concluída</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-lg font-bold tabular leading-none">{resultado.totalRegistros}</p>
            <p className="text-xs text-muted-foreground">Registros no arquivo</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-lg font-bold tabular leading-none">
              {resultado.pagamentosRegistrados}
            </p>
            <p className="text-xs text-muted-foreground">Pagamentos registrados</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <CheckCircle2 className="size-4 shrink-0 text-green-600" aria-hidden />
          <div>
            <p className="text-lg font-bold tabular leading-none">
              {resultado.marcadosComoPagos}
            </p>
            <p className="text-xs text-muted-foreground">Movidos para Já Pagos</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <AlertTriangle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-lg font-bold tabular leading-none">
              {resultado.naoEncontrados.length + resultado.invalidos.length}
            </p>
            <p className="text-xs text-muted-foreground">Não identificados</p>
          </div>
        </div>
      </div>
      {resultado.naoEncontrados.length > 0 || resultado.invalidos.length > 0 ? (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-border">
          <ul className="divide-y divide-border text-sm">
            {[...resultado.naoEncontrados, ...resultado.invalidos].map((item, indice) => (
              <li key={indice} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span className="font-medium">{item.nome}</span>
                <span className="text-xs text-muted-foreground">{item.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

export interface ImportadorArquivoPagamentosProps {
  onImportado?: (resultado: ResultadoImportacaoPagamentos) => void;
}

/**
 * Importação por arquivo de "Clientes que Pagaram", usada no lado direito
 * do modal "Importar Clientes". Reaproveita o mesmo motor de leitura de
 * arquivo do lado de Clientes Novos — só o destino final muda: aqui cada
 * linha é associada a um cliente JÁ EXISTENTE (nunca cria cliente novo).
 */
export function ImportadorArquivoPagamentos({ onImportado }: ImportadorArquivoPagamentosProps) {
  const { base, carregando } = useSistema();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null);
  const [mapeamento, setMapeamento] = useState<CampoBase[]>([]);
  const [registrosDocx, setRegistrosDocx] = useState<LinhaPagamento[] | null>(null);
  const [lendo, setLendo] = useState(false);
  const [tipo, setTipo] = useState<TipoPagamento>("pix");
  const [resultado, setResultado] = useState<ResultadoImportacaoPagamentos | null>(null);

  const ehDocx = !!arquivo && /\.docx$/i.test(arquivo.name);
  const indiceColunaNome = mapeamento.indexOf("nome");

  const registrosDoArquivo = useMemo<LinhaPagamento[]>(() => {
    if (!planilha || indiceColunaNome === -1) return [];
    return planilha.linhas
      .map((linha): LinhaPagamento => {
        const registro: LinhaPagamento = { nome: "", cpf: null, valor: null, data: null };
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
      if (!base) throw new Error("Base ainda carregando, tente novamente.");
      if (registros.length === 0) throw new Error("Nenhum pagamento para importar.");
      return importarPagamentos({
        registros,
        base: base.clientes,
        tipo,
      });
    },
    onSuccess: async (resultado) => {
      if (resultado.pagamentosRegistrados > 0) {
        toast.success(`${resultado.pagamentosRegistrados} pagamento(s) processado(s) com sucesso.`);
      }
      const problemas = resultado.naoEncontrados.length + resultado.invalidos.length;
      if (problemas > 0) {
        toast.error(`${problemas} registro(s) não puderam ser identificados.`);
      }
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
          Formatos aceitos: .xlsx, .xls, .csv ou .docx. Cada linha precisa de nome ou CPF de um
          cliente já existente na base.
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
              {ehDocx ? "registro(s) reconhecido(s) em" : "linha(s) em"} {arquivo.name}
            </span>
            <Button variant="ghost" size="sm" onClick={limpar}>
              Remover
            </Button>
          </div>
        ) : null}
      </div>

      {arquivo && ehDocx && registrosDocx && registrosDocx.length > 0 ? (
        <PreviaRegistros
          registros={registrosDocx}
          descricao="Word é texto livre — confira se nome, valor e data ficaram corretos antes de importar."
        />
      ) : null}

      {arquivo && !ehDocx && planilha && planilha.linhas.length > 0 ? (
        <div className="grid gap-2">
          <MapeamentoColunas
            planilha={planilha}
            mapeamento={mapeamento}
            campos={CAMPOS}
            rotulos={ROTULO_CAMPO_BASE}
            campoPadrao="ignorar"
            descricao='Uma coluna precisa ser "Nome" (ou "CPF") para identificar o cliente que pagou.'
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

      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="pagamentos-tipo-lote">Tipo do pagamento (para todos os registros)</Label>
        <Select value={tipo} onValueChange={(valor) => setTipo(valor as TipoPagamento)}>
          <SelectTrigger id="pagamentos-tipo-lote">
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

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button
          onClick={() => mutation.mutate()}
          disabled={
            mutation.isPending || carregando || lendo || !temColunaNome || registros.length === 0
          }
        >
          <Upload className="size-4" aria-hidden />
          {mutation.isPending
            ? "Importando pagamentos..."
            : `Importar ${registros.length || ""} pagamento(s)`.trim()}
        </Button>
        {registros.length === 0 && arquivo ? (
          <span className="text-xs text-muted-foreground">Nenhum registro reconhecido ainda.</span>
        ) : null}
      </div>

      {resultado ? <ResumoImportacaoPagamentos resultado={resultado} /> : null}
    </div>
  );
}
