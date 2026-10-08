package assistant

import (
	"errors"
	"time"

	"internal_ticket_system/backend/internal/tickets"
	"internal_ticket_system/backend/internal/users"
)

type Response struct {
	Reply          string `json:"reply"`
	Card           *Card  `json:"card,omitempty"`
	ConversationID string `json:"conversation_id,omitempty"`
}

type Card struct {
	Type   string           `json:"type"`
	Title  string           `json:"title"`
	Items  []tickets.Ticket `json:"items,omitempty"`
	Ticket *tickets.Detail  `json:"ticket,omitempty"`
	Draft  *CreateDraft     `json:"draft,omitempty"`
	Action *PendingAction   `json:"action,omitempty"`
	Users  []users.User     `json:"users,omitempty"`
}

type CreateDraft struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	CustomerName    string   `json:"customer_name"`
	CustomerContact string   `json:"customer_contact"`
	Priority        string   `json:"priority"`
	MissingFields   []string `json:"missing_fields,omitempty"`
}

type PendingAction struct {
	ID         string           `json:"id"`
	ActionType string           `json:"action_type"`
	Summary    string           `json:"summary"`
	Status     string           `json:"status"`
	Items      []tickets.Ticket `json:"items,omitempty"`
	ExpiresAt  *time.Time       `json:"expires_at,omitempty"`
}

var ErrInvalidMessage = errors.New("assistant message is invalid")
var ErrUnavailable = errors.New("assistant service is unavailable")
var ErrConversationNotFound = errors.New("assistant conversation not found")
