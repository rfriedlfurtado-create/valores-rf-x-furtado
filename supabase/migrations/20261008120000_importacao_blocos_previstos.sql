-- =====================================================================
-- Importação do modelo em BLOCOS ("VALORES PRI EXECUÇÃO") + VALORES PREVISTOS
--
-- * pagamentos (= valores EFETIVAMENTE recebidos) ganham rastreabilidade e
--   classificação: origem (judicial/administrativo), canal (RPV, precatório,
--   INSS, pagamento pelo cliente…), destinatário (escritório/cliente),
--   natureza (implantação, contratuais sobre atrasados, sucumbência da
--   execução…), descrição, competência, parcela, percentual, aba e células.
-- * valores_previstos: valores a receber, parciais, sem confirmação ou com
--   "não haverá cobrança/sucumbência" — NUNCA entram no TOTAL RECEBIDO.
-- * aplicar_importacao_blocos: cria o cliente (em JÁ PAGOS) só quando não
--   existe, cria o processo/benefício só quando informado (número/NB), grava
--   recebimentos e previstos com chave estável (reimportar não duplica).
-- Nenhum dado existente é apagado; a categoria 'implantacao' passa a ser
-- exibida como CONTRATUAL (a implantação vira a natureza do lançamento).
-- =====================================================================

ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS origem TEXT CHECK (origem IS NULL OR origem IN ('judicial', 'administrativo')),
  ADD COLUMN IF NOT EXISTS canal TEXT,
  ADD COLUMN IF NOT EXISTS destinatario TEXT NOT NULL DEFAULT 'escritorio' CHECK (destinatario IN ('escritorio', 'cliente')),
  ADD COLUMN IF NOT EXISTS natureza TEXT,
  ADD COLUMN IF NOT EXISTS descricao TEXT,
  ADD COLUMN IF NOT EXISTS competencia TEXT,
  ADD COLUMN IF NOT EXISTS parcela TEXT,
  ADD COLUMN IF NOT EXISTS percentual TEXT,
  ADD COLUMN IF NOT EXISTS aba TEXT,
  ADD COLUMN IF NOT EXISTS celulas TEXT,
  ADD COLUMN IF NOT EXISTS data_informada BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS conferencia TEXT;

-- Lançamentos antigos de implantação: natureza explícita (o card passa a ser CONTRATUAL).
UPDATE public.pagamentos SET natureza = 'implantacao'
WHERE classificacao = 'implantacao' AND natureza IS NULL;

CREATE TABLE IF NOT EXISTS public.valores_previstos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  categoria TEXT CHECK (categoria IS NULL OR categoria IN ('atrasados', 'implantacao', 'sucumbencia')),
  natureza TEXT,
  descricao TEXT,
  origem TEXT CHECK (origem IS NULL OR origem IN ('judicial', 'administrativo')),
  canal TEXT,
  destinatario TEXT NOT NULL DEFAULT 'escritorio' CHECK (destinatario IN ('escritorio', 'cliente')),
  valor NUMERIC(14,2) CHECK (valor IS NULL OR valor >= 0),
  valor_recebido NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (valor_recebido >= 0),
  situacao TEXT NOT NULL DEFAULT 'a_receber' CHECK (situacao IN (
    'a_receber', 'parcial', 'nao_confirmado', 'nao_havera_cobranca', 'nao_havera_sucumbencia',
    'recebido', 'cancelado')),
  percentual TEXT,
  competencia TEXT,
  parcela TEXT,
  data_referencia DATE,
  observacao TEXT,
  aba TEXT,
  celulas TEXT,
  conferencia TEXT,
  chave_importacao TEXT,
  importacao_id UUID REFERENCES public.importacoes(id) ON DELETE SET NULL,
  pagamento_id UUID REFERENCES public.pagamentos(id) ON DELETE SET NULL,
  dados_origem JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_previstos_chave
  ON public.valores_previstos (cliente_id, chave_importacao) WHERE chave_importacao IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_previstos_cliente ON public.valores_previstos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_previstos_atendimento ON public.valores_previstos (atendimento_id, categoria);
CREATE INDEX IF NOT EXISTS idx_previstos_situacao ON public.valores_previstos (situacao);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.valores_previstos TO anon, authenticated;
GRANT ALL ON public.valores_previstos TO service_role;
ALTER TABLE public.valores_previstos ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'valores_previstos' AND policyname = 'valores_previstos_open') THEN
    CREATE POLICY valores_previstos_open ON public.valores_previstos
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'valores_previstos') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.valores_previstos;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._previstos_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_previstos_updated ON public.valores_previstos;
CREATE TRIGGER trg_previstos_updated BEFORE UPDATE ON public.valores_previstos
FOR EACH ROW EXECUTE FUNCTION public._previstos_updated();

-- Rótulo da categoria: implantação é exibida como CONTRATUAL.
CREATE OR REPLACE FUNCTION public._rotulo_categoria(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'atrasados' THEN 'Atrasados'
                WHEN 'implantacao' THEN 'Contratual'
                WHEN 'sucumbencia' THEN 'Sucumbência'
                ELSE 'sem categoria' END;
$$;

-- ---------------------------------------------------------------------
-- Valor previsto → recebido (página VALORES PREVISTOS): gera o pagamento.
-- p_valor: quanto foi recebido agora (parcela); p_quitado: encerra o previsto.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receber_valor_previsto(
  p_id uuid, p_valor numeric, p_data date, p_quitado boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v public.valores_previstos%ROWTYPE;
  v_pag uuid;
  v_novo numeric;
BEGIN
  SELECT * INTO v FROM public.valores_previstos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Valor previsto não encontrado.'; END IF;
  IF v.situacao IN ('recebido', 'cancelado', 'nao_havera_cobranca', 'nao_havera_sucumbencia') THEN
    RAISE EXCEPTION 'Este valor não está pendente.';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'Informe o valor recebido.'; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'Informe a data do recebimento.'; END IF;

  INSERT INTO public.pagamentos
    (cliente_id, atendimento_id, valor, data_pagamento, tipo, observacao, usuario_cadastro,
     classificacao, origem, canal, destinatario, natureza, descricao, competencia, parcela,
     percentual, aba, celulas, escritorio)
  VALUES
    (v.cliente_id, v.atendimento_id, round(p_valor, 2), p_data, 'outro', v.observacao,
     'Valores previstos', v.categoria, v.origem, v.canal, v.destinatario, v.natureza, v.descricao,
     v.competencia, v.parcela, v.percentual, v.aba, v.celulas,
     (SELECT escritorio FROM public.atendimentos WHERE id = v.atendimento_id))
  RETURNING id INTO v_pag;

  v_novo := round(coalesce(v.valor_recebido, 0) + p_valor, 2);
  UPDATE public.valores_previstos SET
    valor_recebido = v_novo,
    situacao = CASE WHEN p_quitado OR (v.valor IS NOT NULL AND v_novo >= v.valor) THEN 'recebido' ELSE 'parcial' END,
    pagamento_id = v_pag
  WHERE id = p_id;

  INSERT INTO public.historico_cliente (cliente_id, atendimento_id, categoria, texto, chave_origem)
  VALUES (v.cliente_id, v.atendimento_id, 'alteracao',
          'Valor previsto (' || public._rotulo_categoria(v.categoria) || coalesce(' — ' || v.descricao, '') ||
          ') recebido: ' || public._brl(p_valor) || ' em ' || to_char(p_data, 'DD/MM/YYYY') ||
          CASE WHEN p_quitado OR (v.valor IS NOT NULL AND v_novo >= v.valor) THEN ' (quitado).' ELSE ' (parcial).' END,
          'previsto:receber:' || p_id || ':' || extract(epoch FROM clock_timestamp()));

  RETURN public._situacao_processos(ARRAY[v.atendimento_id], '{}'::uuid[]) || jsonb_build_object('pagamento_id', v_pag);
END;
$$;

GRANT EXECUTE ON FUNCTION public.receber_valor_previsto(uuid, numeric, date, boolean) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Importação do modelo em blocos
-- ---------------------------------------------------------------------
-- Item (um por bloco):
-- { bloco, aba, celulas,
--   cliente: { acao: 'existente'|'novo', id?, nome, nome_normalizado, cpf },
--   processo: { acao: 'existente'|'novo'|'nenhum', id?, numero, numero_digitos, nb, nb_digitos,
--               especie, natureza, tribunal, info{} },
--   nao_havera_sucumbencia: bool,
--   recebimentos: [{ chave, categoria, natureza, descricao, origem, canal, destinatario,
--                    valor, data, data_informada, competencia, parcela, percentual,
--                    observacao, celulas, conferencia, dados }],
--   previstos: [{ chave, ..., valor, valor_recebido, situacao, data }] }
-- Resultado por item: cliente_id, cliente_criado, atendimento_id, processo_criado,
--   recebimentos:[{chave,resultado}] (inserido|ja_registrado|conflito_nao_havera),
--   previstos:[{chave,resultado}] (inserido|atualizado|inalterado|ja_recebido).
CREATE OR REPLACE FUNCTION public._blocos_processar(
  p_itens jsonb, p_arquivo text, p_importacao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r jsonb;
  x jsonb;
  v_imp uuid := p_importacao_id;
  v_cli uuid;
  v_cli_criado boolean;
  v_cli_ja_pagos boolean;
  v_at uuid;
  v_at_criado boolean;
  v_cpf text;
  v_chave_at text;
  v_pag uuid;
  v_prev public.valores_previstos%ROWTYPE;
  v_res jsonb := '[]'::jsonb;
  v_rec jsonb;
  v_prv jsonb;
  v_resultado text;
  v_esc text;
  v_class text;
  v_criados integer := 0;
  v_valor numeric;
BEGIN
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'Importação inválida: lista de blocos ausente.';
  END IF;
  IF v_imp IS NULL THEN
    INSERT INTO public.importacoes
      (nome_importacao, origem_arquivo, tipo_origem, quantidade_clientes, modelo, aba)
    VALUES ('Valores PRI/Execução — ' || coalesce(p_arquivo, 'arquivo'), p_arquivo, 'arquivo', 0,
            'blocos_valores', 'RPV/Implantação')
    RETURNING id INTO v_imp;
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_cli := NULL; v_cli_criado := false; v_cli_ja_pagos := false; v_at := NULL; v_at_criado := false;
    v_rec := '[]'::jsonb; v_prv := '[]'::jsonb;

    -- ---------------- Cliente ----------------
    IF r->'cliente'->>'acao' = 'existente' THEN
      SELECT id INTO v_cli FROM public.clientes
      WHERE id = (r->'cliente'->>'id')::uuid AND deleted_at IS NULL;
      IF v_cli IS NULL THEN
        RAISE EXCEPTION 'Bloco %: o cliente escolhido não existe mais. Analise o arquivo novamente.', r->>'bloco';
      END IF;
    ELSE
      -- Nunca duplica: procura de novo por CPF e por nome idêntico (inclusive em JÁ PAGOS).
      v_cpf := nullif(regexp_replace(coalesce(r->'cliente'->>'cpf', ''), '\D', '', 'g'), '');
      IF v_cpf IS NOT NULL THEN
        SELECT id INTO v_cli FROM public.clientes
        WHERE deleted_at IS NULL AND regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_cpf
        ORDER BY created_at LIMIT 1;
      END IF;
      IF v_cli IS NULL THEN
        SELECT id INTO v_cli FROM public.clientes
        WHERE deleted_at IS NULL AND nome_normalizado = r->'cliente'->>'nome_normalizado'
          AND (v_cpf IS NULL OR coalesce(regexp_replace(coalesce(cpf, ''), '\D', '', 'g'), '') IN ('', v_cpf))
        ORDER BY created_at LIMIT 1;
      END IF;
      IF v_cli IS NULL THEN
        INSERT INTO public.clientes
          (nome, nome_normalizado, cpf, status, origem_importacao, data_importacao)
        VALUES (r->'cliente'->>'nome', r->'cliente'->>'nome_normalizado', nullif(r->'cliente'->>'cpf', ''),
                'pago', 'valores_pri_execucao', now())
        RETURNING id INTO v_cli;
        v_cli_criado := true;
        v_criados := v_criados + 1;
        INSERT INTO public.historico_cliente (cliente_id, categoria, texto, aba, celulas, chave_origem)
        VALUES (v_cli, 'importacao',
                'Cliente criado em JÁ PAGOS pela importação de valores (' || coalesce(p_arquivo, 'arquivo') ||
                ', ' || coalesce(r->>'aba', '') || ' ' || coalesce(r->>'celulas', '') || ').',
                r->>'aba', r->>'celulas', 'vb:cli:' || v_cli);
      END IF;
      -- Cliente criado por esta importação (agora ou em lote anterior): fica em JÁ PAGOS.
      v_cli_ja_pagos := v_cli_criado OR EXISTS (
        SELECT 1 FROM public.clientes WHERE id = v_cli AND origem_importacao = 'valores_pri_execucao');
    END IF;

    -- ---------------- Processo / benefício ----------------
    IF r->'processo'->>'acao' = 'existente' THEN
      SELECT id, escritorio INTO v_at, v_esc FROM public.atendimentos
      WHERE id = (r->'processo'->>'id')::uuid AND cliente_id = v_cli AND deleted_at IS NULL;
    ELSIF r->'processo'->>'acao' = 'novo' THEN
      v_chave_at := 'vb:' || v_cli || ':' ||
        coalesce(nullif(r->'processo'->>'numero_digitos', ''), 'nb' || nullif(r->'processo'->>'nb_digitos', ''), 'sem');
      SELECT id, escritorio INTO v_at, v_esc FROM public.atendimentos WHERE chave_origem = v_chave_at;
      IF v_at IS NULL AND nullif(r->'processo'->>'numero_digitos', '') IS NOT NULL THEN
        SELECT id, escritorio INTO v_at, v_esc FROM public.atendimentos
        WHERE cliente_id = v_cli AND deleted_at IS NULL
          AND coalesce(processo_digitos, regexp_replace(coalesce(dados_rf->>'numero', numero_processo, ''), '\D', '', 'g'))
              = r->'processo'->>'numero_digitos'
        LIMIT 1;
      END IF;
      IF v_at IS NULL THEN
        -- Cliente novo (JÁ PAGOS): o processo entra como pago, como os registros
        -- anteriores à regra dos três cards (finalizacao_validada = false).
        INSERT INTO public.atendimentos
          (cliente_id, escritorio, numero_processo, processo_digitos, tribunal, natureza, servico,
           beneficio, chave_origem, dados_rf, informacoes_adicionais, modelo, origens, pago, pago_em)
        VALUES
          (v_cli, 'a_confirmar', nullif(r->'processo'->>'numero', ''), nullif(r->'processo'->>'numero_digitos', ''),
           nullif(r->'processo'->>'tribunal', ''), nullif(r->'processo'->>'natureza', ''),
           nullif(r->'processo'->>'especie', ''), nullif(r->'processo'->>'especie', ''), v_chave_at,
           jsonb_strip_nulls(jsonb_build_object(
             'numero', coalesce(nullif(r->'processo'->>'numero', ''), CASE WHEN nullif(r->'processo'->>'nb', '') IS NOT NULL THEN 'NB ' || (r->'processo'->>'nb') END),
             'tipo_acao', nullif(r->'processo'->>'especie', ''))),
           coalesce(r->'processo'->'info', '{}'::jsonb), 'blocos_valores',
           jsonb_build_array(jsonb_build_object('arquivo', p_arquivo, 'aba', r->>'aba', 'celulas', r->>'celulas')),
           v_cli_ja_pagos, CASE WHEN v_cli_ja_pagos THEN now() END)
        RETURNING id, escritorio INTO v_at, v_esc;
        v_at_criado := true;
        INSERT INTO public.historico_cliente (cliente_id, atendimento_id, categoria, texto, aba, celulas, chave_origem)
        VALUES (v_cli, v_at, 'importacao',
                'Processo/benefício ' || coalesce(nullif(r->'processo'->>'numero', ''), 'NB ' || nullif(r->'processo'->>'nb', ''), 'sem número') ||
                ' criado pela importação de valores (' || coalesce(r->>'aba', '') || ' ' || coalesce(r->>'celulas', '') || ').',
                r->>'aba', r->>'celulas', 'vb:at:' || v_at);
      END IF;
    END IF;

    -- ---------------- Não haverá sucumbência (indicação expressa) ----------------
    IF coalesce((r->>'nao_havera_sucumbencia')::boolean, false) AND v_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.pagamentos WHERE atendimento_id = v_at AND classificacao = 'sucumbencia')
       AND NOT EXISTS (SELECT 1 FROM public.processo_categorias WHERE atendimento_id = v_at AND categoria = 'sucumbencia' AND nao_havera) THEN
      INSERT INTO public.processo_categorias (atendimento_id, categoria, nao_havera)
      VALUES (v_at, 'sucumbencia', true)
      ON CONFLICT (atendimento_id, categoria) DO UPDATE SET nao_havera = true;
    END IF;

    -- ---------------- Recebimentos efetivos ----------------
    FOR x IN SELECT value FROM jsonb_array_elements(coalesce(r->'recebimentos', '[]'::jsonb)) LOOP
      v_pag := NULL;
      v_class := nullif(x->>'categoria', '');
      v_valor := nullif(x->>'valor', '')::numeric;
      IF v_valor IS NULL OR v_valor <= 0 THEN
        v_resultado := 'valor_invalido';
      ELSIF v_class = 'sucumbencia' AND v_at IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.processo_categorias WHERE atendimento_id = v_at AND categoria = 'sucumbencia' AND nao_havera
      ) THEN
        v_resultado := 'conflito_nao_havera';
      ELSE
        INSERT INTO public.pagamentos
          (cliente_id, atendimento_id, valor, data_pagamento, tipo, observacao, usuario_cadastro,
           classificacao, chave_importacao, importacao_id, escritorio, dados_origem,
           origem, canal, destinatario, natureza, descricao, competencia, parcela, percentual,
           aba, celulas, data_informada, conferencia)
        VALUES
          (v_cli, v_at, round(v_valor, 2), coalesce(nullif(x->>'data', '')::date, current_date), 'outro',
           nullif(x->>'observacao', ''), 'Importação Valores PRI/Execução', v_class, x->>'chave', v_imp, v_esc,
           coalesce(x->'dados', '{}'::jsonb) || jsonb_build_object('arquivo', p_arquivo),
           nullif(x->>'origem', ''), nullif(x->>'canal', ''), coalesce(nullif(x->>'destinatario', ''), 'escritorio'),
           nullif(x->>'natureza', ''), nullif(x->>'descricao', ''), nullif(x->>'competencia', ''),
           nullif(x->>'parcela', ''), nullif(x->>'percentual', ''), r->>'aba', nullif(x->>'celulas', ''),
           nullif(x->>'data', '') IS NOT NULL, nullif(x->>'conferencia', ''))
        ON CONFLICT (cliente_id, chave_importacao) WHERE chave_importacao IS NOT NULL DO NOTHING
        RETURNING id INTO v_pag;
        v_resultado := CASE WHEN v_pag IS NULL THEN 'ja_registrado' ELSE 'inserido' END;
        IF v_pag IS NOT NULL THEN
          INSERT INTO public.historico_cliente
            (cliente_id, atendimento_id, categoria, texto, aba, celulas, escritorio, chave_origem)
          VALUES (v_cli, v_at, 'importacao',
                  'Recebimento de ' || public._brl(v_valor) || ' (' || public._rotulo_categoria(v_class) ||
                  coalesce(' — ' || nullif(x->>'descricao', ''), '') || ') importado de ' || coalesce(r->>'aba', '') ||
                  ' ' || coalesce(x->>'celulas', '') || '.',
                  r->>'aba', x->>'celulas', v_esc, 'vb:hist:' || v_pag);
        END IF;
      END IF;
      v_rec := v_rec || jsonb_build_object('chave', x->>'chave', 'resultado', v_resultado, 'pagamento_id', v_pag);
    END LOOP;

    -- ---------------- Valores previstos / pendentes ----------------
    FOR x IN SELECT value FROM jsonb_array_elements(coalesce(r->'previstos', '[]'::jsonb)) LOOP
      SELECT * INTO v_prev FROM public.valores_previstos
      WHERE cliente_id = v_cli AND chave_importacao = x->>'chave' FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO public.valores_previstos
          (cliente_id, atendimento_id, categoria, natureza, descricao, origem, canal, destinatario,
           valor, valor_recebido, situacao, percentual, competencia, parcela, data_referencia,
           observacao, aba, celulas, conferencia, chave_importacao, importacao_id, dados_origem)
        VALUES
          (v_cli, v_at, nullif(x->>'categoria', ''), nullif(x->>'natureza', ''), nullif(x->>'descricao', ''),
           nullif(x->>'origem', ''), nullif(x->>'canal', ''), coalesce(nullif(x->>'destinatario', ''), 'escritorio'),
           nullif(x->>'valor', '')::numeric, coalesce(nullif(x->>'valor_recebido', '')::numeric, 0),
           coalesce(nullif(x->>'situacao', ''), 'a_receber'), nullif(x->>'percentual', ''),
           nullif(x->>'competencia', ''), nullif(x->>'parcela', ''), nullif(x->>'data', '')::date,
           nullif(x->>'observacao', ''), r->>'aba', nullif(x->>'celulas', ''), nullif(x->>'conferencia', ''),
           x->>'chave', v_imp, coalesce(x->'dados', '{}'::jsonb) || jsonb_build_object('arquivo', p_arquivo));
        v_resultado := 'inserido';
      ELSIF v_prev.situacao IN ('recebido', 'cancelado') THEN
        v_resultado := 'ja_recebido'; -- tratado na página VALORES PREVISTOS: não volta a pendente
      ELSIF v_prev.valor IS NOT DISTINCT FROM nullif(x->>'valor', '')::numeric
            AND v_prev.situacao = coalesce(nullif(x->>'situacao', ''), 'a_receber') THEN
        v_resultado := 'inalterado';
      ELSE
        -- Versão atualizada do MESMO valor: substitui (não soma) e guarda a anterior.
        UPDATE public.valores_previstos SET
          valor = nullif(x->>'valor', '')::numeric,
          situacao = coalesce(nullif(x->>'situacao', ''), situacao),
          valor_recebido = greatest(valor_recebido, coalesce(nullif(x->>'valor_recebido', '')::numeric, 0)),
          atendimento_id = coalesce(atendimento_id, v_at),
          celulas = coalesce(nullif(x->>'celulas', ''), celulas),
          conferencia = nullif(x->>'conferencia', ''),
          dados_origem = dados_origem || coalesce(x->'dados', '{}'::jsonb) ||
            jsonb_build_object('versao_anterior', jsonb_build_object('valor', v_prev.valor, 'situacao', v_prev.situacao,
                                                                      'em', now()))
        WHERE id = v_prev.id;
        v_resultado := 'atualizado';
      END IF;
      v_prv := v_prv || jsonb_build_object('chave', x->>'chave', 'resultado', v_resultado);
    END LOOP;

    v_res := v_res || jsonb_build_object(
      'bloco', r->>'bloco', 'cliente_id', v_cli, 'cliente_criado', v_cli_criado,
      'atendimento_id', v_at, 'processo_criado', v_at_criado,
      'recebimentos', v_rec, 'previstos', v_prv);
  END LOOP;

  UPDATE public.importacoes SET quantidade_clientes = quantidade_clientes + v_criados WHERE id = v_imp;
  RETURN jsonb_build_object('importacao_id', v_imp, 'blocos', v_res);
END;
$$;

CREATE OR REPLACE FUNCTION public.aplicar_importacao_blocos(
  p_itens jsonb,
  p_arquivo text,
  p_simular boolean DEFAULT true,
  p_importacao_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF p_simular THEN
    BEGIN
      v_res := public._blocos_processar(p_itens, p_arquivo, p_importacao_id);
      RAISE EXCEPTION 'simulacao' USING ERRCODE = 'VB001';
    EXCEPTION WHEN SQLSTATE 'VB001' THEN
      RETURN v_res || jsonb_build_object('simulacao', true);
    END;
  END IF;
  RETURN public._blocos_processar(p_itens, p_arquivo, p_importacao_id) || jsonb_build_object('simulacao', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public._blocos_processar(jsonb, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.aplicar_importacao_blocos(jsonb, text, boolean, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
