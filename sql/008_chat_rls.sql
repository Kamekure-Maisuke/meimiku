-- ============================================================
-- RLS (Row Level Security) for Chat Tables
-- ============================================================

-- Helper function to get current user ID from JWT
CREATE OR REPLACE FUNCTION api.current_user_id()
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT (current_setting('request.jwt.claims', true)::json->>'user_id')::int;
$$;

-- ============================================================
-- RLS on chat_rooms
-- All authenticated users can see all rooms (to discover and join)
-- ============================================================

ALTER TABLE api.chat_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_rooms_select_policy ON api.chat_rooms
  FOR SELECT
  TO api_user
  USING (true);

-- ============================================================
-- RLS on room_members
-- Allow all authenticated users to see room members
-- (Access control is enforced by chat_rooms RLS and RPC functions)
-- ============================================================

ALTER TABLE api.room_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY room_members_select_policy ON api.room_members
  FOR SELECT
  TO api_user
  USING (true);

-- ============================================================
-- RLS on chat_messages
-- Users can only see and post messages in rooms they are members of
-- ============================================================

ALTER TABLE api.chat_messages ENABLE ROW LEVEL SECURITY;

-- SELECT: Can read messages from rooms they're in
CREATE POLICY chat_messages_select_policy ON api.chat_messages
  FOR SELECT
  TO api_user
  USING (
    EXISTS (
      SELECT 1 FROM api.room_members
      WHERE room_members.room_id = chat_messages.room_id
        AND room_members.user_id = api.current_user_id()
    )
  );

-- INSERT: Can post messages to rooms they're in
CREATE POLICY chat_messages_insert_policy ON api.chat_messages
  FOR INSERT
  TO api_user
  WITH CHECK (
    user_id = api.current_user_id()
    AND EXISTS (
      SELECT 1 FROM api.room_members
      WHERE room_members.room_id = chat_messages.room_id
        AND room_members.user_id = api.current_user_id()
    )
  );
