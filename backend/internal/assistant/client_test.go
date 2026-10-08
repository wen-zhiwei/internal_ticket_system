package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"internal_ticket_system/backend/internal/users"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func testHTTPClient(fn roundTripFunc) *http.Client {
	return &http.Client{Transport: fn}
}

func jsonHTTPResponse(statusCode int, body string) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestClientSendsDatabaseIdentityConversationAndToken(t *testing.T) {
	var gotAuthorization string
	var got chatRequest
	httpClient := testHTTPClient(func(request *http.Request) (*http.Response, error) {
		gotAuthorization = request.Header.Get("Authorization")
		if err := json.NewDecoder(request.Body).Decode(&got); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		return jsonHTTPResponse(
			http.StatusOK,
			`{"reply":"找到 1 张工单。","conversation_id":"20000000-0000-0000-0000-000000000001"}`,
		), nil
	})

	client := NewClient("http://assistant.internal", "service-token", httpClient)
	actor := users.User{
		ID: "00000000-0000-0000-0000-000000000001", Name: "王芳", Role: users.RoleAgent, Team: "自动驾驶客服一组",
	}
	response, err := client.Chat(context.Background(), actor, "20000000-0000-0000-0000-000000000001", "查本周工单")
	if err != nil {
		t.Fatalf("chat returned error: %v", err)
	}

	if gotAuthorization != "Bearer service-token" {
		t.Fatalf("unexpected authorization header: %q", gotAuthorization)
	}
	if got.Message != "查本周工单" || got.ConversationID != "20000000-0000-0000-0000-000000000001" {
		t.Fatalf("unexpected request: %#v", got)
	}
	if got.User.ID != actor.ID || got.User.Role != "agent" || got.User.Team != actor.Team {
		t.Fatalf("expected database identity, got %#v", got.User)
	}
	if response.Reply != "找到 1 张工单。" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestClientMapsServiceFailures(t *testing.T) {
	tests := []struct {
		name       string
		statusCode int
		want       error
	}{
		{name: "validation", statusCode: http.StatusUnprocessableEntity, want: ErrInvalidMessage},
		{name: "unavailable", statusCode: http.StatusServiceUnavailable, want: ErrUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			httpClient := testHTTPClient(func(_ *http.Request) (*http.Response, error) {
				return jsonHTTPResponse(test.statusCode, `{"detail":"failed"}`), nil
			})
			_, err := NewClient("http://assistant.internal", "", httpClient).Chat(
				context.Background(),
				users.User{ID: "00000000-0000-0000-0000-000000000001"},
				"",
				"查工单",
			)
			if !errors.Is(err, test.want) {
				t.Fatalf("expected %v, got %v", test.want, err)
			}
		})
	}
}

func TestClientRejectsIncompleteResponse(t *testing.T) {
	httpClient := testHTTPClient(func(_ *http.Request) (*http.Response, error) {
		return jsonHTTPResponse(http.StatusOK, `{"reply":"","conversation_id":""}`), nil
	})
	_, err := NewClient("http://assistant.internal", "", httpClient).Chat(
		context.Background(),
		users.User{ID: "00000000-0000-0000-0000-000000000001"},
		"",
		"查工单",
	)
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected unavailable error, got %v", err)
	}
}
