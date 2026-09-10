import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  ListChecks,
  Upload,
  Users,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { PageHeader } from "@/components/layout/AppShell";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSistema } from "@/hooks/useSistema";
import { importarNomes, type LinhaImportacao, type ResultadoImportacao } from "@/lib/acoes";
import { parseBRL, todayISO } from "@/lib/format";

export const Route = createFileRoute("/importar")({
  head: () => ({
    meta: [
      { title: "Importar clientes — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Importe uma nova listagem de clientes por arquivo ou colagem manual e compare automaticamente com a base histórica.",
      },
      { property: "og:title", content: "Importar clientes — Base de Pagamentos" },
      {
        property: "og:description",
        content: "Importação de clientes com comparação automática de nomes.",
      },
    ],
  }),
  component: Importar,
});

type CampoMapeado = "nome" | "cpf" | "valor" | "data" | "ignorar";

const ROTULO_CAMPO: Record<CampoMapeado, string> = {
  nome: "Nome",
  cpf: "CPF",
  valor: "Valor",
  data: "Data",
  ignorar: "Ignorar",
};

function adivinharCampo(cabecalho: string): CampoMapeado {
  const h = cabecalho.toLowerCase();
  if (/nome|cliente|parte|autor/.test(h)) return "nome";
  if (/cpf/.test(h)) return "cpf";
  if (/valor|montante|quantia|r\$/.test(h)) return "valor";
  if (/data/.test(h)) return "data";
  return "ignorar";
}

/** Converte uma célula de data (Date do xlsx, serial ou texto) para YYYY-MM-DD. */
function parseDataCell(valor: unknown): string | null {
  if (valor == null || valor === "") return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return valor.toISOString().slice(0, 10);
  }
  const texto = String(valor).trim();
  const br = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (br && br[1] && br[2] && br[3]) {
    return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  return null;
}

interface PlanilhaLida {
  cabecalhos: string[];
  linhas: unknown[][];
  temCabecalho: boolean;
}

/** Lê a planilha inteira (todas as colunas), sem aplicar mapeamento ainda. */
async function lerPlanilha(arquivo: File): Promise<PlanilhaLida> {
  const buffer = await arquivo.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const planilha = workbook.Sheets[workbook.SheetNames[0]!];
  if (!planilha) return { cabecalhos: [], linhas: [], temCabecalho: false };

  const todasLinhas = XLSX.utils.sheet_to_json<unknown[]>(planilha, {
    header: 1,
    blankrows: false,
  });
  const linhasComConteudo = todasLinhas.filter(
    (linha) => Array.isArray(linha) && linha.some((c) => c != null && String(c).trim() !== ""),
  );
  if (linhasComConteudo.length === 0) return { cabecalhos: [], linhas: [], temCabecalho: false };

  const numColunas = Math.max(...linhasComConteudo.map((l) => l.length));
  const primeira = linhasComConteudo[0]!;
  const primeiraEhTexto = primeira.every((c) => c == null || typeof c !== "number");
  const restoTemNumero = linhasComConteudo
    .slice(1)
    .some((l) => l.some((c) => typeof c === "number" || c instanceof Date));
  const temCabecalho = primeiraEhTexto && restoTemNumero;

  const cabecalhos = Array.from({ length: numColunas }, (_, i) =>
    temCabecalho ? String(primeira[i] ?? `Coluna ${i + 1}`).trim() : `Coluna ${i + 1}`,
  );
  const linhas = temCabecalho ? linhasComConteudo.slice(1) : linhasComConteudo;

  return { cabecalhos, linhas, temCabecalho };
}

function ResumoResultado({ resultado }: { resultado: ResultadoImportacao }) {
  const itens = [
    { label: "Nomes importados", valor: resultado.totalNomes, icone: Users },
    { label: "Correspondências encontradas", valor: resultado.correspondencias, icone: ListChecks },
    { label: "Já pagos identificados", valor: resultado.jaPagos, icone: CheckCircle2 },
    { label: "Possíveis correspondências", valor: resultado.possiveis, icone: AlertTriangle },
  ];

  return (
    <Card className="gap-4 p-5">
      <p className="text-sm font-semibold text-foreground">Importação concluída</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {itens.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5"
          >
            <item.icone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-lg font-bold tabular leading-none">{item.valor}</p>
              <p className="text-xs text-muted-foreground">{item.label}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {resultado.jaPagos > 0 || resultado.correspondencias > 0 ? (
          <Button asChild size="sm">
            <Link to="/ja-pagos">Ver correspondências</Link>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline">
          <Link to="/importacoes">Ver histórico de importações</Link>
        </Button>
      </div>
    </Card>
  );
}

function MapeamentoColunas({
  planilha,
  mapeamento,
  onMudarCampo,
  onMudarCabecalho,
}: {
  planilha: PlanilhaLida;
  mapeamento: CampoMapeado[];
  onMudarCampo: (indice: number, campo: CampoMapeado) => void;
  onMudarCabecalho: (usa: boolean) => void;
}) {
  const preview = planilha.linhas.slice(0, 5);

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Mapear colunas</p>
          <p className="text-xs text-muted-foreground">
            Diga o que cada coluna representa. Uma coluna precisa ser "Nome".
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={planilha.temCabecalho}
            onCheckedChange={onMudarCabecalho}
            id="tem-cabecalho"
          />
          <Label htmlFor="tem-cabecalho" className="text-xs text-muted-foreground">
            Primeira linha é cabeçalho
          </Label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {planilha.cabecalhos.map((cabecalho, indice) => (
                <TableHead key={indice} className="min-w-40">
                  <div className="space-y-1.5 py-1">
                    <p className="truncate text-xs font-semibold text-foreground" title={cabecalho}>
                      {cabecalho}
                    </p>
                    <Select
                      value={mapeamento[indice] ?? "ignorar"}
                      onValueChange={(valor) => onMudarCampo(indice, valor as CampoMapeado)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ROTULO_CAMPO) as CampoMapeado[]).map((campo) => (
                          <SelectItem key={campo} value={campo}>
                            {ROTULO_CAMPO[campo]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.map((linha, indiceLinha) => (
              <TableRow key={indiceLinha}>
                {planilha.cabecalhos.map((_, indiceColuna) => (
                  <TableCell key={indiceColuna} className="text-sm text-muted-foreground">
                    {linha[indiceColuna] instanceof Date
                      ? (linha[indiceColuna] as Date).toLocaleDateString("pt-BR")
                      : String(linha[indiceColuna] ?? "—")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Mostrando {preview.length} de {planilha.linhas.length} linha(s).
      </p>
    </Card>
  );
}

function Importar() {
  const { base, variacoes, rejeicoes, limiares, carregando } = useSistema();
  const queryClient = useQueryClient();
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  const [nomeImportacao, setNomeImportacao] = useState("");
  const [textoManual, setTextoManual] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null);
  const [mapeamento, setMapeamento] = useState<CampoMapeado[]>([]);
  const [lendoArquivo, setLendoArquivo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  const registrosManuais = useMemo<LinhaImportacao[]>(
    () =>
      textoManual
        .split("\n")
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0)
        .map((linha) => {
          const partes = linha.split(";").map((parte) => parte.trim());
          return {
            nome: partes[0] ?? "",
            cpf: partes[1] || null,
            valor: partes[2] ? parseBRL(partes[2]) : null,
            data: partes[3] ? parseDataCell(partes[3]) : null,
          };
        })
        .filter((registro) => registro.nome.length > 0),
    [textoManual],
  );

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

  const origem: "arquivo" | "manual" = arquivo ? "arquivo" : "manual";
  const registrosParaImportar = arquivo ? registrosDoArquivo : registrosManuais;

  async function aoSelecionarArquivo(event: React.ChangeEvent<HTMLInputElement>) {
    const selecionado = event.target.files?.[0] ?? null;
    setArquivo(selecionado);
    setPlanilha(null);
    setMapeamento([]);
    setResultado(null);
    if (!selecionado) return;

    setLendoArquivo(true);
    try {
      const lida = await lerPlanilha(selecionado);
      setPlanilha(lida);
      setMapeamento(lida.cabecalhos.map((cabecalho) => adivinharCampo(cabecalho)));
      if (lida.linhas.length === 0) {
        toast.error("Não encontrei linhas com dados nesse arquivo.");
      }
      if (!nomeImportacao) {
        setNomeImportacao(selecionado.name.replace(/\.[^.]+$/, ""));
      }
    } catch {
      toast.error("Não consegui ler esse arquivo. Confirme se é um .xlsx, .xls ou .csv válido.");
      setArquivo(null);
    } finally {
      setLendoArquivo(false);
    }
  }

  function limparArquivo() {
    setArquivo(null);
    setPlanilha(null);
    setMapeamento([]);
    if (inputArquivoRef.current) inputArquivoRef.current.value = "";
  }

  function alterarMapeamento(indice: number, campo: CampoMapeado) {
    setMapeamento((atual) => atual.map((c, i) => (i === indice ? campo : c)));
  }

  async function alterarTemCabecalho(usa: boolean) {
    if (!arquivo || !planilha) return;
    setLendoArquivo(true);
    try {
      const buffer = await arquivo.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const folha = workbook.Sheets[workbook.SheetNames[0]!];
      const todasLinhas = folha
        ? XLSX.utils.sheet_to_json<unknown[]>(folha, { header: 1, blankrows: false })
        : [];
      const linhasComConteudo = todasLinhas.filter(
        (linha) => Array.isArray(linha) && linha.some((c) => c != null && String(c).trim() !== ""),
      );
      const numColunas = Math.max(1, ...linhasComConteudo.map((l) => l.length));
      const primeira = linhasComConteudo[0] ?? [];
      const cabecalhos = Array.from({ length: numColunas }, (_, i) =>
        usa ? String(primeira[i] ?? `Coluna ${i + 1}`).trim() : `Coluna ${i + 1}`,
      );
      const linhas = usa ? linhasComConteudo.slice(1) : linhasComConteudo;
      setPlanilha({ cabecalhos, linhas, temCabecalho: usa });
      setMapeamento(cabecalhos.map((c) => (usa ? adivinharCampo(c) : "ignorar")));
    } finally {
      setLendoArquivo(false);
    }
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!base || !limiares) throw new Error("Base ainda carregando, tente novamente.");
      if (registrosParaImportar.length === 0) throw new Error("Nenhum nome para importar.");
      const nome =
        nomeImportacao.trim() || `Importação — ${new Date().toLocaleDateString("pt-BR")}`;

      return importarNomes({
        registros: registrosParaImportar,
        nomeImportacao: nome,
        origemArquivo: arquivo?.name ?? null,
        tipoOrigem: origem,
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
      toast.success(`${resultado.totalNomes} nome(s) importado(s) com sucesso.`);
      await queryClient.invalidateQueries();
      setResultado(resultado);
      setTextoManual("");
      limparArquivo();
      setNomeImportacao("");
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const temColunaNomeMapeada = !arquivo || indiceColunaNome !== -1;

  return (
    <div>
      <PageHeader
        titulo="Importar clientes"
        descricao="Envie um arquivo (xlsx/csv) ou cole os nomes manualmente. Cada nome é comparado com toda a base histórica — nomes parecidos geram apenas um alerta, nunca uma união automática."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="gap-4 p-5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold text-foreground">Importar por arquivo</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Formatos aceitos: .xlsx, .xls ou .csv. Depois de enviar, você escolhe o que cada coluna
            representa (nome, CPF, valor, data).
          </p>
          <Input
            ref={inputArquivoRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={aoSelecionarArquivo}
          />
          {lendoArquivo ? <p className="text-xs text-muted-foreground">Lendo arquivo...</p> : null}
          {arquivo && planilha ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <span>
                <strong className="tabular">{planilha.linhas.length}</strong> linha(s) em{" "}
                {arquivo.name}
              </span>
              <Button variant="ghost" size="sm" onClick={limparArquivo}>
                Remover
              </Button>
            </div>
          ) : null}
        </Card>

        <Card className="gap-4 p-5">
          <div className="flex items-center gap-2">
            <Upload className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold text-foreground">Colar manualmente</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Um por linha. Opcionalmente: <span className="font-mono">Nome; CPF; Valor; Data</span>
          </p>
          <Textarea
            rows={8}
            placeholder={
              "CARLOS ALBERTO SOUZA\nMARIA DA SILVA; 123.456.789-00; 1500,00; 10/03/2026"
            }
            value={textoManual}
            onChange={(evento) => {
              setTextoManual(evento.target.value);
              setResultado(null);
            }}
            disabled={!!arquivo}
            className="font-mono text-sm"
          />
          {registrosManuais.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              <strong className="tabular">{registrosManuais.length}</strong> nome(s) reconhecido(s)
            </p>
          ) : null}
        </Card>
      </div>

      {arquivo && planilha && planilha.linhas.length > 0 ? (
        <div className="mt-5">
          <MapeamentoColunas
            planilha={planilha}
            mapeamento={mapeamento}
            onMudarCampo={alterarMapeamento}
            onMudarCabecalho={alterarTemCabecalho}
          />
          {!temColunaNomeMapeada ? (
            <p className="mt-2 text-sm font-medium text-danger">
              Marque qual coluna é o "Nome" para poder importar.
            </p>
          ) : null}
        </div>
      ) : null}

      <Card className="mt-5 gap-4 p-5">
        <div className="grid gap-2 sm:max-w-sm">
          <Label htmlFor="nome-importacao">Nome desta importação</Label>
          <Input
            id="nome-importacao"
            placeholder={`Importação — ${todayISO().split("-").reverse().join("/")}`}
            value={nomeImportacao}
            onChange={(evento) => setNomeImportacao(evento.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              mutation.isPending ||
              carregando ||
              lendoArquivo ||
              !temColunaNomeMapeada ||
              registrosParaImportar.length === 0
            }
          >
            {mutation.isPending
              ? "Importando e comparando..."
              : `Importar ${registrosParaImportar.length || ""} nome(s)`.trim()}
          </Button>
          {registrosParaImportar.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Selecione um arquivo ou cole ao menos um nome.
            </span>
          ) : null}
        </div>
      </Card>

      {resultado ? (
        <div className="mt-5">
          <ResumoResultado resultado={resultado} />
        </div>
      ) : null}
    </div>
  );
}
