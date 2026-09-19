package tickets

import (
	"strings"
	"testing"

	"internal_ticket_system/backend/internal/users"
)

func TestListConditionsApplyLeastPrivilegeVisibility(t *testing.T) {
	filter := ListFilter{Search: "登录", AssigneeID: "unassigned"}
	where, args := listConditions(users.User{ID: "agent-id", Role: users.RoleAgent}, filter)
	joined := strings.Join(where, " ")

	if !strings.Contains(joined, "t.assignee_id::text = $1") || !strings.Contains(joined, "t.status = 'open'") {
		t.Fatalf("expected agent visibility condition, got %s", joined)
	}
	if !strings.Contains(joined, "t.assignee_id IS NULL") {
		t.Fatalf("expected unassigned filter, got %s", joined)
	}
	if !strings.Contains(joined, "t.title ILIKE $2 OR t.customer_name ILIKE $2") {
		t.Fatalf("expected parameterized search condition, got %s", joined)
	}
	if len(args) != 2 || args[0] != "agent-id" || args[1] != "%登录%" {
		t.Fatalf("unexpected query args: %#v", args)
	}
}

func TestListConditionsDoNotRestrictSupervisorVisibility(t *testing.T) {
	where, args := listConditions(users.User{ID: "supervisor-id", Role: users.RoleSupervisor}, ListFilter{})
	joined := strings.Join(where, " ")
	if strings.Contains(joined, "assignee_id") {
		t.Fatalf("supervisor visibility must not be restricted, got %s", joined)
	}
	if len(args) != 0 {
		t.Fatalf("expected no query args, got %#v", args)
	}
}

func TestAgentCanViewOnlyClaimableOrOwnTicket(t *testing.T) {
	agentID := "agent-id"
	other := &UserSummary{ID: "other-agent", Name: "其他客服"}
	own := &UserSummary{ID: agentID, Name: "当前客服"}

	tests := []struct {
		name   string
		ticket Ticket
		want   bool
	}{
		{name: "open unassigned", ticket: Ticket{Status: StatusOpen}, want: true},
		{name: "own in progress", ticket: Ticket{Status: StatusInProgress, Assignee: own}, want: true},
		{name: "other in progress", ticket: Ticket{Status: StatusInProgress, Assignee: other}, want: false},
		{name: "other resolved", ticket: Ticket{Status: StatusResolved, Assignee: other}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := agentCanView(agentID, test.ticket); got != test.want {
				t.Fatalf("expected %t, got %t", test.want, got)
			}
		})
	}
}

func TestTicketOrderByUsesOnlyWhitelistedExpressions(t *testing.T) {
	tests := []struct {
		name      string
		filter    ListFilter
		wantParts []string
	}{
		{name: "default created descending", filter: ListFilter{}, wantParts: []string{"t.created_at DESC", "t.id DESC"}},
		{name: "updated ascending", filter: ListFilter{SortBy: SortUpdatedAt, SortDirection: SortAscending}, wantParts: []string{"t.updated_at ASC", "t.id DESC"}},
		{name: "priority descending", filter: ListFilter{SortBy: SortPriority, SortDirection: SortDescending}, wantParts: []string{"CASE t.priority", "DESC"}},
		{name: "sla ascending", filter: ListFilter{SortBy: SortSLADueAt, SortDirection: SortAscending}, wantParts: []string{"t.created_at + CASE t.priority", "ASC"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			order := ticketOrderBy(test.filter)
			for _, part := range test.wantParts {
				if !strings.Contains(order, part) {
					t.Errorf("expected %q in %q", part, order)
				}
			}
		})
	}
}

func TestTicketOrderByFallsBackForUnknownValues(t *testing.T) {
	order := ticketOrderBy(ListFilter{SortBy: SortField("customer_name"), SortDirection: SortDirection("sideways")})
	if !strings.Contains(order, "t.created_at DESC") {
		t.Fatalf("expected safe default order, got %s", order)
	}
}
