package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type OpenAIClient struct {
	endpoint string
	apiKey   string
	model    string
	http     *http.Client
}

func NewOpenAIClient(baseURL, apiKey, model string, httpClient *http.Client) *OpenAIClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Second}
	}
	return &OpenAIClient{
		endpoint: completionEndpoint(baseURL),
		apiKey:   strings.TrimSpace(apiKey),
		model:    strings.TrimSpace(model),
		http:     httpClient,
	}
}

func (c *OpenAIClient) Chat(ctx context.Context, request ChatRequest) (ChatResponse, error) {
	if c == nil || c.endpoint == "" || c.model == "" {
		return ChatResponse{}, ErrUnavailable
	}
	request.Model = c.model
	body, err := json.Marshal(request)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("encode model request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("create model request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	response, err := c.http.Do(req)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("send model request: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("read model response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ChatResponse{}, fmt.Errorf("model returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	var result ChatResponse
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return ChatResponse{}, fmt.Errorf("decode model response: %w", err)
	}
	return result, nil
}

func completionEndpoint(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return ""
	}
	if strings.HasSuffix(baseURL, "/chat/completions") {
		return baseURL
	}
	if strings.HasSuffix(baseURL, "/v1") {
		return baseURL + "/chat/completions"
	}
	return baseURL + "/v1/chat/completions"
}
