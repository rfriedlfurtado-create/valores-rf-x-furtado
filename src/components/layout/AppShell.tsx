import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  FileSearch,
  History,
  LayoutDashboard,
  Menu,
  Receipt,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ItemMenu {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const ITENS_MENU: ItemMenu[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/ja-pagos", label: "Já pagos", icon: Wallet },
  { to: "/pagamentos", label: "Histórico de pagamentos", icon: Receipt },
  { to: "/analise", label: "Análise de nomes", icon: FileSearch },
  { to: "/importacoes", label: "Histórico de importações", icon: History },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

function NavItens({ onNavegar }: { onNavegar?: () => void }) {
  const caminho = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav className="flex flex-col gap-1 px-3">
      {ITENS_MENU.map((item) => {
        const ativo = item.to === "/" ? caminho === "/" : caminho.startsWith(item.to);
        const Icone = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={onNavegar}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              ativo &&
                "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_0_var(--sidebar-primary)]",
            )}
          >
            <Icone className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Marca() {
  return (
    <div className="flex items-center gap-3 px-6 py-6">
      <div className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
        <BarChart3 className="size-5" aria-hidden />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-bold tracking-tight text-sidebar-accent-foreground">
          Base de Pagamentos
        </p>
        <p className="text-xs text-sidebar-foreground/60">Controle de clientes</p>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const caminho = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    setAberto(false);
  }, [caminho]);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <Marca />
        <NavItens />
        <div className="mt-auto px-6 py-5 text-xs text-sidebar-foreground/50">
          Nomes semelhantes geram apenas alertas. A união de clientes é sempre manual.
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur lg:hidden">
          <Sheet open={aberto} onOpenChange={setAberto}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Abrir menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0">
              <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
              <Marca />
              <NavItens onNavegar={() => setAberto(false)} />
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold">Base de Pagamentos</span>
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{titulo}</h1>
        {descricao ? <p className="mt-1 text-sm text-muted-foreground">{descricao}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function SecaoVazia({
  titulo,
  descricao,
  ...rest
}: ComponentProps<"div"> & {
  titulo: string;
  descricao?: string;
}) {
  return (
    <div
      {...rest}
      className={cn(
        "rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center",
        rest.className,
      )}
    >
      <p className="text-sm font-semibold text-foreground">{titulo}</p>
      {descricao ? <p className="mt-1 text-sm text-muted-foreground">{descricao}</p> : null}
    </div>
  );
}
