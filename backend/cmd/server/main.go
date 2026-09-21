package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"internal_ticket_system/backend/internal/assistant"
	"internal_ticket_system/backend/internal/config"
	"internal_ticket_system/backend/internal/httpapi"
	"internal_ticket_system/backend/internal/tickets"
	"internal_ticket_system/backend/internal/users"
)

func main() {
	cfg := config.Load()
	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		slog.Error("database pool initialization failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	userStore := users.NewPGStore(pool)
	ticketStore := tickets.NewPGStore(pool)
	var assistantService httpapi.AssistantService
	if cfg.LLMBaseURL != "" && cfg.LLMModel != "" {
		assistantService = assistant.NewService(
			assistant.NewOpenAIClient(cfg.LLMBaseURL, cfg.LLMAPIKey, cfg.LLMModel, nil),
			ticketStore,
		)
	}

	conversationStore := assistant.NewPGConversationStore(pool)
	server := &http.Server{
		Addr: cfg.Addr,
		Handler: httpapi.NewHandlerWithAssistantHistory(
			cfg.WebOrigin,
			userStore,
			ticketStore,
			assistantService,
			conversationStore,
		),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("API server started", "addr", cfg.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("API server stopped unexpectedly", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("API server shutdown failed", "error", err)
		os.Exit(1)
	}
	slog.Info("API server stopped")
}
