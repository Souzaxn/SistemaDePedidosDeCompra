-- ====================================================
-- TECAR - Sistema de Pedidos de Compra - Setup SQL
-- Execute no Supabase SQL Editor (seguro para executar novamente)
-- ====================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- Perfis de usuários
CREATE TABLE IF NOT EXISTS public.profiles_tecar (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fornecedores
CREATE TABLE IF NOT EXISTS public.suppliers_tecar (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  name TEXT NOT NULL,
  cnpj TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers_tecar ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
ALTER TABLE public.suppliers_tecar ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE public.suppliers_tecar ADD COLUMN IF NOT EXISTS created_by UUID;

create or replace function public.normalizar_texto_tecar(valor text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$ select unaccent(lower(coalesce(valor, ''))); $$;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tecar_name_normalized_uidx
  ON public.suppliers_tecar (public.normalizar_texto_tecar(trim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_tecar_cnpj_digits_uidx
  ON public.suppliers_tecar ((regexp_replace(cnpj, '\D', '', 'g')));

-- Itens compartilhados (o código é chave primária e índice de busca exata)
CREATE TABLE IF NOT EXISTS public.itens (
  codigo TEXT PRIMARY KEY,
  descricao TEXT NOT NULL DEFAULT '',
  valor NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- Estoque atual (separado da base de itens usada nos pedidos)
CREATE TABLE IF NOT EXISTS public.estoque (
  codigo TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  locacao TEXT NOT NULL DEFAULT '',
  custo_contabil NUMERIC(14,2) NOT NULL DEFAULT 0,
  custo_fornecedor NUMERIC(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (codigo, locacao)
);

CREATE INDEX IF NOT EXISTS estoque_codigo_idx
  ON public.estoque (codigo);
CREATE INDEX IF NOT EXISTS estoque_descricao_idx
  ON public.estoque (descricao);
CREATE INDEX IF NOT EXISTS estoque_locacao_trgm_idx
  ON public.estoque USING gin (lower(locacao) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS estoque_descricao_normalizada_trgm_idx
  ON public.estoque USING gin (public.normalizar_texto_tecar(descricao) gin_trgm_ops);

-- Registro das importações concluídas
CREATE TABLE IF NOT EXISTS public.estoque_importacoes (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by UUID NOT NULL,
  imported_by_name TEXT NOT NULL,
  line_count INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS estoque_importacoes_imported_at_idx
  ON public.estoque_importacoes (imported_at DESC);

-- Consulta paginada com descrição sem distinção de caixa ou acentos.
-- Todas as palavras informadas precisam existir, em qualquer ordem.
CREATE OR REPLACE FUNCTION public.buscar_estoque_tecar(
  p_codigo TEXT DEFAULT '',
  p_descricao TEXT DEFAULT '',
  p_locacao TEXT DEFAULT '',
  p_ordenacao TEXT DEFAULT 'code',
  p_direcao TEXT DEFAULT 'asc',
  p_limite INT DEFAULT 10,
  p_deslocamento INT DEFAULT 0
)
RETURNS TABLE (
  codigo TEXT,
  descricao TEXT,
  locacao TEXT,
  custo_contabil NUMERIC,
  custo_fornecedor NUMERIC,
  total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH filtros AS (
    SELECT
      trim(COALESCE(p_codigo, '')) AS codigo_digitado,
      lower(trim(COALESCE(p_locacao, ''))) AS locacao_digitada,
      regexp_split_to_array(
        trim(unaccent(lower(COALESCE(p_descricao, '')))),
        '\s+'
      ) AS palavras
  ),
  resultados AS (
    SELECT e.*
    FROM public.estoque e
    CROSS JOIN filtros f
    WHERE (
      f.codigo_digitado = ''
      OR e.codigo ILIKE '%' || f.codigo_digitado || '%'
    )
    AND (
      f.locacao_digitada = ''
      OR lower(e.locacao) LIKE '%' || f.locacao_digitada || '%'
    )
    AND (
      trim(COALESCE(p_descricao, '')) = ''
      OR NOT EXISTS (
        SELECT 1
        FROM unnest(f.palavras) AS palavra
        WHERE palavra <> ''
          AND unaccent(lower(e.descricao)) NOT LIKE '%' || palavra || '%'
      )
    )
  )
  SELECT
    r.codigo,
    r.descricao,
    r.locacao,
    r.custo_contabil,
    r.custo_fornecedor,
    count(*) OVER () AS total_count
  FROM resultados r
  ORDER BY
    CASE WHEN p_ordenacao = 'location'
      THEN CASE WHEN trim(r.locacao) = '' OR lower(trim(trailing '.' FROM r.locacao)) = 'indef' THEN 1 ELSE 0 END
      ELSE 0
    END ASC,
    CASE WHEN p_ordenacao = 'code' AND lower(p_direcao) = 'asc' THEN r.codigo END ASC,
    CASE WHEN p_ordenacao = 'code' AND lower(p_direcao) = 'desc' THEN r.codigo END DESC,
    CASE WHEN p_ordenacao = 'location' AND lower(p_direcao) = 'asc'
      AND NOT (trim(r.locacao) = '' OR lower(trim(trailing '.' FROM r.locacao)) = 'indef')
      THEN lower(r.locacao) END ASC,
    CASE WHEN p_ordenacao = 'location' AND lower(p_direcao) = 'desc'
      AND NOT (trim(r.locacao) = '' OR lower(trim(trailing '.' FROM r.locacao)) = 'indef')
      THEN lower(r.locacao) END DESC,
    CASE WHEN p_ordenacao = 'description' AND lower(p_direcao) = 'asc'
      THEN public.normalizar_texto_tecar(r.descricao) END ASC,
    CASE WHEN p_ordenacao = 'description' AND lower(p_direcao) = 'desc'
      THEN public.normalizar_texto_tecar(r.descricao) END DESC,
    r.codigo ASC
  LIMIT GREATEST(p_limite, 1)
  OFFSET GREATEST(p_deslocamento, 0);
$$;

CREATE OR REPLACE FUNCTION public.buscar_fornecedores_tecar(
  p_busca TEXT DEFAULT '',
  p_limite INT DEFAULT 10,
  p_deslocamento INT DEFAULT 0
)
RETURNS TABLE (
  id UUID, name TEXT, cnpj TEXT, phone TEXT, email TEXT, created_by UUID,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, total_count BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  WITH resultados AS (
    SELECT s.*
    FROM public.suppliers_tecar s
    WHERE trim(COALESCE(p_busca, '')) = ''
      OR public.normalizar_texto_tecar(s.name) LIKE '%' || public.normalizar_texto_tecar(trim(p_busca)) || '%'
      OR (
        regexp_replace(p_busca, '\D', '', 'g') <> ''
        AND regexp_replace(s.cnpj, '\D', '', 'g') LIKE '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'
      )
  )
  SELECT r.id, r.name, r.cnpj, r.phone, r.email, r.created_by,
    r.created_at, r.updated_at, count(*) OVER ()
  FROM resultados r
  ORDER BY public.normalizar_texto_tecar(r.name), r.id
  LIMIT GREATEST(p_limite, 1) OFFSET GREATEST(p_deslocamento, 0);
$$;

-- Contador de pedidos (sequência global atômica)
CREATE TABLE IF NOT EXISTS public.order_sequence_tecar (
  id INT PRIMARY KEY DEFAULT 1,
  last_number INT NOT NULL DEFAULT 0
);
INSERT INTO public.order_sequence_tecar (id, last_number)
VALUES (1, 0) ON CONFLICT DO NOTHING;

-- Pedidos de compra
CREATE TABLE IF NOT EXISTS public.purchase_orders_tecar (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  order_number INT NOT NULL UNIQUE,
  supplier_id UUID,
  supplier_name TEXT NOT NULL,
  supplier_cnpj TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_by_name TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  items JSONB NOT NULL DEFAULT '[]',
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_orders_tecar
  ADD COLUMN IF NOT EXISTS nota_numero TEXT,
  ADD COLUMN IF NOT EXISTS nota_conferida BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nota_conferida_por TEXT,
  ADD COLUMN IF NOT EXISTS nota_conferida_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS excluido_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS excluido_por TEXT;
DO $$ BEGIN
  ALTER TABLE public.purchase_orders_tecar
    ADD CONSTRAINT purchase_orders_supplier_fk
    FOREIGN KEY (supplier_id) REFERENCES public.suppliers_tecar(id) ON DELETE RESTRICT
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Notas fiscais sem pedido de compra associado.
CREATE TABLE IF NOT EXISTS public.notas_fiscais_avulsas_tecar (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  nota_numero TEXT NOT NULL CHECK (NULLIF(trim(nota_numero), '') IS NOT NULL),
  supplier_id UUID NOT NULL REFERENCES public.suppliers_tecar(id) ON DELETE RESTRICT,
  total NUMERIC(14,2),
  issued_on DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  created_by UUID NOT NULL,
  created_by_name TEXT NOT NULL,
  nota_conferida BOOLEAN NOT NULL DEFAULT false,
  nota_conferida_por TEXT,
  nota_conferida_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notas_avulsas_issued_on_idx
  ON public.notas_fiscais_avulsas_tecar (issued_on DESC);
CREATE INDEX IF NOT EXISTS notas_avulsas_numero_idx
  ON public.notas_fiscais_avulsas_tecar (nota_numero);
CREATE INDEX IF NOT EXISTS notas_avulsas_conferida_idx
  ON public.notas_fiscais_avulsas_tecar (nota_conferida);

-- Um único rascunho, sem numeração, por usuário.
CREATE TABLE IF NOT EXISTS public.order_drafts_tecar (
  user_id UUID PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Controle interno do agendamento e do último resultado de backup.
CREATE TABLE IF NOT EXISTS public.backup_cron_tecar (
  id INT PRIMARY KEY CHECK (id = 1),
  token UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error TEXT
);
INSERT INTO public.backup_cron_tecar (id) VALUES (1) ON CONFLICT DO NOTHING;
ALTER TABLE public.backup_cron_tecar ENABLE ROW LEVEL SECURITY;

-- Índices para filtros e ordenação do histórico
CREATE INDEX IF NOT EXISTS purchase_orders_tecar_order_number_idx
  ON public.purchase_orders_tecar (order_number DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_tecar_issued_at_idx
  ON public.purchase_orders_tecar (issued_at);
CREATE INDEX IF NOT EXISTS purchase_orders_tecar_created_by_name_idx
  ON public.purchase_orders_tecar (created_by_name);
CREATE INDEX IF NOT EXISTS purchase_orders_tecar_nota_numero_idx
  ON public.purchase_orders_tecar (nota_numero);
CREATE INDEX IF NOT EXISTS purchase_orders_tecar_nota_conferida_idx
  ON public.purchase_orders_tecar (nota_conferida);
CREATE INDEX IF NOT EXISTS purchase_orders_tecar_excluido_em_idx
  ON public.purchase_orders_tecar (excluido_em);

CREATE OR REPLACE FUNCTION public.codigos_pedido_tecar(p_items JSONB)
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT upper(regexp_replace(item->>'code', '\s', '', 'g')))
      FILTER (WHERE NULLIF(regexp_replace(item->>'code', '\s', '', 'g'), '') IS NOT NULL),
    ARRAY[]::TEXT[]
  )
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) item;
$$;
CREATE INDEX IF NOT EXISTS purchase_orders_tecar_item_codes_idx
  ON public.purchase_orders_tecar USING gin (public.codigos_pedido_tecar(items));

-- Exige nota em novos pedidos feitos por usuários autenticados e impede apagar
-- uma nota existente. Pedidos legados sem nota e restaurações continuam válidos.
CREATE OR REPLACE FUNCTION public.validar_nota_pedido_tecar()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NULLIF(trim(NEW.nota_numero), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o número da nota';
  END IF;
  IF TG_OP = 'UPDATE'
    AND NULLIF(trim(OLD.nota_numero), '') IS NOT NULL
    AND NULLIF(trim(NEW.nota_numero), '') IS NULL THEN
    RAISE EXCEPTION 'O número da nota é obrigatório';
  END IF;
  RETURN NEW;
END;
$$;
DO $$ BEGIN
  CREATE TRIGGER validar_nota_pedido_tecar_trigger
    BEFORE INSERT OR UPDATE OF nota_numero ON public.purchase_orders_tecar
    FOR EACH ROW EXECUTE FUNCTION public.validar_nota_pedido_tecar();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Lista paginada de notas, com busca sem distinção de caixa ou acentos.
CREATE OR REPLACE FUNCTION public.listar_notas_tecar(
  p_status TEXT DEFAULT 'pending',
  p_busca TEXT DEFAULT '',
  p_limite INT DEFAULT 10,
  p_deslocamento INT DEFAULT 0
)
RETURNS TABLE (
  id UUID, order_number INT, supplier_name TEXT, supplier_cnpj TEXT,
  issued_at TIMESTAMPTZ, total NUMERIC, nota_numero TEXT,
  nota_conferida BOOLEAN, nota_conferida_por TEXT,
  nota_conferida_em TIMESTAMPTZ, total_count BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH resultados AS (
    SELECT p.*
    FROM public.purchase_orders_tecar p
    WHERE NULLIF(trim(p.nota_numero), '') IS NOT NULL
      AND p.excluido_em IS NULL
      AND (
        lower(COALESCE(p_status, 'pending')) = 'all'
        OR (lower(COALESCE(p_status, 'pending')) = 'completed' AND p.nota_conferida)
        OR (lower(COALESCE(p_status, 'pending')) = 'pending' AND NOT p.nota_conferida)
      )
      AND (
        trim(COALESCE(p_busca, '')) = ''
        OR public.normalizar_texto_tecar(p.supplier_name)
          LIKE '%' || public.normalizar_texto_tecar(trim(p_busca)) || '%'
        OR public.normalizar_texto_tecar(p.nota_numero)
          LIKE '%' || public.normalizar_texto_tecar(trim(p_busca)) || '%'
      )
  )
  SELECT r.id, r.order_number, r.supplier_name, r.supplier_cnpj,
    r.issued_at, r.total, r.nota_numero, r.nota_conferida,
    r.nota_conferida_por, r.nota_conferida_em, count(*) OVER ()
  FROM resultados r
  ORDER BY r.issued_at DESC, r.order_number DESC
  LIMIT GREATEST(p_limite, 1)
  OFFSET GREATEST(p_deslocamento, 0);
$$;

-- Qualquer usuário autenticado pode alterar somente os campos de conferência.
CREATE OR REPLACE FUNCTION public.salvar_nota_pedido_tecar(
  p_pedido_id UUID,
  p_nota_numero TEXT
)
RETURNS TABLE (
  nota_numero TEXT, nota_conferida BOOLEAN, nota_conferida_por TEXT,
  nota_conferida_em TIMESTAMPTZ, duplicate_order_number INT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_numero TEXT := NULLIF(trim(COALESCE(p_nota_numero, '')), '');
  v_supplier_id UUID;
  v_supplier_cnpj TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  IF v_numero IS NULL THEN RAISE EXCEPTION 'O número da nota é obrigatório'; END IF;
  IF length(COALESCE(v_numero, '')) > 20 THEN
    RAISE EXCEPTION 'O Nº da Nota deve ter no máximo 20 caracteres';
  END IF;

  UPDATE public.purchase_orders_tecar p
  SET nota_numero = v_numero,
      nota_conferida = CASE WHEN p.nota_numero IS DISTINCT FROM v_numero THEN false ELSE p.nota_conferida END,
      nota_conferida_por = CASE WHEN p.nota_numero IS DISTINCT FROM v_numero THEN NULL ELSE p.nota_conferida_por END,
      nota_conferida_em = CASE WHEN p.nota_numero IS DISTINCT FROM v_numero THEN NULL ELSE p.nota_conferida_em END
  WHERE p.id = p_pedido_id AND p.excluido_em IS NULL
  RETURNING p.supplier_id, p.supplier_cnpj
  INTO v_supplier_id, v_supplier_cnpj;

  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;

  RETURN QUERY
  SELECT p.nota_numero, p.nota_conferida, p.nota_conferida_por,
    p.nota_conferida_em,
    (
      SELECT d.order_number
      FROM public.purchase_orders_tecar d
      WHERE d.id <> p.id
        AND d.excluido_em IS NULL
        AND lower(trim(d.nota_numero)) = lower(trim(p.nota_numero))
        AND (
          (v_supplier_id IS NOT NULL AND d.supplier_id = v_supplier_id)
          OR (v_supplier_id IS NULL AND regexp_replace(d.supplier_cnpj, '\D', '', 'g')
            = regexp_replace(v_supplier_cnpj, '\D', '', 'g'))
        )
      ORDER BY d.order_number DESC
      LIMIT 1
    )
  FROM public.purchase_orders_tecar p
  WHERE p.id = p_pedido_id AND p.excluido_em IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.conferir_nota_pedido_tecar(
  p_pedido_id UUID,
  p_conferida BOOLEAN
)
RETURNS TABLE (
  nota_conferida BOOLEAN, nota_conferida_por TEXT, nota_conferida_em TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nome TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  SELECT COALESCE(NULLIF(trim(p.name), ''), NULLIF(trim(p.email), ''), 'Usuário')
  INTO v_nome FROM public.profiles_tecar p WHERE p.id = auth.uid();

  RETURN QUERY
  UPDATE public.purchase_orders_tecar p
  SET nota_conferida = COALESCE(p_conferida, false),
      nota_conferida_por = CASE WHEN COALESCE(p_conferida, false) THEN COALESCE(v_nome, 'Usuário') ELSE NULL END,
      nota_conferida_em = CASE WHEN COALESCE(p_conferida, false) THEN now() ELSE NULL END
  WHERE p.id = p_pedido_id
    AND p.excluido_em IS NULL
    AND NULLIF(trim(p.nota_numero), '') IS NOT NULL
  RETURNING p.nota_conferida, p.nota_conferida_por, p.nota_conferida_em;

  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido sem Nº da Nota ou não encontrado'; END IF;
END;
$$;

-- Cadastra uma nota avulsa. Número, fornecedor e data são validados no banco;
-- a data usa o dia corrente de Brasília e o valor permanece nulo quando omitido.
CREATE OR REPLACE FUNCTION public.criar_nota_avulsa_tecar(
  p_nota_numero TEXT,
  p_supplier_id UUID,
  p_total NUMERIC DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_numero TEXT := NULLIF(trim(COALESCE(p_nota_numero, '')), '');
  v_nome TEXT;
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  IF v_numero IS NULL THEN RAISE EXCEPTION 'Informe o número da nota'; END IF;
  IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'Selecione o fornecedor'; END IF;
  IF length(v_numero) > 20 THEN
    RAISE EXCEPTION 'O Nº da Nota deve ter no máximo 20 caracteres';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers_tecar s WHERE s.id = p_supplier_id
  ) THEN
    RAISE EXCEPTION 'Selecione o fornecedor';
  END IF;

  SELECT COALESCE(NULLIF(trim(p.name), ''), NULLIF(trim(p.email), ''), 'Usuário')
  INTO v_nome
  FROM public.profiles_tecar p
  WHERE p.id = auth.uid();

  INSERT INTO public.notas_fiscais_avulsas_tecar (
    nota_numero, supplier_id, total, issued_on, created_by, created_by_name
  )
  VALUES (
    v_numero,
    p_supplier_id,
    p_total,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    auth.uid(),
    COALESCE(v_nome, 'Usuário')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Lista única para a conferência, preservando as datas originais dos pedidos.
CREATE OR REPLACE FUNCTION public.listar_notas_unificadas_tecar(
  p_status TEXT DEFAULT 'pending',
  p_busca TEXT DEFAULT '',
  p_limite INT DEFAULT 10,
  p_deslocamento INT DEFAULT 0
)
RETURNS TABLE (
  id UUID, note_type TEXT, order_number INT, supplier_name TEXT,
  supplier_cnpj TEXT, issued_on DATE, total NUMERIC, nota_numero TEXT,
  nota_conferida BOOLEAN, nota_conferida_por TEXT,
  nota_conferida_em TIMESTAMPTZ, total_count BIGINT
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  WITH notas AS (
    SELECT p.id, 'order'::TEXT AS note_type, p.order_number,
      p.supplier_name, p.supplier_cnpj,
      (p.issued_at AT TIME ZONE 'America/Sao_Paulo')::date AS issued_on,
      p.total, p.nota_numero, p.nota_conferida, p.nota_conferida_por,
      p.nota_conferida_em, p.created_at
    FROM public.purchase_orders_tecar p
    WHERE NULLIF(trim(p.nota_numero), '') IS NOT NULL
      AND p.excluido_em IS NULL
    UNION ALL
    SELECT n.id, 'standalone'::TEXT, NULL::INT,
      s.name, s.cnpj, n.issued_on, n.total, n.nota_numero,
      n.nota_conferida, n.nota_conferida_por, n.nota_conferida_em,
      n.created_at
    FROM public.notas_fiscais_avulsas_tecar n
    JOIN public.suppliers_tecar s ON s.id = n.supplier_id
  ),
  resultados AS (
    SELECT n.*
    FROM notas n
    WHERE (
        lower(COALESCE(p_status, 'pending')) = 'all'
        OR (lower(COALESCE(p_status, 'pending')) = 'completed' AND n.nota_conferida)
        OR (lower(COALESCE(p_status, 'pending')) = 'pending' AND NOT n.nota_conferida)
      )
      AND (
        trim(COALESCE(p_busca, '')) = ''
        OR public.normalizar_texto_tecar(n.supplier_name)
          LIKE '%' || public.normalizar_texto_tecar(trim(p_busca)) || '%'
        OR public.normalizar_texto_tecar(n.nota_numero)
          LIKE '%' || public.normalizar_texto_tecar(trim(p_busca)) || '%'
      )
  )
  SELECT r.id, r.note_type, r.order_number, r.supplier_name, r.supplier_cnpj,
    r.issued_on, r.total, r.nota_numero, r.nota_conferida,
    r.nota_conferida_por, r.nota_conferida_em, count(*) OVER ()
  FROM resultados r
  ORDER BY r.issued_on DESC NULLS LAST, r.created_at DESC
  LIMIT GREATEST(p_limite, 1)
  OFFSET GREATEST(p_deslocamento, 0);
$$;

CREATE OR REPLACE FUNCTION public.conferir_nota_avulsa_tecar(
  p_nota_id UUID,
  p_conferida BOOLEAN
)
RETURNS TABLE (
  nota_conferida BOOLEAN, nota_conferida_por TEXT, nota_conferida_em TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_nome TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  SELECT COALESCE(NULLIF(trim(p.name), ''), NULLIF(trim(p.email), ''), 'Usuário')
  INTO v_nome FROM public.profiles_tecar p WHERE p.id = auth.uid();

  RETURN QUERY
  UPDATE public.notas_fiscais_avulsas_tecar n
  SET nota_conferida = COALESCE(p_conferida, false),
      nota_conferida_por = CASE WHEN COALESCE(p_conferida, false) THEN COALESCE(v_nome, 'Usuário') ELSE NULL END,
      nota_conferida_em = CASE WHEN COALESCE(p_conferida, false) THEN now() ELSE NULL END
  WHERE n.id = p_nota_id
  RETURNING n.nota_conferida, n.nota_conferida_por, n.nota_conferida_em;

  IF NOT FOUND THEN RAISE EXCEPTION 'Nota avulsa não encontrada'; END IF;
END;
$$;

-- Lixeira de pedidos. O UUID do usuário é guardado como texto para que a
-- restauração possa validar exatamente quem moveu o pedido.
CREATE OR REPLACE FUNCTION public.usuario_admin_tecar()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles_tecar
    WHERE id = auth.uid() AND is_admin = true
  );
$$;

CREATE OR REPLACE FUNCTION public.mover_pedido_lixeira_tecar(p_pedido_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  UPDATE public.purchase_orders_tecar p
  SET excluido_em = now(), excluido_por = auth.uid()::TEXT
  WHERE p.id = p_pedido_id
    AND p.excluido_em IS NULL
    AND (p.created_by = auth.uid() OR public.usuario_admin_tecar());
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou sem permissão'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restaurar_pedido_lixeira_tecar(p_pedido_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  UPDATE public.purchase_orders_tecar p
  SET excluido_em = NULL, excluido_por = NULL
  WHERE p.id = p_pedido_id
    AND p.excluido_em IS NOT NULL
    AND (p.excluido_por = auth.uid()::TEXT OR public.usuario_admin_tecar());
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado ou sem permissão'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.excluir_pedido_definitivamente_tecar(p_pedido_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.usuario_admin_tecar() THEN
    RAISE EXCEPTION 'Somente administradores podem excluir definitivamente';
  END IF;
  DELETE FROM public.purchase_orders_tecar p
  WHERE p.id = p_pedido_id AND p.excluido_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado na lixeira'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.listar_lixeira_tecar(
  p_limite INT DEFAULT 10,
  p_deslocamento INT DEFAULT 0
)
RETURNS TABLE (
  id UUID, order_number INT, supplier_name TEXT, total NUMERIC,
  created_by_name TEXT, excluido_por_nome TEXT, excluido_em TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.order_number, p.supplier_name, p.total, p.created_by_name,
    COALESCE(NULLIF(trim(perfil.name), ''), NULLIF(trim(perfil.email), ''), p.excluido_por),
    p.excluido_em, count(*) OVER ()
  FROM public.purchase_orders_tecar p
  LEFT JOIN public.profiles_tecar perfil
    ON perfil.id::TEXT = p.excluido_por
  WHERE auth.uid() IS NOT NULL
    AND p.excluido_em IS NOT NULL
    AND (p.excluido_por = auth.uid()::TEXT OR public.usuario_admin_tecar())
  ORDER BY p.excluido_em DESC, p.order_number DESC
  LIMIT GREATEST(p_limite, 1)
  OFFSET GREATEST(p_deslocamento, 0);
$$;

CREATE OR REPLACE FUNCTION public.contar_lixeira_tecar()
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM public.purchase_orders_tecar p
  WHERE auth.uid() IS NOT NULL
    AND p.excluido_em IS NOT NULL
    AND (p.excluido_por = auth.uid()::TEXT OR public.usuario_admin_tecar());
$$;

CREATE OR REPLACE FUNCTION public.buscar_ultimo_preco_tecar(
  p_codigo TEXT,
  p_supplier_id UUID DEFAULT NULL,
  p_supplier_cnpj TEXT DEFAULT '',
  p_excluir_pedido_id UUID DEFAULT NULL
)
RETURNS TABLE (
  valor NUMERIC, issued_at TIMESTAMPTZ, supplier_name TEXT,
  mesmo_fornecedor BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH parametros AS (
    SELECT upper(regexp_replace(COALESCE(p_codigo, ''), '\s', '', 'g')) AS codigo
  ),
  candidatos AS (
    SELECT
      NULLIF(item->>'unit_price', '')::NUMERIC AS valor,
      p.issued_at,
      p.order_number,
      p.supplier_name,
      (
        (p_supplier_id IS NOT NULL AND p.supplier_id = p_supplier_id)
        OR (
          regexp_replace(COALESCE(p_supplier_cnpj, ''), '\D', '', 'g') <> ''
          AND regexp_replace(p.supplier_cnpj, '\D', '', 'g')
            = regexp_replace(COALESCE(p_supplier_cnpj, ''), '\D', '', 'g')
        )
      ) AS mesmo_fornecedor
    FROM public.purchase_orders_tecar p
    CROSS JOIN parametros prm
    CROSS JOIN LATERAL jsonb_array_elements(p.items) item
    WHERE auth.uid() IS NOT NULL
      AND prm.codigo <> ''
      AND p.excluido_em IS NULL
      AND (p_excluir_pedido_id IS NULL OR p.id <> p_excluir_pedido_id)
      AND public.codigos_pedido_tecar(p.items) @> ARRAY[prm.codigo]
      AND upper(regexp_replace(COALESCE(item->>'code', ''), '\s', '', 'g')) = prm.codigo
      AND NULLIF(item->>'unit_price', '') IS NOT NULL
  )
  SELECT c.valor, c.issued_at, c.supplier_name, c.mesmo_fornecedor
  FROM candidatos c
  ORDER BY c.mesmo_fornecedor DESC, c.issued_at DESC, c.order_number DESC
  LIMIT 1;
$$;

-- Função atômica para número do pedido
CREATE OR REPLACE FUNCTION public.next_order_number_tecar()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_next INT;
BEGIN
  UPDATE public.order_sequence_tecar
  SET last_number = last_number + 1
  WHERE id = 1
  RETURNING last_number INTO v_next;
  RETURN v_next;
END;
$$;

-- Trigger: criar perfil automaticamente ao cadastrar usuário
CREATE OR REPLACE FUNCTION public.handle_new_user_tecar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles_tecar (id, name, email, is_admin)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    new.email = 'admim@tecar.com.br'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_tecar ON auth.users;
CREATE TRIGGER on_auth_user_created_tecar
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_tecar();

-- RLS Policies
ALTER TABLE public.profiles_tecar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers_tecar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders_tecar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_fiscais_avulsas_tecar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_drafts_tecar ENABLE ROW LEVEL SECURITY;

-- Perfis: leitura pública, escrita pelo próprio usuário
DO $$ BEGIN
  CREATE POLICY "profiles_select" ON public.profiles_tecar FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "profiles_insert" ON public.profiles_tecar FOR INSERT WITH CHECK (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "profiles_update" ON public.profiles_tecar FOR UPDATE USING (auth.uid() = id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
REVOKE UPDATE ON public.profiles_tecar FROM authenticated;
GRANT UPDATE (name, email) ON public.profiles_tecar TO authenticated;

DROP POLICY IF EXISTS "suppliers_all" ON public.suppliers_tecar;
DROP POLICY IF EXISTS "suppliers_select_insert_update" ON public.suppliers_tecar;
DROP POLICY IF EXISTS "suppliers_select" ON public.suppliers_tecar;
DROP POLICY IF EXISTS "suppliers_insert" ON public.suppliers_tecar;
DROP POLICY IF EXISTS "suppliers_update" ON public.suppliers_tecar;
DROP POLICY IF EXISTS "suppliers_delete" ON public.suppliers_tecar;
CREATE POLICY "suppliers_select" ON public.suppliers_tecar FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "suppliers_insert" ON public.suppliers_tecar FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND auth.uid() = created_by);
CREATE POLICY "suppliers_update" ON public.suppliers_tecar FOR UPDATE
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "suppliers_delete" ON public.suppliers_tecar FOR DELETE
  USING (
    auth.uid() = created_by
    OR EXISTS (SELECT 1 FROM public.profiles_tecar WHERE id = auth.uid() AND is_admin)
  );

-- Itens: base compartilhada com leitura e escrita por todos os autenticados
DO $$ BEGIN
  CREATE POLICY "itens_select" ON public.itens FOR SELECT
    USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "itens_insert" ON public.itens FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "itens_update" ON public.itens FOR UPDATE
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE ON public.itens TO authenticated;

-- Estoque e registro de importações: todos os autenticados podem consultar
-- e importar, sem restrição por usuário ou perfil.
DO $$ BEGIN
  CREATE POLICY "estoque_select" ON public.estoque FOR SELECT
    USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "estoque_insert" ON public.estoque FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "estoque_update" ON public.estoque FOR UPDATE
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "estoque_delete" ON public.estoque FOR DELETE
    USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "estoque_importacoes_select" ON public.estoque_importacoes FOR SELECT
    USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "estoque_importacoes_insert" ON public.estoque_importacoes FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estoque TO authenticated;
GRANT SELECT, INSERT ON public.estoque_importacoes TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_estoque_tecar(TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_fornecedores_tecar(TEXT, INT, INT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalizar_texto_tecar(TEXT)
  TO authenticated;

-- Pedidos: exclusão definitiva não é concedida diretamente; passa apenas pela RPC.
DROP POLICY IF EXISTS "orders_select" ON public.purchase_orders_tecar;
DROP POLICY IF EXISTS "orders_insert" ON public.purchase_orders_tecar;
DROP POLICY IF EXISTS "orders_update" ON public.purchase_orders_tecar;
DROP POLICY IF EXISTS "orders_delete" ON public.purchase_orders_tecar;
CREATE POLICY "orders_select" ON public.purchase_orders_tecar FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      excluido_em IS NULL
      OR excluido_por = auth.uid()::TEXT
      OR EXISTS (
        SELECT 1 FROM public.profiles_tecar
        WHERE id = auth.uid() AND is_admin = true
      )
    )
  );
CREATE POLICY "orders_insert" ON public.purchase_orders_tecar FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "orders_update" ON public.purchase_orders_tecar FOR UPDATE USING (
    excluido_em IS NULL
    AND (
      auth.uid() = created_by OR
      EXISTS (SELECT 1 FROM public.profiles_tecar WHERE id = auth.uid() AND is_admin = true)
    )
  ) WITH CHECK (
    excluido_em IS NULL
    AND (
      auth.uid() = created_by OR
      EXISTS (SELECT 1 FROM public.profiles_tecar WHERE id = auth.uid() AND is_admin = true)
    )
  );
REVOKE DELETE ON public.purchase_orders_tecar FROM authenticated;
REVOKE UPDATE ON public.purchase_orders_tecar FROM authenticated;
GRANT UPDATE (
  supplier_id, supplier_name, supplier_cnpj, items, total, notes, updated_at,
  nota_numero, nota_conferida, nota_conferida_por, nota_conferida_em
) ON public.purchase_orders_tecar TO authenticated;

DO $$ BEGIN
  CREATE POLICY "standalone_notes_select" ON public.notas_fiscais_avulsas_tecar
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON public.notas_fiscais_avulsas_tecar TO authenticated;

-- Permissão para autenticados chamarem a função de sequência
GRANT EXECUTE ON FUNCTION public.next_order_number_tecar() TO authenticated;
REVOKE ALL ON FUNCTION public.listar_notas_tecar(TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.salvar_nota_pedido_tecar(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conferir_nota_pedido_tecar(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_nota_avulsa_tecar(TEXT, UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.listar_notas_unificadas_tecar(TEXT, TEXT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.conferir_nota_avulsa_tecar(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_notas_tecar(TEXT, TEXT, INT, INT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_nota_pedido_tecar(UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.conferir_nota_pedido_tecar(UUID, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_nota_avulsa_tecar(TEXT, UUID, NUMERIC)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_notas_unificadas_tecar(TEXT, TEXT, INT, INT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.conferir_nota_avulsa_tecar(UUID, BOOLEAN)
  TO authenticated;
REVOKE ALL ON FUNCTION public.usuario_admin_tecar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mover_pedido_lixeira_tecar(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restaurar_pedido_lixeira_tecar(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.excluir_pedido_definitivamente_tecar(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.listar_lixeira_tecar(INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contar_lixeira_tecar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buscar_ultimo_preco_tecar(TEXT, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_admin_tecar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mover_pedido_lixeira_tecar(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurar_pedido_lixeira_tecar(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_pedido_definitivamente_tecar(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_lixeira_tecar(INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contar_lixeira_tecar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_ultimo_preco_tecar(TEXT, UUID, TEXT, UUID)
  TO authenticated;

DROP POLICY IF EXISTS "drafts_own" ON public.order_drafts_tecar;
CREATE POLICY "drafts_own" ON public.order_drafts_tecar FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_drafts_tecar TO authenticated;

-- Backup diário às 02:00 de Brasília (05:00 UTC).
DO $$ BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'tecar-backup-diario';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'tecar-backup-diario',
  '0 5 * * *',
  $job$
    SELECT net.http_post(
      url := 'https://udbacmavixfqzzfihums.supabase.co/functions/v1/server/make-server-e3b494b7/backups/scheduled',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Cron-Token', (SELECT token::text FROM public.backup_cron_tecar WHERE id = 1)
      ),
      body := '{}'::jsonb
    );
  $job$
);

-- ====================================================
-- Após rodar o SQL acima:
-- 1. Crie o usuário admin em Authentication > Users:
--    E-mail: admim@tecar.com.br  |  Senha: Tecar@123
-- 2. Volte ao sistema e faça login!
-- ====================================================
