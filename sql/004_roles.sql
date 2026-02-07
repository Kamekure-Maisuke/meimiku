-- ============================================================
-- ロール設計
-- ============================================================
CREATE ROLE web_anon NOLOGIN;
CREATE ROLE api_user NOLOGIN;

-- web_anon: books の SELECT のみ + login/signup 実行権
GRANT USAGE ON SCHEMA api TO web_anon;
GRANT SELECT ON api.books TO web_anon;

-- api_user: books の CRUD + favorites の CRUD
GRANT USAGE ON SCHEMA api TO api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.books TO api_user;
GRANT SELECT, INSERT, DELETE ON api.favorites TO api_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA api TO api_user;

-- PostgRESTの接続ユーザーがロール切替できるようにする
GRANT web_anon TO meimiku;
GRANT api_user TO meimiku;
