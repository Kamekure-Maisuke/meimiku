# PostgREST API リファレンス

ベースURL: `http://localhost:3000`

## 認証

### ユーザー登録

```bash
curl -X POST http://localhost:3000/rpc/signup \
  -H 'Content-Type: application/json' \
  -d '{"name":"テスト","email":"test@example.com","password":"password123"}'
# → {"token":"eyJhbGciOi..."}
```

### ログイン

```bash
curl -X POST http://localhost:3000/rpc/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"password123"}'
# → {"token":"eyJhbGciOi..."}
```

### 認証ヘッダー

認証が必要なエンドポイントでは `Authorization` ヘッダーにJWTトークンを付与する:

```bash
curl http://localhost:3000/favorites \
  -H 'Authorization: Bearer <token>'
```

トークンは発行から1時間有効。

### アクセス権限

| エンドポイント | 未認証 (web_anon) | 認証済み (api_user) |
|---|---|---|
| `GET /books` | SELECT のみ | CRUD |
| `/rpc/signup` | 実行可 | 実行可 |
| `/rpc/login` | 実行可 | 実行可 |
| `/favorites` | アクセス不可 | CRUD (自分のデータのみ) |

---

## Books API

## API情報の取得

```bash
# ルート: 公開されているテーブル一覧
curl http://localhost:3000/
```

## 読み取り (GET)

```bash
# 全件取得
curl http://localhost:3000/books

# 件数だけ取得 (ヘッダーで確認)
curl -I http://localhost:3000/books
```

### フィルタリング

```bash
# IDで1件取得
curl 'http://localhost:3000/books?id=eq.1'

# タイトルに "Rust" を含む
curl 'http://localhost:3000/books?title=like.*Rust*'

# 大文字小文字を無視して検索
curl 'http://localhost:3000/books?title=ilike.*rust*'

# 著者が完全一致
curl 'http://localhost:3000/books?author=eq.Alex%20Petrov'

# 出版年が2019年以降
curl 'http://localhost:3000/books?published_year=gte.2019'

# 出版年が2010〜2020の範囲
curl 'http://localhost:3000/books?published_year=gte.2010&published_year=lte.2020'

# 複数IDをまとめて取得
curl 'http://localhost:3000/books?id=in.(1,2)'
```

### フィルタ演算子一覧

| 演算子   | 意味             | 例                           |
|----------|------------------|------------------------------|
| `eq`     | =                | `?id=eq.1`                   |
| `neq`    | !=               | `?id=neq.1`                  |
| `gt`     | >                | `?published_year=gt.2015`    |
| `gte`    | >=               | `?published_year=gte.2015`   |
| `lt`     | <                | `?published_year=lt.2020`    |
| `lte`    | <=               | `?published_year=lte.2020`   |
| `like`   | LIKE             | `?title=like.*Rust*`         |
| `ilike`  | ILIKE (大小無視) | `?title=ilike.*rust*`        |
| `in`     | IN               | `?id=in.(1,2,3)`             |
| `is`     | IS (null判定)    | `?published_year=is.null`    |
| `not`    | NOT              | `?published_year=not.is.null`|

### ソート

```bash
# 出版年の降順
curl 'http://localhost:3000/books?order=published_year.desc'

# タイトルの昇順
curl 'http://localhost:3000/books?order=title.asc'

# 複数条件: 出版年降順 → タイトル昇順
curl 'http://localhost:3000/books?order=published_year.desc,title.asc'
```

### ページネーション

```bash
# 先頭3件
curl 'http://localhost:3000/books?limit=3'

# 4件目から3件取得 (offset)
curl 'http://localhost:3000/books?limit=3&offset=3'

# Range ヘッダーでも可能
curl -H 'Range: 0-4' http://localhost:3000/books
```

### カラム選択

```bash
# title と author だけ取得
curl 'http://localhost:3000/books?select=title,author'

# カラムをリネームして取得
curl 'http://localhost:3000/books?select=book_title:title,book_author:author'
```

### 件数の取得

```bash
# レスポンスヘッダーに総件数を含める
curl -H 'Prefer: count=exact' 'http://localhost:3000/books'
# → Content-Range: 0-1/2
```

## 作成 (POST)

```bash
# 1件作成
curl -X POST http://localhost:3000/books \
  -H 'Content-Type: application/json' \
  -d '{"title":"Clean Code","author":"Robert C. Martin","published_year":2008}'

# 作成した行を返却させる
curl -X POST http://localhost:3000/books \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '{"title":"Clean Code","author":"Robert C. Martin","published_year":2008}'

# 複数件を一括作成
curl -X POST http://localhost:3000/books \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '[
    {"title":"Design Patterns","author":"Gang of Four","published_year":1994},
    {"title":"Refactoring","author":"Martin Fowler","published_year":1999}
  ]'
```

## 更新 (PATCH)

```bash
# IDを指定して更新
curl -X PATCH 'http://localhost:3000/books?id=eq.1' \
  -H 'Content-Type: application/json' \
  -d '{"published_year":2020}'

# 更新結果を返却させる
curl -X PATCH 'http://localhost:3000/books?id=eq.1' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '{"published_year":2020}'

# 条件に合う複数行を一括更新
curl -X PATCH 'http://localhost:3000/books?published_year=lt.2000' \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=representation' \
  -d '{"published_year":2000}'
```

## 削除 (DELETE)

```bash
# IDを指定して削除
curl -X DELETE 'http://localhost:3000/books?id=eq.1'

# 削除した行を返却させる
curl -X DELETE 'http://localhost:3000/books?id=eq.1' \
  -H 'Prefer: return=representation'

# 条件に合う複数行を削除
curl -X DELETE 'http://localhost:3000/books?published_year=lt.2000' \
  -H 'Prefer: return=representation'
```

## UPSERT (INSERT or UPDATE)

```bash
# idが一致すれば更新、なければ挿入
curl -X POST http://localhost:3000/books \
  -H 'Content-Type: application/json' \
  -H 'Prefer: resolution=merge-duplicates, return=representation' \
  -d '{"id":1,"title":"Updated Title","author":"Updated Author","published_year":2025}'
```

## レスポンス形式の指定

```bash
# CSV形式で取得
curl -H 'Accept: text/csv' http://localhost:3000/books

# 単一オブジェクト (配列ではなくオブジェクトで返す)
curl -H 'Accept: application/vnd.pgrst.object+json' \
  'http://localhost:3000/books?id=eq.1'
```

---

## お気に入り API

認証必須。RLSにより自分のデータのみ操作可能。

### お気に入り追加

```bash
curl -X POST http://localhost:3000/favorites \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -H 'Prefer: return=representation' \
  -d '{"user_id":1,"book_id":1}'
```

### お気に入り一覧

```bash
curl http://localhost:3000/favorites \
  -H 'Authorization: Bearer <token>'
```

### お気に入り削除

```bash
# book_idを指定して削除
curl -X DELETE 'http://localhost:3000/favorites?book_id=eq.1' \
  -H 'Authorization: Bearer <token>' \
  -H 'Prefer: return=representation'
```

### 未認証でのアクセス

```bash
# 認証なしでfavoritesにアクセス → 401 Unauthorized
curl http://localhost:3000/favorites
```
