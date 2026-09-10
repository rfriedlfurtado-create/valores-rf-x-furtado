import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Save, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { BadgeSimilaridade } from "@/components/BadgeSimilaridade";
import { PageHeader } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { useSistema } from "@/hooks/useSistema";
import { salvarLimiares } from "@/lib/acoes";
import { compararNomes, normalizarNome, type LimiaresSimilaridade } from "@/lib/similarity";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Base de Pagamentos" },
      {
        name: "description",
        content:
          "Ajuste os limiares de similaridade usados para identificar correspondências entre nomes.",
      },
      { property: "og:title", content: "Configurações — Base de Pagamentos" },
      {
        property: "og:description",
        content: "Limiares de similaridade do motor de comparação de nomes.",
      },
    ],
  }),
  component: Configuracoes,
});

interface LinhaLimiar {
  chave: keyof LimiaresSimilaridade;
  titulo: string;
  descricao: string;
}

const LINHAS: LinhaLimiar[] = [
  {
    chave: "muito_parecido",
    titulo: "Muito parecido",
    descricao: "A partir deste percentual, a correspondência é classificada como MUITO PARECIDO.",
  },
  {
    chave: "possivel",
    titulo: "Possível correspondência",
    descricao: "A partir deste percentual, a correspondência é classificada como POSSÍVEL.",
  },
  {
    chave: "minimo",
    titulo: "Mínimo para gerar alerta",
    descricao: "Abaixo deste percentual, a correspondência é descartada e nem aparece como alerta.",
  },
];

function validar(limiares: LimiaresSimilaridade): string | null {
  if (limiares.minimo < 0 || limiares.igual > 100)
    return "Os percentuais devem ficar entre 0 e 100.";
  if (!(
    limiares.minimo <= limiares.possivel &&
    limiares.possivel <= limiares.muito_parecido &&
    limiares.muito_parecido <= limiares.igual
  )) {
    return "A ordem precisa ser: mínimo ≤ possível ≤ muito parecido ≤ igual (100).";
  }
  return null;
}

function Testador({ limiares }: { limiares: LimiaresSimilaridade }) {
  const [nomeA, setNomeA] = useState("CARLOS ALBERTO SOUZA");
  const [nomeB, setNomeB] = useState("CARLOS ALBERTO DE SOUZA");

  const resultado = useMemo(() => {
    if (!nomeA.trim() || !nomeB.trim()) return null;
    return compararNomes(normalizarNome(nomeA), normalizarNome(nomeB), limiares);
  }, [nomeA, nomeB, limiares]);

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold text-foreground">Testar comparação</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Compare dois nomes com os limiares atuais (mesmo antes de salvar) para conferir o resultado.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="teste-nome-a">Nome A</Label>
          <Input id="teste-nome-a" value={nomeA} onChange={(e) => setNomeA(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="teste-nome-b">Nome B</Label>
          <Input id="teste-nome-b" value={nomeB} onChange={(e) => setNomeB(e.target.value)} />
        </div>
      </div>
      {resultado ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <span className="text-lg font-bold tabular">{resultado.percentual.toFixed(2)}%</span>
          {resultado.classificacao ? (
            <BadgeSimilaridade classificacao={resultado.classificacao} />
          ) : (
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Abaixo do mínimo — descartado
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Levenshtein {resultado.detalhes.levenshtein.toFixed(0)}% · Jaro-Winkler{" "}
            {resultado.detalhes.jaroWinkler.toFixed(0)}% · Tokens{" "}
            {resultado.detalhes.tokens.toFixed(0)}%
          </span>
        </div>
      ) : null}
    </Card>
  );
}

function Configuracoes() {
  const { limiares, carregando } = useSistema();
  const queryClient = useQueryClient();
  const [rascunho, setRascunho] = useState<LimiaresSimilaridade | null>(null);

  useEffect(() => {
    if (limiares && !rascunho) setRascunho(limiares);
  }, [limiares, rascunho]);

  const erroValidacao = rascunho ? validar(rascunho) : null;
  const alterado = rascunho && limiares && JSON.stringify(rascunho) !== JSON.stringify(limiares);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!rascunho) return;
      const erro = validar(rascunho);
      if (erro) throw new Error(erro);
      await salvarLimiares(rascunho);
    },
    onSuccess: async () => {
      toast.success("Limiares salvos. Novas importações já usam os novos valores.");
      await queryClient.invalidateQueries({ queryKey: ["configuracoes"] });
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  if (carregando || !rascunho) {
    return (
      <div className="space-y-4">
        <PageHeader titulo="Configurações" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        titulo="Configurações"
        descricao="Ajuste os limiares que definem quando dois nomes são considerados parecidos. Isso afeta apenas novas importações — correspondências já geradas não são recalculadas."
      >
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !alterado || !!erroValidacao}
        >
          <Save className="size-4" aria-hidden />
          {mutation.isPending ? "Salvando..." : "Salvar alterações"}
        </Button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card className="gap-6 p-5">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold text-foreground">Limiares de similaridade</p>
          </div>

          {LINHAS.map((linha) => (
            <div key={linha.chave} className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>{linha.titulo}</Label>
                <span className="tabular text-sm font-semibold">{rascunho[linha.chave]}%</span>
              </div>
              <Slider
                value={[rascunho[linha.chave]]}
                min={0}
                max={100}
                step={1}
                onValueChange={([valor]) =>
                  setRascunho((atual) => (atual ? { ...atual, [linha.chave]: valor } : atual))
                }
              />
              <p className="text-xs text-muted-foreground">{linha.descricao}</p>
            </div>
          ))}

          <div className="grid gap-2 rounded-lg border border-dashed border-border px-3 py-3">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">Igual (fixo em 100%)</Label>
              <span className="tabular text-sm font-semibold text-muted-foreground">100%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Correspondência exata sempre é classificada como IGUAL — este valor não é editável.
            </p>
          </div>

          {erroValidacao ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
              {erroValidacao}
            </p>
          ) : null}
        </Card>

        <Testador limiares={rascunho} />
      </div>
    </div>
  );
}
