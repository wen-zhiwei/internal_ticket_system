-- LangGraph workflow actions that require explicit user confirmation.
BEGIN;

CREATE TABLE IF NOT EXISTS assistant_pending_actions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL,
    action_type VARCHAR(40) NOT NULL CHECK (
        action_type IN ('update_ticket', 'change_status', 'bulk_change_status')
    ),
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'executing', 'completed', 'cancelled', 'failed')
    ),
    result JSONB,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assistant_pending_actions_user_conversation_idx
ON assistant_pending_actions (user_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS assistant_pending_actions_expiry_idx
ON assistant_pending_actions (status, expires_at)
WHERE status = 'pending';

COMMIT;
