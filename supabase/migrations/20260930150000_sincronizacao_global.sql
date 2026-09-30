-- =====================================================================
-- Sincronização global e consistência transacional
--
-- 1. Operações críticas passam a rodar em UMA transação no banco
--    (função plpgsql = tudo ou nada). Nenhum estado parcial:
--      * aplicar_importacao_modelo  (Modelo Documento ATLAS_CLIENTES_V1)
--      * excluir_cliente            (exclusão definitiva em cascata)
--      * zerar_sistema              (limpeza total)
-- 2. Tabelas de domínio publicadas no Supabase Realtime, para que todas as
--    telas abertas se atualizem sozinhas.
--
-- Status gravados respeitam clientes_status_check
-- ('ativo','inativo','arquivado','pago'). Nenhum status novo é criado.
-- Idempotente: pode ser executada mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a. Importação do Modelo Documento — atômica
-- ---------------------------------------------------------------------
-- p_itens: array JSON gerado pelo planejador do frontend, somente com
-- linhas que gravam algo:
--   { "acao": "criar", "linha": 5, "nome": "...", "nome_normalizado": "...",
--     "cpf": "000.000.000-00"|null, "numero_processo": "..."|null }
--   { "acao": "atualizar"|"marcar_pago", "linha": 6, "cliente_id": "uuid",
--     "alteracoes": { "cpf"?, "numero_processo"?, "status"? },
--     "valor": 1500.00|null }
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
  v_acao text;
  v_id uuid;
  v_cpf_digitos text;
  v_status_anterior text;
  v_novo_status text;
  v_alt jsonb;
  v_valor numeric;
  v_novos integer := 0;
  v_atualizados integer := 0;
  v_movidos integer := 0;
  v_valores integer := 0;
BEGIN
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'Importação inválida: lista de itens ausente.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_acao := v_item->>'acao';

    IF v_acao = 'criar' THEN
      v_cpf_digitos := nullif(regexp_replace(coalesce(v_item->>'cpf', ''), '\D', '', 'g'), '');

      -- Prevenção de duplicidade no próprio banco (protege contra a base ter
      -- mudado entre a pré-visualização e a confirmação).
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
        (nome, nome_normalizado, cpf, numero_processo, status, origem_importacao, data_importacao)
      VALUES
        (v_item->>'nome', v_item->>'nome_normalizado', nullif(v_item->>'cpf', ''),
         nullif(v_item->>'numero_processo', ''), 'ativo', p_origem, now());
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

      -- Só preenche o que está vazio; nunca sobrescreve dado cadastrado.
      UPDATE public.clientes SET
        cpf = CASE WHEN v_alt ? 'cpf' AND coalesce(cpf, '') = '' THEN v_alt->>'cpf' ELSE cpf END,
        numero_processo = CASE WHEN v_alt ? 'numero_processo' AND coalesce(numero_processo, '') = ''
                               THEN v_alt->>'numero_processo' ELSE numero_processo END,
        status = v_novo_status
      WHERE id = v_id;

      v_valor := nullif(v_item->>'valor', '')::numeric;
      IF v_valor IS NOT NULL AND v_valor > 0 THEN
        INSERT INTO public.pagamentos
          (cliente_id, valor, data_pagamento, tipo, observacao, usuario_cadastro)
        VALUES
          (v_id, v_valor, current_date, 'outro',
           'Importado via Modelo Documento (ATLAS_CLIENTES_V1)', 'Modelo Documento');
        v_valores := v_valores + 1;
      END IF;

      IF v_novo_status = 'pago' AND v_status_anterior IS DISTINCT FROM 'pago' THEN
        v_movidos := v_movidos + 1;
      ELSE
        v_atualizados := v_atualizados + 1;
      END IF;

    ELSE
      RAISE EXCEPTION 'Ação desconhecida na importação: %', v_acao;
    END IF;
  END LOOP;

  INSERT INTO public.importacoes
    (nome_importacao, origem_arquivo, tipo_origem, quantidade_clientes, quantidade_ja_pagos)
  VALUES
    ('Modelo Documento — ' || coalesce(p_arquivo, 'arquivo'), p_arquivo, 'arquivo',
     coalesce(p_total_linhas, 0), v_movidos);

  RETURN jsonb_build_object(
    'novos', v_novos,
    'atualizados', v_atualizados,
    'movidos', v_movidos,
    'valores', v_valores
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 1b. Exclusão definitiva — atômica
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_cliente(p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.clientes WHERE id = p_cliente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  DELETE FROM public.correspondencias
  WHERE cliente_encontrado_id = p_cliente_id
     OR cliente_importado_id IN (
       SELECT id FROM public.clientes_importados WHERE cliente_vinculado_id = p_cliente_id
     );
  DELETE FROM public.clientes_importados WHERE cliente_vinculado_id = p_cliente_id;
  DELETE FROM public.pagamentos WHERE cliente_id = p_cliente_id;
  DELETE FROM public.variacoes_nome WHERE cliente_id = p_cliente_id;
  DELETE FROM public.clientes WHERE id = p_cliente_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 1c. Zerar sistema — atômico (preserva configurações)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zerar_sistema()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.correspondencias WHERE true;
  DELETE FROM public.correspondencias_rejeitadas WHERE true;
  DELETE FROM public.clientes_importados WHERE true;
  DELETE FROM public.importacoes WHERE true;
  DELETE FROM public.pagamentos WHERE true;
  DELETE FROM public.variacoes_nome WHERE true;
  DELETE FROM public.clientes WHERE true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_importacao_modelo(jsonb, text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_cliente(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zerar_sistema() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Realtime
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['clientes','pagamentos','variacoes_nome','importacoes','clientes_importados','correspondencias'] LOOP
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
