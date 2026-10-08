package assistant

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"internal_ticket_system/backend/internal/tickets"
	"internal_ticket_system/backend/internal/users"
)

const maxConversationTitleRunes = 36

type ConversationSummary struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	MessageCount int       `json:"message_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type ConversationMessage struct {
	ID        string    `json:"id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	Card      *Card     `json:"card,omitempty"`
	IsError   bool      `json:"is_error"`
	CreatedAt time.Time `json:"created_at"`
}

type Conversation struct {
	ConversationSummary
	Messages []ConversationMessage `json:"messages"`
}

type ConversationStore interface {
	List(context.Context, users.User, int) ([]ConversationSummary, error)
	Get(context.Context, users.User, string) (Conversation, error)
	AppendExchange(context.Context, users.User, string, string, Response) (Conversation, error)
}

type PGConversationStore struct {
	pool *pgxpool.Pool
}

func NewPGConversationStore(pool *pgxpool.Pool) *PGConversationStore {
	return &PGConversationStore{pool: pool}
}

func (s *PGConversationStore) List(ctx context.Context, actor users.User, limit int) ([]ConversationSummary, error) {
	if limit <= 0 || limit > 50 {
		limit = 12
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			conversation.id::text,
			conversation.title,
			COUNT(message.id)::int,
			conversation.created_at,
			conversation.updated_at
		FROM assistant_conversations AS conversation
		LEFT JOIN assistant_messages AS message ON message.conversation_id = conversation.id
		WHERE conversation.user_id::text = $1
		GROUP BY conversation.id
		ORDER BY conversation.updated_at DESC, conversation.id DESC
		LIMIT $2
	`, actor.ID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]ConversationSummary, 0)
	for rows.Next() {
		var item ConversationSummary
		if err := rows.Scan(&item.ID, &item.Title, &item.MessageCount, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *PGConversationStore) Get(ctx context.Context, actor users.User, id string) (Conversation, error) {
	if !tickets.IsUUID(strings.TrimSpace(id)) {
		return Conversation{}, ErrConversationNotFound
	}

	var result Conversation
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, title, created_at, updated_at
		FROM assistant_conversations
		WHERE id::text = $1 AND user_id::text = $2
	`, id, actor.ID).Scan(&result.ID, &result.Title, &result.CreatedAt, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, ErrConversationNotFound
	}
	if err != nil {
		return Conversation{}, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id::text, role, content, card, is_error, created_at
		FROM assistant_messages
		WHERE conversation_id::text = $1
		ORDER BY created_at ASC, CASE role WHEN 'user' THEN 0 ELSE 1 END ASC, id ASC
	`, id)
	if err != nil {
		return Conversation{}, err
	}
	defer rows.Close()

	result.Messages = make([]ConversationMessage, 0)
	for rows.Next() {
		var message ConversationMessage
		var rawCard []byte
		if err := rows.Scan(&message.ID, &message.Role, &message.Content, &rawCard, &message.IsError, &message.CreatedAt); err != nil {
			return Conversation{}, err
		}
		if len(rawCard) > 0 {
			var card Card
			if err := json.Unmarshal(rawCard, &card); err != nil {
				return Conversation{}, err
			}
			message.Card = &card
		}
		result.Messages = append(result.Messages, message)
	}
	if err := rows.Err(); err != nil {
		return Conversation{}, err
	}
	result.MessageCount = len(result.Messages)
	return result, nil
}

func (s *PGConversationStore) AppendExchange(ctx context.Context, actor users.User, conversationID, userMessage string, response Response) (Conversation, error) {
	conversationID = strings.TrimSpace(conversationID)
	userMessage = strings.TrimSpace(userMessage)
	if userMessage == "" || strings.TrimSpace(response.Reply) == "" {
		return Conversation{}, ErrInvalidMessage
	}
	if conversationID != "" && !tickets.IsUUID(conversationID) {
		return Conversation{}, ErrConversationNotFound
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Conversation{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if conversationID == "" {
		conversationID, err = newConversationUUID()
		if err != nil {
			return Conversation{}, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO assistant_conversations (id, user_id, title)
			VALUES ($1, $2, $3)
		`, conversationID, actor.ID, conversationTitle(userMessage)); err != nil {
			return Conversation{}, err
		}
	} else {
		var lockedID string
		err := tx.QueryRow(ctx, `
			SELECT id::text
			FROM assistant_conversations
			WHERE id::text = $1 AND user_id::text = $2
			FOR UPDATE
		`, conversationID, actor.ID).Scan(&lockedID)
		if errors.Is(err, pgx.ErrNoRows) {
			if _, err := tx.Exec(ctx, `
				INSERT INTO assistant_conversations (id, user_id, title)
				VALUES ($1, $2, $3)
			`, conversationID, actor.ID, conversationTitle(userMessage)); err != nil {
				return Conversation{}, err
			}
		} else if err != nil {
			return Conversation{}, err
		}
	}

	userMessageID, err := newConversationUUID()
	if err != nil {
		return Conversation{}, err
	}
	assistantMessageID, err := newConversationUUID()
	if err != nil {
		return Conversation{}, err
	}
	var cardJSON []byte
	if response.Card != nil {
		cardJSON, err = json.Marshal(response.Card)
		if err != nil {
			return Conversation{}, err
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO assistant_messages (id, conversation_id, role, content)
		VALUES ($1, $2, 'user', $3)
	`, userMessageID, conversationID, userMessage); err != nil {
		return Conversation{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO assistant_messages (id, conversation_id, role, content, card)
		VALUES ($1, $2, 'assistant', $3, $4)
	`, assistantMessageID, conversationID, response.Reply, cardJSON); err != nil {
		return Conversation{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE assistant_conversations SET updated_at = NOW()
		WHERE id::text = $1 AND user_id::text = $2
	`, conversationID, actor.ID); err != nil {
		return Conversation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Conversation{}, err
	}
	return s.Get(ctx, actor, conversationID)
}

func conversationTitle(message string) string {
	runes := []rune(strings.TrimSpace(message))
	if len(runes) <= maxConversationTitleRunes {
		return string(runes)
	}
	return string(runes[:maxConversationTitleRunes]) + "…"
}

func newConversationUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	raw := hex.EncodeToString(value)
	return raw[0:8] + "-" + raw[8:12] + "-" + raw[12:16] + "-" + raw[16:20] + "-" + raw[20:32], nil
}
