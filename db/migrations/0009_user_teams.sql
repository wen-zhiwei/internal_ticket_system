-- Feature 16: expose team context for assignment and ticket collaboration.
-- Run after 0008_assistant_conversations.sql.

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS team VARCHAR(100) NOT NULL DEFAULT '自动驾驶客服组';

UPDATE users
SET team = CASE id::text
    WHEN '00000000-0000-0000-0000-000000000001' THEN '自动驾驶客服一组'
    WHEN '00000000-0000-0000-0000-000000000002' THEN '自动驾驶客服二组'
    WHEN '00000000-0000-0000-0000-000000000003' THEN '客服管理组'
    ELSE team
END
WHERE id IN (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000003'::uuid
);

COMMIT;
