-- Feature 12: persist assistant conversations per user.
-- Run after 0001_users.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS assistant_conversations (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(80) NOT NULL CHECK (char_length(btrim(title)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assistant_conversations_user_updated_idx
ON assistant_conversations (user_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (
        char_length(btrim(content)) > 0
        AND char_length(content) <= 10000
    ),
    card JSONB,
    is_error BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assistant_messages_conversation_created_idx
ON assistant_messages (conversation_id, created_at ASC, id ASC);

COMMIT;
