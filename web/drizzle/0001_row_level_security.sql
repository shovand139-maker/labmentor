-- Tenant isolation and learner privacy, enforced by PostgreSQL for the application role.
--
-- The web app connects as labmentor_app, which owns nothing and has no BYPASSRLS. Every request runs in a
-- transaction that first sets app.tenant_id, app.user_id and app.role (see src/lib/db/tenant.ts). A missing
-- setting reads as NULL, which matches no rows, so forgetting it fails closed.
--
-- scripts/migrate.ts creates the labmentor_app role before this file runs.

CREATE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.role', true), '') $$;

-- Organization data that everyone in the tenant reads.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON tenants FOR SELECT USING (id = app_tenant());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON users FOR SELECT USING (tenant_id = app_tenant());

ALTER TABLE labs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON labs FOR SELECT USING (tenant_id = app_tenant());
CREATE POLICY instructors_update ON labs FOR UPDATE
  USING (tenant_id = app_tenant() AND app_role() = 'instructor')
  WITH CHECK (tenant_id = app_tenant() AND app_role() = 'instructor');

ALTER TABLE lab_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON lab_steps FOR SELECT USING (tenant_id = app_tenant());

ALTER TABLE lab_faq ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON lab_faq FOR SELECT USING (tenant_id = app_tenant());

-- A learner's own work. Instructors in the same tenant can read it for insights but never write it.
ALTER TABLE progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_or_instructor_read ON progress FOR SELECT
  USING (tenant_id = app_tenant() AND (user_id = app_user() OR app_role() = 'instructor'));
CREATE POLICY own_write ON progress FOR INSERT WITH CHECK (tenant_id = app_tenant() AND user_id = app_user());
CREATE POLICY own_delete ON progress FOR DELETE USING (tenant_id = app_tenant() AND user_id = app_user());

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_or_instructor_read ON conversations FOR SELECT
  USING (tenant_id = app_tenant() AND (user_id = app_user() OR app_role() = 'instructor'));
CREATE POLICY own_write ON conversations FOR INSERT WITH CHECK (tenant_id = app_tenant() AND user_id = app_user());

-- Messages follow their conversation: the subquery is itself filtered by the conversations policy.
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY via_conversation_read ON messages FOR SELECT
  USING (tenant_id = app_tenant() AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id));
CREATE POLICY own_conversation_write ON messages FOR INSERT
  WITH CHECK (
    tenant_id = app_tenant()
    AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.user_id = app_user())
  );

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_or_instructor_read ON feedback FOR SELECT
  USING (tenant_id = app_tenant() AND (user_id = app_user() OR app_role() = 'instructor'));
CREATE POLICY own_insert ON feedback FOR INSERT
  WITH CHECK (
    tenant_id = app_tenant()
    AND user_id = app_user()
    AND EXISTS (SELECT 1 FROM messages m WHERE m.id = message_id AND m.role = 'assistant')
  );
CREATE POLICY own_update ON feedback FOR UPDATE
  USING (tenant_id = app_tenant() AND user_id = app_user())
  WITH CHECK (tenant_id = app_tenant() AND user_id = app_user());

-- Least privilege: read everything the policies allow, write only what the app writes.
GRANT USAGE ON SCHEMA public TO labmentor_app;
GRANT SELECT ON tenants, users, labs, lab_steps, lab_faq, progress, conversations, messages, feedback TO labmentor_app;
GRANT UPDATE (solutions_allowed, updated_at) ON labs TO labmentor_app;
GRANT INSERT, DELETE ON progress TO labmentor_app;
GRANT INSERT ON conversations, messages TO labmentor_app;
GRANT INSERT, UPDATE (rating, comment) ON feedback TO labmentor_app;
GRANT EXECUTE ON FUNCTION app_tenant(), app_user(), app_role() TO labmentor_app;
