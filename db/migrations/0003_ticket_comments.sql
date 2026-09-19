-- Feature 3: durable ticket comments, separate from the operation timeline.
-- Run after 0002_tickets.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS ticket_comments (
    id BIGSERIAL PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body TEXT NOT NULL CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 5000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ticket_comments_ticket_created_idx
ON ticket_comments (ticket_id, created_at ASC, id ASC);

COMMIT;
