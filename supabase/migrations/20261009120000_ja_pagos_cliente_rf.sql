-- =====================================================================
-- (Aplicada em produção em 09/10/2026.)
-- JÁ PAGOS = cliente RICARDO FRIEDL + pelo menos um recebimento confirmado
--
-- Substitui as regras anteriores de encaminhamento (processo pago / cliente
-- criado em JÁ PAGOS pela importação de valores):
--   * clientes.cliente_rf: identificação "cliente do Ricardo Friedl", vinda
--     da importação CLIENTES RICARDO FRIEDL (cliente_escritorios). Mantida
--     por gatilho; não depende da página em que o cliente está.
--   * Recebimento confirmado = linha em pagamentos (valor > 0, recebido pelo
--     escritório). Valores previstos/pendentes/sem confirmação não contam.
--   * clientes.status ('pago' = JÁ PAGOS, 'ativo' = CLIENTES) é recalculado
--     por _sincronizar_status_cliente sempre que muda o vínculo RF ou um
--     recebimento — o resultado não depende da ordem das importações.
--   * atendimentos.pago passa a significar apenas "processo finalizado"
--     (todos os valores recebidos); não decide mais a página.
-- Nenhum dado é apagado.
-- =====================================================================

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS cliente_rf BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_clientes_cliente_rf ON public.clientes (cliente_rf);

-- Identificação existente: vínculo gravado pela importação Ricardo Friedl.
UPDATE public.clientes c SET cliente_rf = true
WHERE NOT c.cliente_rf AND EXISTS (
  SELECT 1 FROM public.cliente_escritorios e
  WHERE e.cliente_id = c.id AND e.escritorio = 'ricardo_friedl');

CREATE OR REPLACE FUNCTION public.cliente_tem_recebimento(p_cliente uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pagamentos
    WHERE cliente_id = p_cliente AND valor > 0
      AND coalesce(destinatario, 'escritorio') = 'escritorio');
$$;

-- Página do cliente: JÁ PAGOS só com as duas condições.
CREATE OR REPLACE FUNCTION public._sincronizar_status_cliente(p_cliente uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v public.clientes%ROWTYPE;
  v_pago boolean;
  v_rec boolean;
BEGIN
  IF p_cliente IS NULL THEN RETURN; END IF;
  SELECT * INTO v FROM public.clientes WHERE id = p_cliente;
  IF NOT FOUND OR v.deleted_at IS NOT NULL OR coalesce(v.arquivado, false)
     OR v.status NOT IN ('ativo', 'inativo', 'pago') THEN
    RETURN;
  END IF;
  v_rec := public.cliente_tem_recebimento(p_cliente);
  v_pago := v.cliente_rf AND v_rec;
  IF v_pago AND v.status <> 'pago' THEN
    UPDATE public.clientes SET status = 'pago' WHERE id = p_cliente;
    INSERT INTO public.historico_cliente (cliente_id, categoria, texto, chave_origem)
    VALUES (p_cliente, 'alteracao',
            'Cliente movido para JÁ PAGOS: cliente Ricardo Friedl com recebimento confirmado.',
            'pagina:' || p_cliente || ':' || extract(epoch FROM clock_timestamp()));
  ELSIF NOT v_pago AND v.status = 'pago' THEN
    UPDATE public.clientes SET status = 'ativo' WHERE id = p_cliente;
    INSERT INTO public.historico_cliente (cliente_id, categoria, texto, chave_origem)
    VALUES (p_cliente, 'alteracao',
            'Cliente voltou para CLIENTES: ' ||
            CASE WHEN NOT v.cliente_rf AND NOT v_rec
                   THEN 'não identificado como cliente Ricardo Friedl e sem recebimento confirmado.'
                 WHEN NOT v.cliente_rf THEN 'não identificado como cliente Ricardo Friedl.'
                 ELSE 'sem recebimento confirmado.' END,
            'pagina:' || p_cliente || ':' || extract(epoch FROM clock_timestamp()));
  END IF;
END;
$$;

-- Vínculo Ricardo Friedl → clientes.cliente_rf → página.
CREATE OR REPLACE FUNCTION public._cliente_escritorios_rf()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_cli uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.cliente_id ELSE NEW.cliente_id END;
BEGIN
  UPDATE public.clientes c SET cliente_rf = EXISTS (
    SELECT 1 FROM public.cliente_escritorios e WHERE e.cliente_id = c.id AND e.escritorio = 'ricardo_friedl')
  WHERE c.id = v_cli;
  IF TG_OP = 'UPDATE' AND OLD.cliente_id IS DISTINCT FROM NEW.cliente_id THEN
    UPDATE public.clientes c SET cliente_rf = EXISTS (
      SELECT 1 FROM public.cliente_escritorios e WHERE e.cliente_id = c.id AND e.escritorio = 'ricardo_friedl')
    WHERE c.id = OLD.cliente_id;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_cliente_escritorios_rf ON public.cliente_escritorios;
CREATE TRIGGER trg_cliente_escritorios_rf
AFTER INSERT OR UPDATE OR DELETE ON public.cliente_escritorios
FOR EACH ROW EXECUTE FUNCTION public._cliente_escritorios_rf();

CREATE OR REPLACE FUNCTION public._clientes_rf_pagina()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cliente_rf IS DISTINCT FROM OLD.cliente_rf THEN
    INSERT INTO public.historico_cliente (cliente_id, categoria, texto, chave_origem)
    VALUES (NEW.id, 'alteracao',
            CASE WHEN NEW.cliente_rf THEN 'Cliente identificado como cliente Ricardo Friedl.'
                 ELSE 'Identificação de cliente Ricardo Friedl retirada.' END,
            'rf:ident:' || NEW.id || ':' || extract(epoch FROM clock_timestamp()));
    PERFORM public._sincronizar_status_cliente(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_clientes_rf_pagina ON public.clientes;
CREATE TRIGGER trg_clientes_rf_pagina
AFTER UPDATE OF cliente_rf ON public.clientes
FOR EACH ROW EXECUTE FUNCTION public._clientes_rf_pagina();

-- Recebimentos → página.
CREATE OR REPLACE FUNCTION public._pagamentos_pagina()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public._sincronizar_status_cliente(OLD.cliente_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
      OR NEW.valor IS DISTINCT FROM OLD.valor OR NEW.destinatario IS DISTINCT FROM OLD.destinatario) THEN
    PERFORM public._sincronizar_status_cliente(NEW.cliente_id);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_pagamentos_pagina ON public.pagamentos;
CREATE TRIGGER trg_pagamentos_pagina
AFTER INSERT OR UPDATE OR DELETE ON public.pagamentos
FOR EACH ROW EXECUTE FUNCTION public._pagamentos_pagina();

-- Processo pago = finalizado (não move mais o cliente de página).
CREATE OR REPLACE FUNCTION public.definir_processo_pago(p_atendimento uuid, p_pago boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_at public.atendimentos%ROWTYPE;
  v_num text;
BEGIN
  SELECT * INTO v_at FROM public.atendimentos
  WHERE id = p_atendimento AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Processo não encontrado.'; END IF;
  IF v_at.pago = p_pago THEN RETURN; END IF;

  UPDATE public.atendimentos
  SET pago = p_pago, pago_em = CASE WHEN p_pago THEN now() ELSE NULL END
  WHERE id = p_atendimento;

  v_num := coalesce(nullif(v_at.dados_rf->>'numero', ''), v_at.numero_processo, 'sem número');
  INSERT INTO public.historico_cliente (cliente_id, atendimento_id, categoria, texto, chave_origem)
  VALUES (v_at.cliente_id, v_at.id, 'alteracao',
          CASE WHEN p_pago
            THEN 'Processo ' || v_num || ' marcado como FINALIZADO — todos os valores recebidos.'
            ELSE 'Processo ' || v_num || ' voltou para PENDENTE (valores a receber).' END,
          'manual:pago:' || v_at.id || ':' || extract(epoch FROM clock_timestamp()));
END;
$$;

-- A página não é mais escolhida manualmente.
CREATE OR REPLACE FUNCTION public.definir_cliente_pago(p_cliente uuid, p_pago boolean)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'A página do cliente é automática: JÁ PAGOS = cliente Ricardo Friedl com pelo menos um recebimento confirmado.';
END;
$$;

-- Importação simples de valores: a página é decidida pela sincronização.
CREATE OR REPLACE FUNCTION public._recebimentos_mover(
  v_cli uuid, v_at uuid, p_arquivo text, p_aba text, v_linha integer, v_chave text
) RETURNS boolean LANGUAGE sql AS $$ SELECT false; $$;

-- Encontra ou cria clientes das importações de valores (CPF > nome exato).
-- Cliente novo entra em CLIENTES, SEM identificação Ricardo Friedl.
-- p_clientes: [{ ref, nome, nome_normalizado, cpf }]  →  [{ ref, cliente_id, criado }]
CREATE OR REPLACE FUNCTION public.criar_clientes_valores(p_clientes jsonb, p_arquivo text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r jsonb;
  v_cli uuid;
  v_cpf text;
  v_criado boolean;
  v_res jsonb := '[]'::jsonb;
BEGIN
  FOR r IN SELECT value FROM jsonb_array_elements(coalesce(p_clientes, '[]'::jsonb)) LOOP
    v_cli := NULL; v_criado := false;
    IF coalesce(btrim(r->>'nome'), '') = '' THEN CONTINUE; END IF;
    v_cpf := nullif(regexp_replace(coalesce(r->>'cpf', ''), '\D', '', 'g'), '');
    IF v_cpf IS NOT NULL THEN
      SELECT id INTO v_cli FROM public.clientes
      WHERE deleted_at IS NULL AND cpf_digitos = v_cpf ORDER BY created_at LIMIT 1;
    END IF;
    IF v_cli IS NULL THEN
      SELECT id INTO v_cli FROM public.clientes
      WHERE deleted_at IS NULL AND nome_normalizado = r->>'nome_normalizado'
        AND (v_cpf IS NULL OR cpf_digitos IS NULL OR cpf_digitos = v_cpf)
      ORDER BY created_at LIMIT 1;
    END IF;
    IF v_cli IS NULL THEN
      INSERT INTO public.clientes (nome, nome_normalizado, cpf, status, origem_importacao, data_importacao)
      VALUES (btrim(r->>'nome'), r->>'nome_normalizado', nullif(btrim(coalesce(r->>'cpf', '')), ''),
              'ativo', 'valores_recebidos', now())
      RETURNING id INTO v_cli;
      v_criado := true;
      INSERT INTO public.historico_cliente (cliente_id, categoria, texto, chave_origem)
      VALUES (v_cli, 'importacao',
              'Cliente criado em CLIENTES pela importação Clientes com Valores Recebidos (' ||
              coalesce(p_arquivo, 'arquivo') || ').', 'rv:cli:' || v_cli);
    END IF;
    v_res := v_res || jsonb_build_object('ref', r->>'ref', 'cliente_id', v_cli, 'criado', v_criado);
  END LOOP;
  RETURN v_res;
END;
$$;
GRANT EXECUTE ON FUNCTION public.criar_clientes_valores(jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cliente_tem_recebimento(uuid) TO anon, authenticated, service_role;

-- Importação CLIENTES RICARDO FRIEDL: CPF > nome completo idêntico (sem duplicar).
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

    -- (b2) Sem CPF que identifique: nome completo normalizado idêntico (um único
    -- cadastro, sem CPF divergente) — inclusive clientes criados pela importação
    -- de valores recebidos. Nomes apenas parecidos não unem (viram revisão).
    IF v_cli IS NULL AND (SELECT count(*) FROM public.clientes c
        WHERE c.nome_normalizado = r->>'nome_normalizado' AND c.deleted_at IS NULL
          AND (c.cpf_digitos IS NULL OR v_cpf_dig IS NULL OR c.cpf_digitos = v_cpf_dig)) = 1 THEN
      SELECT id INTO v_cli FROM public.clientes c
      WHERE c.nome_normalizado = r->>'nome_normalizado' AND c.deleted_at IS NULL
        AND (c.cpf_digitos IS NULL OR v_cpf_dig IS NULL OR c.cpf_digitos = v_cpf_dig);
      SELECT * INTO v_cliente FROM public.clientes WHERE id = v_cli;
      v_status_cli := CASE WHEN v_cliente.importacao_rf_id = v_imp THEN 'mesmo_arquivo' ELSE 'existente' END;
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
        cpf = nullif(v_m2->'dados'->>'cpf_reclamante', ''),
        -- Identificado agora como cliente Ricardo Friedl (origem antes desconhecida).
        escritorio_origem = CASE WHEN escritorio_origem = 'a_confirmar' THEN 'ricardo_friedl' ELSE escritorio_origem END,
        importacao_rf_id = coalesce(importacao_rf_id, v_imp)
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

-- Importação de valores em blocos: cliente novo em CLIENTES; processo novo não finalizado.
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
                'ativo', 'valores_pri_execucao', now())
        RETURNING id INTO v_cli;
        v_cli_criado := true;
        v_criados := v_criados + 1;
        INSERT INTO public.historico_cliente (cliente_id, categoria, texto, aba, celulas, chave_origem)
        VALUES (v_cli, 'importacao',
                'Cliente criado em CLIENTES pela importação de valores (' || coalesce(p_arquivo, 'arquivo') ||
                ', ' || coalesce(r->>'aba', '') || ' ' || coalesce(r->>'celulas', '') || ').',
                r->>'aba', r->>'celulas', 'vb:cli:' || v_cli);
      END IF;
      -- A página (CLIENTES / JÁ PAGOS) é definida por _sincronizar_status_cliente:
      -- a importação de valores nunca identifica o cliente como Ricardo Friedl.
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
           false, NULL)
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
        v_resultado := 'ja_recebido'; -- já recebido no perfil: não volta a pendente
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

-- Importação simples de valores: sem mover cliente/processo por conta própria.
CREATE OR REPLACE FUNCTION public._recebimentos_processar(
  p_itens jsonb, p_arquivo text, p_aba text, p_importacao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r jsonb;
  v_imp uuid := p_importacao_id;
  v_cli uuid;
  v_cliente public.clientes%ROWTYPE;
  v_valor numeric;
  v_data date;
  v_class text;
  v_at uuid;
  v_esc text;
  v_pag uuid;
  v_res jsonb := '[]'::jsonb;
  v_resultado text;
  v_movido boolean;
  v_movidos integer := 0;
  v_linha integer;
  v_tem_proc boolean;
  v_achou boolean;
  v_total numeric;
BEGIN
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'Importação inválida: lista de valores ausente.';
  END IF;

  IF v_imp IS NULL THEN
    INSERT INTO public.importacoes
      (nome_importacao, origem_arquivo, tipo_origem, quantidade_clientes, modelo, aba)
    VALUES
      ('Valores recebidos — ' || coalesce(p_arquivo, 'arquivo'), p_arquivo, 'arquivo', 0,
       'recebimentos', p_aba)
    RETURNING id INTO v_imp;
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_linha := (r->>'linha')::integer;
    v_cli := (r->>'cliente_id')::uuid;
    v_valor := nullif(r->>'valor', '')::numeric;
    v_data := nullif(r->>'data', '')::date;
    v_class := nullif(r->>'classificacao', '');
    v_at := nullif(r->>'atendimento_id', '')::uuid;
    v_total := nullif(r->>'total_previsto', '')::numeric;
    v_movido := false;
    v_pag := NULL;
    v_esc := NULL;

    IF v_class = 'contratuais' THEN v_class := 'implantacao'; END IF;
    IF v_class IS NOT NULL AND v_class NOT IN ('atrasados', 'implantacao', 'sucumbencia') THEN
      v_class := NULL;
    END IF;

    SELECT * INTO v_cliente FROM public.clientes WHERE id = v_cli FOR UPDATE;
    v_achou := FOUND;

    IF v_achou AND v_at IS NOT NULL THEN
      SELECT escritorio INTO v_esc FROM public.atendimentos
      WHERE id = v_at AND cliente_id = v_cli AND deleted_at IS NULL;
      IF NOT FOUND THEN v_at := NULL; v_esc := NULL; END IF;
    END IF;

    IF NOT v_achou OR v_cliente.deleted_at IS NOT NULL OR v_cliente.arquivado THEN
      v_resultado := 'cliente_indisponivel';
    ELSIF coalesce((r->>'sem_valor')::boolean, false) THEN
      v_tem_proc := EXISTS (SELECT 1 FROM public.atendimentos
                            WHERE cliente_id = v_cli AND deleted_at IS NULL);
      -- Linha sem valor não é recebimento confirmado: não muda a página do cliente.
      IF v_at IS NULL AND v_tem_proc THEN
        v_resultado := 'processo_nao_definido';
      ELSE
        v_resultado := 'sem_valor';
      END IF;
    ELSIF v_valor IS NULL OR v_valor <= 0 THEN
      v_resultado := 'valor_invalido';
    ELSIF v_class = 'sucumbencia' AND v_at IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.processo_categorias
      WHERE atendimento_id = v_at AND categoria = 'sucumbencia' AND nao_havera
    ) THEN
      v_resultado := 'conflito_nao_havera';
    ELSIF v_data IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.pagamentos p
      WHERE p.cliente_id = v_cli AND p.chave_importacao IS NULL
        AND p.valor = v_valor AND p.data_pagamento = v_data
    ) THEN
      v_resultado := 'possivel_duplicado';
    ELSE
      INSERT INTO public.pagamentos
        (cliente_id, valor, data_pagamento, tipo, observacao, usuario_cadastro, classificacao,
         chave_importacao, linha_importacao, atendimento_id, escritorio, importacao_id, dados_origem)
      VALUES
        (v_cli, v_valor, coalesce(v_data, current_date), 'outro',
         coalesce(nullif(btrim(coalesce(r->>'observacao', '')), ''),
                  'Valores recebidos — ' || coalesce(p_arquivo, 'arquivo') || ', linha ' || v_linha),
         'Importação de valores recebidos', v_class, r->>'chave', v_linha, v_at, v_esc, v_imp,
         coalesce(r->'dados_origem', '{}'::jsonb))
      ON CONFLICT (cliente_id, chave_importacao) WHERE chave_importacao IS NOT NULL
      DO NOTHING
      RETURNING id INTO v_pag;

      IF v_pag IS NULL THEN
        v_resultado := 'ja_registrado';
      ELSE
        v_resultado := 'inserido';
        INSERT INTO public.historico_cliente
          (cliente_id, atendimento_id, categoria, texto, aba, celulas, escritorio, chave_origem)
        VALUES
          (v_cli, v_at, 'importacao',
           'Valor recebido de ' || public._brl(v_valor) ||
           ' (' || public._rotulo_categoria(v_class) ||
           coalesce(', processo ' || public._numero_do_processo(v_at), ', sem processo — para conferência') || ')' ||
           ' registrado pela importação Clientes com Valores Recebidos (' || coalesce(p_arquivo, 'arquivo') ||
           ', linha ' || v_linha || ').',
           p_aba, 'linha ' || v_linha, v_esc, 'rv:hist:' || v_pag);

        -- Total a receber / recebimento integral informados na planilha:
        -- só completam o que está vazio (nunca sobrescrevem o card).
        IF v_at IS NOT NULL AND v_class IS NOT NULL
           AND (v_total > 0 OR coalesce((r->>'integral')::boolean, false)) THEN
          INSERT INTO public.processo_categorias (atendimento_id, categoria)
          VALUES (v_at, v_class)
          ON CONFLICT (atendimento_id, categoria) DO NOTHING;
          UPDATE public.processo_categorias SET
            total_previsto = CASE WHEN total_previsto IS NULL AND v_total > 0 THEN round(v_total, 2) ELSE total_previsto END,
            integral_confirmado = integral_confirmado OR coalesce((r->>'integral')::boolean, false)
          WHERE atendimento_id = v_at AND categoria = v_class;
        END IF;

        -- JÁ PAGOS: decidido por _sincronizar_status_cliente (cliente RF + recebimento).
        v_movido := (v_cliente.status IS DISTINCT FROM 'pago')
                    AND (SELECT status FROM public.clientes WHERE id = v_cli) = 'pago';
      END IF;
    END IF;

    IF v_movido THEN v_movidos := v_movidos + 1; END IF;

    v_res := v_res || jsonb_build_object(
      'linha', v_linha, 'cliente_id', v_cli, 'chave', r->>'chave',
      'resultado', v_resultado, 'movido', v_movido, 'pagamento_id', v_pag,
      'atendimento_id', v_at);
  END LOOP;

  UPDATE public.importacoes
  SET quantidade_ja_pagos = quantidade_ja_pagos + v_movidos
  WHERE id = v_imp;

  RETURN jsonb_build_object('importacao_id', v_imp, 'linhas', v_res);
END;
$$;

-- ---------------------------------------------------------------------
-- Adequação dos registros existentes
-- ---------------------------------------------------------------------
-- Processos criados pela importação em blocos só foram marcados como pagos
-- para ficarem em JÁ PAGOS (regra anterior): voltam a "não finalizado".
INSERT INTO public.historico_cliente (cliente_id, atendimento_id, categoria, texto, chave_origem)
SELECT a.cliente_id, a.id, 'alteracao',
       'Processo ' || coalesce(nullif(a.dados_rf->>'numero', ''), a.numero_processo, 'sem número') ||
       ' deixou de constar como pago: a marcação vinha da regra anterior da importação de valores ' ||
       '(a página agora depende de cliente Ricardo Friedl + recebimento confirmado).',
       'regra-ja-pagos:' || a.id
FROM public.atendimentos a
WHERE a.modelo = 'blocos_valores' AND a.pago AND NOT a.finalizacao_validada AND a.deleted_at IS NULL
ON CONFLICT (chave_origem) DO NOTHING;
UPDATE public.atendimentos SET pago = false, pago_em = NULL
WHERE modelo = 'blocos_valores' AND pago AND NOT finalizacao_validada AND deleted_at IS NULL;

-- Recalcula a página de todos os clientes pela regra nova.
SELECT public._sincronizar_status_cliente(id) FROM public.clientes WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
