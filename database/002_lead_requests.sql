-- NOVA CABINET: public website lead intake
-- Apply only after creating a Supabase project and reviewing this migration.
-- Public visitors may submit requests, but cannot read or change any request.
-- Authenticated staff access is restricted to trusted JWT app_metadata roles.

CREATE TABLE IF NOT EXISTS public.lead_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(160) NOT NULL CHECK (char_length(trim(full_name)) BETWEEN 2 AND 160),
  mobile VARCHAR(20) NOT NULL CHECK (mobile ~ '^(09[0-9]{9}|\\+989[0-9]{9}|00989[0-9]{9})$'),
  request_type VARCHAR(80) NOT NULL CHECK (request_type IN (
    'طراحی آشپزخانه','ساخت کابینت','بازسازی','مشاوره و برآورد قیمت'
  )),
  city VARCHAR(100),
  details TEXT CHECK (details IS NULL OR char_length(details) <= 3000),
  status VARCHAR(24) NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','contacted','quoted','converted','closed'
  )),
  source VARCHAR(30) NOT NULL DEFAULT 'website' CHECK (source = 'website'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_requests_created_idx
  ON public.lead_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS lead_requests_status_idx
  ON public.lead_requests (status, created_at DESC);

ALTER TABLE public.lead_requests ENABLE ROW LEVEL SECURITY;

-- Remove broad policies if this migration is re-applied during setup.
DROP POLICY IF EXISTS "Public can submit website leads" ON public.lead_requests;
DROP POLICY IF EXISTS "Staff can view website leads" ON public.lead_requests;
DROP POLICY IF EXISTS "Staff can update website leads" ON public.lead_requests;

CREATE POLICY "Public can submit website leads"
  ON public.lead_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'new'
    AND source = 'website'
  );

CREATE POLICY "Staff can view website leads"
  ON public.lead_requests
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('owner_admin','factory_manager')
  );

CREATE POLICY "Staff can update website leads"
  ON public.lead_requests
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('owner_admin','factory_manager')
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('owner_admin','factory_manager')
  );

-- No anonymous SELECT, UPDATE, or DELETE policy is intentionally provided.
-- Configure staff roles only in trusted Supabase app_metadata, never user_metadata.
