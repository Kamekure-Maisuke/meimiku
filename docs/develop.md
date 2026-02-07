# 開発ガイド

## 構成

```
postgrest-sample/
├── podman.yaml   # Pod定義 (PostgreSQL + PostgREST)
├── start.sh      # 起動
├── stop.sh       # 停止・削除
├── clear.sh      # 停止・削除 + ボリューム削除 (完全リセット)
├── sql/          # DB初期化SQL (番号順に実行)
│   ├── 001_extensions.sql  # pgcrypto拡張
│   ├── 002_jwt.sql         # JWT署名関数
│   ├── 003_tables.sql      # テーブル定義 + 初期データ
│   ├── 004_roles.sql       # ロール作成 + 権限付与
│   ├── 005_auth.sql        # signup/login RPC関数
│   └── 006_rls.sql         # Row Level Security
└── docs/
    ├── api.md      # APIリファレンス
    └── develop.md  # このファイル
```

| コンテナ   | ポート | 役割                         |
|------------|--------|------------------------------|
| postgres   | 5432   | データベース                 |
| postgrest  | 3000   | PostgreSQLを自動でREST API化 |

## 認証の仕組み

### 概要

JWT (JSON Web Token) ベースの認証を採用。PostgRESTの組み込みJWT検証機能を利用する。

```
┌──────────┐  signup/login   ┌───────────┐  JWT検証    ┌───────────┐
│  Client  │ ──────────────→ │ PostgREST │ ─────────→ │ PostgreSQL│
│          │ ←────────────── │           │ ←───────── │           │
│          │   JWT token     │ (JWT検証)  │  ロール切替 │ (RLS適用)  │
└──────────┘                 └───────────┘            └───────────┘
```

1. クライアントが `/rpc/signup` または `/rpc/login` を呼び出し
2. PostgreSQL内のPL/pgSQL関数がパスワードを検証し、JWTを生成して返却
3. クライアントは以降のリクエストで `Authorization: Bearer <token>` ヘッダーを付与
4. PostgRESTがJWTを検証し、ペイロードの `role` に基づいてPostgreSQLロールを切り替え
5. RLS (Row Level Security) がJWTの `user_id` に基づいてアクセス制御

### ロール設計

| ロール | 用途 | 権限 |
|---|---|---|
| `web_anon` | 未認証ユーザー | books: SELECT, login/signup: EXECUTE |
| `api_user` | 認証済みユーザー | books: CRUD, favorites: CRUD (自分のデータのみ) |
| `meimiku` | PostgREST接続ユーザー | web_anon / api_user に切り替え可能 |

### JWT署名

`postgres:alpine` には `pgjwt` 拡張が含まれないため、PL/pgSQLで `sign()` 関数を実装している。アルゴリズムは HS256。

### JWT Secret の変更方法

`podman.yaml` の以下2箇所を同じ値に変更する (最低32文字):

```yaml
# PostgRESTがJWTを検証するために使用
- name: PGRST_JWT_SECRET
  value: "新しいシークレットキー"

# SQL関数内でJWT生成に使用
- name: PGRST_APP_SETTINGS_JWT_SECRET
  value: "新しいシークレットキー"
```

変更後は再構築が必要:

```bash
./clear.sh
./start.sh
```

## 起動・停止

```bash
# 起動
./start.sh

# 停止・削除
./stop.sh

# 停止・削除 + ボリューム削除 (DB初期化からやり直す場合)
./clear.sh
```

## ログ確認

```bash
# Pod内の全コンテナのログ
podman pod logs meimiku

# コンテナ単位で確認
podman logs meimiku-postgres
podman logs meimiku-postgrest
```

## DB接続

```bash
podman exec -it meimiku-postgres psql -U meimiku
```

psql内での操作例:

```sql
-- テーブル一覧
\dt api.*

-- booksテーブルの構造を確認
\d api.books
```

## テーブルの追加

### 1. `sql/003_tables.sql` に CREATE TABLE を追加

```sql
CREATE TABLE api.authors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT
);
```

### 2. 権限の設定

`sql/004_roles.sql` にテーブルごとの権限を追加する。ロールは2種類:

- `web_anon` — 未認証ユーザー (読み取り中心)
- `api_user` — 認証済みユーザー (CRUD)

```sql
-- 例: 新テーブルを両方のロールで読み取り可能にする
GRANT SELECT ON api.new_table TO web_anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.new_table TO api_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA api TO api_user;
```

認証ユーザーのみアクセスさせたい場合は `api_user` にのみ権限を付与する。

### 3. 反映 (初回構築 or 再構築)

`sql/` 内のSQLファイルはPostgreSQLの初回起動時のみ実行される。既にデータがある場合は再構築が必要:

```bash
./clear.sh
./start.sh
```

### 4. 稼働中のDBに直接追加する場合

再構築せずに追加したい場合は psql で直接実行する:

```bash
podman exec -it meimiku-postgres psql -U meimiku -c "
  CREATE TABLE api.authors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT
  );
  GRANT SELECT ON api.authors TO web_anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON api.authors TO api_user;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA api TO api_user;
"
```

その後 PostgREST にスキーマキャッシュをリロードさせる:

```bash
curl -X GET http://localhost:3000/
# 自動検出されない場合は PostgREST を再起動
podman restart meimiku-postgrest
```

## カラムの追加

### 1. SQLファイルに反映する場合

`sql/003_tables.sql` のCREATE TABLE文にカラムを追加して再構築:

```sql
CREATE TABLE api.books (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  published_year INT,
  isbn TEXT,              -- 追加
  created_at TIMESTAMPTZ DEFAULT now()
);
```

```bash
./clear.sh
./start.sh
```

### 2. 稼働中のDBに直接追加する場合

```bash
podman exec -it meimiku-postgres psql -U meimiku -c "
  ALTER TABLE api.books ADD COLUMN isbn TEXT;
"
```

PostgREST は次のリクエスト時に自動でスキーマを再読み込みする。反映されない場合:

```bash
podman restart meimiku-postgrest
```

## PostgREST のスキーマリロード

テーブルやカラムを変更した後、PostgREST に通知する方法:

```bash
# NOTIFY で通知 (推奨・ダウンタイムなし)
podman exec -it meimiku-postgres psql -U meimiku -c "NOTIFY pgrst, 'reload schema';"

# それでも反映されない場合はコンテナ再起動
podman restart meimiku-postgrest
```

## トラブルシューティング

### PostgREST が接続できない

PostgreSQLの起動完了前にPostgRESTが接続を試みることがある。少し待ってからログを確認:

```bash
podman logs meimiku-postgrest
```

接続エラーが出続ける場合はPostgRESTだけ再起動:

```bash
podman restart meimiku-postgrest
```

### sql/ のSQLが実行されない

PostgreSQLは初回起動時のみ `/docker-entrypoint-initdb.d/` のスクリプトを実行する。データベースのボリュームが残っていると再実行されない:

```bash
./clear.sh
./start.sh
```

### 新しいテーブルがAPIに出てこない

1. テーブルが `api` スキーマに作成されているか確認
2. `web_anon` または `api_user` ロールに権限があるか確認
3. PostgREST にスキーマリロードを通知

```bash
podman exec -it meimiku-postgres psql -U meimiku -c "
  SELECT table_name FROM information_schema.tables WHERE table_schema = 'api';
  SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'api';
"
```
