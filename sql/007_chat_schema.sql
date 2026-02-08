-- ============================================================
-- Chat Schema: Tables, Indexes, Views, and RPC Functions
-- ============================================================

-- Chat Rooms table
CREATE TABLE api.chat_rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by INT NOT NULL
    REFERENCES api.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Room Members table (tracks which users are in which rooms)
CREATE TABLE api.room_members (
  id SERIAL PRIMARY KEY,
  room_id INT NOT NULL
    REFERENCES api.chat_rooms(id) ON DELETE CASCADE,
  user_id INT NOT NULL
    REFERENCES api.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, user_id)
);

-- Chat Messages table
CREATE TABLE api.chat_messages (
  id SERIAL PRIMARY KEY,
  room_id INT NOT NULL
    REFERENCES api.chat_rooms(id) ON DELETE CASCADE,
  user_id INT NOT NULL
    REFERENCES api.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(message) > 0 AND length(message) <= 5000),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Indexes for Performance
-- ============================================================

CREATE INDEX idx_room_members_user ON api.room_members(user_id);
CREATE INDEX idx_room_members_room ON api.room_members(room_id);
CREATE INDEX idx_messages_room_time ON api.chat_messages(room_id, created_at DESC);

-- ============================================================
-- View: My Chat Rooms (rooms the current user is a member of)
-- ============================================================

CREATE VIEW api.my_chat_rooms AS
SELECT
  cr.id,
  cr.name,
  cr.description,
  cr.created_by,
  cr.created_at,
  (SELECT COUNT(*) FROM api.room_members WHERE room_id = cr.id) AS member_count,
  (SELECT COUNT(*) FROM api.chat_messages WHERE room_id = cr.id) AS message_count,
  (SELECT MAX(created_at) FROM api.chat_messages WHERE room_id = cr.id) AS last_message_at
FROM api.chat_rooms cr
WHERE EXISTS (
  SELECT 1 FROM api.room_members rm
  WHERE rm.room_id = cr.id
    AND rm.user_id = (current_setting('request.jwt.claims', true)::json->>'user_id')::int
);

-- ============================================================
-- RPC: create_chat_room
-- Creates a new chat room and automatically adds the creator as a member
-- ============================================================

CREATE OR REPLACE FUNCTION api.create_chat_room(name text, description text DEFAULT '')
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_user_id int;
  new_room api.chat_rooms;
  jwt_claims text;
BEGIN
  -- Get JWT claims
  jwt_claims := current_setting('request.jwt.claims', true);

  IF jwt_claims IS NULL OR jwt_claims = '' THEN
    RAISE EXCEPTION 'Not authenticated: JWT claims not found';
  END IF;

  -- Extract user_id from claims
  current_user_id := (jwt_claims::json->>'user_id')::int;

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated: user_id not found in JWT';
  END IF;

  -- Verify user exists
  IF NOT EXISTS (SELECT 1 FROM api.users WHERE id = current_user_id) THEN
    RAISE EXCEPTION 'User does not exist: %', current_user_id;
  END IF;

  -- Create the room
  INSERT INTO api.chat_rooms (name, description, created_by)
    VALUES (create_chat_room.name, create_chat_room.description, current_user_id)
    RETURNING * INTO new_room;

  -- Automatically add creator as a member
  INSERT INTO api.room_members (room_id, user_id)
    VALUES (new_room.id, current_user_id);

  RETURN json_build_object(
    'id', new_room.id,
    'name', new_room.name,
    'description', new_room.description,
    'created_at', new_room.created_at
  );
END;
$$;

-- ============================================================
-- RPC: join_chat_room
-- Adds the current user to a chat room
-- ============================================================

CREATE OR REPLACE FUNCTION api.join_chat_room(p_room_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_user_id int;
  room_exists boolean;
  jwt_claims text;
BEGIN
  jwt_claims := current_setting('request.jwt.claims', true);

  IF jwt_claims IS NULL OR jwt_claims = '' THEN
    RAISE EXCEPTION 'Not authenticated: JWT claims not found';
  END IF;

  current_user_id := (jwt_claims::json->>'user_id')::int;

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated: user_id not found in JWT';
  END IF;

  -- Check if room exists
  SELECT EXISTS(SELECT 1 FROM api.chat_rooms WHERE id = p_room_id)
    INTO room_exists;

  IF NOT room_exists THEN
    RAISE EXCEPTION 'Room not found'
      USING HINT = 'The specified room does not exist';
  END IF;

  -- Insert or ignore if already a member
  INSERT INTO api.room_members (room_id, user_id)
    VALUES (p_room_id, current_user_id)
    ON CONFLICT (room_id, user_id) DO NOTHING;

  RETURN json_build_object('success', true);
END;
$$;

-- ============================================================
-- RPC: leave_chat_room
-- Removes the current user from a chat room
-- ============================================================

CREATE OR REPLACE FUNCTION api.leave_chat_room(p_room_id int)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_user_id int;
  jwt_claims text;
BEGIN
  jwt_claims := current_setting('request.jwt.claims', true);

  IF jwt_claims IS NULL OR jwt_claims = '' THEN
    RAISE EXCEPTION 'Not authenticated: JWT claims not found';
  END IF;

  current_user_id := (jwt_claims::json->>'user_id')::int;

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated: user_id not found in JWT';
  END IF;

  DELETE FROM api.room_members
    WHERE api.room_members.room_id = p_room_id
      AND api.room_members.user_id = current_user_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ============================================================
-- Grant Permissions
-- ============================================================

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION api.create_chat_room(text, text) TO api_user;
GRANT EXECUTE ON FUNCTION api.join_chat_room(int) TO api_user;
GRANT EXECUTE ON FUNCTION api.leave_chat_room(int) TO api_user;

-- Grant table access to authenticated users
GRANT SELECT ON api.chat_rooms TO api_user;
GRANT SELECT ON api.room_members TO api_user;
GRANT SELECT, INSERT ON api.chat_messages TO api_user;
GRANT SELECT ON api.my_chat_rooms TO api_user;
