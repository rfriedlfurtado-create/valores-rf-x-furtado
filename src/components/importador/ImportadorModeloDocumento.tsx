import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useSistema } from "@/hooks/useSistema";
import { executarPlanoModelo, type ResultadoImportacaoModelo } from "@/lib/acoes";
import { CHAVES_PARA_INVALIDAR } from "@/lib/dados";
import { formatBRL } from "@/lib/format";
import {
  analisarModeloDocumento,
  gerarModeloDocumento,
  planejarImportacaoModelo,
  rotuloSituacao,
  VERSAO_MODELO,
  type AcaoModelo,
  type AnaliseModelo,
  type ItemPlano,
  type PlanoModelo,
} from "@/lib/modeloDocumento";

const ROTULO_ACAO: Record<AcaoModelo, { texto: string; classe: string }> = {
  criar: {
    texto: "Novo cliente",
    classe: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  },
  atualizar: {
    texto: "Atualizar existente",
    classe: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  },
  sem_alteracao: {
    texto: "Já cadastrado",
    classe: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  marcar_pago: {
    texto: "Mover p/ Já Pagos",
    classe: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  },
  nao_encontrado: {
    texto: "Não encontrado",
    classe: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  erro: { texto: "Erro", classe: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
};

function Contador({
  valor,
  rotulo,
  destaque,
}: {
  valor: number;
  rotulo: string;
  destaque?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <p className={`text-lg font-bold tabular leading-none ${destaque ?? ""}`}>{valor}</p>
      <p className="mt-1 text-xs text-muted-foreground">{rotulo}</p>
    </div>
  );
}

function TabelaItens({ itens }: { itens: ItemPlano[] }) {
  if (itens.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">Nenhum registro.</p>;
  }
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-left">
          <tr>
            <th className="px-2 py-1.5 font-semibold">Linha</th>
            <th className="px-2 py-1.5 font-semibold">Nome</th>
            <th className="px-2 py-1.5 font-semibold">Situação</th>
            <th className="px-2 py-1.5 font-semibold">Ação</th>
            <th className="px-2 py-1.5 font-semibold">Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item) => (
            <tr key={item.linha.numeroLinha} className="border-t border-border align-top">
              <td className="px-2 py-1.5 tabular">{item.linha.numeroLinha}</td>
              <td className="px-2 py-1.5">
                <span className="font-medium">{item.linha.nome || "—"}</span>
                {item.linha.cpf ? (
                  <span className="block text-muted-foreground">{item.linha.cpf}</span>
                ) : null}
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap">
                {item.linha.situacao ? rotuloSituacao(item.linha.situacao) : "—"}
                {item.linha.valor != null ? (
                  <span className="block text-muted-foreground">{formatBRL(item.linha.valor)}</span>
                ) : null}
              </td>
              <td className="px-2 py-1.5">
                <Badge variant="outline" className={`border-0 ${ROTULO_ACAO[item.acao].classe}`}>
                  {ROTULO_ACAO[item.acao].texto}
                </Badge>
              </td>
              <td className="px-2 py-1.5 text-muted-foreground">
                {[
                  item.clienteNome && item.acao !== "criar" ? `Cliente: ${item.clienteNome}` : null,
                  item.motivo,
                  item.aviso,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Filtro = "problemas" | "todos";

/**
 * Importador do Modelo Documento (ATLAS_CLIENTES_V1).
 *
 * Fluxo: arquivo → validar estrutura → reconhecer cabeçalhos → ler linhas →
 * normalizar → identificar situação → validar cliente → PRÉ-VISUALIZAÇÃO →
 * confirmação do usuário → execução → resultado.
 *
 * Toda a regra de colunas vem de `@/lib/modeloDocumento` — a mesma usada
 * pelo gerador do botão "Modelo Documento".
 */
export function ImportadorModeloDocumento() {
  const { base, variacoes } = useSistema();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analise, setAnalise] = useState<AnaliseModelo | null>(null);
  const [lendo, setLendo] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("problemas");
  const [resultado, setResultado] = useState<ResultadoImportacaoModelo | null>(null);

  const plano: PlanoModelo | null = useMemo(() => {
    if (!analise || analise.errosEstrutura.length > 0 || !base) return null;
    const pagamentos = [...base.pagamentosPorCliente.values()].flat();
    return planejarImportacaoModelo({
      linhas: analise.linhas,
      clientes: base.clientes,
      variacoes,
      pagamentos,
    });
  }, [analise, base, variacoes]);

  function limpar() {
    setArquivo(null);
    setAnalise(null);
    setFiltro("problemas");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function aoSelecionar(file: File | undefined) {
    if (!file) return;
    setResultado(null);
    setArquivo(file);
    setLendo(true);
    try {
      setAnalise(await analisarModeloDocumento(file));
    } finally {
      setLendo(false);
    }
  }

  const mutation = useMutation({
    mutationFn: () =>
      executarPlanoModelo({ plano: plano!, nomeArquivo: arquivo?.name ?? "arquivo" }),
    onSuccess: async (res) => {
      setResultado(res);
      limpar();
      for (const chave of CHAVES_PARA_INVALIDAR) {
        await queryClient.invalidateQueries({ queryKey: chave });
      }
      if (res.falhas.length > 0)
        toast.error(`${res.falhas.length} registro(s) falharam ao gravar.`);
      else toast.success("Importação concluída.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const itensVisiveis = plano
    ? filtro === "todos"
      ? plano.itens
      : plano.itens.filter((i) => i.acao === "erro" || i.acao === "nao_encontrado" || i.aviso)
    : [];
  const temAlgoParaGravar =
    !!plano &&
    plano.itens.some(
      (i) => i.acao === "criar" || i.acao === "atualizar" || i.acao === "marcar_pago",
    );

  return (
    <div className="grid gap-3 pt-2">
      <p className="text-xs text-muted-foreground">
        Use o arquivo baixado no botão <strong>Modelo Documento</strong>. Um mesmo arquivo pode ter
        clientes <strong>NÃO PAGO</strong> (em tramitação) e <strong>PAGO</strong> (movidos para Já
        Pagos). Nada é gravado antes da sua confirmação.
      </p>

      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => void aoSelecionar(e.target.files?.[0])}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={lendo || mutation.isPending}>
          <Upload className="size-4" aria-hidden />
          {lendo ? "Analisando..." : "Selecionar arquivo do modelo"}
        </Button>
        <Button variant="outline" onClick={gerarModeloDocumento}>
          <FileSpreadsheet className="size-4" aria-hidden />
          Baixar Modelo Documento
        </Button>
      </div>

      {analise && analise.errosEstrutura.length > 0 ? (
        <Card className="gap-2 border-red-300 p-4 dark:border-red-900">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <XCircle className="size-4" aria-hidden />
            Arquivo fora do modelo — nada foi importado
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {analise.errosEstrutura.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <div>
            <Button size="sm" variant="outline" onClick={limpar}>
              Escolher outro arquivo
            </Button>
          </div>
        </Card>
      ) : null}

      {plano && analise ? (
        <Card className="gap-4 p-4">
          <div>
            <p className="text-sm font-semibold">Arquivo analisado</p>
            <p className="text-xs text-muted-foreground">
              {arquivo?.name} ·{" "}
              {analise.versao ?? `sem controle de versão (validado como ${VERSAO_MODELO})`}
            </p>
          </div>

          {analise.avisos.length > 0 ? (
            <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300">
              {analise.avisos.map((a) => (
                <li key={a} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {a}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Contador valor={plano.resumo.total} rotulo="Total de registros" />
            <Contador
              valor={plano.resumo.emTramitacao}
              rotulo={`Em tramitação (${plano.resumo.novos} novos)`}
            />
            <Contador
              valor={plano.resumo.pagosIdentificados}
              rotulo="Pagos identificados"
              destaque="text-green-700 dark:text-green-400"
            />
            <Contador
              valor={plano.resumo.pagosNaoEncontrados}
              rotulo="Pagos não encontrados"
              destaque={
                plano.resumo.pagosNaoEncontrados ? "text-amber-700 dark:text-amber-400" : ""
              }
            />
            <Contador
              valor={plano.resumo.erros}
              rotulo="Registros com erro"
              destaque={plano.resumo.erros ? "text-red-700 dark:text-red-400" : ""}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={filtro === "problemas" ? "secondary" : "ghost"}
                onClick={() => setFiltro("problemas")}
              >
                Problemas e avisos
              </Button>
              <Button
                size="sm"
                variant={filtro === "todos" ? "secondary" : "ghost"}
                onClick={() => setFiltro("todos")}
              >
                Todos os registros
              </Button>
            </div>
            <TabelaItens itens={itensVisiveis} />
          </div>

          {plano.resumo.erros + plano.resumo.pagosNaoEncontrados > 0 ? (
            <p className="text-xs text-muted-foreground">
              Registros com erro e pagos não encontrados <strong>não serão gravados</strong>.
              Corrija o arquivo e importe novamente — a reimportação não duplica clientes.
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={limpar} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!temAlgoParaGravar || mutation.isPending}
            >
              <CheckCircle2 className="size-4" aria-hidden />
              {mutation.isPending ? "Importando..." : "Confirmar importação"}
            </Button>
          </div>
        </Card>
      ) : null}

      {resultado ? <ResultadoModelo resultado={resultado} /> : null}
    </div>
  );
}

function ResultadoModelo({ resultado }: { resultado: ResultadoImportacaoModelo }) {
  const pendentes = [
    ...resultado.naoEncontrados,
    ...resultado.naoImportadosPorErro,
    ...resultado.falhas.map((f) => ({ ...f.item, acao: "erro" as const, motivo: f.mensagem })),
  ].sort((a, b) => a.linha.numeroLinha - b.linha.numeroLinha);

  return (
    <Card className="gap-4 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="size-4 text-green-600" aria-hidden />
        Importação concluída
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Contador valor={resultado.novosClientes} rotulo="Novos clientes" />
        <Contador
          valor={resultado.existentesAtualizados + resultado.semAlteracao}
          rotulo={`Existentes (${resultado.existentesAtualizados} atualizados)`}
        />
        <Contador
          valor={resultado.movidosParaJaPagos}
          rotulo={`Movidos p/ Já Pagos (${resultado.pagamentosRegistrados} valores)`}
          destaque="text-green-700 dark:text-green-400"
        />
        <Contador valor={resultado.naoEncontrados.length} rotulo="Não encontrados" />
        <Contador
          valor={resultado.naoImportadosPorErro.length + resultado.falhas.length}
          rotulo="Não importados por erro"
        />
      </div>
      {pendentes.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-xs font-semibold">Registros para revisão</p>
          <TabelaItens itens={pendentes} />
        </div>
      ) : null}
    </Card>
  );
}
