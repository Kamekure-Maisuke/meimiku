-- ============================================
-- お知らせ機能
-- ============================================

-- 1. お知らせテーブル
CREATE TABLE IF NOT EXISTS api.announcements (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 200),
  content TEXT NOT NULL CHECK (length(content) > 0 AND length(content) <= 5000),
  created_by INT NOT NULL REFERENCES api.users(id) ON DELETE CASCADE,
  is_published BOOLEAN DEFAULT false,
  priority INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_published ON api.announcements(is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_announcements_priority ON api.announcements(priority DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON api.announcements(created_at DESC);

-- 3. 既読管理テーブル
CREATE TABLE IF NOT EXISTS api.announcement_reads (
  id SERIAL PRIMARY KEY,
  announcement_id INT NOT NULL REFERENCES api.announcements(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES api.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON api.announcement_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement ON api.announcement_reads(announcement_id);

-- 4. ヘルパー関数：現在のユーザーIDを取得
CREATE OR REPLACE FUNCTION api.current_user_id()
RETURNS INT AS $$
BEGIN
  RETURN (current_setting('request.jwt.claims', true)::json->>'user_id')::int;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. 現在のユーザーが管理者かチェック
CREATE OR REPLACE FUNCTION api.is_current_user_admin()
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id INT;
  v_is_admin BOOLEAN;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT is_admin INTO v_is_admin FROM api.users WHERE id = v_user_id;
  RETURN COALESCE(v_is_admin, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 6. 未読お知らせ件数を取得
CREATE OR REPLACE FUNCTION api.get_unread_announcement_count()
RETURNS INT AS $$
DECLARE
  v_user_id INT;
  v_count INT;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COUNT(*)::INT INTO v_count
  FROM api.announcements a
  WHERE a.is_published = true
    AND NOT EXISTS (
      SELECT 1 FROM api.announcement_reads ar
      WHERE ar.announcement_id = a.id AND ar.user_id = v_user_id
    );

  RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 7. お知らせを既読にする
CREATE OR REPLACE FUNCTION api.mark_announcement_as_read(p_announcement_id INT)
RETURNS JSON AS $$
DECLARE
  v_user_id INT;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  -- 既読レコードを挿入（既に存在する場合は無視）
  INSERT INTO api.announcement_reads (announcement_id, user_id)
  VALUES (p_announcement_id, v_user_id)
  ON CONFLICT (announcement_id, user_id) DO NOTHING;

  RETURN json_build_object('success', true, 'message', 'Marked as read');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. 全てのお知らせを既読にする
CREATE OR REPLACE FUNCTION api.mark_all_announcements_as_read()
RETURNS JSON AS $$
DECLARE
  v_user_id INT;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  -- 公開済みの全お知らせを既読にする
  INSERT INTO api.announcement_reads (announcement_id, user_id)
  SELECT a.id, v_user_id
  FROM api.announcements a
  WHERE a.is_published = true
    AND NOT EXISTS (
      SELECT 1 FROM api.announcement_reads ar
      WHERE ar.announcement_id = a.id AND ar.user_id = v_user_id
    )
  ON CONFLICT (announcement_id, user_id) DO NOTHING;

  RETURN json_build_object('success', true, 'message', 'All marked as read');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. お知らせ作成（管理者のみ）
CREATE OR REPLACE FUNCTION api.create_announcement(
  p_title TEXT,
  p_content TEXT,
  p_is_published BOOLEAN DEFAULT false,
  p_priority INT DEFAULT 0
)
RETURNS JSON AS $$
DECLARE
  v_user_id INT;
  v_announcement_id INT;
BEGIN
  v_user_id := api.current_user_id();

  -- 管理者チェック
  IF NOT api.is_current_user_admin() THEN
    RETURN json_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  -- バリデーション
  IF p_title IS NULL OR length(p_title) = 0 OR length(p_title) > 200 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid title length');
  END IF;

  IF p_content IS NULL OR length(p_content) = 0 OR length(p_content) > 5000 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid content length');
  END IF;

  -- お知らせを作成
  INSERT INTO api.announcements (title, content, created_by, is_published, priority)
  VALUES (p_title, p_content, v_user_id, p_is_published, p_priority)
  RETURNING id INTO v_announcement_id;

  RETURN json_build_object(
    'success', true,
    'message', 'Announcement created',
    'id', v_announcement_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. お知らせ更新（管理者のみ）
CREATE OR REPLACE FUNCTION api.update_announcement(
  p_id INT,
  p_title TEXT,
  p_content TEXT,
  p_is_published BOOLEAN,
  p_priority INT
)
RETURNS JSON AS $$
BEGIN
  -- 管理者チェック
  IF NOT api.is_current_user_admin() THEN
    RETURN json_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  -- バリデーション
  IF p_title IS NULL OR length(p_title) = 0 OR length(p_title) > 200 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid title length');
  END IF;

  IF p_content IS NULL OR length(p_content) = 0 OR length(p_content) > 5000 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid content length');
  END IF;

  -- お知らせを更新
  UPDATE api.announcements
  SET
    title = p_title,
    content = p_content,
    is_published = p_is_published,
    priority = p_priority,
    updated_at = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Announcement not found');
  END IF;

  RETURN json_build_object('success', true, 'message', 'Announcement updated');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. お知らせ削除（管理者のみ）
CREATE OR REPLACE FUNCTION api.delete_announcement(p_id INT)
RETURNS JSON AS $$
BEGIN
  -- 管理者チェック
  IF NOT api.is_current_user_admin() THEN
    RETURN json_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  -- お知らせを削除
  DELETE FROM api.announcements WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Announcement not found');
  END IF;

  RETURN json_build_object('success', true, 'message', 'Announcement deleted');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12. お知らせビュー（一般ユーザー用）
CREATE OR REPLACE VIEW api.announcements_with_read_status AS
SELECT
  a.id,
  a.title,
  a.content,
  a.is_published,
  a.priority,
  a.created_at,
  a.updated_at,
  u.name AS author_name,
  EXISTS (
    SELECT 1 FROM api.announcement_reads ar
    WHERE ar.announcement_id = a.id AND ar.user_id = api.current_user_id()
  ) AS is_read
FROM api.announcements a
INNER JOIN api.users u ON u.id = a.created_by
WHERE a.is_published = true OR api.is_current_user_admin()
ORDER BY a.priority DESC, a.created_at DESC;

-- 13. RLSポリシー設定
ALTER TABLE api.announcements ENABLE ROW LEVEL SECURITY;

-- 既存のポリシーを削除（存在する場合）
DROP POLICY IF EXISTS announcements_select_policy ON api.announcements;
DROP POLICY IF EXISTS announcements_insert_policy ON api.announcements;
DROP POLICY IF EXISTS announcements_update_policy ON api.announcements;
DROP POLICY IF EXISTS announcements_delete_policy ON api.announcements;

-- 公開済みは全員、未公開は管理者のみ
CREATE POLICY announcements_select_policy ON api.announcements
  FOR SELECT TO api_user
  USING (is_published = true OR api.is_current_user_admin());

-- 挿入・更新・削除は管理者のみ（実際はRPC関数経由でのみ実行）
CREATE POLICY announcements_insert_policy ON api.announcements
  FOR INSERT TO api_user
  WITH CHECK (api.is_current_user_admin());

CREATE POLICY announcements_update_policy ON api.announcements
  FOR UPDATE TO api_user
  USING (api.is_current_user_admin());

CREATE POLICY announcements_delete_policy ON api.announcements
  FOR DELETE TO api_user
  USING (api.is_current_user_admin());

-- 既読管理テーブルのRLS
ALTER TABLE api.announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcement_reads_select_policy ON api.announcement_reads;
DROP POLICY IF EXISTS announcement_reads_insert_policy ON api.announcement_reads;

-- 自分の既読情報のみアクセス可能
CREATE POLICY announcement_reads_select_policy ON api.announcement_reads
  FOR SELECT TO api_user
  USING (user_id = api.current_user_id());

CREATE POLICY announcement_reads_insert_policy ON api.announcement_reads
  FOR INSERT TO api_user
  WITH CHECK (user_id = api.current_user_id());

-- ビューにも権限を付与
GRANT SELECT ON api.announcements_with_read_status TO api_user;
