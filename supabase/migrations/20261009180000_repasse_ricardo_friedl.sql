-- =====================================================================
-- REPASSE RICARDO FRIEDL — 5 % de todo valor efetivamente recebido pelo
-- Furtado (cada linha de public.pagamentos que não foi paga ao cliente).
--
-- Fonte primária continua sendo o recebimento (valor, categoria, cliente,
-- processo, data, origem). O repasse é DERIVADO da regra versionada abaixo —
-- não é gravado em pagamentos, então nunca diverge do valor recebido.
-- A auditoria grava, a cada criação/alteração/exclusão, o valor, a categoria,
-- o percentual, a versão da regra e o repasse calculado naquele momento.
--
-- Mesma regra no frontend: src/lib/repasse.ts (o teste tests/repasse.test.ts
-- confere que percentual e versão daqui são os mesmos de lá).
-- Não altera nem apaga nenhum dado existente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Regra versionada (fonte única no banco)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.regras_repasse (
  versao        INTEGER PRIMARY KEY,
  percentual    NUMERIC(5,2) NOT NULL CHECK (percentual > 0 AND percentual <= 100),
  beneficiario  TEXT NOT NULL DEFAULT 'ricardo_friedl',
  descricao     TEXT,
  vigente_desde TIMESTAMPTZ NOT NULL DEFAULT now(),
  vigente       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Só uma regra vigente por vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_regras_repasse_vigente
  ON public.regras_repasse (vigente) WHERE vigente;

INSERT INTO public.regras_repasse (versao, percentual, beneficiario, descricao)
VALUES (1, 5.00, 'ricardo_friedl',
  'Ricardo Friedl tem direito a 5% de todo valor efetivamente recebido pelo Furtado referente aos clientes/processos cadastrados, independentemente do tipo de ação, requerimento, cliente, processo, valor ou categoria (CONTRATUAL, ATRASADOS, SUCUMBÊNCIA). Não incide sobre valor estimado, valor da causa, previsões ou valores pendentes.')
ON CONFLICT (versao) DO NOTHING;

GRANT SELECT ON public.regras_repasse TO anon, authenticated;
GRANT ALL ON public.regras_repasse TO service_role;
ALTER TABLE public.regras_repasse ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'regras_repasse' AND policyname = 'regras_repasse_leitura') THEN
    CREATE POLICY regras_repasse_leitura ON public.regras_repasse
      FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Funções da regra
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regra_repasse_vigente(OUT versao integer, OUT percentual numeric)
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT r.versao, r.percentual FROM public.regras_repasse r WHERE r.vigente ORDER BY r.versao DESC LIMIT 1;
$$;

-- Elegível = efetivamente recebido pelo Furtado: valor positivo e não pago ao cliente.
CREATE OR REPLACE FUNCTION public.repasse_elegivel(p_valor numeric, p_destinatario text)
RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(p_valor, 0) > 0 AND coalesce(p_destinatario, 'escritorio') <> 'cliente';
$$;

-- Repasse de um valor: round(valor × percentual / 100, 2) — numeric exato,
-- meio centavo afastado do zero (mesmo critério de src/lib/repasse.ts).
CREATE OR REPLACE FUNCTION public.repasse_de(p_valor numeric, p_destinatario text DEFAULT NULL)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT CASE WHEN public.repasse_elegivel(p_valor, p_destinatario)
              THEN round(p_valor * (SELECT percentual FROM public.regra_repasse_vigente()) / 100, 2)
              ELSE 0::numeric END;
$$;

GRANT EXECUTE ON FUNCTION public.regra_repasse_vigente() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.repasse_elegivel(numeric, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.repasse_de(numeric, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. View: repasse de cada recebimento (consultas, relatórios, conferência)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vw_repasse_pagamentos
WITH (security_invoker = true) AS
SELECT
  p.id               AS pagamento_id,
  p.cliente_id,
  p.atendimento_id,
  p.data_pagamento,
  p.classificacao,
  p.destinatario,
  p.valor,
  public.repasse_elegivel(p.valor, p.destinatario) AS elegivel,
  r.versao           AS regra_versao,
  r.percentual,
  CASE WHEN public.repasse_elegivel(p.valor, p.destinatario)
       THEN round(p.valor * r.percentual / 100, 2) ELSE 0 END AS repasse,
  p.importacao_id,
  p.chave_importacao
FROM public.pagamentos p
CROSS JOIN public.regra_repasse_vigente() r
JOIN public.clientes c ON c.id = p.cliente_id AND c.deleted_at IS NULL;

GRANT SELECT ON public.vw_repasse_pagamentos TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Auditoria do repasse
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auditoria_repasse (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pagamento_id       UUID NOT NULL,           -- sem FK: a linha permanece após a exclusão
  cliente_id         UUID,
  atendimento_id     UUID,
  operacao           TEXT NOT NULL CHECK (operacao IN ('criacao', 'alteracao', 'exclusao', 'saldo_inicial')),
  valor_anterior     NUMERIC(14,2),
  valor_novo         NUMERIC(14,2),
  categoria_anterior TEXT,
  categoria_nova     TEXT,
  destinatario       TEXT,
  regra_versao       INTEGER NOT NULL,
  percentual         NUMERIC(5,2) NOT NULL,
  repasse_anterior   NUMERIC(14,2) NOT NULL DEFAULT 0,
  repasse_novo       NUMERIC(14,2) NOT NULL DEFAULT 0,
  origem             TEXT,                    -- 'importacao' | 'manual'
  importacao_id      UUID,
  chave_importacao   TEXT,
  data_pagamento     DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_repasse_cliente ON public.auditoria_repasse (cliente_id, created_at);
CREATE INDEX IF NOT EXISTS idx_auditoria_repasse_pagamento ON public.auditoria_repasse (pagamento_id);

GRANT SELECT ON public.auditoria_repasse TO anon, authenticated;
GRANT ALL ON public.auditoria_repasse TO service_role;
ALTER TABLE public.auditoria_repasse ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'auditoria_repasse' AND policyname = 'auditoria_repasse_leitura') THEN
    CREATE POLICY auditoria_repasse_leitura ON public.auditoria_repasse
      FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                       AND tablename = 'auditoria_repasse') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auditoria_repasse;
  END IF;
END $$;

-- SECURITY DEFINER: grava a auditoria mesmo sem permissão de escrita direta.
CREATE OR REPLACE FUNCTION public._pagamentos_auditoria_repasse()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_regra record;
  v_old_rep numeric := 0;
  v_new_rep numeric := 0;
  v_ref public.pagamentos%ROWTYPE;
BEGIN
  SELECT * INTO v_regra FROM public.regra_repasse_vigente();

  IF TG_OP = 'UPDATE' AND
     (OLD.valor, OLD.classificacao, OLD.destinatario, OLD.atendimento_id, OLD.cliente_id)
     IS NOT DISTINCT FROM
     (NEW.valor, NEW.classificacao, NEW.destinatario, NEW.atendimento_id, NEW.cliente_id) THEN
    RETURN NULL; -- nada que afete o repasse
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND public.repasse_elegivel(OLD.valor, OLD.destinatario) THEN
    v_old_rep := round(OLD.valor * v_regra.percentual / 100, 2);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND public.repasse_elegivel(NEW.valor, NEW.destinatario) THEN
    v_new_rep := round(NEW.valor * v_regra.percentual / 100, 2);
  END IF;

  IF TG_OP = 'DELETE' THEN v_ref := OLD; ELSE v_ref := NEW; END IF;

  INSERT INTO public.auditoria_repasse (
    pagamento_id, cliente_id, atendimento_id, operacao,
    valor_anterior, valor_novo, categoria_anterior, categoria_nova, destinatario,
    regra_versao, percentual, repasse_anterior, repasse_novo,
    origem, importacao_id, chave_importacao, data_pagamento)
  VALUES (
    v_ref.id, v_ref.cliente_id, v_ref.atendimento_id,
    CASE TG_OP WHEN 'INSERT' THEN 'criacao' WHEN 'UPDATE' THEN 'alteracao' ELSE 'exclusao' END,
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.valor END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.valor END,
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.classificacao END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.classificacao END,
    v_ref.destinatario,
    v_regra.versao, v_regra.percentual, v_old_rep, v_new_rep,
    CASE WHEN v_ref.importacao_id IS NOT NULL OR v_ref.chave_importacao IS NOT NULL
         THEN 'importacao' ELSE 'manual' END,
    v_ref.importacao_id, v_ref.chave_importacao, v_ref.data_pagamento);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pagamentos_auditoria_repasse ON public.pagamentos;
CREATE TRIGGER trg_pagamentos_auditoria_repasse
AFTER INSERT OR UPDATE OR DELETE ON public.pagamentos
FOR EACH ROW EXECUTE FUNCTION public._pagamentos_auditoria_repasse();

-- Recebimentos que já existiam antes da regra: um registro "saldo_inicial"
-- (uma vez só), para que todo repasse tenha origem rastreável.
INSERT INTO public.auditoria_repasse (
  pagamento_id, cliente_id, atendimento_id, operacao, valor_novo, categoria_nova, destinatario,
  regra_versao, percentual, repasse_novo, origem, importacao_id, chave_importacao, data_pagamento)
SELECT p.id, p.cliente_id, p.atendimento_id, 'saldo_inicial', p.valor, p.classificacao, p.destinatario,
       r.versao, r.percentual, public.repasse_de(p.valor, p.destinatario),
       CASE WHEN p.importacao_id IS NOT NULL OR p.chave_importacao IS NOT NULL THEN 'importacao' ELSE 'manual' END,
       p.importacao_id, p.chave_importacao, p.data_pagamento
FROM public.pagamentos p
CROSS JOIN public.regra_repasse_vigente() r
WHERE NOT EXISTS (SELECT 1 FROM public.auditoria_repasse a WHERE a.pagamento_id = p.id);

-- ---------------------------------------------------------------------
-- 5. Conferência geral (varredura): totais do banco para comparar com a tela
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conferir_repasse()
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'regra_versao', (SELECT versao FROM public.regra_repasse_vigente()),
    'percentual', (SELECT percentual FROM public.regra_repasse_vigente()),
    'recebimentos', count(*),
    'elegiveis', count(*) FILTER (WHERE elegivel),
    'total_recebido', coalesce(sum(valor) FILTER (WHERE elegivel), 0),
    'total_repasse', coalesce(sum(repasse), 0),
    'por_categoria', coalesce((
      SELECT jsonb_object_agg(cat, jsonb_build_object('recebido', rec, 'repasse', rep, 'quantidade', qtd))
      FROM (SELECT coalesce(classificacao, 'sem_classificacao') AS cat,
                   sum(valor) AS rec, sum(repasse) AS rep, count(*) AS qtd
            FROM public.vw_repasse_pagamentos WHERE elegivel GROUP BY 1) x), '{}'::jsonb),
    'sem_auditoria', (SELECT count(*) FROM public.pagamentos p
                      WHERE NOT EXISTS (SELECT 1 FROM public.auditoria_repasse a WHERE a.pagamento_id = p.id))
  )
  FROM public.vw_repasse_pagamentos;
$$;

GRANT EXECUTE ON FUNCTION public.conferir_repasse() TO anon, authenticated, service_role;
