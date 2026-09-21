package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"internal_ticket_system/backend/internal/tickets"
	"internal_ticket_system/backend/internal/users"
)

type ToolDefinition struct {
	Type     string         `json:"type"`
	Function FunctionSchema `json:"function"`
}

type FunctionSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type ChatRequest struct {
	Model      string           `json:"model"`
	Messages   []ChatMessage    `json:"messages"`
	Tools      []ToolDefinition `json:"tools,omitempty"`
	ToolChoice string           `json:"tool_choice,omitempty"`
}

type ChatMessage struct {
	Role      string     `json:"role"`
	Content   string     `json:"content,omitempty"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

type ChatResponse struct {
	Choices []struct {
		Message ChatMessage `json:"message"`
	} `json:"choices"`
}

type Client interface {
	Chat(ctx context.Context, request ChatRequest) (ChatResponse, error)
}

type TicketReader interface {
	List(context.Context, users.User, tickets.ListFilter) (tickets.ListResult, error)
	Get(context.Context, users.User, string) (tickets.Detail, error)
}

type Service struct {
	client       Client
	ticketReader TicketReader
}

func NewService(client Client, ticketReader TicketReader) *Service {
	return &Service{client: client, ticketReader: ticketReader}
}

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
}

type CreateDraft struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	CustomerName    string   `json:"customer_name"`
	CustomerContact string   `json:"customer_contact"`
	Priority        string   `json:"priority"`
	MissingFields   []string `json:"missing_fields,omitempty"`
}

var ErrInvalidMessage = errors.New("assistant message is invalid")
var ErrUnavailable = errors.New("assistant model is unavailable")

func (s *Service) Chat(ctx context.Context, actor users.User, message string) (Response, error) {
	message = strings.TrimSpace(message)
	if message == "" || len([]rune(message)) > 4000 {
		return Response{}, ErrInvalidMessage
	}
	if s == nil || s.client == nil || s.ticketReader == nil {
		return Response{}, ErrUnavailable
	}

	result, err := s.client.Chat(ctx, ChatRequest{
		Messages: []ChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: message},
		},
		Tools:      toolDefinitions(),
		ToolChoice: "auto",
	})
	if err != nil {
		return Response{}, fmt.Errorf("assistant model call: %w", err)
	}
	if len(result.Choices) == 0 {
		return Response{}, fmt.Errorf("%w: empty model response", ErrUnavailable)
	}

	modelMessage := result.Choices[0].Message
	if len(modelMessage.ToolCalls) == 0 {
		reply := strings.TrimSpace(modelMessage.Content)
		if reply == "" {
			return Response{}, fmt.Errorf("%w: empty assistant reply", ErrUnavailable)
		}
		return Response{Reply: reply}, nil
	}
	if len(modelMessage.ToolCalls) > 1 {
		return Response{}, fmt.Errorf("%w: multiple tool calls are not supported yet", ErrUnavailable)
	}
	return s.executeTool(ctx, actor, modelMessage.ToolCalls[0], message)
}

const systemPrompt = `你是滴滴自动驾驶客服助手。只能使用提供的工具查询工单或整理工单草稿，不要直接修改数据库。查询问题优先调用 search_tickets；查看具体工单调用 get_ticket_detail；用户要创建工单时调用 prepare_create_ticket。缺少创建工单必填信息时保留为空，不要编造。回答简洁、明确。`

func toolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		{
			Type: "function",
			Function: FunctionSchema{
				Name:        "search_tickets",
				Description: "按条件查询当前用户有权查看的工单。",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"q":              map[string]any{"type": "string", "description": "标题或客户名称关键词"},
						"status":         map[string]any{"type": "string", "enum": []string{"open", "in_progress", "resolved", "closed"}},
						"priority":       map[string]any{"type": "string", "enum": []string{"urgent", "high", "normal", "low"}},
						"assignee_id":    map[string]any{"type": "string", "description": "处理人 UUID，未分配使用 unassigned"},
						"page":           map[string]any{"type": "integer", "minimum": 1, "maximum": 100000},
						"page_size":      map[string]any{"type": "integer", "minimum": 1, "maximum": 50},
						"sort_by":        map[string]any{"type": "string", "enum": []string{"created_at", "updated_at", "priority", "sla_due_at"}},
						"sort_direction": map[string]any{"type": "string", "enum": []string{"asc", "desc"}},
					},
				},
			},
		},
		{
			Type: "function",
			Function: FunctionSchema{
				Name:        "get_ticket_detail",
				Description: "查看当前用户有权查看的某一张工单详情。",
				Parameters: map[string]any{
					"type":       "object",
					"required":   []string{"ticket_id"},
					"properties": map[string]any{"ticket_id": map[string]any{"type": "string", "description": "工单 UUID"}},
				},
			},
		},
		{
			Type: "function",
			Function: FunctionSchema{
				Name:        "prepare_create_ticket",
				Description: "把用户描述整理成工单草稿，不创建工单。",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"title":            map[string]any{"type": "string"},
						"description":      map[string]any{"type": "string"},
						"customer_name":    map[string]any{"type": "string"},
						"customer_contact": map[string]any{"type": "string"},
						"priority":         map[string]any{"type": "string", "enum": []string{"urgent", "high", "normal", "low"}},
					},
				},
			},
		},
	}
}

func (s *Service) executeTool(ctx context.Context, actor users.User, call ToolCall, sourceMessage string) (Response, error) {
	switch call.Function.Name {
	case "search_tickets":
		return s.searchTickets(ctx, actor, call.Function.Arguments)
	case "get_ticket_detail":
		return s.getTicketDetail(ctx, actor, call.Function.Arguments)
	case "prepare_create_ticket":
		return s.prepareCreateTicket(call.Function.Arguments, sourceMessage)
	default:
		return Response{}, fmt.Errorf("%w: unsupported tool %q", ErrUnavailable, call.Function.Name)
	}
}

func decodeArguments(raw string, destination any) error {
	if strings.TrimSpace(raw) == "" {
		raw = "{}"
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(destination)
}
