package tickets

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"internal_ticket_system/backend/internal/users"
)

// TestClaimConcurrentExactlyOneWinner is an opt-in PostgreSQL integration test.
// Set TEST_DATABASE_URL after running `make db-migrate` to execute it locally.
func TestClaimConcurrentExactlyOneWinner(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set; skipping PostgreSQL concurrency test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Fatal(err)
	}

	ticketID, err := newUUID()
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO tickets (id, title, description, customer_name, customer_contact, priority, status, created_by_id)
		VALUES ($1, '并发领取测试', '验证同一工单只能被一名客服领取', '测试客户', 'test@example.com', 'normal', 'open', '00000000-0000-0000-0000-000000000003')
	`, ticketID)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(context.Background(), `DELETE FROM tickets WHERE id = $1`, ticketID)

	store := NewPGStore(pool)
	actors := []users.User{
		{ID: "00000000-0000-0000-0000-000000000001", Name: "张三", Role: users.RoleAgent},
		{ID: "00000000-0000-0000-0000-000000000002", Name: "李四", Role: users.RoleAgent},
	}
	results := make(chan error, len(actors))
	var group sync.WaitGroup
	for _, actor := range actors {
		actor := actor
		group.Add(1)
		go func() {
			defer group.Done()
			_, err := store.Claim(ctx, actor, ticketID)
			results <- err
		}()
	}
	group.Wait()
	close(results)

	var success, conflict int
	for err := range results {
		switch {
		case err == nil:
			success++
		case errors.Is(err, ErrConflict):
			conflict++
		default:
			t.Fatalf("unexpected claim result: %v", err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("expected one winner and one conflict, got success=%d conflict=%d", success, conflict)
	}

	var status Status
	var assignee string
	if err := pool.QueryRow(ctx, `SELECT status, assignee_id::text FROM tickets WHERE id = $1`, ticketID).Scan(&status, &assignee); err != nil {
		t.Fatal(err)
	}
	if status != StatusInProgress || assignee == "" {
		t.Fatalf("expected one atomic assignment, got status=%s assignee=%s", status, assignee)
	}
	var eventCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM ticket_events WHERE ticket_id = $1 AND event_type = 'claimed'`, ticketID).Scan(&eventCount); err != nil {
		t.Fatal(err)
	}
	if eventCount != 1 {
		t.Fatalf("expected exactly one claimed event, got %d", eventCount)
	}

}
