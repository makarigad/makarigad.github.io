-- Makari Gad Inventory v2 — run in Supabase SQL Editor
-- Extends existing inventory_items / inventory_logs with stores, fuel workflow, and audit trail.

-- ── Stores (admin can add temporary stores) ──
CREATE TABLE IF NOT EXISTS inventory_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  short_code TEXT,
  site_group TEXT DEFAULT 'general',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_temporary BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by_email TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_stores_name_key ON inventory_stores (lower(trim(name)));

-- ── Fuel pumps (purchase source) ──
CREATE TABLE IF NOT EXISTS inventory_fuel_pumps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location_label TEXT,
  contact_phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Equipment (diesel/petrol consumers) ──
CREATE TABLE IF NOT EXISTS inventory_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('diesel', 'petrol')),
  store_id UUID REFERENCES inventory_stores(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Extend inventory_items ──
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES inventory_stores(id) ON DELETE SET NULL;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS fuel_type TEXT CHECK (fuel_type IS NULL OR fuel_type IN ('diesel', 'petrol'));
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS min_stock NUMERIC DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS updated_by_email TEXT;

-- ── Extend inventory_logs ──
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS txn_subtype TEXT;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS pump_id UUID REFERENCES inventory_fuel_pumps(id) ON DELETE SET NULL;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS equipment_id UUID REFERENCES inventory_equipment(id) ON DELETE SET NULL;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS from_store_id UUID REFERENCES inventory_stores(id) ON DELETE SET NULL;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS to_store_id UUID REFERENCES inventory_stores(id) ON DELETE SET NULL;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS created_by_email TEXT;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS modified_by_email TEXT;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS modified_by_name TEXT;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS geo_label TEXT;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE inventory_logs ADD COLUMN IF NOT EXISTS notes TEXT;

-- ── Audit log (all create / update / delete) ──
CREATE TABLE IF NOT EXISTS inventory_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  summary TEXT,
  payload JSONB,
  user_email TEXT,
  user_name TEXT,
  user_role TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geo_label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_audit_entity_idx ON inventory_audit (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS inventory_audit_created_idx ON inventory_audit (created_at DESC);

-- ── Seed default stores ──
INSERT INTO inventory_stores (name, short_code, site_group, sort_order)
SELECT * FROM (VALUES
  ('Transmission Line Store – Marma', 'TL-MARMA', 'transmission', 10),
  ('Transmission Line Store – Powerhouse', 'TL-PH', 'transmission', 20),
  ('WKV Store (inside Powerhouse)', 'WKV-PH', 'powerhouse', 30),
  ('Civil Store (Powerhouse)', 'CIVIL-PH', 'powerhouse', 40),
  ('Mechanical Store (Powerhouse)', 'MECH-PH', 'powerhouse', 50),
  ('Electrical Store (Powerhouse)', 'ELEC-PH', 'powerhouse', 60),
  ('Backside Store (Powerhouse)', 'BACK-PH', 'powerhouse', 70),
  ('Ropeway Store', 'ROPE', 'ropeway', 80),
  ('Headworks / Dam Store', 'DAM', 'headworks', 90)
) AS t(name, short_code, site_group, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM inventory_stores LIMIT 1);

-- ── Seed fuel pumps (edit names to match your suppliers) ──
INSERT INTO inventory_fuel_pumps (name, location_label)
SELECT * FROM (VALUES
  ('Local Fuel Pump – Marma Road', 'Marma'),
  ('Local Fuel Pump – Near Site', 'Makari Gad access road')
) AS v(name, location_label)
WHERE NOT EXISTS (SELECT 1 FROM inventory_fuel_pumps LIMIT 1);

-- ── Seed equipment (customize in Admin → Equipment) ──
INSERT INTO inventory_equipment (name, fuel_type, store_id)
SELECT v.name, v.fuel_type, s.id
FROM (VALUES
  ('Powerhouse Generator 1', 'diesel', 'Electrical Store (Powerhouse)'),
  ('Powerhouse Generator 2', 'diesel', 'Electrical Store (Powerhouse)'),
  ('Ropeway Generator 1', 'diesel', 'Ropeway Store'),
  ('Ropeway Generator 2', 'diesel', 'Ropeway Store'),
  ('Headworks Generator', 'diesel', 'Headworks / Dam Store'),
  ('Bolero / Site Vehicle', 'diesel', 'Backside Store (Powerhouse)'),
  ('Petrol Generator (PH)', 'petrol', 'Electrical Store (Powerhouse)')
) AS v(name, fuel_type, store_name)
JOIN inventory_stores s ON s.name = v.store_name
WHERE NOT EXISTS (SELECT 1 FROM inventory_equipment LIMIT 1);

-- ── Optional: stock refresh trigger (if not already present) ──
CREATE OR REPLACE FUNCTION inventory_apply_log_to_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.txn_type = 'IN' THEN
      UPDATE inventory_items SET current_stock = COALESCE(current_stock, 0) + NEW.quantity WHERE id = NEW.item_id;
    ELSE
      UPDATE inventory_items SET current_stock = COALESCE(current_stock, 0) - NEW.quantity WHERE id = NEW.item_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.txn_type = 'IN' THEN
      UPDATE inventory_items SET current_stock = COALESCE(current_stock, 0) - OLD.quantity WHERE id = OLD.item_id;
    ELSE
      UPDATE inventory_items SET current_stock = COALESCE(current_stock, 0) + OLD.quantity WHERE id = OLD.item_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_log_stock ON inventory_logs;
CREATE TRIGGER trg_inventory_log_stock
  AFTER INSERT OR DELETE ON inventory_logs
  FOR EACH ROW EXECUTE FUNCTION inventory_apply_log_to_stock();

-- ── RLS (adjust policies to your auth setup) ──
ALTER TABLE inventory_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_fuel_pumps ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_stores_read" ON inventory_stores FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory_stores_write" ON inventory_stores FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "inventory_pumps_read" ON inventory_fuel_pumps FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory_pumps_write" ON inventory_fuel_pumps FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "inventory_equipment_read" ON inventory_equipment FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory_equipment_write" ON inventory_equipment FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "inventory_audit_read" ON inventory_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory_audit_insert" ON inventory_audit FOR INSERT TO authenticated WITH CHECK (true);
