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
import { Textarea } from "@/components/ui/textarea";
import { useSistema } from "@/hooks/useSistema";
import { importarNomes, type ResultadoImportacao } from "@/lib/acoes";
import { todayISO } from "@/lib/format";

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

/** Extrai uma lista de nomes de um arquivo xlsx/xls/csv: usa a primeira coluna com texto. */
async function extrairNomesDoArquivo(arquivo: File): Promise<string[]> {
  const buffer = await arquivo.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const planilha = workbook.Sheets[workbook.SheetNames[0]!];
  if (!planilha) return [];

  const linhas = XLSX.utils.sheet_to_json<unknown[]>(planilha, { header: 1, blankrows: false });

  const nomes: string[] = [];
  for (const linha of linhas) {
    if (!Array.isArray(linha) || linha.length === 0) continue;
    const primeiraCelula = linha[0];
    const texto = primeiraCelula == null ? "" : String(primeiraCelula).trim();
    if (!texto) continue;
    // Ignora um possível cabeçalho ("nome", "cliente" etc.) na primeira linha.
    const normalizado = texto.toLowerCase();
    if (
      nomes.length === 0 &&
      ["nome", "cliente", "nome completo", "nome do cliente"].includes(normalizado)
    ) {
      continue;
    }
    nomes.push(texto);
  }
  return nomes;
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

function Importar() {
  const { base, variacoes, rejeicoes, limiares, carregando } = useSistema();
  const queryClient = useQueryClient();
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  const [nomeImportacao, setNomeImportacao] = useState("");
  const [textoManual, setTextoManual] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [nomesDoArquivo, setNomesDoArquivo] = useState<string[] | null>(null);
  const [lendoArquivo, setLendoArquivo] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  const nomesManuais = useMemo(
    () =>
      textoManual
        .split("\n")
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0),
    [textoManual],
  );

  const origem: "arquivo" | "manual" = arquivo ? "arquivo" : "manual";
  const nomesParaImportar = arquivo ? (nomesDoArquivo ?? []) : nomesManuais;

  async function aoSelecionarArquivo(event: React.ChangeEvent<HTMLInputElement>) {
    const selecionado = event.target.files?.[0] ?? null;
    setArquivo(selecionado);
    setNomesDoArquivo(null);
    setResultado(null);
    if (!selecionado) return;

    setLendoArquivo(true);
    try {
      const nomes = await extrairNomesDoArquivo(selecionado);
      setNomesDoArquivo(nomes);
      if (nomes.length === 0) {
        toast.error("Não encontrei nomes na primeira coluna desse arquivo.");
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
    setNomesDoArquivo(null);
    if (inputArquivoRef.current) inputArquivoRef.current.value = "";
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!base || !limiares) throw new Error("Base ainda carregando, tente novamente.");
      if (nomesParaImportar.length === 0) throw new Error("Nenhum nome para importar.");
      const nome =
        nomeImportacao.trim() || `Importação — ${new Date().toLocaleDateString("pt-BR")}`;

      return importarNomes({
        nomes: nomesParaImportar,
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
            Formatos aceitos: .xlsx, .xls ou .csv. Uso a primeira coluna, uma linha por cliente.
          </p>
          <Input
            ref={inputArquivoRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={aoSelecionarArquivo}
          />
          {lendoArquivo ? <p className="text-xs text-muted-foreground">Lendo arquivo...</p> : null}
          {arquivo && nomesDoArquivo ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <span>
                <strong className="tabular">{nomesDoArquivo.length}</strong> nome(s) encontrado(s)
                em {arquivo.name}
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
          <p className="text-xs text-muted-foreground">Um nome por linha.</p>
          <Textarea
            rows={8}
            placeholder={"CARLOS ALBERTO SOUZA\nMARIA DA SILVA\n..."}
            value={textoManual}
            onChange={(evento) => {
              setTextoManual(evento.target.value);
              setResultado(null);
            }}
            disabled={!!arquivo}
            className="font-mono text-sm"
          />
          {nomesManuais.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              <strong className="tabular">{nomesManuais.length}</strong> nome(s) reconhecido(s)
            </p>
          ) : null}
        </Card>
      </div>

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
              mutation.isPending || carregando || lendoArquivo || nomesParaImportar.length === 0
            }
          >
            {mutation.isPending
              ? "Importando e comparando..."
              : `Importar ${nomesParaImportar.length || ""} nome(s)`.trim()}
          </Button>
          {nomesParaImportar.length === 0 ? (
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
