-- =====================================================================
-- Importação por escritório + importador da planilha Furtado Advogados
--
-- 1. Origem por escritório:
--      clientes.escritorio_origem  ('furtado' | 'ricardo_friedl' | 'a_confirmar')
--      cliente_escritorios         vínculos (uma pessoa pode ter os dois)
--    Cadastros antigos ficam 'a_confirmar' (origem não comprovada).
--    A origem NÃO determina honorários nem percentual de repasse.
-- 2. Lotes de importação com rastreabilidade célula a célula:
--      import_lotes, import_celulas, import_blocos, import_pessoas,
--      import_pendencias, import_alteracoes (registro para desfazer).
-- 3. Entidades do perfil do cliente:
--      atendimentos, beneficios, lancamentos_financeiros, requisicoes,
--      acordos, cobrancas, parcelas, recebimento_parcelas,
--      dados_bancarios, representantes, historico_cliente.
-- 4. RPCs transacionais: aplicar_pessoas_lote, desfazer_lote,
--    mesclar_atendimentos, registrar_recebimento_importado,
--    atualizar_campo_importado; Ricardo Friedl (Modelo Documento) passa a
--    gravar a origem 'ricardo_friedl'.
--
-- Aditiva e idempotente. Mantém o modelo de acesso existente (RLS aberto
-- para anon/authenticated, igual às demais tabelas do sistema).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Escritório de origem
-- ---------------------------------------------------------------------
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS escritorio_origem TEXT NOT NULL DEFAULT 'a_confirmar';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clientes_escritorio_origem_check') THEN
    ALTER TABLE public.clientes
      ADD CONSTRAINT clientes_escritorio_origem_check
      CHECK (escritorio_origem IN ('furtado', 'ricardo_friedl', 'a_confirmar'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_clientes_escritorio ON public.clientes (escritorio_origem);

ALTER TABLE public.importacoes
  ADD COLUMN IF NOT EXISTS escritorio TEXT,
  ADD COLUMN IF NOT EXISTS modelo TEXT;

CREATE TABLE IF NOT EXISTS public.cliente_escritorios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  escritorio TEXT NOT NULL CHECK (escritorio IN ('furtado', 'ricardo_friedl')),
  lote_id UUID,
  importacao_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, escritorio)
);

-- ---------------------------------------------------------------------
-- 2. Lotes de importação
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_lotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escritorio TEXT NOT NULL CHECK (escritorio IN ('furtado', 'ricardo_friedl')),
  modelo TEXT NOT NULL,
  arquivo_nome TEXT NOT NULL,
  arquivo_hash TEXT,
  arquivo_tamanho BIGINT,
  arquivo_path TEXT,
  status TEXT NOT NULL DEFAULT 'gravando' CHECK (status IN (
    'gravando', 'gravado_com_pendencias', 'concluido', 'falhou', 'desfeito', 'desfeito_parcial')),
  etapa TEXT,
  progresso INTEGER NOT NULL DEFAULT 0,
  total_pessoas INTEGER NOT NULL DEFAULT 0,
  pessoas_aplicadas INTEGER NOT NULL DEFAULT 0,
  resumo JSONB NOT NULL DEFAULT '{}'::jsonb,
  totais JSONB NOT NULL DEFAULT '[]'::jsonb,
  abas JSONB NOT NULL DEFAULT '[]'::jsonb,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  concluido_em TIMESTAMPTZ,
  desfeito_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_import_lotes_hash ON public.import_lotes (arquivo_hash);

CREATE TABLE IF NOT EXISTS public.import_blocos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES public.import_lotes(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  aba TEXT NOT NULL,
  intervalo TEXT,
  tipo TEXT NOT NULL,
  nome_original TEXT,
  nome_detectado TEXT,
  pessoa_ref TEXT,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  dados JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lote_id, ref)
);
CREATE INDEX IF NOT EXISTS idx_import_blocos_cliente ON public.import_blocos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_import_blocos_pessoa ON public.import_blocos (lote_id, pessoa_ref);

CREATE TABLE IF NOT EXISTS public.import_celulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES public.import_lotes(id) ON DELETE CASCADE,
  aba TEXT NOT NULL,
  celula TEXT NOT NULL,
  linha INTEGER NOT NULL,
  coluna INTEGER NOT NULL,
  valor_original TEXT,
  tipo TEXT,
  formula TEXT,
  resultado_armazenado TEXT,
  resultado_recalculado TEXT,
  formato TEXT,
  metadados JSONB NOT NULL DEFAULT '{}'::jsonb,
  bloco_ref TEXT,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  valor_interpretado JSONB,
  destino TEXT NOT NULL CHECK (destino IN (
    'campo', 'historico', 'informacao_adicional', 'resumo_arquivo', 'pendencia_revisao')),
  destino_ref TEXT,
  situacao TEXT NOT NULL DEFAULT 'interpretado' CHECK (situacao IN (
    'interpretado', 'incerto', 'pendente', 'resolvido', 'elemento_arquivo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lote_id, aba, celula)
);
CREATE INDEX IF NOT EXISTS idx_import_celulas_cliente ON public.import_celulas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_import_celulas_bloco ON public.import_celulas (lote_id, bloco_ref);

CREATE TABLE IF NOT EXISTS public.import_pessoas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES public.import_lotes(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  nome TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,
  acao TEXT NOT NULL CHECK (acao IN ('criar', 'vincular', 'pendente', 'ignorar')),
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aplicado', 'desfeito', 'ignorado')),
  motivo TEXT,
  candidatos JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resultado JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lote_id, ref)
);

CREATE TABLE IF NOT EXISTS public.import_pendencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id UUID NOT NULL REFERENCES public.import_lotes(id) ON DELETE CASCADE,
  pessoa_ref TEXT,
  bloco_ref TEXT,
  tipo TEXT NOT NULL,
  bloqueante BOOLEAN NOT NULL DEFAULT false,
  descricao TEXT NOT NULL,
  celulas TEXT[] NOT NULL DEFAULT '{}',
  dados JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'resolvida', 'ignorada')),
  resolucao JSONB,
  resolvido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_pendencias_lote ON public.import_pendencias (lote_id, status);

CREATE TABLE IF NOT EXISTS public.import_alteracoes (
  id BIGSERIAL PRIMARY KEY,
  lote_id UUID NOT NULL REFERENCES public.import_lotes(id) ON DELETE CASCADE,
  tabela TEXT NOT NULL,
  registro_id UUID NOT NULL,
  operacao TEXT NOT NULL CHECK (operacao IN ('insert', 'update')),
  antes JSONB,
  depois JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_import_alteracoes_lote ON public.import_alteracoes (lote_id);

-- ---------------------------------------------------------------------
-- 3. Entidades do perfil
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.atendimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  escritorio TEXT NOT NULL DEFAULT 'a_confirmar' CHECK (escritorio IN ('furtado', 'ricardo_friedl', 'a_confirmar')),
  numero_processo TEXT,
  processo_digitos TEXT,
  tribunal TEXT,
  natureza TEXT CHECK (natureza IS NULL OR natureza IN ('judicial', 'administrativo')),
  servico TEXT,
  beneficio TEXT,
  situacao TEXT,
  observacoes TEXT,
  parceria TEXT,
  origens JSONB NOT NULL DEFAULT '[]'::jsonb,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atendimentos_cliente ON public.atendimentos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_atendimentos_processo ON public.atendimentos (processo_digitos);

CREATE TABLE IF NOT EXISTS public.beneficios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  especie TEXT,
  especie_codigo TEXT,
  nb TEXT,
  nb_digitos TEXT,
  dib DATE, dib_texto TEXT,
  dib_origem_texto TEXT,
  dip DATE, dip_texto TEXT,
  dcb DATE, dcb_texto TEXT,
  rmi NUMERIC(14,2), rmi_texto TEXT,
  rma NUMERIC(14,2), rma_texto TEXT,
  previsao_pagamento_texto TEXT,
  transito_julgado DATE, transito_texto TEXT,
  data_requerimento_texto TEXT,
  data_concessao_texto TEXT,
  prorrogacao_texto TEXT,
  revisao_texto TEXT,
  implantacao_texto TEXT,
  atrasados_texto TEXT,
  honorarios_regra TEXT,
  comunicacao_texto TEXT,
  historico JSONB NOT NULL DEFAULT '[]'::jsonb,
  origens JSONB NOT NULL DEFAULT '[]'::jsonb,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_beneficios_cliente ON public.beneficios (cliente_id);
CREATE INDEX IF NOT EXISTS idx_beneficios_nb ON public.beneficios (nb_digitos);

CREATE TABLE IF NOT EXISTS public.lancamentos_financeiros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  categoria TEXT NOT NULL CHECK (categoria IN (
    'valor_total', 'atrasados', 'valor_cliente', 'repasse_cliente',
    'honorarios_contratuais', 'honorarios_implantacao', 'honorarios_sucumbenciais',
    'honorarios_execucao', 'honorarios_tutela', 'honorarios_administrativos',
    'outros_honorarios', 'calculo_inss', 'valor_a_receber', 'ajuste')),
  natureza TEXT NOT NULL DEFAULT 'devido' CHECK (natureza IN ('previsto', 'devido', 'informativo', 'recebido')),
  valor NUMERIC(14,2),
  valor_texto TEXT,
  percentual NUMERIC(9,4),
  base_calculo TEXT,
  quantidade_beneficios NUMERIC(9,2),
  ausencia_declarada TEXT,
  rotulo_original TEXT,
  versao INTEGER NOT NULL DEFAULT 1,
  coluna TEXT,
  data_referencia_texto TEXT,
  situacao_texto TEXT,
  observacao TEXT,
  origens JSONB NOT NULL DEFAULT '[]'::jsonb,
  pagamento_id UUID REFERENCES public.pagamentos(id) ON DELETE SET NULL,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lancamentos_cliente ON public.lancamentos_financeiros (cliente_id);

CREATE TABLE IF NOT EXISTS public.requisicoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'nao_definido' CHECK (tipo IN ('rpv', 'precatorio', 'ted', 'alvara', 'nao_definido')),
  numero_processo TEXT,
  expedicao_texto TEXT,
  ano_previsto INTEGER,
  previsao_texto TEXT,
  valor NUMERIC(14,2),
  valor_texto TEXT,
  tipo_valor TEXT,
  conta_indicada TEXT,
  titular TEXT,
  situacao TEXT,
  situacao_texto TEXT,
  data_texto TEXT,
  retificacao TEXT,
  venda BOOLEAN NOT NULL DEFAULT false,
  observacoes TEXT,
  origens JSONB NOT NULL DEFAULT '[]'::jsonb,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requisicoes_cliente ON public.requisicoes (cliente_id);

CREATE TABLE IF NOT EXISTS public.acordos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  numero_processo TEXT,
  aceitacao TEXT,
  aceitacao_texto TEXT,
  percentual NUMERIC(9,4),
  beneficio TEXT,
  dib DATE, dib_texto TEXT,
  dip DATE, dip_texto TEXT,
  dcb DATE, dcb_texto TEXT,
  dcb_prazo_dias INTEGER,
  sucumbencia_percentual NUMERIC(9,4),
  sucumbencia_texto TEXT,
  de_acordo_laudo TEXT,
  prorrogacao TEXT,
  reabilitacao TEXT,
  observacoes TEXT,
  origens JSONB NOT NULL DEFAULT '[]'::jsonb,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acordos_cliente ON public.acordos (cliente_id);

CREATE TABLE IF NOT EXISTS public.cobrancas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  escritorio TEXT NOT NULL DEFAULT 'a_confirmar' CHECK (escritorio IN ('furtado', 'ricardo_friedl', 'a_confirmar')),
  descricao TEXT,
  valor_contratado NUMERIC(14,2),
  entrada NUMERIC(14,2),
  quantidade_parcelas INTEGER,
  valor_parcela NUMERIC(14,2),
  vencimento_inicial DATE,
  vencimento_texto TEXT,
  situacao TEXT NOT NULL DEFAULT 'a_confirmar' CHECK (situacao IN ('pendente', 'parcial', 'quitada', 'a_confirmar')),
  responsavel TEXT,
  prestacao_contas TEXT,
  historico TEXT,
  divergencia TEXT,
  completar TEXT,
  origens JSONB NOT NULL DEFAULT '[]'::jsonb,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cobrancas_cliente ON public.cobrancas (cliente_id);

CREATE TABLE IF NOT EXISTS public.parcelas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cobranca_id UUID NOT NULL REFERENCES public.cobrancas(id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  valor NUMERIC(14,2) NOT NULL,
  vencimento DATE,
  vencimento_texto TEXT,
  situacao TEXT NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'paga', 'paga_parcial')),
  valor_pago NUMERIC(14,2) NOT NULL DEFAULT 0,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parcelas_cobranca ON public.parcelas (cobranca_id);

CREATE TABLE IF NOT EXISTS public.recebimento_parcelas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pagamento_id UUID NOT NULL REFERENCES public.pagamentos(id) ON DELETE CASCADE,
  parcela_id UUID NOT NULL REFERENCES public.parcelas(id) ON DELETE CASCADE,
  valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pagamento_id, parcela_id)
);

CREATE TABLE IF NOT EXISTS public.dados_bancarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  banco TEXT,
  agencia TEXT,
  conta TEXT,
  operacao TEXT,
  tipo_conta TEXT,
  titular TEXT,
  cpf_titular TEXT,
  texto_original TEXT NOT NULL,
  consistente BOOLEAN NOT NULL DEFAULT true,
  observacao TEXT,
  origens JSONB NOT NULL DEFAULT '[]'::jsonb,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.representantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome TEXT,
  relacao TEXT,
  texto_original TEXT NOT NULL,
  origens JSONB NOT NULL DEFAULT '[]'::jsonb,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.historico_cliente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  categoria TEXT NOT NULL DEFAULT 'observacao',
  texto TEXT NOT NULL,
  aba TEXT,
  celulas TEXT,
  data_texto TEXT,
  origens JSONB NOT NULL DEFAULT '[]'::jsonb,
  chave_origem TEXT NOT NULL UNIQUE,
  lote_id UUID REFERENCES public.import_lotes(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_historico_cliente ON public.historico_cliente (cliente_id);

-- Escritório responsável pelo registro (para filtros); não define honorários.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['beneficios','lancamentos_financeiros','requisicoes','acordos','historico_cliente'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS escritorio TEXT', t);
  END LOOP;
END $$;

-- Entradas recebidas (tabela existente `pagamentos`): vínculo opcional ao
-- atendimento/escritório e novas classificações por serviço.
ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escritorio TEXT;

ALTER TABLE public.pagamentos DROP CONSTRAINT IF EXISTS pagamentos_classificacao_check;
ALTER TABLE public.pagamentos
  ADD CONSTRAINT pagamentos_classificacao_check
  CHECK (classificacao IS NULL OR classificacao IN (
    'contratuais', 'atrasados', 'sucumbencia', 'implantacao', 'execucao', 'administrativos', 'outros'));

-- updated_at automático
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cliente_escritorios','import_lotes','import_pessoas','atendimentos','beneficios',
    'lancamentos_financeiros','requisicoes','acordos','cobrancas','parcelas','dados_bancarios',
    'representantes','historico_cliente'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
        'trg_' || t || '_updated', t);
    END IF;
  END LOOP;
END $$;

-- Permissões: mesmo modelo das tabelas existentes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cliente_escritorios','import_lotes','import_blocos','import_celulas','import_pessoas',
    'import_pendencias','import_alteracoes','atendimentos','beneficios','lancamentos_financeiros','requisicoes',
    'acordos','cobrancas','parcelas','recebimento_parcelas','dados_bancarios','representantes','historico_cliente'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_open') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t || '_open', t);
    END IF;
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.import_alteracoes_id_seq TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Funções auxiliares de gravação rastreada
-- ---------------------------------------------------------------------

-- Insere um registro importado (idempotente pela chave_origem) e registra a
-- alteração no lote. Retorna o id (novo ou já existente).
CREATE OR REPLACE FUNCTION public._inserir_importado(p_tabela text, p_obj jsonb, p_lote uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_obj jsonb;
  v_linha jsonb;
BEGIN
  IF p_tabela NOT IN ('atendimentos','beneficios','lancamentos_financeiros','requisicoes','acordos',
                      'cobrancas','parcelas','dados_bancarios','representantes','historico_cliente') THEN
    RAISE EXCEPTION 'Tabela não permitida: %', p_tabela;
  END IF;
  -- Valores padrão das colunas NOT NULL (jsonb_populate_record não aplica DEFAULT).
  v_obj := jsonb_build_object('id', gen_random_uuid(), 'created_at', now(), 'updated_at', now(),
                              'origens', '[]'::jsonb)
           || CASE p_tabela
                WHEN 'atendimentos' THEN jsonb_build_object('escritorio', 'a_confirmar')
                WHEN 'beneficios' THEN jsonb_build_object('historico', '[]'::jsonb)
                WHEN 'lancamentos_financeiros' THEN jsonb_build_object('natureza', 'devido', 'versao', 1)
                WHEN 'requisicoes' THEN jsonb_build_object('tipo', 'nao_definido', 'venda', false)
                WHEN 'cobrancas' THEN jsonb_build_object('situacao', 'a_confirmar', 'escritorio', 'a_confirmar')
                WHEN 'parcelas' THEN jsonb_build_object('situacao', 'aberta', 'valor_pago', 0)
                WHEN 'dados_bancarios' THEN jsonb_build_object('consistente', true)
                WHEN 'historico_cliente' THEN jsonb_build_object('categoria', 'observacao')
                ELSE '{}'::jsonb
              END
           || jsonb_strip_nulls(p_obj)
           || jsonb_build_object('lote_id', p_lote);

  EXECUTE format(
    'INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)
     ON CONFLICT (chave_origem) DO NOTHING RETURNING id, to_jsonb(%I.*)',
    p_tabela, p_tabela, p_tabela)
  USING v_obj INTO v_id, v_linha;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.import_alteracoes (lote_id, tabela, registro_id, operacao, depois)
    VALUES (p_lote, p_tabela, v_id, 'insert', v_linha);
    RETURN v_id;
  END IF;

  EXECUTE format('SELECT id FROM public.%I WHERE chave_origem = $1', p_tabela)
  USING v_obj->>'chave_origem' INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Aplicação de pessoas de um lote (transação por chamada)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aplicar_pessoas_lote(p_lote uuid, p_refs text[])
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_lote public.import_lotes%ROWTYPE;
  v_pessoa public.import_pessoas%ROWTYPE;
  v_p jsonb;
  v_cli uuid;
  v_antes jsonb;
  v_depois jsonb;
  v_item jsonb;
  v_sub jsonb;
  v_id uuid;
  v_cob uuid;
  v_aten jsonb;
  v_aten_id uuid;
  v_digitos text;
  v_cpf text;
  v_mapa jsonb;
  v_aplicadas integer := 0;
  v_ignoradas integer := 0;
  v_escritorio text;
  v_tab text;
BEGIN
  SELECT * INTO v_lote FROM public.import_lotes WHERE id = p_lote FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote de importação não encontrado.'; END IF;
  IF v_lote.status IN ('desfeito', 'desfeito_parcial') THEN
    RAISE EXCEPTION 'Este lote foi desfeito e não pode receber novas gravações.';
  END IF;
  v_escritorio := v_lote.escritorio;

  FOR v_pessoa IN
    SELECT * FROM public.import_pessoas
    WHERE lote_id = p_lote AND ref = ANY(p_refs)
    ORDER BY ref
    FOR UPDATE
  LOOP
    IF v_pessoa.status <> 'pendente' OR v_pessoa.acao NOT IN ('criar', 'vincular') THEN
      v_ignoradas := v_ignoradas + 1;
      CONTINUE;
    END IF;
    v_p := v_pessoa.payload;
    v_mapa := '{}'::jsonb;

    -- 5.1 Cliente
    IF v_pessoa.acao = 'criar' THEN
      v_cpf := nullif(v_p->'cliente'->>'cpf', '');
      INSERT INTO public.clientes
        (nome, nome_normalizado, cpf, numero_processo, status, origem_importacao, data_importacao, escritorio_origem)
      VALUES
        (v_pessoa.nome, v_pessoa.nome_normalizado, v_cpf, nullif(v_p->'cliente'->>'numero_processo', ''),
         'ativo', coalesce(v_p->'cliente'->>'origem_importacao', 'Importação ' || v_lote.arquivo_nome),
         now(), v_escritorio)
      RETURNING id, to_jsonb(clientes.*) INTO v_cli, v_depois;
      INSERT INTO public.import_alteracoes (lote_id, tabela, registro_id, operacao, depois)
      VALUES (p_lote, 'clientes', v_cli, 'insert', v_depois);
    ELSE
      v_cli := v_pessoa.cliente_id;
      SELECT to_jsonb(c.*) INTO v_antes FROM public.clientes c
      WHERE c.id = v_cli AND c.deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'O cliente escolhido para "%" não existe mais (ou está na lixeira). Revise a associação.', v_pessoa.nome;
      END IF;
      -- Complementa somente campos realmente vazios.
      v_cpf := nullif(v_p->'cliente'->>'cpf', '');
      IF v_cpf IS NOT NULL AND coalesce(v_antes->>'cpf', '') = '' THEN
        UPDATE public.clientes SET cpf = v_cpf WHERE id = v_cli;
        INSERT INTO public.import_alteracoes (lote_id, tabela, registro_id, operacao, antes, depois)
        VALUES (p_lote, 'clientes', v_cli, 'update', jsonb_build_object('cpf', v_antes->'cpf'), jsonb_build_object('cpf', v_cpf));
      END IF;
      IF nullif(v_p->'cliente'->>'numero_processo', '') IS NOT NULL AND coalesce(v_antes->>'numero_processo', '') = '' THEN
        UPDATE public.clientes SET numero_processo = v_p->'cliente'->>'numero_processo' WHERE id = v_cli;
        INSERT INTO public.import_alteracoes (lote_id, tabela, registro_id, operacao, antes, depois)
        VALUES (p_lote, 'clientes', v_cli, 'update',
                jsonb_build_object('numero_processo', v_antes->'numero_processo'),
                jsonb_build_object('numero_processo', v_p->'cliente'->>'numero_processo'));
      END IF;
    END IF;

    -- 5.2 Vínculo com o escritório (não altera a origem de cadastros anteriores)
    INSERT INTO public.cliente_escritorios (cliente_id, escritorio, lote_id)
    VALUES (v_cli, v_escritorio, p_lote)
    ON CONFLICT (cliente_id, escritorio) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      INSERT INTO public.import_alteracoes (lote_id, tabela, registro_id, operacao, depois)
      VALUES (p_lote, 'cliente_escritorios', v_id, 'insert', jsonb_build_object('cliente_id', v_cli, 'escritorio', v_escritorio));
    END IF;

    -- 5.3 Variações do nome (grafias encontradas na planilha)
    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_p->'variacoes', '[]'::jsonb)) LOOP
      INSERT INTO public.variacoes_nome (cliente_id, nome_variacao, nome_normalizado)
      VALUES (v_cli, v_item->>'nome', v_item->>'nome_normalizado')
      ON CONFLICT (cliente_id, nome_normalizado) DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN
        INSERT INTO public.import_alteracoes (lote_id, tabela, registro_id, operacao, depois)
        VALUES (p_lote, 'variacoes_nome', v_id, 'insert', jsonb_build_object('cliente_id', v_cli));
      END IF;
    END LOOP;

    -- 5.4 Atendimentos (reaproveita atendimento com o mesmo processo)
    FOR v_aten IN SELECT value FROM jsonb_array_elements(coalesce(v_p->'atendimentos', '[]'::jsonb)) LOOP
      v_aten_id := NULL;
      v_digitos := nullif(v_aten->>'processo_digitos', '');
      SELECT id INTO v_aten_id FROM public.atendimentos
      WHERE chave_origem = v_cli::text || '|' || (v_aten->>'chave');
      IF v_aten_id IS NULL AND v_digitos IS NOT NULL THEN
        SELECT id INTO v_aten_id FROM public.atendimentos
        WHERE cliente_id = v_cli AND processo_digitos = v_digitos AND deleted_at IS NULL
        ORDER BY created_at LIMIT 1;
      END IF;
      IF v_aten_id IS NULL THEN
        v_aten_id := public._inserir_importado('atendimentos',
          (v_aten - 'chave') || jsonb_build_object('cliente_id', v_cli, 'escritorio', v_escritorio,
                                                    'chave_origem', v_cli::text || '|' || (v_aten->>'chave')),
          p_lote);
      END IF;
      v_mapa := v_mapa || jsonb_build_object(v_aten->>'chave', v_aten_id);
    END LOOP;

    -- 5.5 Demais entidades
    FOREACH v_tab IN ARRAY ARRAY['beneficios','lancamentos_financeiros','requisicoes','acordos',
                                 'dados_bancarios','representantes','historico_cliente'] LOOP
      FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_p->v_tab, '[]'::jsonb)) LOOP
        PERFORM public._inserir_importado(v_tab,
          (v_item - 'chave' - 'atendimento_chave')
          || jsonb_build_object(
               'cliente_id', v_cli,
               'atendimento_id', v_mapa->>(v_item->>'atendimento_chave'),
               'chave_origem', v_cli::text || '|' || (v_item->>'chave'))
          || CASE WHEN v_tab IN ('beneficios','lancamentos_financeiros','requisicoes','acordos','historico_cliente')
                  THEN jsonb_build_object('escritorio', v_escritorio) ELSE '{}'::jsonb END,
          p_lote);
      END LOOP;
    END LOOP;

    -- 5.6 Cobranças e parcelas
    FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_p->'cobrancas', '[]'::jsonb)) LOOP
      v_cob := public._inserir_importado('cobrancas',
        (v_item - 'chave' - 'atendimento_chave' - 'parcelas')
        || jsonb_build_object(
             'cliente_id', v_cli,
             'escritorio', v_escritorio,
             'atendimento_id', v_mapa->>(v_item->>'atendimento_chave'),
             'chave_origem', v_cli::text || '|' || (v_item->>'chave')),
        p_lote);
      FOR v_sub IN SELECT value FROM jsonb_array_elements(coalesce(v_item->'parcelas', '[]'::jsonb)) LOOP
        PERFORM public._inserir_importado('parcelas',
          (v_sub - 'chave') || jsonb_build_object(
            'cobranca_id', v_cob, 'cliente_id', v_cli,
            'chave_origem', v_cli::text || '|' || (v_sub->>'chave')),
          p_lote);
      END LOOP;
    END LOOP;

    -- 5.7 Rastreabilidade: blocos e células passam a apontar para o cliente
    UPDATE public.import_blocos SET cliente_id = v_cli, status = 'aplicado'
    WHERE lote_id = p_lote AND pessoa_ref = v_pessoa.ref;
    UPDATE public.import_celulas c SET cliente_id = v_cli
    FROM public.import_blocos b
    WHERE b.lote_id = p_lote AND b.pessoa_ref = v_pessoa.ref
      AND c.lote_id = p_lote AND c.bloco_ref = b.ref;

    UPDATE public.import_pessoas
    SET status = 'aplicado', cliente_id = v_cli,
        resultado = jsonb_build_object('cliente_id', v_cli, 'aplicado_em', now())
    WHERE id = v_pessoa.id;
    v_aplicadas := v_aplicadas + 1;
  END LOOP;

  UPDATE public.import_lotes l SET
    pessoas_aplicadas = (SELECT count(*) FROM public.import_pessoas p WHERE p.lote_id = l.id AND p.status = 'aplicado'),
    status = CASE
      WHEN EXISTS (SELECT 1 FROM public.import_pessoas p WHERE p.lote_id = l.id AND p.status = 'pendente')
        OR EXISTS (SELECT 1 FROM public.import_pendencias d WHERE d.lote_id = l.id AND d.status = 'aberta')
      THEN 'gravado_com_pendencias' ELSE 'concluido' END
  WHERE l.id = p_lote;

  RETURN jsonb_build_object('aplicadas', v_aplicadas, 'ignoradas', v_ignoradas);
END;
$$;

-- Estatísticas atualizadas após a carga do lote (evita planos lentos logo
-- depois de inserir milhares de células).
CREATE OR REPLACE FUNCTION public.preparar_lote_importacao(p_lote uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.import_lotes WHERE id = p_lote;
  ANALYZE public.import_celulas;
  ANALYZE public.import_blocos;
  ANALYZE public.import_pessoas;
END;
$$;
GRANT EXECUTE ON FUNCTION public.preparar_lote_importacao(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Desfazer um lote (somente os efeitos do próprio lote)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.desfazer_lote(p_lote uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r public.import_alteracoes%ROWTYPE;
  v_atual jsonb;
  v_col text;
  v_removidos integer := 0;
  v_revertidos integer := 0;
  v_preservados jsonb := '[]'::jsonb;
  v_ignorar text[] := ARRAY['updated_at'];
  v_tem_ref boolean;
BEGIN
  PERFORM 1 FROM public.import_lotes WHERE id = p_lote FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lote não encontrado.'; END IF;

  FOR r IN SELECT * FROM public.import_alteracoes WHERE lote_id = p_lote ORDER BY id DESC LOOP
    EXECUTE format('SELECT to_jsonb(t.*) FROM public.%I t WHERE id = $1', r.tabela)
    USING r.registro_id INTO v_atual;
    IF v_atual IS NULL THEN CONTINUE; END IF;

    IF r.operacao = 'insert' THEN
      -- Alterado depois por outra pessoa? Preserva.
      IF r.tabela NOT IN ('cliente_escritorios', 'variacoes_nome') THEN
        IF (v_atual - v_ignorar) IS DISTINCT FROM (r.depois - v_ignorar) THEN
          v_preservados := v_preservados || jsonb_build_object('tabela', r.tabela, 'id', r.registro_id,
            'motivo', 'registro alterado após a importação');
          CONTINUE;
        END IF;
      END IF;
      IF r.tabela = 'clientes' THEN
        -- Só remove o cliente criado pelo lote se nada mais depender dele.
        SELECT EXISTS (SELECT 1 FROM public.pagamentos WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.atendimentos WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.beneficios WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.lancamentos_financeiros WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.requisicoes WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.acordos WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.cobrancas WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.historico_cliente WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.dados_bancarios WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.representantes WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.cliente_escritorios WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.variacoes_nome WHERE cliente_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.clientes_importados WHERE cliente_vinculado_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.correspondencias WHERE cliente_encontrado_id = r.registro_id)
            OR EXISTS (SELECT 1 FROM public.import_pessoas p WHERE p.cliente_id = r.registro_id AND p.lote_id <> p_lote AND p.status = 'aplicado')
        INTO v_tem_ref;
        IF v_tem_ref THEN
          v_preservados := v_preservados || jsonb_build_object('tabela', 'clientes', 'id', r.registro_id,
            'motivo', 'cliente possui dados de outras origens');
          CONTINUE;
        END IF;
      END IF;
      EXECUTE format('DELETE FROM public.%I WHERE id = $1', r.tabela) USING r.registro_id;
      v_removidos := v_removidos + 1;
    ELSE
      -- update: reverte apenas campos que continuam com o valor gravado pelo lote
      FOR v_col IN SELECT jsonb_object_keys(r.depois) LOOP
        IF (v_atual->v_col) IS NOT DISTINCT FROM (r.depois->v_col) THEN
          EXECUTE format(
            'UPDATE public.%1$I SET %2$I = (jsonb_populate_record(NULL::public.%1$I, $1)).%2$I WHERE id = $2',
            r.tabela, v_col)
          USING r.antes, r.registro_id;
          v_revertidos := v_revertidos + 1;
        ELSE
          v_preservados := v_preservados || jsonb_build_object('tabela', r.tabela, 'id', r.registro_id,
            'campo', v_col, 'motivo', 'campo alterado após a importação');
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  UPDATE public.import_pessoas SET status = 'desfeito' WHERE lote_id = p_lote AND status = 'aplicado';
  UPDATE public.import_blocos SET status = 'desfeito' WHERE lote_id = p_lote AND status = 'aplicado';
  UPDATE public.import_lotes SET
    status = CASE WHEN jsonb_array_length(v_preservados) > 0 THEN 'desfeito_parcial' ELSE 'desfeito' END,
    desfeito_em = now(),
    resumo = resumo || jsonb_build_object('desfazimento', jsonb_build_object(
      'removidos', v_removidos, 'revertidos', v_revertidos, 'preservados', v_preservados))
  WHERE id = p_lote;

  RETURN jsonb_build_object('removidos', v_removidos, 'revertidos', v_revertidos, 'preservados', v_preservados);
END;
$$;

-- ---------------------------------------------------------------------
-- 7. Mesclar atendimentos do mesmo cliente (ação manual no perfil)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mesclar_atendimentos(p_origem uuid, p_destino uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o public.atendimentos%ROWTYPE;
  d public.atendimentos%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.atendimentos WHERE id = p_origem FOR UPDATE;
  SELECT * INTO d FROM public.atendimentos WHERE id = p_destino FOR UPDATE;
  IF o.id IS NULL OR d.id IS NULL THEN RAISE EXCEPTION 'Atendimento não encontrado.'; END IF;
  IF o.cliente_id <> d.cliente_id THEN RAISE EXCEPTION 'Os atendimentos pertencem a clientes diferentes.'; END IF;
  IF o.processo_digitos IS NOT NULL AND d.processo_digitos IS NOT NULL AND o.processo_digitos <> d.processo_digitos THEN
    RAISE EXCEPTION 'Os atendimentos têm números de processo diferentes.';
  END IF;
  UPDATE public.beneficios SET atendimento_id = p_destino WHERE atendimento_id = p_origem;
  UPDATE public.lancamentos_financeiros SET atendimento_id = p_destino WHERE atendimento_id = p_origem;
  UPDATE public.requisicoes SET atendimento_id = p_destino WHERE atendimento_id = p_origem;
  UPDATE public.acordos SET atendimento_id = p_destino WHERE atendimento_id = p_origem;
  UPDATE public.cobrancas SET atendimento_id = p_destino WHERE atendimento_id = p_origem;
  UPDATE public.historico_cliente SET atendimento_id = p_destino WHERE atendimento_id = p_origem;
  UPDATE public.pagamentos SET atendimento_id = p_destino WHERE atendimento_id = p_origem;
  UPDATE public.atendimentos SET
    numero_processo = coalesce(d.numero_processo, o.numero_processo),
    processo_digitos = coalesce(d.processo_digitos, o.processo_digitos),
    tribunal = coalesce(d.tribunal, o.tribunal),
    natureza = coalesce(d.natureza, o.natureza),
    origens = d.origens || o.origens,
    observacoes = nullif(concat_ws(E'\n', d.observacoes, o.observacoes), '')
  WHERE id = p_destino;
  UPDATE public.atendimentos SET deleted_at = now(),
    observacoes = concat_ws(E'\n', observacoes, 'Mesclado em ' || p_destino::text)
  WHERE id = p_origem;
END;
$$;

-- ---------------------------------------------------------------------
-- 8. Recebimento confirmado a partir de informação importada
--    (um pagamento pode quitar várias parcelas: um único recebimento
--     com a distribuição correspondente)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_recebimento_importado(
  p_cliente uuid,
  p_valor numeric,
  p_data date,
  p_classificacao text,
  p_observacao text,
  p_lancamento uuid,
  p_atendimento uuid,
  p_distribuicao jsonb,
  p_pendencia uuid
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pag uuid;
  v_item jsonb;
  v_parc public.parcelas%ROWTYPE;
  v_soma numeric := 0;
  v_esc text;
BEGIN
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor maior que zero.'; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'Informe a data do recebimento.'; END IF;
  SELECT escritorio INTO v_esc FROM public.atendimentos WHERE id = p_atendimento;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_distribuicao, '[]'::jsonb)) LOOP
    v_soma := v_soma + (v_item->>'valor')::numeric;
  END LOOP;
  IF v_soma > 0 AND abs(v_soma - p_valor) > 0.005 THEN
    RAISE EXCEPTION 'A distribuição entre parcelas (%) não confere com o valor recebido (%).', v_soma, p_valor;
  END IF;

  INSERT INTO public.pagamentos
    (cliente_id, valor, data_pagamento, tipo, observacao, usuario_cadastro, classificacao, atendimento_id, escritorio)
  VALUES (p_cliente, p_valor, p_data, 'outro', p_observacao, 'Revisão de importação',
          nullif(p_classificacao, ''), p_atendimento, v_esc)
  RETURNING id INTO v_pag;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_distribuicao, '[]'::jsonb)) LOOP
    SELECT * INTO v_parc FROM public.parcelas WHERE id = (v_item->>'parcela_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_parc.cliente_id <> p_cliente THEN RAISE EXCEPTION 'Parcela inválida.'; END IF;
    INSERT INTO public.recebimento_parcelas (pagamento_id, parcela_id, valor)
    VALUES (v_pag, v_parc.id, (v_item->>'valor')::numeric);
    UPDATE public.parcelas SET
      valor_pago = valor_pago + (v_item->>'valor')::numeric,
      situacao = CASE WHEN valor_pago + (v_item->>'valor')::numeric >= valor - 0.005 THEN 'paga' ELSE 'paga_parcial' END
    WHERE id = v_parc.id;
  END LOOP;

  IF p_lancamento IS NOT NULL THEN
    UPDATE public.lancamentos_financeiros SET pagamento_id = v_pag WHERE id = p_lancamento AND cliente_id = p_cliente;
  END IF;

  UPDATE public.cobrancas c SET situacao = CASE
      WHEN NOT EXISTS (SELECT 1 FROM public.parcelas p WHERE p.cobranca_id = c.id AND p.situacao <> 'paga') THEN 'quitada'
      ELSE 'parcial' END
  WHERE c.id IN (SELECT p.cobranca_id FROM public.parcelas p
                 JOIN public.recebimento_parcelas rp ON rp.parcela_id = p.id WHERE rp.pagamento_id = v_pag);

  IF p_pendencia IS NOT NULL THEN
    UPDATE public.import_pendencias SET status = 'resolvida', resolvido_em = now(),
      resolucao = jsonb_build_object('acao', 'recebimento_registrado', 'pagamento_id', v_pag)
    WHERE id = p_pendencia;
  END IF;
  RETURN v_pag;
END;
$$;

-- ---------------------------------------------------------------------
-- 9. Resolver conflito: substituir campo de um registro importado
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.atualizar_campo_importado(
  p_tabela text, p_id uuid, p_campo text, p_valor jsonb, p_pendencia uuid
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_tabela NOT IN ('atendimentos','beneficios','lancamentos_financeiros','requisicoes','acordos',
                      'cobrancas','dados_bancarios','representantes') THEN
    RAISE EXCEPTION 'Tabela não permitida.';
  END IF;
  IF p_campo IN ('id','cliente_id','chave_origem','lote_id','created_at') THEN
    RAISE EXCEPTION 'Campo não permitido.';
  END IF;
  EXECUTE format(
    'UPDATE public.%1$I SET %2$I = (jsonb_populate_record(NULL::public.%1$I, $1)).%2$I WHERE id = $2',
    p_tabela, p_campo)
  USING jsonb_build_object(p_campo, p_valor), p_id;
  IF p_pendencia IS NOT NULL THEN
    UPDATE public.import_pendencias SET status = 'resolvida', resolvido_em = now(),
      resolucao = jsonb_build_object('acao', 'substituido', 'campo', p_campo, 'valor', p_valor)
    WHERE id = p_pendencia;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 10. Ricardo Friedl (Modelo Documento): mesma regra de antes, agora
--     identificando a origem 'ricardo_friedl' nos novos cadastros e o
--     vínculo nos existentes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aplicar_importacao_modelo(
  p_itens jsonb,
  p_origem text,
  p_arquivo text,
  p_total_linhas integer
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_entrada jsonb;
  v_acao text;
  v_id uuid;
  v_cpf_digitos text;
  v_status_anterior text;
  v_novo_status text;
  v_alt jsonb;
  v_valor numeric;
  v_inseridas integer;
  v_novos integer := 0;
  v_atualizados integer := 0;
  v_movidos integer := 0;
  v_valores integer := 0;
  v_ignorados integer := 0;
  v_importacao uuid;
BEGIN
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'Importação inválida: lista de itens ausente.';
  END IF;

  INSERT INTO public.importacoes
    (nome_importacao, origem_arquivo, tipo_origem, quantidade_clientes, quantidade_ja_pagos, escritorio, modelo)
  VALUES
    ('Modelo Documento — ' || coalesce(p_arquivo, 'arquivo'), p_arquivo, 'arquivo',
     coalesce(p_total_linhas, 0), 0, 'ricardo_friedl', 'modelo_documento_atlas_v1')
  RETURNING id INTO v_importacao;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_acao := v_item->>'acao';

    IF v_acao = 'criar' THEN
      v_cpf_digitos := nullif(regexp_replace(coalesce(v_item->>'cpf', ''), '\D', '', 'g'), '');

      IF EXISTS (
        SELECT 1 FROM public.clientes c
        WHERE c.deleted_at IS NULL
          AND (
            (v_cpf_digitos IS NOT NULL
               AND regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = v_cpf_digitos)
            OR (c.nome_normalizado = v_item->>'nome_normalizado'
               AND (v_cpf_digitos IS NULL
                    OR regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = ''))
          )
      ) THEN
        RAISE EXCEPTION 'Linha %: o cliente "%" já existe na base (a base mudou desde a análise). Nada foi gravado — selecione o arquivo novamente.',
          v_item->>'linha', v_item->>'nome'
          USING ERRCODE = 'unique_violation';
      END IF;

      INSERT INTO public.clientes
        (nome, nome_normalizado, cpf, numero_processo, status, origem_importacao, data_importacao, escritorio_origem)
      VALUES
        (v_item->>'nome', v_item->>'nome_normalizado', nullif(v_item->>'cpf', ''),
         nullif(v_item->>'numero_processo', ''), 'ativo', p_origem, now(), 'ricardo_friedl')
      RETURNING id INTO v_id;
      v_novos := v_novos + 1;

    ELSIF v_acao IN ('atualizar', 'marcar_pago') THEN
      v_id := (v_item->>'cliente_id')::uuid;
      v_alt := coalesce(v_item->'alteracoes', '{}'::jsonb);

      SELECT status INTO v_status_anterior
      FROM public.clientes
      WHERE id = v_id AND deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Linha %: o cliente não existe mais na base. Nada foi gravado — selecione o arquivo novamente.',
          v_item->>'linha';
      END IF;

      v_novo_status := coalesce(v_alt->>'status', v_status_anterior);

      UPDATE public.clientes SET
        cpf = CASE WHEN v_alt ? 'cpf' AND coalesce(cpf, '') = '' THEN v_alt->>'cpf' ELSE cpf END,
        numero_processo = CASE WHEN v_alt ? 'numero_processo' AND coalesce(numero_processo, '') = ''
                               THEN v_alt->>'numero_processo' ELSE numero_processo END,
        status = v_novo_status
      WHERE id = v_id;

      IF v_novo_status = 'pago' AND v_status_anterior IS DISTINCT FROM 'pago' THEN
        v_movidos := v_movidos + 1;
      ELSE
        v_atualizados := v_atualizados + 1;
      END IF;

    ELSE
      RAISE EXCEPTION 'Ação desconhecida na importação: %', v_acao;
    END IF;

    -- Vínculo com o escritório Ricardo Friedl (não altera a origem já registrada).
    INSERT INTO public.cliente_escritorios (cliente_id, escritorio, importacao_id)
    VALUES (v_id, 'ricardo_friedl', v_importacao)
    ON CONFLICT (cliente_id, escritorio) DO NOTHING;

    FOR v_entrada IN SELECT value FROM jsonb_array_elements(coalesce(v_item->'entradas', '[]'::jsonb)) LOOP
      v_valor := nullif(v_entrada->>'valor', '')::numeric;
      IF v_valor IS NULL OR v_valor <= 0 THEN
        CONTINUE;
      END IF;
      INSERT INTO public.pagamentos
        (cliente_id, valor, data_pagamento, tipo, observacao, usuario_cadastro,
         chave_importacao, linha_importacao, escritorio)
      VALUES
        (v_id, v_valor, current_date, 'outro',
         'Modelo Documento — ' || coalesce(p_arquivo, 'arquivo') || ', linha ' || coalesce(v_entrada->>'linha', '?'),
         'Modelo Documento', v_entrada->>'chave', nullif(v_entrada->>'linha', '')::integer, 'ricardo_friedl')
      ON CONFLICT (cliente_id, chave_importacao) WHERE chave_importacao IS NOT NULL
      DO NOTHING;
      GET DIAGNOSTICS v_inseridas = ROW_COUNT;
      IF v_inseridas > 0 THEN
        v_valores := v_valores + 1;
      ELSE
        v_ignorados := v_ignorados + 1;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.importacoes SET quantidade_ja_pagos = v_movidos WHERE id = v_importacao;

  RETURN jsonb_build_object(
    'novos', v_novos,
    'atualizados', v_atualizados,
    'movidos', v_movidos,
    'valores', v_valores,
    'valores_ignorados', v_ignorados
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 11. Zerar sistema inclui as novas tabelas (preserva configurações)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zerar_sistema()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.recebimento_parcelas WHERE true;
  DELETE FROM public.parcelas WHERE true;
  DELETE FROM public.cobrancas WHERE true;
  DELETE FROM public.lancamentos_financeiros WHERE true;
  DELETE FROM public.requisicoes WHERE true;
  DELETE FROM public.acordos WHERE true;
  DELETE FROM public.beneficios WHERE true;
  DELETE FROM public.historico_cliente WHERE true;
  DELETE FROM public.dados_bancarios WHERE true;
  DELETE FROM public.representantes WHERE true;
  DELETE FROM public.atendimentos WHERE true;
  DELETE FROM public.cliente_escritorios WHERE true;
  DELETE FROM public.import_lotes WHERE true;
  DELETE FROM public.correspondencias WHERE true;
  DELETE FROM public.correspondencias_rejeitadas WHERE true;
  DELETE FROM public.clientes_importados WHERE true;
  DELETE FROM public.importacoes WHERE true;
  DELETE FROM public.pagamentos WHERE true;
  DELETE FROM public.variacoes_nome WHERE true;
  DELETE FROM public.clientes WHERE true;
END;
$$;

GRANT EXECUTE ON FUNCTION public._inserir_importado(text, jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_pessoas_lote(uuid, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.desfazer_lote(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mesclar_atendimentos(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_recebimento_importado(uuid, numeric, date, text, text, uuid, uuid, jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.atualizar_campo_importado(text, uuid, text, jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_importacao_modelo(jsonb, text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zerar_sistema() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12. Arquivo original preservado (Supabase Storage, bucket privado)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('importacoes', 'importacoes', false)
    ON CONFLICT (id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname = 'importacoes_arquivos_open') THEN
      EXECUTE 'CREATE POLICY importacoes_arquivos_open ON storage.objects FOR ALL TO anon, authenticated
               USING (bucket_id = ''importacoes'') WITH CHECK (bucket_id = ''importacoes'')';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 13. Realtime
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['cliente_escritorios','atendimentos','beneficios','lancamentos_financeiros',
      'requisicoes','acordos','cobrancas','parcelas','import_lotes'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
