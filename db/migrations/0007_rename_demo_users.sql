-- Feature 9: use realistic demo names for a clearer product presentation.
-- Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0007_rename_demo_users.sql

BEGIN;

UPDATE users
SET name = CASE id::text
    WHEN '00000000-0000-0000-0000-000000000001' THEN '王芳'
    WHEN '00000000-0000-0000-0000-000000000002' THEN '李娜'
    WHEN '00000000-0000-0000-0000-000000000003' THEN '赵经理'
    ELSE name
END
WHERE id IN (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000003'::uuid
);

UPDATE ticket_events
SET description = REPLACE(
    REPLACE(
        REPLACE(description, '张三', '王芳'),
        '李四', '李娜'
    ),
    '主管用户', '赵经理'
)
WHERE description LIKE '%张三%'
   OR description LIKE '%李四%'
   OR description LIKE '%主管用户%';

COMMIT;
