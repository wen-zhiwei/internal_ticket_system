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
		{ID: "00000000-0000-0000-0000-000000000001", Name: "王芳", Role: users.RoleAgent},
		{ID: "00000000-0000-0000-0000-000000000002", Name: "李娜", Role: users.RoleAgent},
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

// TestUpdateEnforcesPermissionsAndRecordsEvent is an opt-in PostgreSQL
// integration test for ticket edit permissions and durable update history.
func TestUpdateEnforcesPermissionsAndRecordsEvent(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set; skipping PostgreSQL update test")
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
		INSERT INTO tickets (id, title, description, customer_name, customer_contact, priority, status, assignee_id, created_by_id)
		VALUES ($1, '编辑测试', '验证工单编辑规则', '测试客户', 'test@example.com', 'normal', 'in_progress',
			'00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003')
	`, ticketID)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(context.Background(), `DELETE FROM tickets WHERE id = $1`, ticketID)

	store := NewPGStore(pool)
	otherAgent := users.User{ID: "00000000-0000-0000-0000-000000000002", Name: "李娜", Role: users.RoleAgent}
	owner := users.User{ID: "00000000-0000-0000-0000-000000000001", Name: "王芳", Role: users.RoleAgent}
	supervisor := users.User{ID: "00000000-0000-0000-0000-000000000003", Name: "赵经理", Role: users.RoleSupervisor}
	input := UpdateInput{
		Title:           "客服已更新标题",
		Description:     "客服已补充问题描述",
		CustomerName:    "更新后的客户",
		CustomerContact: "updated@example.com",
		Priority:        PriorityHigh,
	}

	if _, err := store.Update(ctx, otherAgent, ticketID, input); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected non-owner agent to be forbidden, got %v", err)
	}
	if _, err := store.Update(ctx, owner, ticketID, input); err != nil {
		t.Fatalf("expected owner agent update to succeed, got %v", err)
	}

	supervisorInput := input
	supervisorInput.Title = "主管已更新标题"
	if _, err := store.Update(ctx, supervisor, ticketID, supervisorInput); err != nil {
		t.Fatalf("expected supervisor update to succeed, got %v", err)
	}

	var title string
	var priority Priority
	if err := pool.QueryRow(ctx, `SELECT title, priority FROM tickets WHERE id = $1`, ticketID).Scan(&title, &priority); err != nil {
		t.Fatal(err)
	}
	if title != supervisorInput.Title || priority != supervisorInput.Priority {
		t.Fatalf("unexpected updated ticket: title=%q priority=%q", title, priority)
	}
	var updateEvents int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM ticket_events WHERE ticket_id = $1 AND event_type = 'updated'`, ticketID).Scan(&updateEvents); err != nil {
		t.Fatal(err)
	}
	if updateEvents != 2 {
		t.Fatalf("expected one update event per successful edit, got %d", updateEvents)
	}

	if _, err := pool.Exec(ctx, `UPDATE tickets SET status = 'closed' WHERE id = $1`, ticketID); err != nil {
		t.Fatal(err)
	}
	closedInput := supervisorInput
	closedInput.Title = "不应更新"
	if _, err := store.Update(ctx, supervisor, ticketID, closedInput); !errors.Is(err, ErrTicketClosed) {
		t.Fatalf("expected closed ticket edit to be rejected, got %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT title FROM tickets WHERE id = $1`, ticketID).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != supervisorInput.Title {
		t.Fatalf("closed ticket was modified: title=%q", title)
	}
}
