package tickets

import (
	"testing"
	"time"
)

func TestCreateInputNormalizeAndValidate(t *testing.T) {
	input := CreateInput{
		Title:           "  无法登录  ",
		Description:     "  客户收到错误提示  ",
		CustomerName:    "  陈女士  ",
		CustomerContact: "  chen@example.com  ",
		Priority:        PriorityHigh,
	}

	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		t.Fatalf("expected valid input, got %v", err)
	}
	if normalized.Title != "无法登录" || normalized.CustomerName != "陈女士" {
		t.Fatalf("expected trimmed input, got %#v", normalized)
	}
}

func TestCreateInputRejectsMissingAndInvalidFields(t *testing.T) {
	_, err := (CreateInput{Priority: "critical"}).NormalizeAndValidate()
	fieldErrors, ok := err.(ValidationErrors)
	if !ok {
		t.Fatalf("expected ValidationErrors, got %T", err)
	}
	for _, field := range []string{"title", "description", "customer_name", "customer_contact", "priority"} {
		if fieldErrors[field] == "" {
			t.Errorf("expected validation error for %s", field)
		}
	}
}

func TestParseSortOptions(t *testing.T) {
	if field, err := ParseSortField("sla_due_at"); err != nil || field != SortSLADueAt {
		t.Fatalf("expected sla_due_at, got %q, %v", field, err)
	}
	if direction, err := ParseSortDirection("asc"); err != nil || direction != SortAscending {
		t.Fatalf("expected asc, got %q, %v", direction, err)
	}
	if _, err := ParseSortField("customer_name"); err == nil {
		t.Fatal("expected unsupported sort field to fail")
	}
	if _, err := ParseSortDirection("sideways"); err == nil {
		t.Fatal("expected unsupported sort direction to fail")
	}
}

func TestParseStatusAndPriority(t *testing.T) {
	if _, err := ParseStatus("waiting"); err == nil {
		t.Fatal("expected invalid status to fail")
	}
	if _, err := ParsePriority("critical"); err == nil {
		t.Fatal("expected invalid priority to fail")
	}
	if status, err := ParseStatus("in_progress"); err != nil || status != StatusInProgress {
		t.Fatalf("expected in_progress, got %q, %v", status, err)
	}
}

func TestIsUUIDAcceptsDatabaseDemoIdentifiers(t *testing.T) {
	if !IsUUID("10000000-0000-0000-0000-000000000001") {
		t.Fatal("expected demo UUID to be accepted")
	}
	if IsUUID("not-a-uuid") {
		t.Fatal("expected malformed UUID to be rejected")
	}
}

func TestApplySLA(t *testing.T) {
	createdAt := time.Date(2026, time.September, 19, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name        string
		priority    Priority
		status      Status
		now         time.Time
		wantDueAt   time.Time
		wantOverdue bool
	}{
		{name: "urgent overdue", priority: PriorityUrgent, status: StatusOpen, now: createdAt.Add(3 * time.Hour), wantDueAt: createdAt.Add(2 * time.Hour), wantOverdue: true},
		{name: "high active within SLA", priority: PriorityHigh, status: StatusInProgress, now: createdAt.Add(7 * time.Hour), wantDueAt: createdAt.Add(8 * time.Hour)},
		{name: "normal resolved never overdue", priority: PriorityNormal, status: StatusResolved, now: createdAt.Add(48 * time.Hour), wantDueAt: createdAt.Add(24 * time.Hour)},
		{name: "low closed never overdue", priority: PriorityLow, status: StatusClosed, now: createdAt.Add(96 * time.Hour), wantDueAt: createdAt.Add(72 * time.Hour)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ticket := applySLA(Ticket{Priority: test.priority, Status: test.status, CreatedAt: createdAt}, test.now)
			if !ticket.SLADueAt.Equal(test.wantDueAt) {
				t.Fatalf("expected due at %s, got %s", test.wantDueAt, ticket.SLADueAt)
			}
			if ticket.Overdue != test.wantOverdue {
				t.Fatalf("expected overdue=%t, got %t", test.wantOverdue, ticket.Overdue)
			}
		})
	}
}

func TestCanTransitionEnforcesTicketStateMachine(t *testing.T) {
	allowed := [][2]Status{
		{StatusOpen, StatusInProgress},
		{StatusInProgress, StatusResolved},
		{StatusResolved, StatusInProgress},
		{StatusResolved, StatusClosed},
	}
	for _, pair := range allowed {
		if !CanTransition(pair[0], pair[1]) {
			t.Errorf("expected transition %s -> %s to be allowed", pair[0], pair[1])
		}
	}
	for _, pair := range [][2]Status{
		{StatusOpen, StatusResolved},
		{StatusOpen, StatusClosed},
		{StatusInProgress, StatusOpen},
		{StatusInProgress, StatusClosed},
		{StatusClosed, StatusInProgress},
		{StatusClosed, StatusClosed},
	} {
		if CanTransition(pair[0], pair[1]) {
			t.Errorf("expected transition %s -> %s to be rejected", pair[0], pair[1])
		}
	}
}

func TestActionInputsNormalizeAndValidate(t *testing.T) {
	comment, err := (CommentInput{Body: "  需要客户补充日志  "}).NormalizeAndValidate()
	if err != nil || comment.Body != "需要客户补充日志" {
		t.Fatalf("expected normalized comment, got %#v, %v", comment, err)
	}
	if _, err := (CommentInput{}).NormalizeAndValidate(); err == nil {
		t.Fatal("expected empty comment to fail")
	}
	if _, err := (AssignmentInput{AssigneeID: "not-a-uuid"}).NormalizeAndValidate(); err == nil {
		t.Fatal("expected invalid assignee UUID to fail")
	}
}
