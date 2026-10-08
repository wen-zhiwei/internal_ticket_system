package httpapi

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"internal_ticket_system/backend/internal/tickets"
	"internal_ticket_system/backend/internal/users"
)

type fakeTicketStore struct {
	listResult  tickets.ListResult
	detail      tickets.Detail
	overview    tickets.Overview
	err         error
	lastActor   users.User
	lastFilter  tickets.ListFilter
	lastInput   tickets.CreateInput
	listCalls   int
	getCalls    int
	createCalls int
}

func (s *fakeTicketStore) List(_ context.Context, actor users.User, filter tickets.ListFilter) (tickets.ListResult, error) {
	s.listCalls++
	s.lastActor = actor
	s.lastFilter = filter
	if s.err != nil {
		return tickets.ListResult{}, s.err
	}
	return s.listResult, nil
}

func (s *fakeTicketStore) Overview(_ context.Context, actor users.User) (tickets.Overview, error) {
	s.lastActor = actor
	if s.err != nil {
		return tickets.Overview{}, s.err
	}
	return s.overview, nil
}

func (s *fakeTicketStore) Get(_ context.Context, actor users.User, _ string) (tickets.Detail, error) {
	s.getCalls++
	s.lastActor = actor
	if s.err != nil {
		return tickets.Detail{}, s.err
	}
	return s.detail, nil
}

func (s *fakeTicketStore) Create(_ context.Context, actor users.User, input tickets.CreateInput) (tickets.Detail, error) {
	s.createCalls++
	s.lastActor = actor
	s.lastInput = input
	if s.err != nil {
		return tickets.Detail{}, s.err
	}
	return s.detail, nil
}

func (s *fakeTicketStore) Update(_ context.Context, actor users.User, _ string, _ tickets.UpdateInput) (tickets.Detail, error) {
	s.lastActor = actor
	if s.err != nil {
		return tickets.Detail{}, s.err
	}
	return s.detail, nil
}

func (s *fakeTicketStore) Claim(_ context.Context, actor users.User, _ string) (tickets.Detail, error) {
	s.lastActor = actor
	if s.err != nil {
		return tickets.Detail{}, s.err
	}
	return s.detail, nil
}

func (s *fakeTicketStore) Assign(_ context.Context, actor users.User, _ string, _ tickets.AssignmentInput) (tickets.Detail, error) {
	s.lastActor = actor
	if s.err != nil {
		return tickets.Detail{}, s.err
	}
	return s.detail, nil
}

func (s *fakeTicketStore) Reassign(_ context.Context, actor users.User, _ string, _ tickets.AssignmentInput) (tickets.Detail, error) {
	s.lastActor = actor
	if s.err != nil {
		return tickets.Detail{}, s.err
	}
	return s.detail, nil
}

func (s *fakeTicketStore) ChangeStatus(_ context.Context, actor users.User, _ string, _ tickets.StatusInput) (tickets.Detail, error) {
	s.lastActor = actor
	if s.err != nil {
		return tickets.Detail{}, s.err
	}
	return s.detail, nil
}

func (s *fakeTicketStore) AddComment(_ context.Context, actor users.User, _ string, _ tickets.CommentInput) (tickets.Detail, error) {
	s.lastActor = actor
	if s.err != nil {
		return tickets.Detail{}, s.err
	}
	return s.detail, nil
}

func TestListTicketsUsesDatabaseActorAndParsesFilters(t *testing.T) {
	store := &fakeTicketStore{listResult: tickets.ListResult{Items: []tickets.Ticket{}, Page: 2, PageSize: 10}}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/tickets?status=open&priority=high&assignee_id=unassigned&q=%E7%99%BB%E5%BD%95&page=2&page_size=10&sort_by=sla_due_at&sort_direction=asc",
		nil,
	)
	request.Header.Set("X-User-ID", "agent-001")
	request.Header.Set("X-User-Role", "supervisor")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if store.lastActor.Role != users.RoleAgent {
		t.Fatalf("expected database role agent, got %q", store.lastActor.Role)
	}
	if store.lastFilter.Status == nil || *store.lastFilter.Status != tickets.StatusOpen {
		t.Fatalf("expected open status filter, got %#v", store.lastFilter.Status)
	}
	if store.lastFilter.Page != 2 || store.lastFilter.PageSize != 10 || store.lastFilter.Search != "登录" {
		t.Fatalf("unexpected parsed filter: %#v", store.lastFilter)
	}
	if store.lastFilter.SortBy != tickets.SortSLADueAt || store.lastFilter.SortDirection != tickets.SortAscending {
		t.Fatalf("unexpected sort filter: %#v", store.lastFilter)
	}
}

func TestListTicketsRejectsInvalidSortFilters(t *testing.T) {
	for _, query := range []string{
		"sort_by=customer_name",
		"sort_direction=sideways",
	} {
		t.Run(query, func(t *testing.T) {
			store := &fakeTicketStore{}
			handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
			request := httptest.NewRequest(http.MethodGet, "/api/tickets?"+query, nil)
			request.Header.Set("X-User-ID", "agent-001")
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d", response.Code)
			}
			if store.listCalls != 0 {
				t.Fatal("ticket store must not be called for invalid sort filters")
			}
		})
	}
}

func TestListTicketsRejectsInvalidFilters(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodGet, "/api/tickets?status=waiting&page_size=500", nil)
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
	if store.listCalls != 0 {
		t.Fatal("ticket store must not be called for invalid filters")
	}
	if body := response.Body.String(); !containsAll(body, `"code":"invalid_filter"`) {
		t.Fatalf("expected invalid_filter response, got %s", body)
	}
}

func TestCreateTicketValidatesAndNormalizesInput(t *testing.T) {
	store := &fakeTicketStore{detail: tickets.Detail{Ticket: tickets.Ticket{ID: "ticket-001"}, History: []tickets.Event{}}}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	body := bytes.NewBufferString(`{
		"title":"  无法登录  ",
		"description":"  客户收到错误提示  ",
		"customer_name":"  陈女士  ",
		"customer_contact":"  chen@example.com  ",
		"priority":"high"
	}`)
	request := httptest.NewRequest(http.MethodPost, "/api/tickets", body)
	request.Header.Set("X-User-ID", "agent-001")
	request.Header.Set("X-User-Role", "supervisor")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", response.Code, response.Body.String())
	}
	if store.lastInput.Title != "无法登录" || store.lastInput.CustomerName != "陈女士" {
		t.Fatalf("expected normalized input, got %#v", store.lastInput)
	}
	if store.lastActor.Role != users.RoleAgent {
		t.Fatalf("expected database role agent, got %q", store.lastActor.Role)
	}
}

func TestCreateTicketReturnsFieldErrors(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodPost, "/api/tickets", bytes.NewBufferString(`{"priority":"critical"}`))
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
	if store.createCalls != 0 {
		t.Fatal("ticket store must not be called for invalid input")
	}
	if body := response.Body.String(); !containsAll(body, `"code":"validation_error"`, `"title"`, `"priority"`) {
		t.Fatalf("expected field validation response, got %s", body)
	}
}

func TestCreateTicketRejectsUnknownJSONFields(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodPost, "/api/tickets", bytes.NewBufferString(`{
		"title":"测试", "description":"描述", "customer_name":"客户",
		"customer_contact":"contact", "priority":"normal", "status":"closed"
	}`))
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
	if body := response.Body.String(); !containsAll(body, `"code":"invalid_json"`) {
		t.Fatalf("expected invalid_json response, got %s", body)
	}
}

func TestUpdateTicketValidatesAndMapsClosedConflict(t *testing.T) {
	store := &fakeTicketStore{err: tickets.ErrTicketClosed}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodPatch, "/api/tickets/10000000-0000-0000-0000-000000000001", bytes.NewBufferString(`{
		"title":"更新后的标题", "description":"更新后的描述", "customer_name":"客户",
		"customer_contact":"contact", "priority":"high"
	}`))
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", response.Code, response.Body.String())
	}
	if body := response.Body.String(); !containsAll(body, `"code":"ticket_closed"`, "已关闭工单不能编辑") {
		t.Fatalf("expected closed ticket response, got %s", body)
	}
}

func TestUpdateTicketRejectsInvalidInputBeforeStore(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodPatch, "/api/tickets/10000000-0000-0000-0000-000000000001", bytes.NewBufferString(`{
		"title":"", "description":"描述", "customer_name":"客户",
		"customer_contact":"contact", "priority":"critical"
	}`))
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
	if store.lastActor.ID != "" {
		t.Fatal("ticket store must not be called for invalid update input")
	}
	if body := response.Body.String(); !containsAll(body, `"code":"validation_error"`, `"title"`, `"priority"`) {
		t.Fatalf("expected field validation response, got %s", body)
	}
}

func TestTicketEndpointsRequireIdentity(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodGet, "/api/tickets", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.Code)
	}
	if store.listCalls != 0 {
		t.Fatal("ticket store must not be called without identity")
	}
}

func TestGetTicketMapsDomainErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "not found", err: tickets.ErrNotFound, wantStatus: http.StatusNotFound, wantCode: "ticket_not_found"},
		{name: "forbidden", err: tickets.ErrForbidden, wantStatus: http.StatusForbidden, wantCode: "ticket_access_denied"},
		{name: "store unavailable", err: errors.New("database down"), wantStatus: http.StatusServiceUnavailable, wantCode: "ticket_store_unavailable"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := &fakeTicketStore{err: test.err}
			handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
			request := httptest.NewRequest(http.MethodGet, "/api/tickets/10000000-0000-4000-8000-000000000001", nil)
			request.Header.Set("X-User-ID", "agent-001")
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != test.wantStatus {
				t.Fatalf("expected %d, got %d", test.wantStatus, response.Code)
			}
			if body := response.Body.String(); !containsAll(body, `"code":"`+test.wantCode+`"`) {
				t.Fatalf("expected %s response, got %s", test.wantCode, body)
			}
		})
	}
}

func TestGetTicketRejectsInvalidID(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodGet, "/api/tickets/not-a-uuid", nil)
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", response.Code)
	}
	if store.getCalls != 0 {
		t.Fatal("ticket store must not be called for invalid ID")
	}
}

func TestClaimTicketMapsBusinessConflictTo409(t *testing.T) {
	store := &fakeTicketStore{err: tickets.ErrConflict}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodPost, "/api/tickets/10000000-0000-0000-0000-000000000001/claim", nil)
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", response.Code, response.Body.String())
	}
	if body := response.Body.String(); !containsAll(body, `"code":"ticket_conflict"`, "当前状态") {
		t.Fatalf("expected conflict response, got %s", body)
	}
}

func TestStatusActionRejectsInvalidTransitionInputBeforeStore(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodPatch, "/api/tickets/10000000-0000-0000-0000-000000000001/status", bytes.NewBufferString(`{"status":"waiting"}`))
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
	if body := response.Body.String(); !containsAll(body, `"code":"validation_error"`, `"status"`) {
		t.Fatalf("expected validation response, got %s", body)
	}
}

func TestTicketOverviewUsesDatabaseActorAndReturnsCounts(t *testing.T) {
	store := &fakeTicketStore{overview: tickets.Overview{
		Total:        10,
		Pending:      4,
		Urgent:       2,
		SLAAttention: 1,
		ByStatus:     map[string]int{"open": 2, "in_progress": 2, "resolved": 4, "closed": 2},
	}}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodGet, "/api/tickets/overview", nil)
	request.Header.Set("X-User-ID", "agent-001")
	request.Header.Set("X-User-Role", "supervisor")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if store.lastActor.Role != users.RoleAgent {
		t.Fatalf("expected database role agent, got %q", store.lastActor.Role)
	}
	if body := response.Body.String(); !containsAll(body, `"total":10`, `"pending":4`, `"sla_attention":1`) {
		t.Fatalf("expected overview response, got %s", body)
	}
}

func TestListTicketsSupportsPendingAndOverdueFilters(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(http.MethodGet, "/api/tickets?status=pending&overdue=true", nil)
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !store.lastFilter.Pending || !store.lastFilter.Overdue {
		t.Fatalf("expected pending and overdue filters, got %#v", store.lastFilter)
	}
}

func TestListTicketsParsesCreatedTimeRange(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/tickets?created_from=2026-09-28T00%3A00%3A00%2B08%3A00&created_to=2026-09-29T12%3A00%3A00%2B08%3A00",
		nil,
	)
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if store.lastFilter.CreatedFrom == nil || store.lastFilter.CreatedTo == nil {
		t.Fatalf("expected created time range, got %#v", store.lastFilter)
	}
	if got := store.lastFilter.CreatedFrom.Format(time.RFC3339); got != "2026-09-28T00:00:00+08:00" {
		t.Fatalf("unexpected created_from: %s", got)
	}
}

func TestListTicketsRejectsInvalidCreatedTimeRange(t *testing.T) {
	store := &fakeTicketStore{}
	handler := NewHandler("http://localhost:5173", fakeUserStore{items: testUsers()}, store)
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/tickets?created_from=2026-09-30T00%3A00%3A00Z&created_to=2026-09-29T00%3A00%3A00Z",
		nil,
	)
	request.Header.Set("X-User-ID", "agent-001")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", response.Code, response.Body.String())
	}
	if store.listCalls != 0 {
		t.Fatal("ticket store must not be called for an invalid time range")
	}
}
