package config

import "os"

type Config struct {
	Addr        string
	DatabaseURL string
	WebOrigin   string
	LLMBaseURL  string
	LLMAPIKey   string
	LLMModel    string
}

func Load() Config {
	return Config{
		Addr:        envOrDefault("API_ADDR", ":8080"),
		DatabaseURL: envOrDefault("DATABASE_URL", "postgres://internal_ticket_system:internal_ticket_system@localhost:5432/internal_ticket_system?sslmode=disable"),
		WebOrigin:   envOrDefault("WEB_ORIGIN", "http://localhost:5173"),
		LLMBaseURL:  os.Getenv("LLM_BASE_URL"),
		LLMAPIKey:   os.Getenv("LLM_API_KEY"),
		LLMModel:    os.Getenv("LLM_MODEL"),
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
