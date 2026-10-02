-- =====================================================================
-- Novo modelo de importação de clientes — Ricardo Friedl (Espaider)
--
-- Modelo permanente: planilha "CLIENTES RICARDO - PELO ESPAIDER".
--   * 1 cliente (pessoa) = 1 linha em `clientes`
--       - nome  = Reclamante | cpf = CPF Reclamante
--       - dados_rf (jsonb) = dados pessoais e de contato consolidados
--   * 1 processo/atendimento = 1 linha em `atendimentos` (modelo 'rf_espaider')
--       - mesmo cliente + mesmo número + mesmo tipo de ação = mesmo registro
--       - dados_rf (jsonb) = campos do processo, captação e honorários
--   * 1 linha da planilha = 1 linha em `registro_linhas` (rastreabilidade,
--     anti-reimportação pela chave da linha — código da pasta quando houver)
--   * `revisoes_rf` = divergências, possíveis duplicidades e associações
--     a revisar. Nada é unido ou substituído automaticamente.
--
-- Nenhum campo do modelo gera pagamento ou cobrança.
-- Aditiva e idempotente: nenhum dado existente é alterado ou removido.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Estrutura
-- ---------------------------------------------------------------------
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS dados_rf JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS importacao_rf_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clientes' AND column_name = 'cpf_digitos'
  ) THEN
    ALTER TABLE public.clientes
      ADD COLUMN cpf_digitos TEXT GENERATED ALWAYS AS
        (nullif(regexp_replace(coalesce(cpf, ''), '\D', '', 'g'), '')) STORED;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_clientes_cpf_digitos ON public.clientes (cpf_digitos) WHERE cpf_digitos IS NOT NULL;

ALTER TABLE public.atendimentos
  ADD COLUMN IF NOT EXISTS dados_rf JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS informacoes_adicionais JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS modelo TEXT,
  ADD COLUMN IF NOT EXISTS revisao_motivo TEXT;
CREATE INDEX IF NOT EXISTS idx_atendimentos_modelo ON public.atendimentos (modelo);

ALTER TABLE public.importacoes
  ADD COLUMN IF NOT EXISTS resumo JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS aba TEXT;

CREATE TABLE IF NOT EXISTS public.registro_linhas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE SET NULL,
  importacao_id UUID REFERENCES public.importacoes(id) ON DELETE SET NULL,
  arquivo_nome TEXT,
  aba TEXT,
  linha INTEGER NOT NULL,
  chave_linha TEXT NOT NULL UNIQUE,
  valores JSONB NOT NULL DEFAULT '{}'::jsonb,
  extras JSONB NOT NULL DEFAULT '{}'::jsonb,
  avisos JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registro_linhas_cliente ON public.registro_linhas (cliente_id);
CREATE INDEX IF NOT EXISTS idx_registro_linhas_atendimento ON public.registro_linhas (atendimento_id);

CREATE TABLE IF NOT EXISTS public.revisoes_rf (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('divergencia', 'duplicidade', 'associacao')),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  atendimento_id UUID REFERENCES public.atendimentos(id) ON DELETE CASCADE,
  outro_cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
  entidade TEXT CHECK (entidade IS NULL OR entidade IN ('cliente', 'registro')),
  campo TEXT,
  valor_atual TEXT,
  valor_novo TEXT,
  descricao TEXT,
  origem JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'aplicada', 'mantida', 'descartada')),
  resolvido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revisoes_rf_cliente ON public.revisoes_rf (cliente_id, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['registro_linhas', 'revisoes_rf'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_open') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t || '_open', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Histórico (tabela existente historico_cliente)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rf_historico(
  p_cliente uuid, p_atendimento uuid, p_categoria text, p_texto text, p_aba text, p_linha integer
) RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO public.historico_cliente
    (cliente_id, atendimento_id, categoria, texto, aba, celulas, escritorio, chave_origem)
  VALUES
    (p_cliente, p_atendimento, p_categoria, p_texto, p_aba,
     CASE WHEN p_linha IS NULL THEN NULL ELSE 'linha ' || p_linha END,
     'ricardo_friedl', 'rf:hist:' || gen_random_uuid());
$$;

-- ---------------------------------------------------------------------
-- 3. Mescla de campos (complementa vazios; diferença = conflito)
-- ---------------------------------------------------------------------
-- Retorna { dados, complementos[], conflitos[] }. Não grava a linha de
-- destino (o chamador grava `dados`), mas registra histórico e revisões.
CREATE OR REPLACE FUNCTION public._rf_mesclar(
  p_entidade text, p_cliente uuid, p_atendimento uuid,
  p_atual jsonb, p_novo jsonb, p_linha integer, p_substituir text[],
  p_arquivo text, p_aba text, p_importacao uuid, p_prefixo text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_dados jsonb := coalesce(p_atual, '{}'::jsonb);
  v_comp jsonb := '[]'::jsonb;
  v_conf jsonb := '[]'::jsonb;
  v_k text;
  v_novo text;
  v_atual text;
  v_campo text;
  v_chave text;
  v_origem jsonb := jsonb_build_object('arquivo', p_arquivo, 'aba', p_aba, 'linha', p_linha, 'importacao_id', p_importacao);
BEGIN
  FOR v_k, v_novo IN SELECT key, value FROM jsonb_each_text(coalesce(p_novo, '{}'::jsonb)) LOOP
    IF v_novo IS NULL OR btrim(v_novo) = '' THEN
      CONTINUE; -- célula vazia nunca apaga dado existente
    END IF;
    v_campo := p_prefixo || v_k;
    v_atual := v_dados->>v_k;
    IF v_atual IS NULL OR btrim(v_atual) = '' THEN
      v_dados := jsonb_set(v_dados, ARRAY[v_k], to_jsonb(v_novo));
      v_comp := v_comp || to_jsonb(v_campo);
      PERFORM public._rf_historico(p_cliente, p_atendimento, 'complementacao',
        'Campo "' || v_campo || '" complementado com "' || v_novo || '" (' || coalesce(p_arquivo, 'arquivo') || ', linha ' || p_linha || ').',
        p_aba, p_linha);
    ELSIF v_atual IS DISTINCT FROM v_novo THEN
      v_chave := p_linha || ':' || p_entidade || ':' || v_campo;
      IF v_chave = ANY (coalesce(p_substituir, ARRAY[]::text[])) THEN
        v_dados := jsonb_set(v_dados, ARRAY[v_k], to_jsonb(v_novo));
        PERFORM public._rf_historico(p_cliente, p_atendimento, 'alteracao',
          'Campo "' || v_campo || '" alterado de "' || v_atual || '" para "' || v_novo || '" (importação ' || coalesce(p_arquivo, 'arquivo') || ', linha ' || p_linha || ').',
          p_aba, p_linha);
        v_conf := v_conf || jsonb_build_object('chave', v_chave, 'entidade', p_entidade, 'campo', v_campo,
          'atual', v_atual, 'novo', v_novo, 'substituido', true);
      ELSIF NOT EXISTS (
        SELECT 1 FROM public.revisoes_rf r
        WHERE r.tipo = 'divergencia' AND r.cliente_id = p_cliente
          AND r.entidade = p_entidade
          AND r.atendimento_id IS NOT DISTINCT FROM p_atendimento
          AND r.campo = v_campo AND r.valor_novo = v_novo
      ) THEN
        INSERT INTO public.revisoes_rf
          (tipo, cliente_id, atendimento_id, entidade, campo, valor_atual, valor_novo, origem, descricao)
        VALUES
          ('divergencia', p_cliente, p_atendimento, p_entidade, v_campo, v_atual, v_novo, v_origem,
           'Valor diferente na linha ' || p_linha || ' do arquivo.');
        v_conf := v_conf || jsonb_build_object('chave', v_chave, 'entidade', p_entidade, 'campo', v_campo,
          'atual', v_atual, 'novo', v_novo, 'substituido', false);
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('dados', v_dados, 'complementos', v_comp, 'conflitos', v_conf);
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Processamento de um lote de linhas
-- ---------------------------------------------------------------------
-- p_linhas: [{ linha, chave, nome, nome_normalizado, cpf, cpf_digitos,
--              cpf_valido, cliente:{...}, registro:{...}, numero_digitos,
--              tipo_norm, extras:{...}, valores:{...}, avisos:[...] }]
CREATE OR REPLACE FUNCTION public._rf_processar(
  p_linhas jsonb, p_arquivo text, p_aba text, p_substituir text[], p_importacao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r jsonb;
  v_imp uuid := p_importacao_id;
  v_linha integer;
  v_cli uuid;
  v_at uuid;
  v_lin public.registro_linhas%ROWTYPE;
  v_cliente public.clientes%ROWTYPE;
  v_atd public.atendimentos%ROWTYPE;
  v_status_cli text;
  v_status_reg text;
  v_chave_reg text;
  v_motivo text;
  v_dup jsonb;
  v_m jsonb;
  v_m2 jsonb;
  v_comp jsonb;
  v_conf jsonb;
  v_res jsonb := '[]'::jsonb;
  v_cpf_dig text;
  v_chave text;
  v_extra_conf jsonb;
BEGIN
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Importação inválida: lista de linhas ausente.';
  END IF;

  IF v_imp IS NULL THEN
    INSERT INTO public.importacoes
      (nome_importacao, origem_arquivo, tipo_origem, quantidade_clientes, escritorio, modelo, aba)
    VALUES
      ('Ricardo Friedl — ' || coalesce(p_arquivo, 'arquivo'), p_arquivo, 'arquivo', 0,
       'ricardo_friedl', 'rf_espaider', p_aba)
    RETURNING id INTO v_imp;
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_linhas) LOOP
    v_linha := (r->>'linha')::integer;
    v_cli := NULL; v_at := NULL; v_motivo := NULL; v_dup := NULL;
    v_comp := '[]'::jsonb; v_conf := '[]'::jsonb;
    v_status_cli := NULL; v_status_reg := NULL;
    v_cpf_dig := nullif(r->>'cpf_digitos', '');

    IF coalesce(btrim(r->>'nome'), '') = '' THEN
      RAISE EXCEPTION 'Linha %: o campo Reclamante é obrigatório.', v_linha;
    END IF;

    -- (a) Linha já importada antes (mesma pasta / mesma impressão digital)
    SELECT * INTO v_lin FROM public.registro_linhas WHERE chave_linha = r->>'chave';
    IF FOUND THEN
      IF v_lin.importacao_id = v_imp THEN
        v_res := v_res || jsonb_build_object('linha', v_linha, 'nome', r->>'nome',
          'cliente', 'repetida', 'cliente_id', v_lin.cliente_id, 'registro', 'repetida',
          'linha_original', v_lin.linha, 'complementos', '[]'::jsonb, 'conflitos', '[]'::jsonb);
        CONTINUE;
      END IF;
      v_cli := v_lin.cliente_id;
      v_at := v_lin.atendimento_id;
      v_status_cli := 'ja_importado';
      v_status_reg := 'ja_importado';
    END IF;

    -- (b) Identificação do cliente
    IF v_cli IS NULL AND v_cpf_dig IS NOT NULL AND length(v_cpf_dig) = 11 THEN
      IF coalesce((r->>'cpf_valido')::boolean, false) THEN
        SELECT id INTO v_cli FROM public.clientes
        WHERE cpf_digitos = v_cpf_dig AND deleted_at IS NULL
        ORDER BY created_at LIMIT 1;
      ELSE
        -- CPF inválido: só identifica com CPF e nome idênticos.
        SELECT id INTO v_cli FROM public.clientes
        WHERE cpf_digitos = v_cpf_dig AND nome_normalizado = r->>'nome_normalizado' AND deleted_at IS NULL
        ORDER BY created_at LIMIT 1;
      END IF;
      IF v_cli IS NOT NULL THEN
        SELECT * INTO v_cliente FROM public.clientes WHERE id = v_cli;
        v_status_cli := CASE WHEN v_cliente.importacao_rf_id = v_imp THEN 'mesmo_arquivo' ELSE 'existente' END;
      END IF;
    END IF;

    IF v_cli IS NULL THEN
      -- Possíveis duplicidades: mesmo nome, sem identificação suficiente.
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'cpf', s.cpf)) INTO v_dup
      FROM (
        SELECT c.id, c.nome, c.cpf FROM public.clientes c
        WHERE c.nome_normalizado = r->>'nome_normalizado' AND c.deleted_at IS NULL
          AND (c.cpf_digitos IS NULL OR v_cpf_dig IS NULL OR c.cpf_digitos <> v_cpf_dig)
        ORDER BY c.created_at LIMIT 5
      ) s;

      INSERT INTO public.clientes
        (nome, nome_normalizado, cpf, status, origem_importacao, data_importacao,
         escritorio_origem, dados_rf, importacao_rf_id)
      VALUES
        (btrim(r->>'nome'), r->>'nome_normalizado', nullif(btrim(coalesce(r->>'cpf', '')), ''), 'ativo',
         'Ricardo Friedl', now(), 'ricardo_friedl', coalesce(r->'cliente', '{}'::jsonb), v_imp)
      RETURNING id INTO v_cli;
      v_status_cli := 'novo';
      PERFORM public._rf_historico(v_cli, NULL, 'importacao',
        'Cliente cadastrado pela importação Ricardo Friedl (' || coalesce(p_arquivo, 'arquivo') || ', aba ' || coalesce(p_aba, '-') || ', linha ' || v_linha || ').',
        p_aba, v_linha);

      IF v_dup IS NOT NULL THEN
        INSERT INTO public.revisoes_rf (tipo, cliente_id, outro_cliente_id, descricao, origem)
        SELECT 'duplicidade', v_cli, (d->>'id')::uuid,
          'Possível mesma pessoa: nome igual sem CPF que confirme a identidade.',
          jsonb_build_object('arquivo', p_arquivo, 'aba', p_aba, 'linha', v_linha, 'importacao_id', v_imp)
        FROM jsonb_array_elements(v_dup) d;
      END IF;
    ELSE
      -- Cliente existente: complementa dados pessoais; diferenças viram revisão.
      SELECT * INTO v_cliente FROM public.clientes WHERE id = v_cli FOR UPDATE;
      v_m := public._rf_mesclar('cliente', v_cli, NULL, v_cliente.dados_rf, coalesce(r->'cliente', '{}'::jsonb),
        v_linha, p_substituir, p_arquivo, p_aba, v_imp);
      v_comp := v_comp || (v_m->'complementos');
      v_conf := v_conf || (v_m->'conflitos');
      -- Nome e CPF do reclamante (colunas próprias). Mesma grafia normalizada
      -- ou mesmo CPF com outra formatação não é divergência.
      v_m2 := public._rf_mesclar('cliente', v_cli, NULL,
        jsonb_build_object('nome', v_cliente.nome, 'cpf_reclamante', coalesce(v_cliente.cpf, '')),
        jsonb_strip_nulls(jsonb_build_object(
          'nome', CASE WHEN r->>'nome_normalizado' = v_cliente.nome_normalizado THEN NULL ELSE btrim(r->>'nome') END,
          'cpf_reclamante', CASE WHEN v_cpf_dig IS NOT DISTINCT FROM v_cliente.cpf_digitos THEN NULL
                                 ELSE nullif(btrim(coalesce(r->>'cpf', '')), '') END)),
        v_linha, p_substituir, p_arquivo, p_aba, v_imp);
      v_comp := v_comp || (v_m2->'complementos');
      v_conf := v_conf || (v_m2->'conflitos');
      UPDATE public.clientes SET
        dados_rf = v_m->'dados',
        nome = v_m2->'dados'->>'nome',
        nome_normalizado = CASE WHEN v_m2->'dados'->>'nome' = v_cliente.nome THEN nome_normalizado
                                ELSE r->>'nome_normalizado' END,
        cpf = nullif(v_m2->'dados'->>'cpf_reclamante', '')
      WHERE id = v_cli;
    END IF;

    INSERT INTO public.cliente_escritorios (cliente_id, escritorio, importacao_id)
    VALUES (v_cli, 'ricardo_friedl', v_imp)
    ON CONFLICT (cliente_id, escritorio) DO NOTHING;

    -- (c) Registro (processo/atendimento). Linha só com dados pessoais
    -- (ex.: planilha apenas com "Reclamante") não cria registro vazio.
    IF v_at IS NULL AND v_status_reg IS NULL
       AND coalesce(r->'registro', '{}'::jsonb) = '{}'::jsonb
       AND coalesce(r->'extras', '{}'::jsonb) = '{}'::jsonb THEN
      v_status_reg := 'sem_registro';
    END IF;

    IF v_at IS NULL AND v_status_reg IS NULL THEN
      IF nullif(r->>'numero_digitos', '') IS NOT NULL AND nullif(r->>'tipo_norm', '') IS NOT NULL THEN
        v_chave_reg := 'rf:' || v_cli || ':' || (r->>'numero_digitos') || ':' || (r->>'tipo_norm');
        SELECT id INTO v_at FROM public.atendimentos WHERE chave_origem = v_chave_reg AND deleted_at IS NULL;
      ELSE
        v_chave_reg := 'rf:linha:' || (r->>'chave');
        v_motivo := CASE
          WHEN nullif(r->>'numero_digitos', '') IS NULL AND nullif(r->>'tipo_norm', '') IS NULL
            THEN 'Número do processo e tipo de ação ausentes'
          WHEN nullif(r->>'numero_digitos', '') IS NULL THEN 'Número do processo ausente'
          ELSE 'Tipo de ação ausente' END;
      END IF;

      IF v_at IS NOT NULL THEN
        v_status_reg := 'agrupado';
      ELSE
        INSERT INTO public.atendimentos
          (cliente_id, escritorio, numero_processo, processo_digitos, servico, situacao,
           chave_origem, dados_rf, informacoes_adicionais, modelo, revisao_motivo, origens)
        VALUES
          (v_cli, 'ricardo_friedl', r->'registro'->>'numero', nullif(r->>'numero_digitos', ''),
           r->'registro'->>'tipo_acao', r->'registro'->>'situacao',
           v_chave_reg, coalesce(r->'registro', '{}'::jsonb), coalesce(r->'extras', '{}'::jsonb),
           'rf_espaider', v_motivo,
           jsonb_build_array(jsonb_build_object('arquivo', p_arquivo, 'aba', p_aba, 'linha', v_linha)))
        RETURNING id INTO v_at;
        v_status_reg := 'novo';
        PERFORM public._rf_historico(v_cli, v_at, 'importacao',
          'Registro ' || coalesce(r->'registro'->>'numero', 'sem número') || ' — ' || coalesce(r->'registro'->>'tipo_acao', 'sem tipo de ação')
          || ' criado pela importação (' || coalesce(p_arquivo, 'arquivo') || ', linha ' || v_linha || ').',
          p_aba, v_linha);
        IF v_motivo IS NOT NULL THEN
          INSERT INTO public.revisoes_rf (tipo, cliente_id, atendimento_id, descricao, origem)
          VALUES ('associacao', v_cli, v_at, v_motivo || ': o registro não foi unido a nenhum outro. Revise a associação.',
            jsonb_build_object('arquivo', p_arquivo, 'aba', p_aba, 'linha', v_linha, 'importacao_id', v_imp));
        END IF;
      END IF;
    END IF;

    IF v_status_reg IN ('agrupado', 'ja_importado') AND v_at IS NOT NULL THEN
      SELECT * INTO v_atd FROM public.atendimentos WHERE id = v_at FOR UPDATE;
      v_m := public._rf_mesclar('registro', v_cli, v_at, v_atd.dados_rf, coalesce(r->'registro', '{}'::jsonb),
        v_linha, p_substituir, p_arquivo, p_aba, v_imp);
      v_comp := v_comp || (v_m->'complementos');
      v_conf := v_conf || (v_m->'conflitos');
      v_extra_conf := public._rf_mesclar('registro', v_cli, v_at, v_atd.informacoes_adicionais,
        coalesce(r->'extras', '{}'::jsonb), v_linha, p_substituir, p_arquivo, p_aba, v_imp, 'adicional:');
      v_comp := v_comp || (v_extra_conf->'complementos');
      v_conf := v_conf || (v_extra_conf->'conflitos');
      UPDATE public.atendimentos SET
        dados_rf = v_m->'dados',
        informacoes_adicionais = v_extra_conf->'dados',
        numero_processo = coalesce(numero_processo, v_m->'dados'->>'numero'),
        servico = coalesce(v_m->'dados'->>'tipo_acao', servico),
        situacao = coalesce(v_m->'dados'->>'situacao', situacao),
        origens = CASE WHEN v_status_reg = 'agrupado'
          THEN origens || jsonb_build_array(jsonb_build_object('arquivo', p_arquivo, 'aba', p_aba, 'linha', v_linha))
          ELSE origens END
      WHERE id = v_at;
    END IF;

    -- (d) Linha de origem (somente na primeira importação desta linha)
    IF v_status_cli IS DISTINCT FROM 'ja_importado' THEN
      INSERT INTO public.registro_linhas
        (cliente_id, atendimento_id, importacao_id, arquivo_nome, aba, linha, chave_linha, valores, extras, avisos)
      VALUES
        (v_cli, v_at, v_imp, p_arquivo, p_aba, v_linha, r->>'chave',
         coalesce(r->'valores', '{}'::jsonb), coalesce(r->'extras', '{}'::jsonb), coalesce(r->'avisos', '[]'::jsonb));
    END IF;

    v_res := v_res || jsonb_build_object(
      'linha', v_linha, 'nome', r->>'nome',
      'cliente', v_status_cli, 'cliente_id', v_cli,
      'registro', v_status_reg, 'atendimento_id', v_at,
      'revisao', v_motivo, 'duplicidades', coalesce(v_dup, '[]'::jsonb),
      'complementos', v_comp, 'conflitos', v_conf);
  END LOOP;

  UPDATE public.importacoes
  SET quantidade_clientes = quantidade_clientes + jsonb_array_length(p_linhas)
  WHERE id = v_imp;

  RETURN jsonb_build_object('importacao_id', v_imp, 'linhas', v_res);
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Ponto de entrada: simulação (prévia) ou gravação
-- ---------------------------------------------------------------------
-- p_simular = true executa exatamente a mesma lógica e desfaz tudo ao final
-- (subtransação), devolvendo o que aconteceria. A prévia e a gravação usam,
-- portanto, as mesmas regras.
CREATE OR REPLACE FUNCTION public.aplicar_importacao_rf(
  p_linhas jsonb,
  p_arquivo text,
  p_aba text,
  p_simular boolean DEFAULT true,
  p_substituir text[] DEFAULT ARRAY[]::text[],
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
      v_res := public._rf_processar(p_linhas, p_arquivo, p_aba, p_substituir, p_importacao_id);
      RAISE EXCEPTION 'simulacao' USING ERRCODE = 'RF001';
    EXCEPTION WHEN SQLSTATE 'RF001' THEN
      RETURN v_res || jsonb_build_object('simulacao', true);
    END;
  END IF;
  RETURN public._rf_processar(p_linhas, p_arquivo, p_aba, p_substituir, p_importacao_id)
    || jsonb_build_object('simulacao', false);
END;
$$;

-- ---------------------------------------------------------------------
-- 6. Edição manual de um campo no perfil (com histórico)
-- ---------------------------------------------------------------------
-- p_entidade: 'cliente' | 'registro' | 'adicional'
-- p_extra: { nome_normalizado?, numero_digitos?, tipo_norm? } (calculados no app)
CREATE OR REPLACE FUNCTION public.editar_campo_rf(
  p_entidade text, p_id uuid, p_campo text, p_valor text,
  p_extra jsonb DEFAULT '{}'::jsonb, p_motivo text DEFAULT 'edição manual'
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_valor text := nullif(btrim(coalesce(p_valor, '')), '');
  v_antes text;
  v_cli uuid;
  v_at uuid;
  v_dados jsonb;
  v_nova_chave text;
BEGIN
  IF p_entidade = 'cliente' THEN
    v_cli := p_id;
    IF p_campo = 'nome' THEN
      IF v_valor IS NULL THEN
        RAISE EXCEPTION 'O nome do cliente (Reclamante) é obrigatório.';
      END IF;
      SELECT nome INTO v_antes FROM public.clientes WHERE id = p_id FOR UPDATE;
      UPDATE public.clientes
      SET nome = v_valor, nome_normalizado = coalesce(nullif(p_extra->>'nome_normalizado', ''), lower(v_valor))
      WHERE id = p_id;
    ELSIF p_campo = 'cpf_reclamante' THEN
      SELECT cpf INTO v_antes FROM public.clientes WHERE id = p_id FOR UPDATE;
      UPDATE public.clientes SET cpf = v_valor WHERE id = p_id;
    ELSE
      SELECT dados_rf INTO v_dados FROM public.clientes WHERE id = p_id FOR UPDATE;
      v_antes := v_dados->>p_campo;
      UPDATE public.clientes SET dados_rf = CASE WHEN v_valor IS NULL THEN dados_rf - p_campo
        ELSE jsonb_set(dados_rf, ARRAY[p_campo], to_jsonb(v_valor)) END
      WHERE id = p_id;
    END IF;
  ELSIF p_entidade IN ('registro', 'adicional') THEN
    v_at := p_id;
    SELECT cliente_id, CASE WHEN p_entidade = 'registro' THEN dados_rf ELSE informacoes_adicionais END
      INTO v_cli, v_dados
    FROM public.atendimentos WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registro não encontrado.'; END IF;
    v_antes := v_dados->>p_campo;
    v_dados := CASE WHEN v_valor IS NULL THEN v_dados - p_campo
      ELSE jsonb_set(v_dados, ARRAY[p_campo], to_jsonb(v_valor)) END;
    IF p_entidade = 'adicional' THEN
      UPDATE public.atendimentos SET informacoes_adicionais = v_dados WHERE id = p_id;
    ELSE
      UPDATE public.atendimentos SET
        dados_rf = v_dados,
        numero_processo = CASE WHEN p_campo = 'numero' THEN v_valor ELSE numero_processo END,
        processo_digitos = CASE WHEN p_campo = 'numero'
          THEN nullif(regexp_replace(coalesce(v_valor, ''), '\D', '', 'g'), '') ELSE processo_digitos END,
        servico = CASE WHEN p_campo = 'tipo_acao' THEN v_valor ELSE servico END,
        situacao = CASE WHEN p_campo = 'situacao' THEN v_valor ELSE situacao END
      WHERE id = p_id;
      -- Número e tipo completos: o registro passa a ser reconhecido nas próximas importações.
      IF p_campo IN ('numero', 'tipo_acao')
         AND nullif(p_extra->>'numero_digitos', '') IS NOT NULL AND nullif(p_extra->>'tipo_norm', '') IS NOT NULL THEN
        v_nova_chave := 'rf:' || v_cli || ':' || (p_extra->>'numero_digitos') || ':' || (p_extra->>'tipo_norm');
        IF NOT EXISTS (SELECT 1 FROM public.atendimentos WHERE chave_origem = v_nova_chave AND id <> p_id) THEN
          UPDATE public.atendimentos SET chave_origem = v_nova_chave, revisao_motivo = NULL
          WHERE id = p_id AND modelo = 'rf_espaider';
        END IF;
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'Entidade inválida: %', p_entidade;
  END IF;

  IF v_antes IS DISTINCT FROM v_valor THEN
    PERFORM public._rf_historico(v_cli, v_at, 'alteracao',
      'Campo "' || CASE WHEN p_entidade = 'adicional' THEN 'adicional:' ELSE '' END || p_campo || '" alterado de "'
      || coalesce(v_antes, 'Não informado') || '" para "' || coalesce(v_valor, 'Não informado') || '" (' || p_motivo || ').',
      NULL, NULL);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 7. Revisões (divergências, duplicidades, associações)
-- ---------------------------------------------------------------------
-- p_acao: 'aplicar' (usa o valor novo) | 'manter' (mantém o atual) | 'revisado'
CREATE OR REPLACE FUNCTION public.resolver_revisao_rf(p_id uuid, p_acao text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v public.revisoes_rf%ROWTYPE;
  v_entidade text;
  v_campo text;
BEGIN
  SELECT * INTO v FROM public.revisoes_rf WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revisão não encontrada.'; END IF;

  IF p_acao = 'aplicar' AND v.tipo = 'divergencia' THEN
    v_entidade := v.entidade;
    v_campo := v.campo;
    IF v_campo LIKE 'adicional:%' THEN
      v_entidade := 'adicional';
      v_campo := substr(v_campo, length('adicional:') + 1);
    END IF;
    PERFORM public.editar_campo_rf(v_entidade,
      CASE WHEN v_entidade = 'cliente' THEN v.cliente_id ELSE v.atendimento_id END,
      v_campo, v.valor_novo, p_extra, 'versão da linha ' || coalesce(v.origem->>'linha', '?') || ' aplicada na revisão');
    UPDATE public.revisoes_rf SET status = 'aplicada', resolvido_em = now() WHERE id = p_id;
  ELSIF p_acao = 'manter' THEN
    UPDATE public.revisoes_rf SET status = 'mantida', resolvido_em = now() WHERE id = p_id;
  ELSE
    UPDATE public.revisoes_rf SET status = 'descartada', resolvido_em = now() WHERE id = p_id;
    IF v.tipo = 'associacao' AND v.atendimento_id IS NOT NULL THEN
      UPDATE public.atendimentos SET revisao_motivo = NULL WHERE id = v.atendimento_id;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_importacao_rf(jsonb, text, text, boolean, text[], uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editar_campo_rf(text, uuid, text, text, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolver_revisao_rf(uuid, text, jsonb) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. Realtime
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['registro_linhas', 'revisoes_rf', 'historico_cliente'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
