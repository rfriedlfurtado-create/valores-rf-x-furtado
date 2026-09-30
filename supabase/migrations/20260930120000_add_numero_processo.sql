-- Modelo Documento (ATLAS_CLIENTES_V1): número do processo do cliente.
-- Aditivo e idempotente — não altera dados existentes nem a constraint de status.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS numero_processo TEXT;

CREATE INDEX IF NOT EXISTS idx_clientes_numero_processo
  ON public.clientes (numero_processo) WHERE numero_processo IS NOT NULL;
