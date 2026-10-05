-- =====================================================================
-- PAGO por PROCESSO (atendimento), não mais pelo cliente inteiro.
--
-- * atendimentos.pago / pago_em: cada processo tem a sua situação.
-- * Um cliente com processos pagos e não pagos aparece em CLIENTES (com os
--   não pagos) e em JÁ PAGOS (com os pagos) — sempre o MESMO cadastro.
-- * clientes.status continua existindo (compatibilidade e clientes sem
--   processo): é sincronizado por gatilho — 'pago' quando TODOS os
--   processos vigentes estão pagos; volta a 'ativo' quando algum reabre.
-- * Importação de valores recebidos: marca como pago o PROCESSO da linha
--   (Pasta/Número, escolha na prévia ou processo único do cliente). Cliente
--   sem processo segue a regra antiga (status do cliente).
-- Aditiva: nenhum dado é apagado; vínculos cliente/processo/pagamento intactos.
-- =====================================================================

ALTER TABLE public.atendimentos
  ADD COLUMN IF NOT EXISTS pago BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pago_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_atendimentos_cliente_pago ON public.atendimentos (cliente_id, pago);

-- Clientes já marcados como pagos: todos os seus processos passam a pagos.
UPDATE public.atendimentos a
SET pago = true, pago_em = coalesce(a.pago_em, c.updated_at)
FROM public.clientes c
WHERE c.id = a.cliente_id AND c.status = 'pago' AND a.deleted_at IS NULL AND NOT a.pago;

-- ---------------------------------------------------------------------
-- Sincronização clientes.status ← processos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sincronizar_status_cliente(p_cliente uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_pagos integer;
BEGIN
  IF p_cliente IS NULL THEN RETURN; END IF;
  SELECT count(*), count(*) FILTER (WHERE pago)
    INTO v_total, v_pagos
  FROM public.atendimentos
  WHERE cliente_id = p_cliente AND deleted_at IS NULL;

  -- Sem processo: a situação continua sendo a do próprio cliente.
  IF v_total = 0 THEN RETURN; END IF;

  IF v_pagos = v_total THEN
    UPDATE public.clientes SET status = 'pago'
    WHERE id = p_cliente AND deleted_at IS NULL AND NOT coalesce(arquivado, false)
      AND status IN ('ativo', 'inativo');
  ELSE
    UPDATE public.clientes SET status = 'ativo'
    WHERE id = p_cliente AND deleted_at IS NULL AND NOT coalesce(arquivado, false)
      AND status = 'pago';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._atendimentos_sincronizar_cliente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._sincronizar_status_cliente(NEW.cliente_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public._sincronizar_status_cliente(NEW.cliente_id);
    IF OLD.cliente_id IS DISTINCT FROM NEW.cliente_id THEN
      PERFORM public._sincronizar_status_cliente(OLD.cliente_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public._sincronizar_status_cliente(OLD.cliente_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_atendimentos_status_cliente ON public.atendimentos;
CREATE TRIGGER trg_atendimentos_status_cliente
AFTER INSERT OR DELETE OR UPDATE OF pago, deleted_at, cliente_id ON public.atendimentos
FOR EACH ROW EXECUTE FUNCTION public._atendimentos_sincronizar_cliente();

-- ---------------------------------------------------------------------
-- Ação manual no perfil: marcar / reabrir UM processo
-- ---------------------------------------------------------------------
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
            THEN 'Processo ' || v_num || ' marcado como PAGO (movido para JÁ PAGOS).'
            ELSE 'Processo ' || v_num || ' voltou para EM TRAMITAÇÃO (CLIENTES).' END,
          'manual:pago:' || v_at.id || ':' || extract(epoch FROM clock_timestamp()));
END;
$$;

-- Cliente SEM processo: a situação é a do próprio cadastro.
CREATE OR REPLACE FUNCTION public.definir_cliente_pago(p_cliente uuid, p_pago boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cli public.clientes%ROWTYPE;
BEGIN
  SELECT * INTO v_cli FROM public.clientes WHERE id = p_cliente AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado.'; END IF;
  IF EXISTS (SELECT 1 FROM public.atendimentos WHERE cliente_id = p_cliente AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Este cliente tem processos: marque o pagamento em cada processo.';
  END IF;
  IF (v_cli.status = 'pago') = p_pago THEN RETURN; END IF;
  UPDATE public.clientes SET status = CASE WHEN p_pago THEN 'pago' ELSE 'ativo' END WHERE id = p_cliente;
  INSERT INTO public.historico_cliente (cliente_id, categoria, texto, chave_origem)
  VALUES (p_cliente, 'alteracao',
          CASE WHEN p_pago THEN 'Cliente (sem processo) marcado como PAGO.'
               ELSE 'Cliente (sem processo) voltou para EM TRAMITAÇÃO.' END,
          'manual:cliente:' || p_cliente || ':' || extract(epoch FROM clock_timestamp()));
END;
$$;

GRANT EXECUTE ON FUNCTION public.definir_processo_pago(uuid, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.definir_cliente_pago(uuid, boolean) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Importação de valores recebidos: move o PROCESSO (não o cliente)
-- ---------------------------------------------------------------------
-- Item: { linha, cliente_id, valor|null, sem_valor, data|null,
--         classificacao|null, atendimento_id|null, chave, observacao|null,
--         dados_origem }
-- Resultados: inserido | ja_registrado | possivel_duplicado |
--   cliente_indisponivel | valor_invalido | marcado_pago | ja_pago |
--   processo_nao_definido (sem_valor e cliente com processos, nenhum escolhido).
-- "movido" = o processo (ou o cliente sem processo) foi para JÁ PAGOS.
CREATE OR REPLACE FUNCTION public._recebimentos_mover(
  v_cli uuid, v_at uuid, p_arquivo text, p_aba text, v_linha integer, v_chave text
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_proc public.atendimentos%ROWTYPE;
  v_cliente public.clientes%ROWTYPE;
  v_num text;
BEGIN
  IF v_at IS NOT NULL THEN
    SELECT * INTO v_proc FROM public.atendimentos
    WHERE id = v_at AND cliente_id = v_cli AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_proc.pago THEN RETURN false; END IF;
    UPDATE public.atendimentos SET pago = true, pago_em = now() WHERE id = v_at;
    v_num := coalesce(nullif(v_proc.dados_rf->>'numero', ''), v_proc.numero_processo, 'sem número');
    INSERT INTO public.historico_cliente
      (cliente_id, atendimento_id, categoria, texto, aba, celulas, chave_origem)
    VALUES
      (v_cli, v_at, 'alteracao',
       'Processo ' || v_num || ' movido para JÁ PAGOS pela importação Clientes com Valores Recebidos (' ||
       coalesce(p_arquivo, 'arquivo') || ', linha ' || v_linha || ').',
       p_aba, 'linha ' || v_linha, 'rv:mov:' || v_chave)
    ON CONFLICT (chave_origem) DO NOTHING;
    RETURN true;
  END IF;

  -- Sem processo identificado: só cliente SEM processos é movido (regra antiga).
  IF EXISTS (SELECT 1 FROM public.atendimentos WHERE cliente_id = v_cli AND deleted_at IS NULL) THEN
    RETURN false;
  END IF;
  SELECT * INTO v_cliente FROM public.clientes WHERE id = v_cli FOR UPDATE;
  IF v_cliente.status IS NOT DISTINCT FROM 'pago' THEN RETURN false; END IF;
  UPDATE public.clientes SET status = 'pago' WHERE id = v_cli;
  INSERT INTO public.historico_cliente (cliente_id, categoria, texto, aba, celulas, chave_origem)
  VALUES (v_cli, 'alteracao',
          'Cliente (sem processo) movido para JÁ PAGOS pela importação Clientes com Valores Recebidos (' ||
          coalesce(p_arquivo, 'arquivo') || ', linha ' || v_linha || ').',
          p_aba, 'linha ' || v_linha, 'rv:mov:' || v_chave)
  ON CONFLICT (chave_origem) DO NOTHING;
  RETURN true;
END;
$$;

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
    v_esc := NULL;

    IF v_class IS NOT NULL AND v_class NOT IN ('contratuais', 'atrasados', 'sucumbencia') THEN
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
      IF v_at IS NULL AND v_tem_proc THEN
        v_resultado := 'processo_nao_definido';
      ELSE
        v_movido := public._recebimentos_mover(v_cli, v_at, p_arquivo, p_aba, v_linha,
                      coalesce(v_imp::text, '') || ':' || v_linha);
        v_resultado := CASE WHEN v_movido THEN 'marcado_pago' ELSE 'ja_pago' END;
      END IF;
    ELSIF v_valor IS NULL OR v_valor <= 0 THEN
      v_resultado := 'valor_invalido';
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
           'Valor recebido de R$ ' || translate(to_char(v_valor, 'FM999,999,999,990.00'), ',.', '.,') ||
           coalesce(' (' || CASE v_class WHEN 'contratuais' THEN 'Contratual'
                                         WHEN 'atrasados' THEN 'Atrasados'
                                         WHEN 'sucumbencia' THEN 'Sucumbência' END || ')', ' (sem categoria)') ||
           ' registrado pela importação Clientes com Valores Recebidos (' || coalesce(p_arquivo, 'arquivo') ||
           ', linha ' || v_linha || ').',
           p_aba, 'linha ' || v_linha, v_esc, 'rv:hist:' || v_pag);
        v_movido := public._recebimentos_mover(v_cli, v_at, p_arquivo, p_aba, v_linha, v_pag::text);
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

GRANT EXECUTE ON FUNCTION public._recebimentos_mover(uuid, uuid, text, text, integer, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
