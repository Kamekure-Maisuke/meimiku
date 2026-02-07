-- ============================================================
-- RLS (Row Level Security) on favorites
-- ============================================================
ALTER TABLE api.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY favorites_policy ON api.favorites
  FOR ALL
  TO api_user
  USING (user_id = (current_setting('request.jwt.claims', true)::json->>'user_id')::int)
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::json->>'user_id')::int);
