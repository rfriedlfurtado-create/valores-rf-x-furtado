-- Suporte a mapeamento de colunas na importação: CPF, valor e data
-- originais de cada linha importada (além do nome). Aditivo, não
-- afeta dados existentes.

ALTER TABLE public.clientes_importados
  ADD COLUMN IF NOT EXISTS cpf_original TEXT,
  ADD COLUMN IF NOT EXISTS valor_original NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS data_original DATE;

CREATE INDEX IF NOT EXISTS idx_ci_cpf ON public.clientes_importados (cpf_original) WHERE cpf_original IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_cpf ON public.clientes (cpf) WHERE cpf IS NOT NULL;
