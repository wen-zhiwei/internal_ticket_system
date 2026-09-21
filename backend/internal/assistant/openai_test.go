package assistant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestOpenAIClientUsesCompatibleChatCompletionsEndpoint(t *testing.T) {
	httpClient := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("expected compatible endpoint, got %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("expected bearer authorization")
		}
		var request ChatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if request.Model != "model-1" || len(request.Messages) != 1 {
			t.Errorf("unexpected request: %#v", request)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"choices":[{"message":{"role":"assistant","content":"可以"}}]}`)),
			Header:     make(http.Header),
		}, nil
	})}

	client := NewOpenAIClient("https://example.test", "secret", "model-1", httpClient)
	response, err := client.Chat(context.Background(), ChatRequest{Messages: []ChatMessage{{Role: "user", Content: "你好"}}})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if response.Choices[0].Message.Content != "可以" {
		t.Fatalf("unexpected response: %#v", response)
	}
}
