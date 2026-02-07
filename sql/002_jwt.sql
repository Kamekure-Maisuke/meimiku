-- ============================================================
-- JWT署名関数 (pgjwt相当をPL/pgSQLで実装)
-- ============================================================
CREATE OR REPLACE FUNCTION url_encode(data bytea) RETURNS text LANGUAGE sql AS $$
  SELECT translate(encode(data, 'base64'), E'+/=\n', '-_');
$$;

CREATE OR REPLACE FUNCTION algorithm_sign(signables text, secret text, algorithm text)
RETURNS text LANGUAGE sql AS $$
WITH
  alg AS (
    SELECT CASE
      WHEN algorithm = 'HS256' THEN 'sha256'
      WHEN algorithm = 'HS384' THEN 'sha384'
      WHEN algorithm = 'HS512' THEN 'sha512'
      ELSE '' END AS id
  )
SELECT url_encode(hmac(signables, secret, alg.id)) FROM alg;
$$;

CREATE OR REPLACE FUNCTION sign(payload json, secret text, algorithm text DEFAULT 'HS256')
RETURNS text LANGUAGE sql AS $$
WITH
  header AS (
    SELECT url_encode(convert_to('{"alg":"' || algorithm || '","typ":"JWT"}', 'utf8')) AS data
  ),
  payload_encoded AS (
    SELECT url_encode(convert_to(payload::text, 'utf8')) AS data
  ),
  signables AS (
    SELECT header.data || '.' || payload_encoded.data AS data FROM header, payload_encoded
  )
SELECT signables.data || '.' || algorithm_sign(signables.data, secret, algorithm)
FROM signables;
$$;
