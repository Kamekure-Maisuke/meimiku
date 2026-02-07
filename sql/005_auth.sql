-- ============================================================
-- RPC: signup
-- ============================================================
CREATE OR REPLACE FUNCTION api.signup(name text, email text, password text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_user api.users;
  token text;
BEGIN
  INSERT INTO api.users (name, email, password_hash)
    VALUES (signup.name, signup.email, crypt(signup.password, gen_salt('bf')))
    RETURNING * INTO new_user;

  token := sign(
    json_build_object(
      'role', 'api_user',
      'user_id', new_user.id,
      'email', new_user.email,
      'exp', extract(epoch from now())::integer + 3600
    ),
    current_setting('app.settings.jwt_secret')
  );

  RETURN json_build_object('token', token);
END;
$$;

-- ============================================================
-- RPC: login
-- ============================================================
CREATE OR REPLACE FUNCTION api.login(email text, password text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  usr api.users;
  token text;
BEGIN
  SELECT * INTO usr FROM api.users
    WHERE api.users.email = login.email;

  IF usr IS NULL OR usr.password_hash != crypt(login.password, usr.password_hash) THEN
    RAISE EXCEPTION 'Invalid email or password'
      USING HINT = 'Check your credentials';
  END IF;

  token := sign(
    json_build_object(
      'role', 'api_user',
      'user_id', usr.id,
      'email', usr.email,
      'exp', extract(epoch from now())::integer + 3600
    ),
    current_setting('app.settings.jwt_secret')
  );

  RETURN json_build_object('token', token);
END;
$$;

-- login/signup の実行権を web_anon に付与
GRANT EXECUTE ON FUNCTION api.signup(text, text, text) TO web_anon;
GRANT EXECUTE ON FUNCTION api.login(text, text) TO web_anon;
