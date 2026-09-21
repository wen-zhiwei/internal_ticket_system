-- Feature 5: allow durable ticket edit events.
-- Run after 0003_ticket_comments.sql.

BEGIN;

ALTER TABLE ticket_events
DROP CONSTRAINT IF EXISTS ticket_events_event_type_check;

ALTER TABLE ticket_events
ADD CONSTRAINT ticket_events_event_type_check CHECK (
    event_type IN ('created', 'updated', 'claimed', 'assigned', 'reassigned', 'status_changed', 'commented')
);

COMMIT;
