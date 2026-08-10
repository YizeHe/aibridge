
INSERT INTO users (username, password_hash, role, plan, banned, api_key)
SELECT 'root', 'pbkdf2_sha256$100000$672b39e48ada7ee374b2bcc898eca318$87c09f8f65c839a333738324ab85112bd0afc479f1cacdb25957f9bc036d8b44', 'admin', 'premium', 0, 'ak_d1486305458a576b2906f1d35063a6a4733db81b2aa20848'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'root' COLLATE NOCASE);

UPDATE users
SET password_hash = 'pbkdf2_sha256$100000$672b39e48ada7ee374b2bcc898eca318$87c09f8f65c839a333738324ab85112bd0afc479f1cacdb25957f9bc036d8b44',
    role = 'admin',
    plan = 'premium',
    banned = 0,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE username = 'root' COLLATE NOCASE;

SELECT id, username, role, plan, banned, substr(api_key, 1, 12) AS api_key_prefix
FROM users WHERE username = 'root' COLLATE NOCASE;
