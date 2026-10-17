CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'trial',
  seat_limit INT NOT NULL DEFAULT 5,
  driver_limit INT NOT NULL DEFAULT 10,
  trial_ends_at TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  default_currency TEXT NOT NULL DEFAULT 'EUR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','dispatcher','sales','finance','driver')),
  locale TEXT NOT NULL DEFAULT 'en',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','carrier','both')),
  email TEXT,
  phone TEXT,
  vat TEXT,
  vat_eu TEXT,
  city TEXT,
  country TEXT,
  payment_terms_days INT NOT NULL DEFAULT 14,
  rating NUMERIC(2,1),
  insurance_expires DATE,
  warning BOOLEAN NOT NULL DEFAULT false,
  blacklisted BOOLEAN NOT NULL DEFAULT false,
  qbo_customer_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  mobile TEXT,
  fax TEXT,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, label)
);

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','quoted','negotiation','won','lost')),
  amount_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  origin TEXT,
  destination TEXT,
  load_type TEXT NOT NULL DEFAULT 'FTL',
  fuel_surcharge_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  distance_km INT,
  duration_min INT,
  distance_source TEXT,
  close_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE RESTRICT,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','assigned','in_transit','delivered','invoiced','cancelled')),
  origin TEXT,
  destination TEXT,
  cargo TEXT,
  weight_kg INT,
  load_type TEXT NOT NULL DEFAULT 'FTL',
  price_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  pickup_at TIMESTAMPTZ,
  delivery_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  distance_km INT,
  duration_min INT,
  distance_source TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'tractor',
  capacity_kg INT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','on_trip','maintenance')),
  location TEXT,
  cost_per_km_cents INT NOT NULL DEFAULT 0,
  insurance_expires DATE,
  inspection_expires DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, plate)
);

CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT,
  license_no TEXT,
  adr BOOLEAN NOT NULL DEFAULT false,
  license_expires DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('own_fleet','subcontracted')),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  carrier_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  cost_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','assigned','arrived','loaded','in_transit','delivered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','void')),
  amount_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  issued_at DATE,
  due_at DATE,
  paid_at DATE,
  qbo_invoice_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id UUID NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT,
  size_bytes INT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note','task','email','sms','system')),
  title TEXT,
  body TEXT,
  due_at TIMESTAMPTZ,
  done BOOLEAN NOT NULL DEFAULT false,
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  object_type TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK (trigger_event IN ('created','updated','property_changed')),
  trigger_property TEXT,
  trigger_value TEXT,
  actions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL,
  object_type TEXT NOT NULL,
  object_id UUID,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL DEFAULT 'read' CHECK (scope IN ('read','write')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrations (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  config JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id UUID,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS companies_tenant_idx ON companies (tenant_id);
CREATE INDEX IF NOT EXISTS contacts_tenant_idx ON contacts (tenant_id);
CREATE INDEX IF NOT EXISTS deals_tenant_idx ON deals (tenant_id, stage);
CREATE INDEX IF NOT EXISTS orders_tenant_idx ON orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS relations_order_idx ON relations (order_id);
CREATE INDEX IF NOT EXISTS invoices_tenant_idx ON invoices (tenant_id, status);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS public_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_token_idx ON invoices (public_token) WHERE public_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  peer TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  twilio_sid TEXT NOT NULL,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, twilio_sid)
);

CREATE INDEX IF NOT EXISTS activities_object_idx ON activities (tenant_id, object_type, object_id);
CREATE INDEX IF NOT EXISTS sms_contact_idx ON sms_messages (tenant_id, contact_id, created_at);
CREATE INDEX IF NOT EXISTS sms_peer_idx ON sms_messages (tenant_id, peer, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_object_idx ON documents (tenant_id, object_type, object_id);
CREATE INDEX IF NOT EXISTS audit_tenant_idx ON audit_log (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  href TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vat TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS iban TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS swift TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS invoice_footer TEXT;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_eu TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS fax TEXT;
UPDATE contacts SET mobile = phone WHERE mobile IS NULL AND phone IS NOT NULL;
UPDATE companies SET vat_eu = vat
WHERE vat_eu IS NULL AND vat IS NOT NULL AND country IN (
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK'
);

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_role_check;
ALTER TABLE companies ADD CONSTRAINT companies_role_check CHECK (role IN ('customer','carrier','both','broker'));

ALTER TABLE orders DROP COLUMN IF EXISTS deal_id;
DROP INDEX IF EXISTS deals_tenant_idx;
DELETE FROM workflows WHERE object_type = 'deal';
DROP TABLE IF EXISTS deals;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom JSONB NOT NULL DEFAULT '{}';
ALTER TABLE activities ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS graph JSONB;

CREATE TABLE IF NOT EXISTS order_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('customer','broker','carrier')),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, role)
);

CREATE TABLE IF NOT EXISTS order_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  amount_cents INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_property_defs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','checkboxes','radio','number','select','multiselect')),
  options JSONB NOT NULL DEFAULT '[]',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS workflow_waits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL,
  object_id UUID NOT NULL,
  node_id TEXT NOT NULL,
  resume_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, object_id)
);

CREATE INDEX IF NOT EXISTS order_parties_order_idx ON order_parties (order_id);
CREATE INDEX IF NOT EXISTS order_expenses_order_idx ON order_expenses (order_id);
CREATE INDEX IF NOT EXISTS order_property_defs_tenant_idx ON order_property_defs (tenant_id, sort_order);
CREATE INDEX IF NOT EXISTS workflow_waits_resume_idx ON workflow_waits (resume_at);
CREATE INDEX IF NOT EXISTS activities_due_idx ON activities (tenant_id, kind, done, due_at);

INSERT INTO order_parties (tenant_id, order_id, role, company_id)
SELECT tenant_id, id, 'customer', company_id
FROM orders
WHERE company_id IS NOT NULL
ON CONFLICT (order_id, role) DO NOTHING;

ALTER TABLE order_expenses ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE order_expenses ADD COLUMN IF NOT EXISTS occurred_on DATE;
ALTER TABLE order_expenses ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE order_expenses ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE order_expenses ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
UPDATE order_expenses SET occurred_on = created_at::date WHERE occurred_on IS NULL;
ALTER TABLE order_expenses ALTER COLUMN occurred_on SET DEFAULT CURRENT_DATE;
ALTER TABLE order_expenses ALTER COLUMN occurred_on SET NOT NULL;
ALTER TABLE order_expenses DROP CONSTRAINT IF EXISTS order_expenses_payment_type_check;
ALTER TABLE order_expenses ADD CONSTRAINT order_expenses_payment_type_check
  CHECK (payment_type IN ('cash','card','wire','fuel_card','cheque','other'));
CREATE INDEX IF NOT EXISTS order_expenses_tenant_date_idx ON order_expenses (tenant_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS order_expenses_company_idx ON order_expenses (company_id);
