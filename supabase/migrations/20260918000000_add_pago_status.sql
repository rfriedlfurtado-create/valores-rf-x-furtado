-- Adiciona 'pago' como valor válido para o campo status de clientes
ALTER TABLE public.clientes
  DROP CONSTRAINT clientes_status_check;

ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_status_check
  CHECK (status IN ('ativo', 'inativo', 'arquivado', 'pago'));
