-- =====================================================================
-- Importação "Clientes com Valores Recebidos": só o Reclamante é obrigatório.
-- Item com "sem_valor": true apenas move o cliente para JÁ PAGOS (status
-- 'pago'), sem criar pagamento — os valores são lançados depois, no perfil.
-- Resultados novos: marcado_pago | ja_pago. Aditiva: nada é apagado.
-- =====================================================================

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
    v_movido := false;
    v_pag := NULL;

    IF v_class IS NOT NULL AND v_class NOT IN ('contratuais', 'atrasados', 'sucumbencia') THEN
      v_class := NULL;
    END IF;

    SELECT * INTO v_cliente FROM public.clientes WHERE id = v_cli FOR UPDATE;

    IF NOT FOUND OR v_cliente.deleted_at IS NOT NULL OR v_cliente.arquivado THEN
      v_resultado := 'cliente_indisponivel';
    ELSIF coalesce((r->>'sem_valor')::boolean, false) THEN
      -- Linha sem valor: só move o cliente para JÁ PAGOS (nenhum pagamento é
      -- criado); os valores são lançados depois, manualmente, no perfil.
      IF v_cliente.status IS DISTINCT FROM 'pago' THEN
        UPDATE public.clientes SET status = 'pago' WHERE id = v_cli;
        v_movido := true;
        v_movidos := v_movidos + 1;
        v_resultado := 'marcado_pago';
        INSERT INTO public.historico_cliente
          (cliente_id, categoria, texto, aba, celulas, chave_origem)
        VALUES
          (v_cli, 'alteracao',
           'Cliente movido para JÁ PAGOS (status "' || coalesce(v_cliente.status, '-') ||
           '" → "pago") pela importação Clientes com Valores Recebidos (' ||
           coalesce(p_arquivo, 'arquivo') || ', linha ' || v_linha ||
           '), sem valor informado — lançar os valores no perfil.',
           p_aba, 'linha ' || v_linha, 'rv:sv:' || coalesce(v_imp::text, '') || ':' || v_linha);
      ELSE
        v_resultado := 'ja_pago';
      END IF;
    ELSIF v_valor IS NULL OR v_valor <= 0 THEN
      v_resultado := 'valor_invalido';
    ELSIF v_data IS NOT NULL AND EXISTS (
      -- Mesmo valor e data já lançados manualmente: não duplica sem revisão.
      SELECT 1 FROM public.pagamentos p
      WHERE p.cliente_id = v_cli AND p.chave_importacao IS NULL
        AND p.valor = v_valor AND p.data_pagamento = v_data
    ) THEN
      v_resultado := 'possivel_duplicado';
    ELSE
      IF v_at IS NOT NULL THEN
        SELECT escritorio INTO v_esc FROM public.atendimentos
        WHERE id = v_at AND cliente_id = v_cli AND deleted_at IS NULL;
        IF NOT FOUND THEN v_at := NULL; v_esc := NULL; END IF;
      ELSE
        v_esc := NULL;
      END IF;

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
           'Valor recebido de R$ ' || translate(to_char(v_valor, 'FM999,999,999,990.00'), ',.', '.,') ||
           coalesce(' (' || CASE v_class WHEN 'contratuais' THEN 'Contratual'
                                         WHEN 'atrasados' THEN 'Atrasados'
                                         WHEN 'sucumbencia' THEN 'Sucumbência' END || ')', ' (sem categoria)') ||
           ' registrado pela importação Clientes com Valores Recebidos (' || coalesce(p_arquivo, 'arquivo') ||
           ', linha ' || v_linha || ').',
           p_aba, 'linha ' || v_linha, v_esc, 'rv:hist:' || v_pag);

        IF v_cliente.status IS DISTINCT FROM 'pago' THEN
          UPDATE public.clientes SET status = 'pago' WHERE id = v_cli;
          v_movido := true;
          v_movidos := v_movidos + 1;
          INSERT INTO public.historico_cliente
            (cliente_id, categoria, texto, aba, celulas, chave_origem)
          VALUES
            (v_cli, 'alteracao',
             'Cliente movido para JÁ PAGOS (status "' || coalesce(v_cliente.status, '-') ||
             '" → "pago") pela importação de valores recebidos (' || coalesce(p_arquivo, 'arquivo') || ').',
             p_aba, 'linha ' || v_linha, 'rv:mov:' || v_pag);
        END IF;
      END IF;
    END IF;

    v_res := v_res || jsonb_build_object(
      'linha', v_linha, 'cliente_id', v_cli, 'chave', r->>'chave',
      'resultado', v_resultado, 'movido', v_movido, 'pagamento_id', v_pag);
  END LOOP;

  UPDATE public.importacoes
  SET quantidade_ja_pagos = quantidade_ja_pagos + v_movidos
  WHERE id = v_imp;

  RETURN jsonb_build_object('importacao_id', v_imp, 'linhas', v_res);
END;
$$;


NOTIFY pgrst, 'reload schema';
