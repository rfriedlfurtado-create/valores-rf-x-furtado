import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Upload,
  Users,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { MapeamentoColunas } from "@/components/importador/MapeamentoColunas";
import { PreviaRegistros } from "@/components/importador/PreviaRegistros";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSistema } from "@/hooks/useSistema";
import { importarNomes, type LinhaImportacao, type ResultadoImportacao } from "@/lib/acoes";
import { parseBRL, todayISO } from "@/lib/format";
import {
  adivinharCampoBase,
  gerarModelo,
  interpretarLinhaLivre,
  lerDocx,
  lerPlanilha,
  parseDataCell,
  relerComCabecalho,
  ROTULO_CAMPO_BASE,
  type CampoBase,
  type PlanilhaLida,
} from "@/lib/leitorArquivo";

type CampoMapeado = CampoBase;
const ROTULO_CAMPO = ROTULO_CAMPO_BASE;
const CAMPOS_MAPEAVEIS: readonly CampoMapeado[] = ["nome", "cpf", "valor", "data", "ignorar"];
const adivinharCampo = adivinharCampoBase;

export function ResumoResultado({ resultado }: { resultado: ResultadoImportacao }) {
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

export interface ImportadorClientesProps {
  /** Chamado após uma importação concluída com sucesso (além da invalidação de queries já feita internamente). */
  onImportado?: (resultado: ResultadoImportacao) => void;
}

/**
 * Núcleo da funcionalidade de importação de clientes: upload de arquivo
 * (xlsx/xls/csv/docx) com mapeamento de colunas, ou colagem manual, com
 * comparação automática contra a base histórica. Usado tanto na página
 * /importar quanto no modal de importação da página de Clientes — a
 * lógica e os componentes vivem só aqui, sem duplicação.
 */
export function ImportadorClientes({ onImportado }: ImportadorClientesProps) {
  const { base, variacoes, rejeicoes, limiares, carregando } = useSistema();
  const queryClient = useQueryClient();
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  const [nomeImportacao, setNomeImportacao] = useState("");
  const [textoManual, setTextoManual] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null);
  const [mapeamento, setMapeamento] = useState<CampoMapeado[]>([]);
  const [registrosDocx, setRegistrosDocx] = useState<LinhaImportacao[] | null>(null);
  const [lendoArquivo, setLendoArquivo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  const ehDocx = !!arquivo && /\.docx$/i.test(arquivo.name);

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
  const registrosParaImportar = ehDocx
    ? (registrosDocx ?? [])
    : arquivo
      ? registrosDoArquivo
      : registrosManuais;

  async function aoSelecionarArquivo(event: React.ChangeEvent<HTMLInputElement>) {
    const selecionado = event.target.files?.[0] ?? null;
    setArquivo(selecionado);
    setPlanilha(null);
    setMapeamento([]);
    setRegistrosDocx(null);
    setResultado(null);
    if (!selecionado) return;

    setLendoArquivo(true);
    try {
      if (/\.docx$/i.test(selecionado.name)) {
        const linhas = await lerDocx(selecionado);
        const registros = linhas.map(interpretarLinhaLivre).filter((r) => r.nome.length > 0);
        setRegistrosDocx(registros);
        if (registros.length === 0) {
          toast.error("Não encontrei nomes nesse documento.");
        }
      } else {
        const lida = await lerPlanilha(selecionado);
        setPlanilha(lida);
        setMapeamento(lida.cabecalhos.map((cabecalho) => adivinharCampo(cabecalho)));
        if (lida.linhas.length === 0) {
          toast.error("Não encontrei linhas com dados nesse arquivo.");
        }
      }
      if (!nomeImportacao) {
        setNomeImportacao(selecionado.name.replace(/\.[^.]+$/, ""));
      }
    } catch {
      toast.error(
        "Não consegui ler esse arquivo. Confirme se é um .xlsx, .xls, .csv ou .docx válido.",
      );
      setArquivo(null);
    } finally {
      setLendoArquivo(false);
    }
  }

  function limparArquivo() {
    setArquivo(null);
    setPlanilha(null);
    setMapeamento([]);
    setRegistrosDocx(null);
    if (inputArquivoRef.current) inputArquivoRef.current.value = "";
  }

  function alterarMapeamento(indice: number, campo: CampoMapeado) {
    setMapeamento((atual) => atual.map((c, i) => (i === indice ? campo : c)));
  }

  async function alterarTemCabecalho(usa: boolean) {
    if (!arquivo || !planilha) return;
    setLendoArquivo(true);
    try {
      const relida = await relerComCabecalho(arquivo, usa);
      setPlanilha(relida);
      setMapeamento(relida.cabecalhos.map((c) => (usa ? adivinharCampo(c) : "ignorar")));
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
      onImportado?.(resultado);
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const temColunaNomeMapeada = ehDocx || !arquivo || indiceColunaNome !== -1;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Envie um arquivo (xlsx/csv/docx) ou cole os nomes manualmente. Cada nome é comparado com
          toda a base histórica — nomes parecidos geram apenas um alerta, nunca uma união
          automática.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            gerarModelo("modelo-importacao-clientes.xlsx", [
              ["Nome", "CPF", "Valor", "Data"],
              ["CARLOS ALBERTO SOUZA", "123.456.789-00", 1500.0, "10/03/2026"],
              ["MARIA DA SILVA", "", "", ""],
            ])
          }
        >
          <Download className="size-4" aria-hidden />
          Baixar modelo de importação
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="gap-4 p-5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold text-foreground">Importar por arquivo</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Formatos aceitos: .xlsx, .xls, .csv ou .docx. Planilhas permitem mapear as colunas; em
            documentos Word, o sistema tenta reconhecer nome, CPF, valor e data no texto — revise a
            prévia antes de importar.
          </p>
          <Input
            ref={inputArquivoRef}
            type="file"
            accept=".xlsx,.xls,.csv,.docx"
            onChange={aoSelecionarArquivo}
          />
          {lendoArquivo ? <p className="text-xs text-muted-foreground">Lendo arquivo...</p> : null}
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

      {arquivo && ehDocx && registrosDocx && registrosDocx.length > 0 ? (
        <div className="mt-5">
          <PreviaRegistros
            registros={registrosDocx}
            descricao="Word é texto livre, então essa leitura é uma estimativa — confira antes de importar. Se algo saiu errado, corrija colando o texto na caixa de colagem manual ao lado."
          />
        </div>
      ) : null}

      {arquivo && !ehDocx && planilha && planilha.linhas.length > 0 ? (
        <div className="mt-5">
          <MapeamentoColunas
            planilha={planilha}
            mapeamento={mapeamento}
            campos={CAMPOS_MAPEAVEIS}
            rotulos={ROTULO_CAMPO}
            campoPadrao="ignorar"
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
