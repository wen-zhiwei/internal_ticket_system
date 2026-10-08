package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"internal_ticket_system/backend/internal/assistant"
	"internal_ticket_system/backend/internal/users"
)

type fakeAssistantService struct {
	actor   users.User
	message string
	result  assistant.Response
}

func (s *fakeAssistantService) Chat(_ context.Context, actor users.User, _ string, message string) (assistant.Response, error) {
	s.actor = actor
	s.message = message
	return s.result, nil
}

func TestAssistantChatRequiresModelConfiguration(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodPost, "/api/assistant/chat", strings.NewReader(`{"message":"查工单"}`))
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable || !contains(response.Body.String(), `"code":"assistant_not_configured"`) {
		t.Fatalf("expected explicit configuration error, got %d: %s", response.Code, response.Body.String())
	}
}

func TestAssistantChatPassesDatabaseIdentityToService(t *testing.T) {
	service := &fakeAssistantService{result: assistant.Response{Reply: "找到 0 张工单。"}}
	handler := NewHandlerWithAssistant("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/assistant/chat", strings.NewReader(`{"message":"  查我未处理的工单  "}`))
	request.Header.Set("X-User-ID", "agent-001")
	request.Header.Set("X-User-Role", "supervisor")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !contains(response.Body.String(), `"reply":"找到 0 张工单。"`) {
		t.Fatalf("expected assistant response, got %d: %s", response.Code, response.Body.String())
	}
	if service.actor.Role != users.RoleAgent || service.message != "查我未处理的工单" {
		t.Fatalf("expected database actor and normalized message, got actor=%#v message=%q", service.actor, service.message)
	}
}

func TestAssistantChatRejectsUnknownFields(t *testing.T) {
	service := &fakeAssistantService{}
	handler := NewHandlerWithAssistant("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/assistant/chat", strings.NewReader(`{"message":"查工单","role":"supervisor"}`))
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !contains(response.Body.String(), `"code":"invalid_json"`) {
		t.Fatalf("expected invalid json, got %d: %s", response.Code, response.Body.String())
	}
}

type fakeAssistantConversationStore struct {
	actor             users.User
	conversationID    string
	userMessage       string
	assistantResponse assistant.Response
	items             []assistant.ConversationSummary
	conversation      assistant.Conversation
	appendErr         error
	listErr           error
	getErr            error
}

func (s *fakeAssistantConversationStore) List(_ context.Context, actor users.User, _ int) ([]assistant.ConversationSummary, error) {
	s.actor = actor
	return s.items, s.listErr
}

func (s *fakeAssistantConversationStore) Get(_ context.Context, actor users.User, id string) (assistant.Conversation, error) {
	s.actor = actor
	s.conversationID = id
	return s.conversation, s.getErr
}

func (s *fakeAssistantConversationStore) AppendExchange(_ context.Context, actor users.User, conversationID, userMessage string, response assistant.Response) (assistant.Conversation, error) {
	s.actor = actor
	s.conversationID = conversationID
	s.userMessage = userMessage
	s.assistantResponse = response
	return s.conversation, s.appendErr
}

func TestAssistantChatPersistsConversationForCurrentUser(t *testing.T) {
	service := &fakeAssistantService{result: assistant.Response{Reply: "找到 2 张工单。"}}
	store := &fakeAssistantConversationStore{conversation: assistant.Conversation{
		ConversationSummary: assistant.ConversationSummary{ID: "20000000-0000-0000-0000-000000000001"},
	}}
	handler := NewHandlerWithAssistantHistory(
		"http://localhost:5173",
		fakeUserStore{items: testUsers()},
		&fakeTicketStore{},
		service,
		store,
	)
	request := httptest.NewRequest(http.MethodPost, "/api/assistant/chat", strings.NewReader(`{"message":"查本周工单"}`))
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !contains(response.Body.String(), `"conversation_id":"20000000-0000-0000-0000-000000000001"`) {
		t.Fatalf("expected persisted conversation id, got %d: %s", response.Code, response.Body.String())
	}
	if store.actor.ID != "agent-001" || store.userMessage != "查本周工单" || store.assistantResponse.Reply != "找到 2 张工单。" {
		t.Fatalf("unexpected persisted exchange: %#v", store)
	}
}

func TestListAssistantConversationsUsesCurrentUser(t *testing.T) {
	store := &fakeAssistantConversationStore{items: []assistant.ConversationSummary{{
		ID: "20000000-0000-0000-0000-000000000001", Title: "查本周工单", MessageCount: 2,
	}}}
	handler := NewHandlerWithAssistantHistory(
		"http://localhost:5173",
		fakeUserStore{items: testUsers()},
		&fakeTicketStore{},
		nil,
		store,
	)
	request := httptest.NewRequest(http.MethodGet, "/api/assistant/conversations", nil)
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !containsAll(response.Body.String(), `"title":"查本周工单"`, `"message_count":2`) {
		t.Fatalf("expected conversation list, got %d: %s", response.Code, response.Body.String())
	}
	if store.actor.Role != users.RoleAgent {
		t.Fatalf("expected database-backed actor, got %#v", store.actor)
	}
}

func TestAssistantChatRejectsInvalidConversationID(t *testing.T) {
	service := &fakeAssistantService{result: assistant.Response{Reply: "不会执行"}}
	store := &fakeAssistantConversationStore{}
	handler := NewHandlerWithAssistantHistory(
		"http://localhost:5173",
		fakeUserStore{items: testUsers()},
		&fakeTicketStore{},
		service,
		store,
	)
	request := httptest.NewRequest(http.MethodPost, "/api/assistant/chat", strings.NewReader(`{"message":"继续","conversation_id":"bad-id"}`))
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !contains(response.Body.String(), `"code":"assistant_invalid_conversation"`) {
		t.Fatalf("expected invalid conversation error, got %d: %s", response.Code, response.Body.String())
	}
}
