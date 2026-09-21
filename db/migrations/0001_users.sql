-- Feature 1: demo users and roles.
-- Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_users.sql

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('agent', 'supervisor')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO users (id, name, role)
VALUES
    ('00000000-0000-0000-0000-000000000001', '王芳', 'agent'),
    ('00000000-0000-0000-0000-000000000002', '李娜', 'agent'),
    ('00000000-0000-0000-0000-000000000003', '赵经理', 'supervisor')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    role = EXCLUDED.role;

COMMIT;
