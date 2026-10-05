import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BotaoExcluirCliente } from "@/components/BotaoExcluirCliente";
import { BotaoImportarClientes } from "@/components/DialogImportar";
import { DialogPagamento } from "@/components/DialogPagamento";
import { PageHeader, SecaoVazia } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSistema } from "@/hooks/useSistema";
import { useIdentificadoresPorCliente } from "@/hooks/useDadosFurtado";
import { FiltroEscritorioSelect } from "@/components/FiltroEscritorioSelect";
import {
  BadgeEscritorio,
  clientePassaFiltro,
  escritoriosDoCliente,
  useFiltroEscritorio,
  useVinculosEscritorio,
} from "@/lib/escritorio";
import { NAO_INFORMADO } from "@/lib/rf/campos";
import { correspondeBusca } from "@/lib/situacao";
import type { ClienteComTotais } from "@/lib/tipos";

export const Route = createFileRoute("/clientes/")({
  head: () => ({
    meta: [
      { title: "Clientes — Base de Pagamentos" },
      {
        name: "description",
        content: "Clientes com processos em tramitação cadastrados no sistema.",
      },
      { property: "og:title", content: "Clientes — Base de Pagamentos" },
      { property: "og:description", content: "Clientes com processos em tramitação." },
    ],
  }),
  component: Clientes,
});

type Ordenacao = "nome" | "cadastro_recente" | "cadastro_antigo";

const POR_PAGINA = 25;

function Clientes() {
  const { base, variacoes, carregando } = useSistema();
  const { filtro } = useFiltroEscritorio();
  const vinculos = useVinculosEscritorio();
  const identificadores = useIdentificadoresPorCliente();
  const navigate = useNavigate();
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("nome");
  const [pagina, setPagina] = useState(0);

  const variacoesPorCliente = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const variacao of variacoes) {
      const lista = mapa.get(variacao.cliente_id) ?? [];
      lista.push(variacao.nome_normalizado);
      mapa.set(variacao.cliente_id, lista);
    }
    return mapa;
  }, [variacoes]);

  // Uma linha por cliente identificado (os processos ficam dentro do perfil).
  const lista = useMemo(() => {
    if (!base) return [];
    const resultado = base.emTramitacao.filter(
      (cliente) =>
        clientePassaFiltro(cliente, filtro, vinculos) &&
        correspondeBusca(cliente, busca, variacoesPorCliente, identificadores),
    );
    const ordenadores: Record<Ordenacao, (a: ClienteComTotais, b: ClienteComTotais) => number> = {
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
      cadastro_recente: (a, b) => b.created_at.localeCompare(a.created_at),
      cadastro_antigo: (a, b) => a.created_at.localeCompare(b.created_at),
    };
    return [...resultado].sort(ordenadores[ordenacao]);
  }, [base, busca, ordenacao, variacoesPorCliente, filtro, vinculos, identificadores]);

  useEffect(() => setPagina(0), [busca, ordenacao, filtro]);

  if (carregando || !base) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Clientes" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = lista.slice(paginaAtual * POR_PAGINA, paginaAtual * POR_PAGINA + POR_PAGINA);

  const totalEmTramitacao =
    filtro === "todos"
      ? base.indicadores.emTramitacao
      : base.emTramitacao.filter((c) => clientePassaFiltro(c, filtro, vinculos)).length;

  const abrir = (id: string) =>
    void navigate({ to: "/clientes/$clienteId", params: { clienteId: id } });

  return (
    <div>
      <PageHeader
        titulo="Clientes"
        descricao={`${totalEmTramitacao} cliente(s) com processo em tramitação. Para importar, arraste a planilha para esta página.`}
      >
        <DialogPagamento
          clientes={base.clientes}
          trigger={
            <Button variant="outline">
              <Plus className="size-4" aria-hidden />
              Registrar pagamento
            </Button>
          }
        />
        {/* Modal com as duas modalidades; soltar a planilha na página também o abre. */}
        <BotaoImportarClientes />
      </PageHeader>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Pesquisar por nome ou CPF..."
            className="h-12 pl-10 text-base"
            aria-label="Pesquisar cliente por nome ou CPF"
          />
        </div>
        <FiltroEscritorioSelect />
        <Select value={ordenacao} onValueChange={(valor) => setOrdenacao(valor as Ordenacao)}>
          <SelectTrigger className="h-12 lg:w-56" aria-label="Ordenação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nome">Nome (A-Z)</SelectItem>
            <SelectItem value="cadastro_recente">Cadastro mais recente</SelectItem>
            <SelectItem value="cadastro_antigo">Cadastro mais antigo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {lista.length === 0 ? (
        <SecaoVazia
          titulo="Nenhum cliente em tramitação"
          descricao={
            busca
              ? "Nenhum resultado para a pesquisa atual."
              : "Nenhum cliente em tramitação cadastrado. Use “Importar clientes” para começar."
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-64">Nome do cliente</TableHead>
                  <TableHead className="min-w-40">CPF</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveis.map((cliente) => (
                  <TableRow
                    key={cliente.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`Abrir perfil de ${cliente.nome}`}
                    className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none"
                    onClick={() => abrir(cliente.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        abrir(cliente.id);
                      }
                    }}
                  >
                    <TableCell className="font-semibold">
                      {cliente.nome}
                      <span className="mt-1 flex flex-wrap gap-1">
                        {escritoriosDoCliente(cliente, vinculos).map((e) => (
                          <BadgeEscritorio key={e} escritorio={e} />
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="tabular text-sm">
                      {cliente.cpf?.trim() ? (
                        cliente.cpf
                      ) : (
                        <span className="text-muted-foreground">{NAO_INFORMADO}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Button asChild size="sm" variant="outline">
                          <Link
                            to="/clientes/$clienteId"
                            params={{ clienteId: cliente.id }}
                            tabIndex={-1}
                          >
                            Ver perfil
                            <ChevronRight className="size-4" aria-hidden />
                          </Link>
                        </Button>
                        <BotaoExcluirCliente cliente={cliente} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex flex-col items-center justify-between gap-2 text-sm sm:flex-row">
            <span className="text-muted-foreground tabular">
              {paginaAtual * POR_PAGINA + 1}–
              {Math.min(lista.length, (paginaAtual + 1) * POR_PAGINA)} de {lista.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={paginaAtual === 0}
                onClick={() => setPagina(paginaAtual - 1)}
              >
                Anterior
              </Button>
              <span className="tabular text-muted-foreground">
                Página {paginaAtual + 1} de {totalPaginas}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={paginaAtual >= totalPaginas - 1}
                onClick={() => setPagina(paginaAtual + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
