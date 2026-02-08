-- ============================================================
-- Database-level settings
-- ============================================================

-- Set JWT secret at database level so it's available in all sessions
ALTER DATABASE meimiku SET app.settings.jwt_secret TO 'my-super-secret-jwt-key-for-meimiku-2024';
