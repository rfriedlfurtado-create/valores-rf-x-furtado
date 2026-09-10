CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  cpf TEXT,
  observacoes TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo','arquivado')),
  origem_importacao TEXT,
  data_importacao TIMESTAMPTZ,
  arquivado BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_clientes_nome_norm ON public.clientes (nome_normalizado);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO anon, authenticated;
GRANT ALL ON public.clientes TO service_role;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clientes_open" ON public.clientes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_clientes_updated BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.variacoes_nome (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome_variacao TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_variacoes_cliente ON public.variacoes_nome (cliente_id);
CREATE INDEX idx_variacoes_norm ON public.variacoes_nome (nome_normalizado);
CREATE UNIQUE INDEX idx_variacoes_unica ON public.variacoes_nome (cliente_id, nome_normalizado);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.variacoes_nome TO anon, authenticated;
GRANT ALL ON public.variacoes_nome TO service_role;
ALTER TABLE public.variacoes_nome ENABLE ROW LEVEL SECURITY;
CREATE POLICY "variacoes_open" ON public.variacoes_nome FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.pagamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  valor NUMERIC(14,2) NOT NULL CHECK (valor >= 0),
  data_pagamento DATE NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'outro' CHECK (tipo IN ('pix','transferencia','dinheiro','cheque','boleto','outro')),
  observacao TEXT,
  usuario_cadastro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pagamentos_cliente ON public.pagamentos (cliente_id);
CREATE INDEX idx_pagamentos_data ON public.pagamentos (data_pagamento DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagamentos TO anon, authenticated;
GRANT ALL ON public.pagamentos TO service_role;
ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pagamentos_open" ON public.pagamentos FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_pagamentos_updated BEFORE UPDATE ON public.pagamentos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.importacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_importacao TEXT NOT NULL,
  origem_arquivo TEXT,
  tipo_origem TEXT NOT NULL DEFAULT 'manual' CHECK (tipo_origem IN ('arquivo','manual')),
  quantidade_clientes INTEGER NOT NULL DEFAULT 0,
  quantidade_correspondencias INTEGER NOT NULL DEFAULT 0,
  quantidade_ja_pagos INTEGER NOT NULL DEFAULT 0,
  quantidade_possiveis INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.importacoes TO anon, authenticated;
GRANT ALL ON public.importacoes TO service_role;
ALTER TABLE public.importacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "importacoes_open" ON public.importacoes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.clientes_importados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID NOT NULL REFERENCES public.importacoes(id) ON DELETE CASCADE,
  nome_original TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  cliente_vinculado_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  status_analise TEXT NOT NULL DEFAULT 'pendente' CHECK (status_analise IN ('pendente','sem_correspondencia','ja_pago','confirmado','rejeitado','analisar_depois')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ci_importacao ON public.clientes_importados (importacao_id);
CREATE INDEX idx_ci_status ON public.clientes_importados (status_analise);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes_importados TO anon, authenticated;
GRANT ALL ON public.clientes_importados TO service_role;
ALTER TABLE public.clientes_importados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ci_open" ON public.clientes_importados FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.correspondencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_importado_id UUID NOT NULL REFERENCES public.clientes_importados(id) ON DELETE CASCADE,
  cliente_encontrado_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  percentual_similaridade NUMERIC(5,2) NOT NULL,
  classificacao TEXT NOT NULL CHECK (classificacao IN ('igual','muito_parecido','possivel')),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','rejeitado','analisar_depois')),
  possui_pagamento BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_corr_importado ON public.correspondencias (cliente_importado_id);
CREATE INDEX idx_corr_encontrado ON public.correspondencias (cliente_encontrado_id);
CREATE INDEX idx_corr_status ON public.correspondencias (status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.correspondencias TO anon, authenticated;
GRANT ALL ON public.correspondencias TO service_role;
ALTER TABLE public.correspondencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corr_open" ON public.correspondencias FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_corr_updated BEFORE UPDATE ON public.correspondencias FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.correspondencias_rejeitadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_1_normalizado TEXT NOT NULL,
  nome_2_normalizado TEXT NOT NULL,
  data_rejeicao TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_rejeitadas_par ON public.correspondencias_rejeitadas (nome_1_normalizado, nome_2_normalizado);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.correspondencias_rejeitadas TO anon, authenticated;
GRANT ALL ON public.correspondencias_rejeitadas TO service_role;
ALTER TABLE public.correspondencias_rejeitadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rejeitadas_open" ON public.correspondencias_rejeitadas FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.configuracoes (
  chave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.configuracoes TO anon, authenticated;
GRANT ALL ON public.configuracoes TO service_role;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_open" ON public.configuracoes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_config_updated BEFORE UPDATE ON public.configuracoes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.configuracoes (chave, valor) VALUES
  ('similaridade', '{"igual":100,"muito_parecido":90,"possivel":75,"minimo":60}'::jsonb);
