-- ============================================================================
-- Makari Gad — Row Level Security hardening
-- Run this in the Supabase SQL Editor AFTER reviewing it.
--
-- WHY: Every existing policy is `USING (true) WITH CHECK (true)`, and all role
-- enforcement lives in the browser. With the public anon key, any authenticated
-- user can (a) escalate their own role to 'admin' and (b) read/write/delete any
-- table directly via the REST API, bypassing the UI entirely.
--
-- This script fixes the crown-jewel issue concretely (self-role-escalation) and
-- gives you a tested-by-you template to tighten the operational tables.
--
-- SAFE TO RUN: the user_roles section is designed NOT to break the app —
-- profile self-save still works; only the `role` column becomes non-self-writable.
-- The operational-table section is COMMENTED OUT: enable it table by table once
-- you've confirmed which write/delete flows each role actually needs.
-- ============================================================================


-- ── 1. Role lookup helpers ──────────────────────────────────────────────────
-- SECURITY DEFINER so the lookup itself bypasses RLS on user_roles (avoids
-- infinite recursion when user_roles policies call these).

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE email = auth.email() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.current_app_role() = 'admin', false);
$$;


-- ── 2. user_roles: the privilege-escalation fix ─────────────────────────────

-- 2a. Give the role column a safe default so brand-new rows are never admin.
ALTER TABLE public.user_roles ALTER COLUMN role SET DEFAULT 'operator';

-- 2b. A trigger enforces column-level protection that a single RLS policy can't:
--     non-admins may edit their own profile row, but can NEVER set/change `role`.
CREATE OR REPLACE FUNCTION public.user_roles_protect_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_app_admin() THEN
    RETURN NEW;                         -- admins may set any role
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.role := OLD.role;               -- non-admins can never change their role
  ELSIF TG_OP = 'INSERT' THEN
    -- keep an existing role if the row already exists; otherwise force default
    NEW.role := COALESCE(
      (SELECT role FROM public.user_roles WHERE email = NEW.email),
      'operator'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_roles_protect_role ON public.user_roles;
CREATE TRIGGER trg_user_roles_protect_role
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_protect_role();

-- 2c. RLS policies for user_roles.
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_roles_select   ON public.user_roles;
DROP POLICY IF EXISTS user_roles_insert   ON public.user_roles;
DROP POLICY IF EXISTS user_roles_update   ON public.user_roles;
DROP POLICY IF EXISTS user_roles_delete   ON public.user_roles;

-- All logged-in staff may read the directory (names, roles).
CREATE POLICY user_roles_select ON public.user_roles
  FOR SELECT TO authenticated USING (true);

-- A user may create their own row (first profile save); admins may create anyone.
-- The trigger forces role to the safe default for non-admins.
CREATE POLICY user_roles_insert ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (email = auth.email() OR public.is_app_admin());

-- A user may update their own row; admins may update anyone.
-- The trigger prevents non-admins from changing the role column.
CREATE POLICY user_roles_update ON public.user_roles
  FOR UPDATE TO authenticated
  USING (email = auth.email() OR public.is_app_admin())
  WITH CHECK (email = auth.email() OR public.is_app_admin());

-- Only admins may delete user rows.
CREATE POLICY user_roles_delete ON public.user_roles
  FOR DELETE TO authenticated USING (public.is_app_admin());


-- ── 3. Operational tables — TEMPLATE (enable per table after testing) ────────
--
-- The app currently relies on broad authenticated read/write. Tighten in stages:
-- keep SELECT + INSERT + UPDATE open to authenticated staff, but restrict the
-- destructive DELETE to elevated roles. Enable ONE table, exercise every flow
-- that touches it (entry, edit, re-upload, report), then move to the next.
--
-- Tables in this project:
--   app_settings, attendance_logs, balanch_readings, board_report_executive,
--   calendar_mappings, contract_energy, hourly_logs, historical_data,
--   inventory_audit, inventory_equipment, inventory_fuel_pumps, inventory_items,
--   inventory_logs, inventory_stores, maintenance_logs, operator_complaints,
--   operator_daily_logs, outages, plant_data, rainfall_data, site_expense_items,
--   work_zones
--
-- NOTE: some normal flows DELETE as part of an upsert (e.g. the expense
-- re-upload in plant-data.js deletes a month then re-inserts). Confirm which
-- role performs each such flow before restricting DELETE, or those flows break.
--
-- Template (uncomment and repeat per table, swapping <TABLE>):
--
--   ALTER TABLE public.<TABLE> ENABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS <TABLE>_select ON public.<TABLE>;
--   DROP POLICY IF EXISTS <TABLE>_write  ON public.<TABLE>;
--   DROP POLICY IF EXISTS <TABLE>_delete ON public.<TABLE>;
--
--   CREATE POLICY <TABLE>_select ON public.<TABLE>
--     FOR SELECT TO authenticated USING (true);
--
--   -- INSERT + UPDATE for any authenticated staff member:
--   CREATE POLICY <TABLE>_write ON public.<TABLE>
--     FOR ALL TO authenticated
--     USING (true) WITH CHECK (true);
--   -- (Replace the two lines above with separate INSERT/UPDATE policies if you
--   --  want UPDATE limited; FOR ALL also covers DELETE, so if you want to limit
--   --  deletes, use explicit FOR INSERT / FOR UPDATE policies plus the one below.)
--
--   -- Destructive deletes limited to admin + management:
--   CREATE POLICY <TABLE>_delete ON public.<TABLE>
--     FOR DELETE TO authenticated
--     USING (public.current_app_role() IN ('admin','management'));
--
-- attendance_logs deserves extra care: the client currently writes `is_valid`
-- and GPS coordinates, so geofence validity is forgeable regardless of RLS.
-- The durable fix is to compute is_valid server-side (Edge Function / RPC) from
-- the raw coordinates rather than trusting the client value.
-- ============================================================================
