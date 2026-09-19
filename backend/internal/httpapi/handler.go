package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"internal_ticket_system/backend/internal/tickets"
	"internal_ticket_system/backend/internal/users"
)

type UserStore interface {
	List(ctx context.Context, role *users.Role) ([]users.User, error)
	Get(ctx context.Context, id string) (users.User, error)
}

type TicketStore interface {
	List(ctx context.Context, actor users.User, filter tickets.ListFilter) (tickets.ListResult, error)
	Get(ctx context.Context, actor users.User, id string) (tickets.Detail, error)
	Create(ctx context.Context, actor users.User, input tickets.CreateInput) (tickets.Detail, error)
	Claim(ctx context.Context, actor users.User, id string) (tickets.Detail, error)
	Assign(ctx context.Context, actor users.User, id string, input tickets.AssignmentInput) (tickets.Detail, error)
	Reassign(ctx context.Context, actor users.User, id string, input tickets.AssignmentInput) (tickets.Detail, error)
	ChangeStatus(ctx context.Context, actor users.User, id string, input tickets.StatusInput) (tickets.Detail, error)
	AddComment(ctx context.Context, actor users.User, id string, input tickets.CommentInput) (tickets.Detail, error)
}

type Handler struct {
	webOrigin  string
	userStore  UserStore
	ticketStore TicketStore
}

func NewHandler(webOrigin string, userStore UserStore, ticketStore TicketStore) http.Handler {
	h := &Handler{webOrigin: webOrigin, userStore: userStore, ticketStore: ticketStore}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", h.health)
	mux.HandleFunc("GET /api/users", h.listUsers)
	mux.HandleFunc("GET /api/me", h.currentUser)
	mux.HandleFunc("GET /api/tickets", h.listTickets)
	mux.HandleFunc("POST /api/tickets", h.createTicket)
	mux.HandleFunc("GET /api/tickets/{id}", h.getTicket)
	mux.HandleFunc("POST /api/tickets/{id}/claim", h.claimTicket)
	mux.HandleFunc("POST /api/tickets/{id}/assign", h.assignTicket)
	mux.HandleFunc("POST /api/tickets/{id}/reassign", h.reassignTicket)
	mux.HandleFunc("PATCH /api/tickets/{id}/status", h.changeTicketStatus)
	mux.HandleFunc("POST /api/tickets/{id}/comments", h.addTicketComment)
	return h.withCORS(mux)
}

func (h *Handler) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) listUsers(w http.ResponseWriter, r *http.Request) {
	var role *users.Role
	if rawRole := strings.TrimSpace(r.URL.Query().Get("role")); rawRole != "" {
		parsedRole, err := users.ParseRole(rawRole)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_role", "role 必须是 agent 或 supervisor")
			return
		}
		role = &parsedRole
	}

	items, err := h.userStore.List(r.Context(), role)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "user_store_unavailable", "暂时无法读取用户列表")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) currentUser(w http.ResponseWriter, r *http.Request) {
	user, ok := h.requireCurrentUser(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (h *Handler) requireCurrentUser(w http.ResponseWriter, r *http.Request) (users.User, bool) {
	userID := strings.TrimSpace(r.Header.Get("X-User-ID"))
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "identity_required", "请求必须携带 X-User-ID")
		return users.User{}, false
	}

	user, err := h.userStore.Get(r.Context(), userID)
	if err != nil {
		if errors.Is(err, users.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, "identity_not_found", "当前用户不存在")
			return users.User{}, false
		}
		writeError(w, http.StatusServiceUnavailable, "user_store_unavailable", "暂时无法确认当前用户")
		return users.User{}, false
	}
	return user, true
}

func (h *Handler) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Add("Vary", "Origin")
		}
		if origin == h.webOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-User-ID")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func decodeJSONBody(w http.ResponseWriter, r *http.Request, destination any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON object")
		}
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func writeValidationError(w http.ResponseWriter, message string, fields tickets.ValidationErrors) {
	writeJSON(w, http.StatusBadRequest, map[string]any{
		"error": map[string]any{
			"code":    "validation_error",
			"message": message,
			"fields":  fields,
		},
	})
}
