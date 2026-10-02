/**
 * Escritório de origem: filtro global e identificação visual.
 *
 *  - `clientes.escritorio_origem`: quem originou o cadastro
 *    ('furtado' | 'ricardo_friedl' | 'a_confirmar'). Cadastros antigos sem
 *    origem comprovada ficam 'a_confirmar'.
 *  - `cliente_escritorios`: vínculos — uma pessoa pode ter atendimentos
 *    pelos dois escritórios sem que a origem anterior seja alterada.
 *
 * A origem NUNCA define quem tem direito a honorários nem percentuais.
 */

import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { vinculosEscritorioQuery } from "@/lib/furtado/consultas";
import { ROTULO_ESCRITORIO, type EscritorioOrigem } from "@/lib/furtado/modelo";
import { cn } from "@/lib/utils";

export type FiltroEscritorio = "todos" | EscritorioOrigem;

export const OPCOES_FILTRO_ESCRITORIO: { value: FiltroEscritorio; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "furtado", label: ROTULO_ESCRITORIO.furtado },
  { value: "ricardo_friedl", label: ROTULO_ESCRITORIO.ricardo_friedl },
  { value: "a_confirmar", label: ROTULO_ESCRITORIO.a_confirmar },
];

const CHAVE = "filtro-escritorio";

interface ContextoFiltro {
  filtro: FiltroEscritorio;
  setFiltro: (f: FiltroEscritorio) => void;
}

const Ctx = createContext<ContextoFiltro>({ filtro: "todos", setFiltro: () => undefined });

export function FiltroEscritorioProvider({ children }: { children: ReactNode }) {
  const [filtro, setFiltroEstado] = useState<FiltroEscritorio>(() => {
    try {
      if (typeof window === "undefined") return "todos";
      const v = window.localStorage.getItem(CHAVE) as FiltroEscritorio | null;
      return v && OPCOES_FILTRO_ESCRITORIO.some((o) => o.value === v) ? v : "todos";
    } catch {
      return "todos";
    }
  });
  const setFiltro = useCallback((f: FiltroEscritorio) => {
    setFiltroEstado(f);
    try {
      window.localStorage.setItem(CHAVE, f);
    } catch {
      /* armazenamento indisponível: o filtro vale só nesta sessão */
    }
  }, []);
  return <Ctx.Provider value={{ filtro, setFiltro }}>{children}</Ctx.Provider>;
}

export function useFiltroEscritorio(): ContextoFiltro {
  return useContext(Ctx);
}

/** Vínculos por cliente (Set de escritórios), a partir de cliente_escritorios. */
export function useVinculosEscritorio(): Map<string, Set<"furtado" | "ricardo_friedl">> {
  const { data } = useQuery(vinculosEscritorioQuery());
  return useMemo(() => {
    const mapa = new Map<string, Set<"furtado" | "ricardo_friedl">>();
    for (const v of data ?? []) {
      const s = mapa.get(v.cliente_id) ?? new Set();
      s.add(v.escritorio);
      mapa.set(v.cliente_id, s);
    }
    return mapa;
  }, [data]);
}

export interface ClienteComOrigem {
  id: string;
  escritorio_origem?: string | null;
}

/** Escritórios relacionados ao cliente (origem + vínculos), sem repetição. */
export function escritoriosDoCliente(
  cliente: ClienteComOrigem,
  vinculos: Map<string, Set<"furtado" | "ricardo_friedl">>,
): EscritorioOrigem[] {
  const out = new Set<EscritorioOrigem>();
  const origem = (cliente.escritorio_origem ?? "a_confirmar") as EscritorioOrigem;
  out.add(origem);
  for (const v of vinculos.get(cliente.id) ?? []) out.add(v);
  return [...out];
}

/**
 * Regra do filtro para CLIENTES: o cliente aparece no escritório de origem e
 * nos escritórios com que tem vínculo; em "Origem a confirmar", aparece quem
 * ainda não teve a origem comprovada. Em "Todos" cada pessoa conta uma vez.
 */
export function clientePassaFiltro(
  cliente: ClienteComOrigem,
  filtro: FiltroEscritorio,
  vinculos: Map<string, Set<"furtado" | "ricardo_friedl">>,
): boolean {
  if (filtro === "todos") return true;
  const origem = cliente.escritorio_origem ?? "a_confirmar";
  if (filtro === "a_confirmar") return origem === "a_confirmar";
  return origem === filtro || (vinculos.get(cliente.id)?.has(filtro) ?? false);
}

/** Regra do filtro para REGISTROS (atendimento, cobrança, lançamento...). */
export function registroPassaFiltro(
  escritorio: string | null | undefined,
  filtro: FiltroEscritorio,
): boolean {
  if (filtro === "todos") return true;
  return (escritorio ?? "a_confirmar") === filtro;
}

const ESTILO: Record<EscritorioOrigem, string> = {
  furtado:
    "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200",
  ricardo_friedl:
    "border-violet-300/70 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-200",
  a_confirmar: "border-border bg-muted text-muted-foreground",
};

const CURTO: Record<EscritorioOrigem, string> = {
  furtado: "Furtado",
  ricardo_friedl: "Ricardo Friedl",
  a_confirmar: "Origem a confirmar",
};

/** Identificação visual discreta do escritório. */
export function BadgeEscritorio({
  escritorio,
  className,
  completo = false,
}: {
  escritorio: string | null | undefined;
  className?: string;
  completo?: boolean;
}) {
  const e = (escritorio ?? "a_confirmar") as EscritorioOrigem;
  return (
    <span
      title={ROTULO_ESCRITORIO[e]}
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        ESTILO[e],
        className,
      )}
    >
      {completo ? ROTULO_ESCRITORIO[e] : CURTO[e]}
    </span>
  );
}
