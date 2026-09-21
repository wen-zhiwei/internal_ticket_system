package assistant

import (
	"context"
	"errors"
	"testing"

	"internal_ticket_system/backend/internal/tickets"
	"internal_ticket_system/backend/internal/users"
)

type fakeClient struct {
	request ChatRequest
	result  ChatResponse
	err     error
}

func (c *fakeClient) Chat(_ context.Context, request ChatRequest) (ChatResponse, error) {
	c.request = request
	return c.result, c.err
}

type fakeTicketReader struct {
	listResult   tickets.ListResult
	listErr      error
	lastActor    users.User
	lastFilter   tickets.ListFilter
	getResult    tickets.Detail
	getErr       error
	lastTicketID string
}

func (r *fakeTicketReader) List(_ context.Context, actor users.User, filter tickets.ListFilter) (tickets.ListResult, error) {
	r.lastActor = actor
	r.lastFilter = filter
	return r.listResult, r.listErr
}

func (r *fakeTicketReader) Get(_ context.Context, actor users.User, id string) (tickets.Detail, error) {
	r.lastActor = actor
	r.lastTicketID = id
	return r.getResult, r.getErr
}

func toolCall(name, arguments string) ToolCall {
	call := ToolCall{ID: "call-1", Type: "function"}
	call.Function.Name = name
	call.Function.Arguments = arguments
	return call
}

func TestServiceSearchesTicketsThroughTheTicketReader(t *testing.T) {
	client := &fakeClient{result: ChatResponse{Choices: []struct {
		Message ChatMessage `json:"message"`
	}{{Message: ChatMessage{ToolCalls: []ToolCall{toolCall("search_tickets", `{"status":"in_progress","priority":"high","page_size":10}`)}}}}}}
	reader := &fakeTicketReader{listResult: tickets.ListResult{Total: 2, Items: []tickets.Ticket{{ID: "ticket-1"}}}}
	service := NewService(client, reader)
	actor := users.User{ID: "agent-1", Role: users.RoleAgent}

	response, err := service.Chat(context.Background(), actor, "查我正在处理的高优先级工单")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if response.Card == nil || response.Card.Type != "ticket_list" || len(response.Card.Items) != 1 {
		t.Fatalf("expected ticket list card, got %#v", response.Card)
	}
	if reader.lastActor.ID != actor.ID || reader.lastFilter.Status == nil || *reader.lastFilter.Status != tickets.StatusInProgress {
		t.Fatalf("expected actor and status filter, got actor=%#v filter=%#v", reader.lastActor, reader.lastFilter)
	}
	if reader.lastFilter.Priority == nil || *reader.lastFilter.Priority != tickets.PriorityHigh || reader.lastFilter.PageSize != 10 {
		t.Fatalf("expected priority and page size filter, got %#v", reader.lastFilter)
	}
	if len(client.request.Tools) != 3 || client.request.ToolChoice != "auto" {
		t.Fatalf("expected registered tools and automatic selection, got %#v", client.request)
	}
}

func TestServicePreparesCreateDraftWithoutWriting(t *testing.T) {
	client := &fakeClient{result: ChatResponse{Choices: []struct {
		Message ChatMessage `json:"message"`
	}{{Message: ChatMessage{ToolCalls: []ToolCall{toolCall("prepare_create_ticket", `{"title":"重复扣费","description":"订单被扣费两次"}`)}}}}}}
	reader := &fakeTicketReader{}
	service := NewService(client, reader)

	response, err := service.Chat(context.Background(), users.User{ID: "agent-1"}, "帮我创建重复扣费工单")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if response.Card == nil || response.Card.Draft == nil {
		t.Fatalf("expected draft card, got %#v", response.Card)
	}
	if response.Card.Draft.Title != "重复扣费" || response.Card.Draft.Priority != "normal" {
		t.Fatalf("unexpected draft: %#v", response.Card.Draft)
	}
	if len(response.Card.Draft.MissingFields) != 2 {
		t.Fatalf("expected customer fields to be requested, got %#v", response.Card.Draft.MissingFields)
	}
}

func TestServiceRejectsInvalidToolArguments(t *testing.T) {
	client := &fakeClient{result: ChatResponse{Choices: []struct {
		Message ChatMessage `json:"message"`
	}{{Message: ChatMessage{ToolCalls: []ToolCall{toolCall("get_ticket_detail", `{"ticket_id":"not-a-uuid"}`)}}}}}}
	service := NewService(client, &fakeTicketReader{})

	_, err := service.Chat(context.Background(), users.User{ID: "agent-1"}, "看一下工单")
	if !errors.Is(err, ErrInvalidMessage) {
		t.Fatalf("expected invalid message error, got %v", err)
	}
}

func TestServiceInfersMissingDraftTitleFromUserMessage(t *testing.T) {
	client := &fakeClient{result: ChatResponse{Choices: []struct {
		Message ChatMessage `json:"message"`
	}{{Message: ChatMessage{ToolCalls: []ToolCall{toolCall("prepare_create_ticket", `{"title":"","description":"自动驾驶订单重复扣费，重复扣费金额 20 元","customer_name":"测试客户","customer_contact":"13800000000"}`)}}}}}}
	service := NewService(client, &fakeTicketReader{})

	response, err := service.Chat(context.Background(), users.User{ID: "agent-1"}, "帮我创建一个自动驾驶订单重复扣费工单")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if response.Card == nil || response.Card.Draft == nil || response.Card.Draft.Title != "自动驾驶订单重复扣费" {
		t.Fatalf("expected inferred title, got %#v", response.Card)
	}
}
