-- =====================================================================
-- Número do processo (judicial ou administrativo) por processo do cliente
-- ---------------------------------------------------------------------
-- * Cada processo (atendimento) tem o seu próprio número e a sua natureza
--   (atendimentos.natureza: 'judicial' | 'administrativo' — coluna já existente).
-- * Judicial: numeração CNJ (20 dígitos, NNNNNNN-DD.AAAA.J.TR.OOOO, DV módulo 97).
-- * Administrativo: protocolo/requerimento/procedimento (texto livre com número).
-- * Mesmo cliente + mesmo número + mesmo tipo de ação = mesmo registro:
--   não é permitido gravar um número que duplique outro processo do cliente.
-- * Nada é excluído; toda alteração fica no histórico do cliente.
-- =====================================================================

-- Dígito verificador CNJ (18 dígitos sem o DV → 'DD').
CREATE OR REPLACE FUNCTION public._cnj_dv(p_digitos text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lpad((98 - (substr(p_digitos, 1, 7) || substr(p_digitos, 10) || '00')::numeric % 97)::int::text, 2, '0');
$$;

-- Valida/normaliza. Retorna o número formatado (ou NULL para "sem número").
CREATE OR REPLACE FUNCTION public._normalizar_numero_processo(p_natureza text, p_numero text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := nullif(btrim(regexp_replace(coalesce(p_numero, ''), '\s+', ' ', 'g')), '');
  d text;
BEGIN
  IF p_natureza NOT IN ('judicial', 'administrativo') THEN
    RAISE EXCEPTION 'Informe se o processo é judicial ou administrativo.';
  END IF;
  IF v IS NULL THEN RETURN NULL; END IF;
  IF p_natureza = 'judicial' THEN
    IF v ~* '[a-z]' THEN
      RAISE EXCEPTION 'Processo judicial: informe somente a numeração CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO).';
    END IF;
    d := regexp_replace(v, '\D', '', 'g');
    IF length(d) <> 20 THEN
      RAISE EXCEPTION 'Processo judicial: a numeração CNJ tem 20 dígitos; foram informados %.', length(d);
    END IF;
    IF public._cnj_dv(d) <> substr(d, 8, 2) THEN
      RAISE EXCEPTION 'Número CNJ inválido: o dígito verificador deveria ser %, não %.', public._cnj_dv(d), substr(d, 8, 2);
    END IF;
    RETURN substr(d, 1, 7) || '-' || substr(d, 8, 2) || '.' || substr(d, 10, 4) || '.'
      || substr(d, 14, 1) || '.' || substr(d, 15, 2) || '.' || substr(d, 17, 4);
  END IF;
  IF length(v) > 80 THEN
    RAISE EXCEPTION 'Número administrativo muito longo (máximo de 80 caracteres).';
  END IF;
  IF v !~ '\d' THEN
    RAISE EXCEPTION 'Informe o número do protocolo, requerimento ou procedimento (deve conter ao menos um número).';
  END IF;
  RETURN v;
END;
$$;

-- Outro processo vigente do mesmo cliente com o mesmo número e o mesmo tipo de ação?
CREATE OR REPLACE FUNCTION public._processo_duplicado(
  p_cliente uuid, p_ignorar uuid, p_digitos text, p_tipo_norm text
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_digitos IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.atendimentos a
    WHERE a.cliente_id = p_cliente
      AND a.deleted_at IS NULL
      AND (p_ignorar IS NULL OR a.id <> p_ignorar)
      AND a.processo_digitos = p_digitos
      AND lower(btrim(coalesce(nullif(a.dados_rf->>'tipo_acao', ''), a.servico, '')))
          = lower(btrim(coalesce(p_tipo_norm, '')))
  );
$$;

-- ---------------------------------------------------------------------
-- Edição do número/natureza de um processo
-- p_extra: { tipo_norm? } (tipo de ação normalizado, calculado no app)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.definir_numero_processo(
  p_id uuid, p_natureza text, p_numero text, p_extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  a public.atendimentos%ROWTYPE;
  v_numero text := public._normalizar_numero_processo(p_natureza, p_numero);
  v_digitos text := nullif(regexp_replace(coalesce(v_numero, ''), '\D', '', 'g'), '');
  v_antes text;
  v_tipo text;
  v_tipo_norm text := nullif(p_extra->>'tipo_norm', '');
  v_chave text;
BEGIN
  SELECT * INTO a FROM public.atendimentos WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Processo não encontrado.'; END IF;

  v_antes := coalesce(nullif(a.dados_rf->>'numero', ''), a.numero_processo);
  v_tipo := coalesce(nullif(a.dados_rf->>'tipo_acao', ''), a.servico);

  IF public._processo_duplicado(a.cliente_id, a.id, v_digitos, v_tipo) THEN
    RAISE EXCEPTION 'Este cliente já tem outro processo com o número % e o mesmo tipo de ação.', v_numero;
  END IF;

  UPDATE public.atendimentos SET
    natureza = p_natureza,
    numero_processo = v_numero,
    processo_digitos = v_digitos,
    dados_rf = CASE WHEN v_numero IS NULL THEN dados_rf - 'numero'
      ELSE jsonb_set(dados_rf, ARRAY['numero'], to_jsonb(v_numero)) END,
    updated_at = now()
  WHERE id = p_id;

  -- Número e tipo completos: reconhecido nas próximas importações.
  IF v_digitos IS NOT NULL AND v_tipo_norm IS NOT NULL AND a.modelo = 'rf_espaider' THEN
    v_chave := 'rf:' || a.cliente_id || ':' || v_digitos || ':' || v_tipo_norm;
    IF NOT EXISTS (SELECT 1 FROM public.atendimentos WHERE chave_origem = v_chave AND id <> p_id) THEN
      UPDATE public.atendimentos SET chave_origem = v_chave, revisao_motivo = NULL WHERE id = p_id;
    END IF;
  END IF;

  IF v_antes IS DISTINCT FROM v_numero OR a.natureza IS DISTINCT FROM p_natureza THEN
    PERFORM public._rf_historico(a.cliente_id, a.id, 'alteracao',
      'Número do processo alterado de "' || coalesce(v_antes, 'Sem número')
      || CASE WHEN a.natureza IS NULL THEN '' ELSE ' (' || initcap(a.natureza) || ')' END
      || '" para "' || coalesce(v_numero, 'Sem número') || ' (' || initcap(p_natureza) || ')" (edição manual no perfil).',
      NULL, NULL);
  END IF;

  RETURN jsonb_build_object('id', p_id, 'numero', v_numero, 'natureza', p_natureza);
END;
$$;

-- ---------------------------------------------------------------------
-- Cadastro manual de um novo processo no perfil do cliente
-- p_extra: { tipo_norm? }
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_processo_cliente(
  p_cliente uuid, p_natureza text, p_numero text, p_tipo_acao text,
  p_extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_numero text := public._normalizar_numero_processo(p_natureza, p_numero);
  v_digitos text := nullif(regexp_replace(coalesce(v_numero, ''), '\D', '', 'g'), '');
  v_tipo text := nullif(btrim(coalesce(p_tipo_acao, '')), '');
  v_tipo_norm text := nullif(p_extra->>'tipo_norm', '');
  v_rf boolean;
  v_chave text;
  v_dados jsonb := '{}'::jsonb;
  v_id uuid;
BEGIN
  SELECT coalesce(cliente_rf, false) INTO v_rf
  FROM public.clientes WHERE id = p_cliente AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;

  IF public._processo_duplicado(p_cliente, NULL, v_digitos, v_tipo) THEN
    RAISE EXCEPTION 'Este cliente já tem um processo com o número % e o mesmo tipo de ação.', v_numero;
  END IF;

  IF v_numero IS NOT NULL THEN v_dados := v_dados || jsonb_build_object('numero', v_numero); END IF;
  IF v_tipo IS NOT NULL THEN v_dados := v_dados || jsonb_build_object('tipo_acao', v_tipo); END IF;

  v_chave := CASE WHEN v_digitos IS NOT NULL AND v_tipo_norm IS NOT NULL
    THEN 'rf:' || p_cliente || ':' || v_digitos || ':' || v_tipo_norm
    ELSE 'manual:' || gen_random_uuid() END;
  IF EXISTS (SELECT 1 FROM public.atendimentos WHERE chave_origem = v_chave) THEN
    v_chave := 'manual:' || gen_random_uuid();
  END IF;

  INSERT INTO public.atendimentos
    (cliente_id, escritorio, natureza, numero_processo, processo_digitos, servico,
     chave_origem, dados_rf, modelo, origens)
  VALUES
    (p_cliente, CASE WHEN v_rf THEN 'ricardo_friedl' ELSE 'a_confirmar' END, p_natureza,
     v_numero, v_digitos, v_tipo, v_chave, v_dados, 'rf_espaider',
     jsonb_build_array(jsonb_build_object('arquivo', 'cadastro manual no perfil')))
  RETURNING id INTO v_id;

  PERFORM public._rf_historico(p_cliente, v_id, 'alteracao',
    'Processo ' || coalesce(v_numero, 'sem número') || ' (' || initcap(p_natureza) || ') — '
    || coalesce(v_tipo, 'sem tipo de ação') || ' cadastrado manualmente no perfil.',
    NULL, NULL);

  RETURN jsonb_build_object('id', v_id, 'numero', v_numero, 'natureza', p_natureza);
END;
$$;

GRANT EXECUTE ON FUNCTION public.definir_numero_processo(uuid, text, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.criar_processo_cliente(uuid, text, text, text, jsonb) TO anon, authenticated, service_role;
