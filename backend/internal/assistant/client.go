package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"internal_ticket_system/backend/internal/users"
)

type Client struct {
	endpoint string
	token    string
	http     *http.Client
}

type chatRequest struct {
	Message        string      `json:"message"`
	ConversationID string      `json:"conversation_id,omitempty"`
	User           requestUser `json:"user"`
}

type requestUser struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
	Team string `json:"team"`
}

type serviceError struct {
	Detail string `json:"detail"`
}

func NewClient(baseURL, token string, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 45 * time.Second}
	}
	return &Client{
		endpoint: strings.TrimRight(strings.TrimSpace(baseURL), "/") + "/chat",
		token:    strings.TrimSpace(token),
		http:     httpClient,
	}
}

func (c *Client) Chat(ctx context.Context, actor users.User, conversationID, message string) (Response, error) {
	message = strings.TrimSpace(message)
	if message == "" || len([]rune(message)) > 4000 {
		return Response{}, ErrInvalidMessage
	}
	if c == nil || strings.TrimSpace(c.endpoint) == "/chat" {
		return Response{}, ErrUnavailable
	}

	body, err := json.Marshal(chatRequest{
		Message:        message,
		ConversationID: strings.TrimSpace(conversationID),
		User: requestUser{
			ID: actor.ID, Name: actor.Name, Role: string(actor.Role), Team: actor.Team,
		},
	})
	if err != nil {
		return Response{}, fmt.Errorf("encode assistant request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return Response{}, fmt.Errorf("create assistant request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	result, err := c.http.Do(req)
	if err != nil {
		return Response{}, fmt.Errorf("call assistant service: %w", err)
	}
	defer result.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(result.Body, 4<<20))
	if err != nil {
		return Response{}, fmt.Errorf("read assistant response: %w", err)
	}
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		var payload serviceError
		_ = json.Unmarshal(responseBody, &payload)
		if result.StatusCode == http.StatusBadRequest || result.StatusCode == http.StatusUnprocessableEntity {
			return Response{}, fmt.Errorf("%w: %s", ErrInvalidMessage, payload.Detail)
		}
		if result.StatusCode == http.StatusNotFound {
			return Response{}, ErrConversationNotFound
		}
		return Response{}, fmt.Errorf("%w: HTTP %d: %s", ErrUnavailable, result.StatusCode, strings.TrimSpace(payload.Detail))
	}
	var response Response
	if err := json.Unmarshal(responseBody, &response); err != nil {
		return Response{}, fmt.Errorf("decode assistant response: %w", err)
	}
	if strings.TrimSpace(response.Reply) == "" || strings.TrimSpace(response.ConversationID) == "" {
		return Response{}, fmt.Errorf("%w: incomplete response", ErrUnavailable)
	}
	return response, nil
}

func IsUnavailable(err error) bool {
	return errors.Is(err, ErrUnavailable)
}
