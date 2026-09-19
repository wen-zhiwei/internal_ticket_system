-- Feature 2: tickets, SLA query data, and operation history foundation.
-- Run after 0001_users.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY,
    title VARCHAR(200) NOT NULL CHECK (char_length(btrim(title)) > 0),
    description TEXT NOT NULL CHECK (
        char_length(btrim(description)) > 0
        AND char_length(description) <= 10000
    ),
    customer_name VARCHAR(100) NOT NULL CHECK (char_length(btrim(customer_name)) > 0),
    customer_contact VARCHAR(200) NOT NULL CHECK (char_length(btrim(customer_contact)) > 0),
    priority VARCHAR(20) NOT NULL CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    assignee_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (status = 'open' AND assignee_id IS NULL)
        OR (status IN ('in_progress', 'resolved', 'closed') AND assignee_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status);
CREATE INDEX IF NOT EXISTS tickets_priority_idx ON tickets (priority);
CREATE INDEX IF NOT EXISTS tickets_assignee_idx ON tickets (assignee_id);
CREATE INDEX IF NOT EXISTS tickets_created_at_idx ON tickets (created_at DESC);

CREATE OR REPLACE FUNCTION set_ticket_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_set_updated_at ON tickets;
CREATE TRIGGER tickets_set_updated_at
BEFORE UPDATE ON tickets
FOR EACH ROW
EXECUTE FUNCTION set_ticket_updated_at();

CREATE TABLE IF NOT EXISTS ticket_events (
    id BIGSERIAL PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    event_type VARCHAR(30) NOT NULL CHECK (
        event_type IN ('created', 'claimed', 'assigned', 'reassigned', 'status_changed', 'commented')
    ),
    description TEXT NOT NULL CHECK (char_length(btrim(description)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ticket_events_ticket_created_idx
ON ticket_events (ticket_id, created_at ASC, id ASC);

INSERT INTO tickets (
    id, title, description, customer_name, customer_contact,
    priority, status, assignee_id, created_by_id, created_at, updated_at
)
VALUES
    (
        '10000000-0000-0000-0000-000000000001',
        '生产环境无法登录',
        '客户反馈管理员账号持续提示凭证无效，需要尽快排查。',
        '远山科技',
        'ops@yuanshan.example',
        'urgent',
        'open',
        NULL,
        '00000000-0000-0000-0000-000000000003',
        NOW() - INTERVAL '3 hours',
        NOW() - INTERVAL '3 hours'
    ),
    (
        '10000000-0000-0000-0000-000000000002',
        '咨询账单下载方式',
        '客户希望导出上个月的账单明细。',
        '云帆设计',
        'finance@yunfan.example',
        'normal',
        'open',
        NULL,
        '00000000-0000-0000-0000-000000000001',
        NOW() - INTERVAL '40 minutes',
        NOW() - INTERVAL '40 minutes'
    ),
    (
        '10000000-0000-0000-0000-000000000003',
        'API 请求偶发超时',
        '客户提供了请求 ID，希望协助定位网络或服务端问题。',
        '星河数据',
        'dev@xinghe.example',
        'high',
        'in_progress',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000003',
        NOW() - INTERVAL '2 hours',
        NOW() - INTERVAL '90 minutes'
    ),
    (
        '10000000-0000-0000-0000-000000000004',
        '修改通知接收邮箱',
        '客户已确认新邮箱，问题已处理完成。',
        '青禾贸易',
        'service@qinghe.example',
        'low',
        'resolved',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '3 hours'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO ticket_events (ticket_id, actor_id, event_type, description, created_at)
SELECT ticket.id, ticket.created_by_id, 'created', '创建了工单', ticket.created_at
FROM tickets AS ticket
WHERE ticket.id IN (
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000004'
)
AND NOT EXISTS (
    SELECT 1
    FROM ticket_events AS event
    WHERE event.ticket_id = ticket.id
      AND event.event_type = 'created'
);

COMMIT;
