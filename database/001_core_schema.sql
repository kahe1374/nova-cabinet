-- NOVA CABINET core database schema (PostgreSQL)
-- Foundation only: review and apply through a controlled migration process.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(160) NOT NULL,
  mobile VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(254),
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('owner_admin','factory_manager','customer')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES app_users(id) ON DELETE SET NULL,
  full_name VARCHAR(160) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  email VARCHAR(254),
  province VARCHAR(100),
  city VARCHAR(100),
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_mobile_idx ON customers(mobile);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(32) NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  order_type VARCHAR(30) NOT NULL CHECK (order_type IN ('cabinet','workshop_service')),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','under_review','awaiting_quote_approval','awaiting_payment','approved_for_production',
    'in_production','quality_control','ready_for_delivery','delivered','completed','cancelled'
  )),
  quoted_amount NUMERIC(14,2) CHECK (quoted_amount IS NULL OR quoted_amount >= 0),
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'IRR',
  requested_due_date DATE,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (paid_amount <= COALESCE(quoted_amount, paid_amount))
);
CREATE INDEX orders_customer_created_idx ON orders(customer_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders(status);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_name VARCHAR(200) NOT NULL,
  specification JSONB NOT NULL DEFAULT '{}'::jsonb,
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit VARCHAR(30),
  unit_price NUMERIC(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  line_total NUMERIC(14,2) CHECK (line_total IS NULL OR line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workshop_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  services JSONB NOT NULL DEFAULT '[]'::jsonb,
  sheet_count INTEGER CHECK (sheet_count IS NULL OR sheet_count >= 0),
  part_count INTEGER CHECK (part_count IS NULL OR part_count >= 0),
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  drawing_file_key TEXT,
  cutting_list_file_key TEXT,
  pricing_mode VARCHAR(20) NOT NULL DEFAULT 'quote' CHECK (pricing_mode IN ('indicative','quote')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_status_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  old_status VARCHAR(40),
  new_status VARCHAR(40) NOT NULL,
  note TEXT,
  changed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_history_order_time_idx ON order_status_history(order_id, changed_at DESC);

CREATE TABLE order_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  file_key TEXT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120),
  file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_actor_time_idx ON audit_log(actor_user_id, created_at DESC);

-- Important implementation notes:
-- 1) Never store plaintext passwords; use Laravel's password hashing facilities.
-- 2) Generate order_number server-side inside a transaction; never trust client input.
-- 3) Enforce role-based authorization on every API route and customer ownership on reads.
-- 4) Store uploaded files outside the public web root; persist opaque file keys only.
-- 5) Payment processing, SMS, AI generation, and production integrations are separate modules.


-- Lock down all exposed tables by default. Add role/ownership policies
-- only after Supabase Auth identities and the admin/customer role model exist.
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshop_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
