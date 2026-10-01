-- =====================================================================
-- Entradas financeiras por cliente (1 cliente = 1 perfil, N entradas)
--
-- * `pagamentos` passa a ser explicitamente a tabela de ENTRADAS: cada
--   linha com valor no Modelo Documento vira um registro próprio.
-- * classificacao: Contratuais / Atrasados / Sucumbência (por entrada).
-- * chave_importacao: impede que reimportar o mesmo arquivo duplique
--   entradas. Formato `v<centavos>#<ocorrência>` por cliente
--   (ex.: 2º valor de R$ 1.000,00 do cliente = v100000#2).
-- * linha_importacao: linha do arquivo de origem (rastreabilidade).
-- Aditiva e idempotente: nenhum dado existente é alterado.
-- =====================================================================

ALTER TABLE public.pagamentos
  ADD COLUMN IF NOT EXISTS classificacao TEXT,
  ADD COLUMN IF NOT EXISTS chave_importacao TEXT,
  ADD COLUMN IF NOT EXISTS linha_importacao INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pagamentos_classificacao_check') THEN
    ALTER TABLE public.pagamentos
      ADD CONSTRAINT pagamentos_classificacao_check
      CHECK (classificacao IS NULL OR classificacao IN ('contratuais', 'atrasados', 'sucumbencia'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pagamentos_chave_importacao
  ON public.pagamentos (cliente_id, chave_importacao)
  WHERE chave_importacao IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pagamentos_classificacao
  ON public.pagamentos (classificacao);

-- ---------------------------------------------------------------------
-- Importação do Modelo Documento — atômica, com N entradas por cliente
-- ---------------------------------------------------------------------
-- p_itens: um item por CLIENTE (nunca por linha):
--   { "acao": "criar", "linha": 2, "linhas": [2,5,9], "nome": "...",
--     "nome_normalizado": "...", "cpf": "..."|null, "numero_processo": "..."|null,
--     "entradas": [ { "valor": 1000.00, "chave": "v100000#1", "linha": 2 }, ... ] }
--   { "acao": "atualizar"|"marcar_pago", "linha": 3, "linhas": [3],
--     "cliente_id": "uuid", "alteracoes": { "cpf"?, "numero_processo"?, "status"? },
--     "entradas": [ ... ] }
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
BEGIN
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'Importação inválida: lista de itens ausente.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_acao := v_item->>'acao';

    IF v_acao = 'criar' THEN
      v_cpf_digitos := nullif(regexp_replace(coalesce(v_item->>'cpf', ''), '\D', '', 'g'), '');

      -- Nunca cria uma segunda pasta para o mesmo cliente.
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
         nullif(v_item->>'numero_processo', ''), 'ativo', p_origem, now())
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

      -- Mesma pasta: só completa o que está vazio e muda o status.
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

    -- Entradas financeiras: uma por linha com valor, cada uma com identidade
    -- própria. A chave única impede duplicar em reimportação; classificações
    -- já feitas nunca são tocadas (só INSERT de entradas novas).
    FOR v_entrada IN SELECT value FROM jsonb_array_elements(coalesce(v_item->'entradas', '[]'::jsonb)) LOOP
      v_valor := nullif(v_entrada->>'valor', '')::numeric;
      IF v_valor IS NULL OR v_valor <= 0 THEN
        CONTINUE;
      END IF;
      INSERT INTO public.pagamentos
        (cliente_id, valor, data_pagamento, tipo, observacao, usuario_cadastro,
         chave_importacao, linha_importacao)
      VALUES
        (v_id, v_valor, current_date, 'outro',
         'Modelo Documento — ' || coalesce(p_arquivo, 'arquivo') || ', linha ' || coalesce(v_entrada->>'linha', '?'),
         'Modelo Documento', v_entrada->>'chave', nullif(v_entrada->>'linha', '')::integer)
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

  INSERT INTO public.importacoes
    (nome_importacao, origem_arquivo, tipo_origem, quantidade_clientes, quantidade_ja_pagos)
  VALUES
    ('Modelo Documento — ' || coalesce(p_arquivo, 'arquivo'), p_arquivo, 'arquivo',
     coalesce(p_total_linhas, 0), v_movidos);

  RETURN jsonb_build_object(
    'novos', v_novos,
    'atualizados', v_atualizados,
    'movidos', v_movidos,
    'valores', v_valores,
    'valores_ignorados', v_ignorados
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_importacao_modelo(jsonb, text, text, integer) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
