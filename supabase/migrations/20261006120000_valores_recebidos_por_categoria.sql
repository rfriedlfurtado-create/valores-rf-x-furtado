-- =====================================================================
-- VALORES RECEBIDOS por PROCESSO e CATEGORIA (Atrasados, Implantação,
-- Sucumbência) + regra de FINALIZAÇÃO do processo.
--
-- * Categoria CONTRATUAL passa a se chamar IMPLANTAÇÃO ('implantacao').
-- * processo_categorias: por processo e categoria — total a receber
--   (opcional), confirmação de recebimento integral e, só para sucumbência,
--   a indicação "Não haverá sucumbência" (não é pagamento: nenhum valor).
-- * Categoria resolvida = há recebimento E (confirmado integral OU recebido
--   >= total a receber); sucumbência também com "Não haverá sucumbência".
-- * atendimentos.pago só passa a true com as três categorias resolvidas
--   (gatilho: vale para o botão e para qualquer outra ação).
-- * Processo finalizado pela regra (finalizacao_validada) que deixa de
--   cumpri-la (edição/exclusão de recebimento, retirada da indicação) volta
--   para pendente, com o motivo no histórico.
-- * Processos já pagos antes desta regra continuam em JÁ PAGOS.
-- * Alterações e exclusões de recebimentos ficam registradas no histórico.
-- * Importação de valores recebidos: só lança valores (não finaliza).
-- Nenhum dado é apagado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CONTRATUAL → IMPLANTAÇÃO
-- ---------------------------------------------------------------------
ALTER TABLE public.pagamentos DROP CONSTRAINT IF EXISTS pagamentos_classificacao_check;
UPDATE public.pagamentos SET classificacao = 'implantacao' WHERE classificacao = 'contratuais';
ALTER TABLE public.pagamentos
  ADD CONSTRAINT pagamentos_classificacao_check
  CHECK (classificacao IS NULL OR classificacao IN ('atrasados', 'implantacao', 'sucumbencia'));

CREATE INDEX IF NOT EXISTS idx_pagamentos_atendimento_class
  ON public.pagamentos (atendimento_id, classificacao);

-- ---------------------------------------------------------------------
-- 2. Situação por processo e categoria
-- ---------------------------------------------------------------------
ALTER TABLE public.atendimentos
  ADD COLUMN IF NOT EXISTS finalizacao_validada BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.processo_categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atendimento_id UUID NOT NULL REFERENCES public.atendimentos(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL CHECK (categoria IN ('atrasados', 'implantacao', 'sucumbencia')),
  total_previsto NUMERIC(14,2) CHECK (total_previsto IS NULL OR total_previsto > 0),
  integral_confirmado BOOLEAN NOT NULL DEFAULT false,
  nao_havera BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT processo_categorias_unica UNIQUE (atendimento_id, categoria),
  CONSTRAINT processo_categorias_nao_havera CHECK (NOT nao_havera OR categoria = 'sucumbencia')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.processo_categorias TO anon, authenticated;
GRANT ALL ON public.processo_categorias TO service_role;
ALTER TABLE public.processo_categorias ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'processo_categorias' AND policyname = 'processo_categorias_open') THEN
    CREATE POLICY processo_categorias_open ON public.processo_categorias
      FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'processo_categorias') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.processo_categorias;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Regras
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rotulo_categoria(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'atrasados' THEN 'Atrasados'
                WHEN 'implantacao' THEN 'Implantação'
                WHEN 'sucumbencia' THEN 'Sucumbência'
                ELSE 'sem categoria' END;
$$;

CREATE OR REPLACE FUNCTION public._numero_do_processo(p_at uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(nullif(dados_rf->>'numero', ''), numero_processo, 'sem número')
  FROM public.atendimentos WHERE id = p_at;
$$;

CREATE OR REPLACE FUNCTION public._brl(v numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'R$ ' || translate(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;

-- Pendência de UMA categoria do processo (NULL = resolvida).
CREATE OR REPLACE FUNCTION public._pendencia_categoria(p_at uuid, p_cat text)
RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_rec numeric;
  v_qtd integer;
  v_cfg public.processo_categorias%ROWTYPE;
  v_rot text := public._rotulo_categoria(p_cat);
BEGIN
  SELECT coalesce(sum(valor), 0), count(*) INTO v_rec, v_qtd
  FROM public.pagamentos
  WHERE atendimento_id = p_at AND classificacao = p_cat AND valor > 0;
  SELECT * INTO v_cfg FROM public.processo_categorias
  WHERE atendimento_id = p_at AND categoria = p_cat;

  IF p_cat = 'sucumbencia' AND coalesce(v_cfg.nao_havera, false) AND v_qtd = 0 THEN
    RETURN NULL;
  END IF;
  IF v_qtd = 0 THEN
    RETURN v_rot || CASE WHEN p_cat = 'sucumbencia'
      THEN ' (nenhum recebimento registrado e não marcado “Não haverá sucumbência”)'
      ELSE ' (nenhum recebimento registrado)' END;
  END IF;
  IF coalesce(v_cfg.integral_confirmado, false)
     OR (v_cfg.total_previsto IS NOT NULL AND v_rec >= v_cfg.total_previsto) THEN
    RETURN NULL;
  END IF;
  RETURN v_rot || ' (recebimento parcial — falta confirmar o recebimento integral' ||
    CASE WHEN v_cfg.total_previsto IS NOT NULL
      THEN '; saldo pendente ' || public._brl(v_cfg.total_previsto - v_rec) ELSE '' END || ')';
END;
$$;

CREATE OR REPLACE FUNCTION public.pendencias_finalizacao(p_at uuid)
RETURNS text[]
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT coalesce(array_agg(p ORDER BY o) FILTER (WHERE p IS NOT NULL), '{}')
  FROM (VALUES (1, public._pendencia_categoria(p_at, 'atrasados')),
               (2, public._pendencia_categoria(p_at, 'implantacao')),
               (3, public._pendencia_categoria(p_at, 'sucumbencia'))) AS t(o, p);
$$;

-- Bloqueia a finalização com pendência — vale para QUALQUER ação.
CREATE OR REPLACE FUNCTION public._atendimentos_validar_finalizacao()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_pend text[];
BEGIN
  IF NEW.pago AND NOT OLD.pago THEN
    v_pend := public.pendencias_finalizacao(NEW.id);
    IF array_length(v_pend, 1) > 0 THEN
      RAISE EXCEPTION 'Não é possível marcar o processo % como PAGO / FINALIZADO — TODOS OS VALORES RECEBIDOS. Pendente: %.',
        coalesce(nullif(NEW.dados_rf->>'numero', ''), NEW.numero_processo, 'sem número'),
        array_to_string(v_pend, '; ')
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.finalizacao_validada := true;
    NEW.pago_em := coalesce(NEW.pago_em, now());
  ELSIF NOT NEW.pago THEN
    NEW.finalizacao_validada := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_atendimentos_validar_finalizacao ON public.atendimentos;
CREATE TRIGGER trg_atendimentos_validar_finalizacao
BEFORE UPDATE OF pago ON public.atendimentos
FOR EACH ROW EXECUTE FUNCTION public._atendimentos_validar_finalizacao();

-- Reavalia um processo pago após mudança nos valores/indicações.
-- Finalizado pela regra e agora com pendência → volta para pendente.
-- Pago antes da regra e agora completo → passa a "validado".
CREATE OR REPLACE FUNCTION public._reavaliar_finalizacao(p_at uuid, p_motivo text)
RETURNS boolean
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_at public.atendimentos%ROWTYPE;
  v_pend text[];
  v_num text;
BEGIN
  IF p_at IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_at FROM public.atendimentos WHERE id = p_at AND deleted_at IS NULL;
  IF NOT FOUND OR NOT v_at.pago THEN RETURN false; END IF;

  v_pend := public.pendencias_finalizacao(p_at);
  IF coalesce(array_length(v_pend, 1), 0) = 0 THEN
    IF NOT v_at.finalizacao_validada THEN
      UPDATE public.atendimentos SET finalizacao_validada = true WHERE id = p_at;
    END IF;
    RETURN false;
  END IF;
  IF NOT v_at.finalizacao_validada THEN
    RETURN false; -- pago antes da regra de valores: mantido em JÁ PAGOS
  END IF;

  UPDATE public.atendimentos SET pago = false, pago_em = NULL WHERE id = p_at;
  v_num := coalesce(nullif(v_at.dados_rf->>'numero', ''), v_at.numero_processo, 'sem número');
  INSERT INTO public.historico_cliente (cliente_id, atendimento_id, categoria, texto, escritorio, chave_origem)
  SELECT v_at.cliente_id, p_at, 'alteracao',
         'Processo ' || v_num || ' voltou para PENDENTE (CLIENTES): ' || p_motivo ||
         '. Pendente: ' || array_to_string(v_pend, '; ') || '.',
         v_at.escritorio,
         'reabertura:' || p_at || ':' || extract(epoch FROM clock_timestamp())
  WHERE EXISTS (SELECT 1 FROM public.clientes WHERE id = v_at.cliente_id);
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Gatilhos dos recebimentos (pagamentos)
-- ---------------------------------------------------------------------
-- Antes: sucumbência não pode ser lançada com "Não haverá sucumbência".
CREATE OR REPLACE FUNCTION public._pagamentos_validar_categoria()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.classificacao = 'sucumbencia' AND NEW.atendimento_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR OLD.classificacao IS DISTINCT FROM NEW.classificacao
          OR OLD.atendimento_id IS DISTINCT FROM NEW.atendimento_id)
     AND EXISTS (SELECT 1 FROM public.processo_categorias
                 WHERE atendimento_id = NEW.atendimento_id AND categoria = 'sucumbencia' AND nao_havera) THEN
    RAISE EXCEPTION 'O processo % está marcado “Não haverá sucumbência”. Desfaça essa indicação no card Sucumbência antes de registrar um recebimento de sucumbência.',
      public._numero_do_processo(NEW.atendimento_id)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagamentos_validar_categoria ON public.pagamentos;
CREATE TRIGGER trg_pagamentos_validar_categoria
BEFORE INSERT OR UPDATE OF classificacao, atendimento_id ON public.pagamentos
FOR EACH ROW EXECUTE FUNCTION public._pagamentos_validar_categoria();

-- Depois: histórico de alteração/exclusão + reavaliação dos processos.
CREATE OR REPLACE FUNCTION public._pagamentos_apos_alteracao()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_desc_old text;
  v_desc_new text;
  v_texto text;
  v_cli uuid;
  v_at uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_desc_old := public._brl(OLD.valor) || ' de ' || to_char(OLD.data_pagamento, 'DD/MM/YYYY') ||
      ' (' || public._rotulo_categoria(OLD.classificacao) ||
      coalesce(', processo ' || public._numero_do_processo(OLD.atendimento_id), ', sem processo') || ')';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD.valor, OLD.data_pagamento, OLD.classificacao, OLD.atendimento_id, OLD.tipo, coalesce(OLD.observacao, ''))
       IS NOT DISTINCT FROM
       (NEW.valor, NEW.data_pagamento, NEW.classificacao, NEW.atendimento_id, NEW.tipo, coalesce(NEW.observacao, '')) THEN
      RETURN NULL;
    END IF;
    v_desc_new := public._brl(NEW.valor) || ' de ' || to_char(NEW.data_pagamento, 'DD/MM/YYYY') ||
      ' (' || public._rotulo_categoria(NEW.classificacao) ||
      coalesce(', processo ' || public._numero_do_processo(NEW.atendimento_id), ', sem processo') || ')';
    v_texto := 'Recebimento alterado: ' || v_desc_old || ' → ' || v_desc_new ||
      CASE WHEN coalesce(OLD.observacao, '') <> coalesce(NEW.observacao, '')
        THEN '. Observação anterior: ' || coalesce(nullif(OLD.observacao, ''), '—') ELSE '' END || '.';
    v_cli := NEW.cliente_id;
    v_at := coalesce(NEW.atendimento_id, OLD.atendimento_id);
  ELSIF TG_OP = 'DELETE' THEN
    v_texto := 'Recebimento excluído: ' || v_desc_old ||
      CASE WHEN coalesce(OLD.observacao, '') <> '' THEN '. Observação: ' || OLD.observacao ELSE '' END || '.';
    v_cli := OLD.cliente_id;
    v_at := OLD.atendimento_id;
  END IF;

  IF v_texto IS NOT NULL THEN
    INSERT INTO public.historico_cliente (cliente_id, atendimento_id, categoria, texto, origens, chave_origem)
    SELECT v_cli, v_at, 'alteracao', v_texto,
           jsonb_build_array(jsonb_build_object('pagamento', to_jsonb(OLD))),
           'recebimento:' || lower(TG_OP) || ':' || OLD.id || ':' || extract(epoch FROM clock_timestamp())
    WHERE EXISTS (SELECT 1 FROM public.clientes WHERE id = v_cli)
      AND (v_at IS NULL OR EXISTS (SELECT 1 FROM public.atendimentos WHERE id = v_at));
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public._reavaliar_finalizacao(OLD.atendimento_id,
      CASE WHEN TG_OP = 'DELETE' THEN 'recebimento excluído (' || v_desc_old || ')'
           ELSE 'recebimento alterado (' || v_desc_old || ' → ' || v_desc_new || ')' END);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.atendimento_id IS DISTINCT FROM
       (CASE WHEN TG_OP = 'UPDATE' THEN OLD.atendimento_id END) THEN
    PERFORM public._reavaliar_finalizacao(NEW.atendimento_id, 'recebimento alterado');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagamentos_apos_alteracao ON public.pagamentos;
CREATE TRIGGER trg_pagamentos_apos_alteracao
AFTER INSERT OR UPDATE OR DELETE ON public.pagamentos
FOR EACH ROW EXECUTE FUNCTION public._pagamentos_apos_alteracao();

-- ---------------------------------------------------------------------
-- 5. Gatilhos da situação por categoria
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._processo_categorias_validar()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.nao_havera AND (TG_OP = 'INSERT' OR NOT OLD.nao_havera) AND EXISTS (
    SELECT 1 FROM public.pagamentos
    WHERE atendimento_id = NEW.atendimento_id AND classificacao = 'sucumbencia'
  ) THEN
    RAISE EXCEPTION 'Este processo já tem recebimento de sucumbência registrado, por isso não pode ser marcado “Não haverá sucumbência”. Confira os registros no card Sucumbência (nada foi apagado).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_processo_categorias_validar ON public.processo_categorias;
CREATE TRIGGER trg_processo_categorias_validar
BEFORE INSERT OR UPDATE ON public.processo_categorias
FOR EACH ROW EXECUTE FUNCTION public._processo_categorias_validar();

CREATE OR REPLACE FUNCTION public._processo_categorias_apos()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_at public.atendimentos%ROWTYPE;
  v_rot text;
  v_partes text[] := '{}';
  v_motivo text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._reavaliar_finalizacao(OLD.atendimento_id, 'situação da categoria ' || public._rotulo_categoria(OLD.categoria) || ' removida');
    RETURN NULL;
  END IF;
  SELECT * INTO v_at FROM public.atendimentos WHERE id = NEW.atendimento_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_rot := public._rotulo_categoria(NEW.categoria);

  IF NEW.nao_havera IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.nao_havera ELSE false END) THEN
    v_partes := v_partes || CASE WHEN NEW.nao_havera
      THEN 'marcado “Não haverá sucumbência”' ELSE 'retirada a indicação “Não haverá sucumbência”' END;
  END IF;
  IF NEW.integral_confirmado IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.integral_confirmado ELSE false END) THEN
    v_partes := v_partes || CASE WHEN NEW.integral_confirmado
      THEN v_rot || ': recebimento integral confirmado' ELSE v_rot || ': confirmação de recebimento integral retirada' END;
  END IF;
  IF NEW.total_previsto IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.total_previsto END) THEN
    v_partes := v_partes || (v_rot || ': total a receber ' ||
      coalesce(public._brl(NEW.total_previsto), 'não informado') ||
      CASE WHEN TG_OP = 'UPDATE' AND OLD.total_previsto IS NOT NULL
        THEN ' (antes ' || public._brl(OLD.total_previsto) || ')' ELSE '' END);
  END IF;
  IF coalesce(array_length(v_partes, 1), 0) = 0 THEN RETURN NULL; END IF;
  v_motivo := array_to_string(v_partes, '; ');

  INSERT INTO public.historico_cliente (cliente_id, atendimento_id, categoria, texto, escritorio, chave_origem)
  SELECT v_at.cliente_id, v_at.id, 'alteracao',
         'Processo ' || coalesce(nullif(v_at.dados_rf->>'numero', ''), v_at.numero_processo, 'sem número') || ' — ' || v_motivo || '.',
         v_at.escritorio,
         'categoria:' || NEW.id || ':' || extract(epoch FROM clock_timestamp())
  WHERE EXISTS (SELECT 1 FROM public.clientes WHERE id = v_at.cliente_id);

  PERFORM public._reavaliar_finalizacao(NEW.atendimento_id, v_motivo);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_processo_categorias_apos ON public.processo_categorias;
CREATE TRIGGER trg_processo_categorias_apos
AFTER INSERT OR UPDATE OR DELETE ON public.processo_categorias
FOR EACH ROW EXECUTE FUNCTION public._processo_categorias_apos();

-- ---------------------------------------------------------------------
-- 6. Ações (RPCs) — devolvem a situação dos processos afetados
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._situacao_processos(p_ids uuid[], p_pagos_antes uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT jsonb_build_object('processos', coalesce(jsonb_agg(jsonb_build_object(
    'atendimento_id', a.id,
    'numero', coalesce(nullif(a.dados_rf->>'numero', ''), a.numero_processo, 'sem número'),
    'pago', a.pago,
    'reaberto', (a.id = ANY (p_pagos_antes)) AND NOT a.pago,
    'pendencias', to_jsonb(public.pendencias_finalizacao(a.id)))), '[]'::jsonb))
  FROM public.atendimentos a
  WHERE a.id = ANY (p_ids);
$$;

CREATE OR REPLACE FUNCTION public.registrar_recebimento(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_cli uuid := nullif(p_dados->>'cliente_id', '')::uuid;
  v_at uuid := nullif(p_dados->>'atendimento_id', '')::uuid;
  v_valor numeric := nullif(p_dados->>'valor', '')::numeric;
  v_data date := nullif(p_dados->>'data_pagamento', '')::date;
  v_class text := nullif(p_dados->>'classificacao', '');
  v_esc text;
  v_id uuid;
  v_antes uuid[];
BEGIN
  IF v_cli IS NULL THEN RAISE EXCEPTION 'Selecione um cliente.'; END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor recebido maior que zero.'; END IF;
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data do recebimento.'; END IF;
  IF v_at IS NOT NULL THEN
    SELECT escritorio INTO v_esc FROM public.atendimentos
    WHERE id = v_at AND cliente_id = v_cli AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Processo não encontrado para este cliente.'; END IF;
  END IF;
  v_antes := ARRAY(SELECT id FROM public.atendimentos WHERE id = v_at AND pago);

  INSERT INTO public.pagamentos
    (cliente_id, valor, data_pagamento, tipo, observacao, usuario_cadastro, classificacao, atendimento_id, escritorio)
  VALUES (v_cli, round(v_valor, 2), v_data, coalesce(nullif(p_dados->>'tipo', ''), 'outro'),
          nullif(btrim(coalesce(p_dados->>'observacao', '')), ''),
          nullif(btrim(coalesce(p_dados->>'usuario_cadastro', '')), ''),
          v_class, v_at, v_esc)
  RETURNING id INTO v_id;

  INSERT INTO public.historico_cliente (cliente_id, atendimento_id, categoria, texto, escritorio, chave_origem)
  VALUES (v_cli, v_at, 'alteracao',
          'Recebimento registrado: ' || public._brl(v_valor) || ' de ' || to_char(v_data, 'DD/MM/YYYY') ||
          ' (' || public._rotulo_categoria(v_class) ||
          coalesce(', processo ' || public._numero_do_processo(v_at), ', sem processo') || ').',
          v_esc, 'recebimento:insert:' || v_id);

  RETURN public._situacao_processos(ARRAY[v_at], v_antes) || jsonb_build_object('pagamento_id', v_id);
END;
$$;

-- Campos presentes em p_dados são alterados: valor, data_pagamento, tipo,
-- observacao, classificacao, atendimento_id.
CREATE OR REPLACE FUNCTION public.alterar_recebimento(p_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_p public.pagamentos%ROWTYPE;
  v_valor numeric;
  v_at uuid;
  v_esc text;
  v_ids uuid[];
  v_antes uuid[];
BEGIN
  SELECT * INTO v_p FROM public.pagamentos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recebimento não encontrado.'; END IF;

  v_valor := CASE WHEN p_dados ? 'valor' THEN nullif(p_dados->>'valor', '')::numeric ELSE v_p.valor END;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'Informe um valor recebido maior que zero.'; END IF;
  IF p_dados ? 'data_pagamento' AND nullif(p_dados->>'data_pagamento', '') IS NULL THEN
    RAISE EXCEPTION 'Informe a data do recebimento.';
  END IF;

  v_at := CASE WHEN p_dados ? 'atendimento_id' THEN nullif(p_dados->>'atendimento_id', '')::uuid ELSE v_p.atendimento_id END;
  v_esc := v_p.escritorio;
  IF v_at IS DISTINCT FROM v_p.atendimento_id AND v_at IS NOT NULL THEN
    SELECT escritorio INTO v_esc FROM public.atendimentos
    WHERE id = v_at AND cliente_id = v_p.cliente_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Processo não encontrado para este cliente.'; END IF;
    v_esc := coalesce(v_esc, v_p.escritorio);
  END IF;

  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[v_p.atendimento_id, v_at]) x WHERE x IS NOT NULL);
  v_antes := ARRAY(SELECT id FROM public.atendimentos WHERE id = ANY (v_ids) AND pago);

  UPDATE public.pagamentos SET
    valor = round(v_valor, 2),
    data_pagamento = CASE WHEN p_dados ? 'data_pagamento' THEN (p_dados->>'data_pagamento')::date ELSE data_pagamento END,
    tipo = CASE WHEN p_dados ? 'tipo' THEN coalesce(nullif(p_dados->>'tipo', ''), 'outro') ELSE tipo END,
    observacao = CASE WHEN p_dados ? 'observacao' THEN nullif(btrim(coalesce(p_dados->>'observacao', '')), '') ELSE observacao END,
    classificacao = CASE WHEN p_dados ? 'classificacao' THEN nullif(p_dados->>'classificacao', '') ELSE classificacao END,
    atendimento_id = v_at,
    escritorio = v_esc,
    updated_at = now()
  WHERE id = p_id;

  RETURN public._situacao_processos(v_ids, v_antes);
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_recebimento(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_p public.pagamentos%ROWTYPE;
  v_antes uuid[];
BEGIN
  SELECT * INTO v_p FROM public.pagamentos WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recebimento não encontrado.'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'recebimento_parcelas')
     AND EXISTS (SELECT 1 FROM public.recebimento_parcelas WHERE pagamento_id = p_id) THEN
    RAISE EXCEPTION 'Este recebimento está distribuído em parcelas de cobrança e não pode ser excluído aqui.';
  END IF;
  v_antes := ARRAY(SELECT id FROM public.atendimentos WHERE id = v_p.atendimento_id AND pago);
  DELETE FROM public.pagamentos WHERE id = p_id;
  RETURN public._situacao_processos(ARRAY[v_p.atendimento_id], v_antes);
END;
$$;

-- p_dados: total_previsto (null limpa), integral_confirmado, nao_havera.
CREATE OR REPLACE FUNCTION public.definir_categoria_processo(p_atendimento uuid, p_categoria text, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_cfg public.processo_categorias%ROWTYPE;
  v_total numeric;
  v_antes uuid[];
BEGIN
  IF p_categoria NOT IN ('atrasados', 'implantacao', 'sucumbencia') THEN
    RAISE EXCEPTION 'Categoria inválida.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.atendimentos WHERE id = p_atendimento AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Processo não encontrado.';
  END IF;
  IF coalesce((p_dados->>'nao_havera')::boolean, false) AND p_categoria <> 'sucumbencia' THEN
    RAISE EXCEPTION '“Não haverá” só existe para Sucumbência — Atrasados e Implantação são obrigatórios.';
  END IF;
  IF p_dados ? 'total_previsto' THEN
    v_total := nullif(p_dados->>'total_previsto', '')::numeric;
    IF v_total IS NOT NULL AND v_total <= 0 THEN RAISE EXCEPTION 'O total a receber deve ser maior que zero.'; END IF;
  END IF;
  v_antes := ARRAY(SELECT id FROM public.atendimentos WHERE id = p_atendimento AND pago);

  INSERT INTO public.processo_categorias (atendimento_id, categoria)
  VALUES (p_atendimento, p_categoria)
  ON CONFLICT (atendimento_id, categoria) DO NOTHING;

  SELECT * INTO v_cfg FROM public.processo_categorias
  WHERE atendimento_id = p_atendimento AND categoria = p_categoria FOR UPDATE;

  UPDATE public.processo_categorias SET
    total_previsto = CASE WHEN p_dados ? 'total_previsto' THEN round(v_total, 2) ELSE total_previsto END,
    integral_confirmado = CASE WHEN p_dados ? 'integral_confirmado'
                               THEN coalesce((p_dados->>'integral_confirmado')::boolean, false)
                               ELSE integral_confirmado END,
    nao_havera = CASE WHEN p_dados ? 'nao_havera'
                      THEN coalesce((p_dados->>'nao_havera')::boolean, false)
                      ELSE nao_havera END
  WHERE id = v_cfg.id;

  RETURN public._situacao_processos(ARRAY[p_atendimento], v_antes);
END;
$$;

-- Botão "Marcar processo como pago": a validação está no gatilho; aqui só
-- registra o histórico (inalterado) — redefinida para deixar a mensagem clara.
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
            THEN 'Processo ' || v_num || ' marcado como PAGO / FINALIZADO — TODOS OS VALORES RECEBIDOS (movido para JÁ PAGOS).'
            ELSE 'Processo ' || v_num || ' voltou para EM TRAMITAÇÃO (CLIENTES).' END,
          'manual:pago:' || v_at.id || ':' || extract(epoch FROM clock_timestamp()));
END;
$$;

GRANT EXECUTE ON FUNCTION public.pendencias_finalizacao(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_recebimento(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.alterar_recebimento(uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.excluir_recebimento(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.definir_categoria_processo(uuid, text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.definir_processo_pago(uuid, boolean) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Importação "Clientes com Valores Recebidos": só lança valores.
-- ---------------------------------------------------------------------
-- Processo identificado: nunca é movido para JÁ PAGOS pela importação (a
-- finalização depende dos três cards). Cliente SEM processo: regra antiga.
CREATE OR REPLACE FUNCTION public._recebimentos_mover(
  v_cli uuid, v_at uuid, p_arquivo text, p_aba text, v_linha integer, v_chave text
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cliente public.clientes%ROWTYPE;
BEGIN
  IF v_at IS NOT NULL THEN RETURN false; END IF;
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

-- Item: { linha, cliente_id, valor|null, sem_valor, data|null,
--         classificacao|null, atendimento_id|null, chave, observacao|null,
--         total_previsto|null, integral|null, dados_origem }
-- Resultados: inserido | ja_registrado | possivel_duplicado |
--   cliente_indisponivel | valor_invalido | marcado_pago | ja_pago |
--   processo_nao_definido | sem_valor | conflito_nao_havera.
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
      IF v_at IS NOT NULL THEN
        v_resultado := 'sem_valor';
      ELSIF v_tem_proc THEN
        v_resultado := 'processo_nao_definido';
      ELSE
        v_movido := public._recebimentos_mover(v_cli, NULL, p_arquivo, p_aba, v_linha,
                      coalesce(v_imp::text, '') || ':' || v_linha);
        v_resultado := CASE WHEN v_movido THEN 'marcado_pago' ELSE 'ja_pago' END;
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

NOTIFY pgrst, 'reload schema';
