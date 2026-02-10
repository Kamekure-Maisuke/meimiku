-- ============================================================
-- テーブル定義
-- ============================================================
CREATE TABLE api.books (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  published_year INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE api.users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE api.favorites (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL
    DEFAULT (current_setting('request.jwt.claims', true)::json->>'user_id')::int
    REFERENCES api.users(id) ON DELETE CASCADE,
  book_id INT NOT NULL REFERENCES api.books(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, book_id)
);

-- 初期データ
INSERT INTO api.books (title, author, published_year) VALUES
  ('吾輩は猫である', '夏目漱石', 1905),
  ('坊っちゃん', '夏目漱石', 1906),
  ('こころ', '夏目漱石', 1914),
  ('羅生門', '芥川龍之介', 1915),
  ('蜘蛛の糸', '芥川龍之介', 1918),
  ('走れメロス', '太宰治', 1940),
  ('人間失格', '太宰治', 1948),
  ('斜陽', '太宰治', 1947),
  ('雪国', '川端康成', 1937),
  ('伊豆の踊子', '川端康成', 1926),
  ('銀河鉄道の夜', '宮沢賢治', 1934),
  ('注文の多い料理店', '宮沢賢治', 1924),
  ('風の又三郎', '宮沢賢治', 1934),
  ('蟹工船', '小林多喜二', 1929),
  ('破戒', '島崎藤村', 1906),
  ('舞姫', '森鷗外', 1890),
  ('高瀬舟', '森鷗外', 1916),
  ('たけくらべ', '樋口一葉', 1896),
  ('檸檬', '梶井基次郎', 1925),
  ('山月記', '中島敦', 1942);
