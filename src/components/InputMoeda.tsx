/**
 * Campo de valor em reais usado em TODO o sistema: mostra "R$" à esquerda e
 * formata no padrão 99.999,99 enquanto o usuário digita. Não é preciso
 * digitar o ponto de milhar; a vírgula separa os centavos e, ao sair do
 * campo, os centavos são completados (9.999 → 9.999,00).
 *
 * O valor entregue ao formulário é o texto formatado ("1.250,00"); converta
 * com `parseBRL` ao salvar (já é o que os formulários fazem).
 */
import { forwardRef, useRef, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { colarMoeda, completarCentavos, mascararMoeda, posicaoCursorMoeda } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface InputMoedaProps extends Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type" | "inputMode"
> {
  value: string;
  onChange: (valor: string) => void;
}

export const InputMoeda = forwardRef<HTMLInputElement, InputMoedaProps>(function InputMoeda(
  { value, onChange, onBlur, onPaste, className, placeholder = "0,00", ...props },
  ref,
) {
  const interno = useRef<HTMLInputElement | null>(null);

  function atribuirRef(el: HTMLInputElement | null) {
    interno.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  }

  function aplicar(el: HTMLInputElement, bruto: string) {
    const cursor = el.selectionStart ?? bruto.length;
    const antes = bruto.slice(0, cursor);
    const digitosAntes = antes.replace(/\D/g, "").length;
    const depoisDaVirgula = antes.includes(",");
    const formatado = mascararMoeda(bruto);
    onChange(formatado);
    // Reposiciona o cursor depois que o React atualizar o campo.
    requestAnimationFrame(() => {
      const alvo = interno.current;
      if (!alvo || document.activeElement !== alvo) return;
      const pos = posicaoCursorMoeda(formatado, digitosAntes, depoisDaVirgula);
      alvo.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="relative">
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
        aria-hidden
      >
        R$
      </span>
      <Input
        {...props}
        ref={atribuirRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={mascararMoeda(value)}
        onChange={(e) => aplicar(e.currentTarget, e.currentTarget.value)}
        onPaste={(e) => {
          onPaste?.(e);
          if (e.defaultPrevented) return;
          const texto = e.clipboardData.getData("text");
          if (!texto) return;
          e.preventDefault();
          onChange(colarMoeda(texto));
        }}
        onBlur={(e) => {
          const completo = completarCentavos(value);
          if (completo !== value) onChange(completo);
          onBlur?.(e);
        }}
        className={cn("pl-10 tabular", className)}
      />
    </div>
  );
});
