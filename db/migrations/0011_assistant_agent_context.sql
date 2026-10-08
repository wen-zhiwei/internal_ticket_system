-- Feature 26: durable assistant context and create/assign confirmation actions.
BEGIN;

ALTER TABLE assistant_pending_actions
    DROP CONSTRAINT IF EXISTS assistant_pending_actions_action_type_check;

ALTER TABLE assistant_pending_actions
    ADD CONSTRAINT assistant_pending_actions_action_type_check CHECK (
        action_type IN (
            'create_ticket',
            'update_ticket',
            'assign_ticket',
            'change_status',
            'bulk_change_status'
        )
    );

CREATE TABLE IF NOT EXISTS assistant_conversation_context (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS assistant_conversation_context_updated_idx
ON assistant_conversation_context (updated_at DESC);

COMMIT;
