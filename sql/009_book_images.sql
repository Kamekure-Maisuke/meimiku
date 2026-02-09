-- ============================================================
-- 書籍画像テーブル
-- ============================================================

CREATE TABLE api.book_images (
  id SERIAL PRIMARY KEY,
  book_id INT NOT NULL REFERENCES api.books(id) ON DELETE CASCADE,
  s3_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INT NOT NULL,
  uploaded_by INT NOT NULL
    DEFAULT (current_setting('request.jwt.claims', true)::json->>'user_id')::int
    REFERENCES api.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(book_id, s3_key)
);

-- RLS (Row Level Security) 設定
ALTER TABLE api.book_images ENABLE ROW LEVEL SECURITY;

-- 全員が画像を閲覧可能
CREATE POLICY book_images_select ON api.book_images
  FOR SELECT
  TO api_user
  USING (true);

-- 認証済みユーザーは画像をアップロード可能
CREATE POLICY book_images_insert ON api.book_images
  FOR INSERT
  TO api_user
  WITH CHECK (
    uploaded_by = (current_setting('request.jwt.claims', true)::json->>'user_id')::int
  );

-- 画像をアップロードしたユーザーのみ削除可能
CREATE POLICY book_images_delete ON api.book_images
  FOR DELETE
  TO api_user
  USING (
    uploaded_by = (current_setting('request.jwt.claims', true)::json->>'user_id')::int
  );

-- インデックス
CREATE INDEX idx_book_images_book_id ON api.book_images(book_id);
CREATE INDEX idx_book_images_uploaded_by ON api.book_images(uploaded_by);

-- 権限付与
GRANT SELECT, INSERT, DELETE ON api.book_images TO api_user;
GRANT USAGE, SELECT ON SEQUENCE api.book_images_id_seq TO api_user;
