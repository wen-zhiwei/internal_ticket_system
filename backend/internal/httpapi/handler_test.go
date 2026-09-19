package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"internal_ticket_system/backend/internal/users"
)

type fakeUserStore struct {
	items []users.User
	err   error
}

func (s fakeUserStore) List(_ context.Context, role *users.Role) ([]users.User, error) {
	if s.err != nil {
		return nil, s.err
	}
	if role == nil {
		return s.items, nil
	}
	filtered := make([]users.User, 0)
	for _, item := range s.items {
		if item.Role == *role {
			filtered = append(filtered, item)
		}
	}
	return filtered, nil
}

func (s fakeUserStore) Get(_ context.Context, id string) (users.User, error) {
	if s.err != nil {
		return users.User{}, s.err
	}
	for _, item := range s.items {
		if item.ID == id {
			return item, nil
		}
	}
	return users.User{}, users.ErrNotFound
}

func testUsers() []users.User {
	return []users.User{
		{ID: "agent-001", Name: "张三", Role: users.RoleAgent},
		{ID: "supervisor-001", Name: "主管用户", Role: users.RoleSupervisor},
	}
}

func TestCurrentUserUsesDatabaseRoleInsteadOfClientRole(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.Header.Set("X-User-ID", "agent-001")
	request.Header.Set("X-User-Role", "supervisor")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	if body := response.Body.String(); !containsAll(body, `"role":"agent"`, `"name":"张三"`) {
		t.Fatalf("expected database-backed agent response, got %s", body)
	}
}

func TestCurrentUserRequiresIdentity(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
	if body := response.Body.String(); !containsAll(body, `"code":"identity_required"`) {
		t.Fatalf("expected identity error, got %s", body)
	}
}

func TestCurrentUserRejectsUnknownIdentity(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.Header.Set("X-User-ID", "missing")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
	if body := response.Body.String(); !containsAll(body, `"code":"identity_not_found"`) {
		t.Fatalf("expected not found identity error, got %s", body)
	}
}

func TestListUsersRejectsInvalidRole(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodGet, "/api/users?role=admin", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
	if body := response.Body.String(); !containsAll(body, `"code":"invalid_role"`) {
		t.Fatalf("expected invalid role error, got %s", body)
	}
}

func TestUserStoreFailureReturnsServiceUnavailable(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{err: errors.New("database down")}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodGet, "/api/users", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", response.Code)
	}
}

func containsAll(value string, parts ...string) bool {
	for _, part := range parts {
		if !contains(value, part) {
			return false
		}
	}
	return true
}

func contains(value, part string) bool {
	for i := 0; i+len(part) <= len(value); i++ {
		if value[i:i+len(part)] == part {
			return true
		}
	}
	return false
}


func TestListUsersReturnsAllUsers(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodGet, "/api/users", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if body := response.Body.String(); !containsAll(body, `"items"`, `"id":"agent-001"`, `"id":"supervisor-001"`) {
		t.Fatalf("expected all users in response, got %s", body)
	}
}

func TestListUsersFiltersByRole(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodGet, "/api/users?role=agent", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if body := response.Body.String(); !containsAll(body, `"id":"agent-001"`) || contains(body, `"id":"supervisor-001"`) {
		t.Fatalf("expected only agents in response, got %s", body)
	}
}

func TestCurrentUserStoreFailureReturnsServiceUnavailable(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{err: errors.New("database down")}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", response.Code, response.Body.String())
	}
	if body := response.Body.String(); !containsAll(body, `"code":"user_store_unavailable"`) {
		t.Fatalf("expected user store error, got %s", body)
	}
}

func TestCORSAllowsConfiguredFrontendOrigin(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodOptions, "/api/users", nil)
	request.Header.Set("Origin", "http://localhost:5173")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", response.Code)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Fatalf("expected configured origin, got %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Headers"); got != "Content-Type, X-User-ID" {
		t.Fatalf("expected allow headers, got %q", got)
	}
	if got := response.Header().Get("Vary"); got != "Origin" {
		t.Fatalf("expected Vary: Origin, got %q", got)
	}
}

func TestCORSDoesNotAllowUnexpectedOrigin(t *testing.T) {
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, &fakeTicketStore{})
	request := httptest.NewRequest(http.MethodOptions, "/api/users", nil)
	request.Header.Set("Origin", "https://unexpected.example")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", response.Code)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected origin must not be allowed, got %q", got)
	}
}
