package tickets

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"internal_ticket_system/backend/internal/users"
)

type Store interface {
	List(ctx context.Context, actor users.User, filter ListFilter) (ListResult, error)
	Get(ctx context.Context, actor users.User, id string) (Detail, error)
	Create(ctx context.Context, actor users.User, input CreateInput) (Detail, error)
	Claim(ctx context.Context, actor users.User, id string) (Detail, error)
	Assign(ctx context.Context, actor users.User, id string, input AssignmentInput) (Detail, error)
	Reassign(ctx context.Context, actor users.User, id string, input AssignmentInput) (Detail, error)
	ChangeStatus(ctx context.Context, actor users.User, id string, input StatusInput) (Detail, error)
	AddComment(ctx context.Context, actor users.User, id string, input CommentInput) (Detail, error)
}

type PGStore struct {
	pool *pgxpool.Pool
}

func NewPGStore(pool *pgxpool.Pool) *PGStore {
	return &PGStore{pool: pool}
}

type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const ticketSelect = `
	SELECT
		t.id::text,
		t.title,
		t.description,
		t.customer_name,
		t.customer_contact,
		t.priority,
		t.status,
		COALESCE(assignee.id::text, ''),
		COALESCE(assignee.name, ''),
		creator.id::text,
		creator.name,
		t.created_at,
		t.updated_at
	FROM tickets AS t
	LEFT JOIN users AS assignee ON assignee.id = t.assignee_id
	JOIN users AS creator ON creator.id = t.created_by_id
`

func (s *PGStore) List(ctx context.Context, actor users.User, filter ListFilter) (ListResult, error) {
	where, args := listConditions(actor, filter)
	whereSQL := " WHERE " + strings.Join(where, " AND ")

	var total int
	if err := s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM tickets AS t"+whereSQL, args...).Scan(&total); err != nil {
		return ListResult{}, err
	}

	limitPlaceholder := fmt.Sprintf("$%d", len(args)+1)
	offsetPlaceholder := fmt.Sprintf("$%d", len(args)+2)
	queryArgs := append(append([]any{}, args...), filter.PageSize, (filter.Page-1)*filter.PageSize)
	rows, err := s.pool.Query(
		ctx,
		ticketSelect+whereSQL+ticketOrderBy(filter)+" LIMIT "+limitPlaceholder+" OFFSET "+offsetPlaceholder,
		queryArgs...,
	)
	if err != nil {
		return ListResult{}, err
	}
	defer rows.Close()

	items := make([]Ticket, 0)
	for rows.Next() {
		ticket, err := scanTicket(rows)
		if err != nil {
			return ListResult{}, err
		}
		items = append(items, ticket)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, err
	}

	totalPages := 0
	if total > 0 {
		totalPages = (total + filter.PageSize - 1) / filter.PageSize
	}
	return ListResult{
		Items:      items,
		Page:       filter.Page,
		PageSize:   filter.PageSize,
		Total:      total,
		TotalPages: totalPages,
	}, nil
}

func ticketOrderBy(filter ListFilter) string {
	direction := "DESC"
	if filter.SortDirection == SortAscending {
		direction = "ASC"
	}

	switch filter.SortBy {
	case SortUpdatedAt:
		return " ORDER BY t.updated_at " + direction + ", t.id DESC"
	case SortPriority:
		return " ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END " + direction + ", t.updated_at DESC, t.id DESC"
	case SortSLADueAt:
		return " ORDER BY (t.created_at + CASE t.priority WHEN 'urgent' THEN INTERVAL '2 hours' WHEN 'high' THEN INTERVAL '8 hours' WHEN 'normal' THEN INTERVAL '24 hours' WHEN 'low' THEN INTERVAL '72 hours' END) " + direction + ", t.id DESC"
	case SortCreatedAt:
		return " ORDER BY t.created_at " + direction + ", t.id DESC"
	default:
		return " ORDER BY t.created_at " + direction + ", t.id DESC"
	}
}

func listConditions(actor users.User, filter ListFilter) ([]string, []any) {
	where := []string{"1 = 1"}
	args := make([]any, 0, 6)
	add := func(condition string, value any) {
		args = append(args, value)
		placeholder := fmt.Sprintf("$%d", len(args))
		where = append(where, strings.ReplaceAll(condition, "?", placeholder))
	}

	if actor.Role != users.RoleSupervisor {
		add("(t.assignee_id::text = ? OR (t.status = 'open' AND t.assignee_id IS NULL))", actor.ID)
	}
	if filter.Status != nil {
		add("t.status = ?", string(*filter.Status))
	}
	if filter.Priority != nil {
		add("t.priority = ?", string(*filter.Priority))
	}
	if filter.AssigneeID == "unassigned" {
		where = append(where, "t.assignee_id IS NULL")
	} else if filter.AssigneeID != "" {
		add("t.assignee_id::text = ?", filter.AssigneeID)
	}
	if filter.Search != "" {
		add("(t.title ILIKE ? OR t.customer_name ILIKE ?)", "%"+filter.Search+"%")
	}
	return where, args
}

func (s *PGStore) Get(ctx context.Context, actor users.User, id string) (Detail, error) {
	return getDetail(ctx, s.pool, actor, id)
}

func (s *PGStore) Create(ctx context.Context, actor users.User, input CreateInput) (Detail, error) {
	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		return Detail{}, err
	}
	id, err := newUUID()
	if err != nil {
		return Detail{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const insertTicket = `
		INSERT INTO tickets (
			id, title, description, customer_name, customer_contact,
			priority, status, assignee_id, created_by_id
		)
		VALUES ($1, $2, $3, $4, $5, $6, 'open', NULL, $7)
	`
	if _, err := tx.Exec(
		ctx,
		insertTicket,
		id,
		normalized.Title,
		normalized.Description,
		normalized.CustomerName,
		normalized.CustomerContact,
		string(normalized.Priority),
		actor.ID,
	); err != nil {
		return Detail{}, err
	}
	if err := insertEvent(ctx, tx, id, actor.ID, "created", "创建了工单"); err != nil {
		return Detail{}, err
	}

	detail, err := getDetail(ctx, tx, actor, id)
	if err != nil {
		return Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	return detail, nil
}

// Claim uses one conditional UPDATE. PostgreSQL row locking makes concurrent
// claims wait for one another; only the transaction that observes open/unassigned
// can update and append its event.
func (s *PGStore) Claim(ctx context.Context, actor users.User, id string) (Detail, error) {
	if actor.Role != users.RoleAgent {
		return Detail{}, ErrForbidden
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var claimedID string
	err = tx.QueryRow(ctx, `
		UPDATE tickets
		SET assignee_id = $1, status = 'in_progress'
		WHERE id = $2 AND status = 'open' AND assignee_id IS NULL
		RETURNING id::text
	`, actor.ID, id).Scan(&claimedID)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return Detail{}, err
		}
		if err := ensureTicketExists(ctx, tx, id); err != nil {
			return Detail{}, err
		}
		return Detail{}, ErrConflict
	}
	if err := insertEvent(ctx, tx, claimedID, actor.ID, "claimed", "领取了工单并开始处理"); err != nil {
		return Detail{}, err
	}
	return commitDetail(ctx, tx, actor, id)
}

func (s *PGStore) Assign(ctx context.Context, actor users.User, id string, input AssignmentInput) (Detail, error) {
	if actor.Role != users.RoleSupervisor {
		return Detail{}, ErrForbidden
	}
	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		return Detail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := lockTicketState(ctx, tx, id)
	if err != nil {
		return Detail{}, err
	}
	if state.Status != StatusOpen || state.AssigneeID != "" {
		return Detail{}, ErrConflict
	}
	target, err := getAgent(ctx, tx, normalized.AssigneeID)
	if err != nil {
		return Detail{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE tickets SET assignee_id = $1, status = 'in_progress' WHERE id = $2`, target.ID, id); err != nil {
		return Detail{}, err
	}
	if err := insertEvent(ctx, tx, id, actor.ID, "assigned", "分配给 "+target.Name+"，并开始处理"); err != nil {
		return Detail{}, err
	}
	return commitDetail(ctx, tx, actor, id)
}

func (s *PGStore) Reassign(ctx context.Context, actor users.User, id string, input AssignmentInput) (Detail, error) {
	if actor.Role != users.RoleSupervisor {
		return Detail{}, ErrForbidden
	}
	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		return Detail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := lockTicketState(ctx, tx, id)
	if err != nil {
		return Detail{}, err
	}
	if state.Status != StatusInProgress || state.AssigneeID == "" {
		return Detail{}, ErrConflict
	}
	target, err := getAgent(ctx, tx, normalized.AssigneeID)
	if err != nil {
		return Detail{}, err
	}
	if state.AssigneeID == target.ID {
		return Detail{}, ErrConflict
	}
	oldAssignee, err := getUserSummary(ctx, tx, state.AssigneeID)
	if err != nil {
		return Detail{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE tickets SET assignee_id = $1 WHERE id = $2`, target.ID, id); err != nil {
		return Detail{}, err
	}
	description := fmt.Sprintf("将工单从 %s 改派给 %s", oldAssignee.Name, target.Name)
	if err := insertEvent(ctx, tx, id, actor.ID, "reassigned", description); err != nil {
		return Detail{}, err
	}
	return commitDetail(ctx, tx, actor, id)
}

func (s *PGStore) ChangeStatus(ctx context.Context, actor users.User, id string, input StatusInput) (Detail, error) {
	if actor.Role != users.RoleAgent {
		return Detail{}, ErrForbidden
	}
	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		return Detail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := lockTicketState(ctx, tx, id)
	if err != nil {
		return Detail{}, err
	}
	if state.AssigneeID != actor.ID {
		return Detail{}, ErrForbidden
	}
	if !CanTransition(state.Status, normalized.Status) {
		return Detail{}, ErrInvalidTransition
	}
	if _, err := tx.Exec(ctx, `UPDATE tickets SET status = $1 WHERE id = $2`, string(normalized.Status), id); err != nil {
		return Detail{}, err
	}
	description := fmt.Sprintf("状态从 %s 变更为 %s", state.Status, normalized.Status)
	if err := insertEvent(ctx, tx, id, actor.ID, "status_changed", description); err != nil {
		return Detail{}, err
	}
	return commitDetail(ctx, tx, actor, id)
}

func (s *PGStore) AddComment(ctx context.Context, actor users.User, id string, input CommentInput) (Detail, error) {
	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		return Detail{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Detail{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := lockTicketState(ctx, tx, id)
	if err != nil {
		return Detail{}, err
	}
	if actor.Role == users.RoleAgent && state.AssigneeID != actor.ID {
		return Detail{}, ErrForbidden
	}
	if actor.Role != users.RoleAgent && actor.Role != users.RoleSupervisor {
		return Detail{}, ErrForbidden
	}
	var commentID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO ticket_comments (ticket_id, author_id, body)
		VALUES ($1, $2, $3)
		RETURNING id
	`, id, actor.ID, normalized.Body).Scan(&commentID); err != nil {
		return Detail{}, err
	}
	if err := insertEvent(ctx, tx, id, actor.ID, "commented", "添加了一条评论"); err != nil {
		return Detail{}, err
	}
	return commitDetail(ctx, tx, actor, id)
}

type ticketState struct {
	Status     Status
	AssigneeID string
}

func lockTicketState(ctx context.Context, tx pgx.Tx, id string) (ticketState, error) {
	var state ticketState
	err := tx.QueryRow(ctx, `
		SELECT status, COALESCE(assignee_id::text, '')
		FROM tickets
		WHERE id = $1
		FOR UPDATE
	`, id).Scan(&state.Status, &state.AssigneeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ticketState{}, ErrNotFound
	}
	return state, err
}

func ensureTicketExists(ctx context.Context, tx pgx.Tx, id string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM tickets WHERE id = $1)`, id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func getAgent(ctx context.Context, tx pgx.Tx, id string) (UserSummary, error) {
	var summary UserSummary
	var role users.Role
	err := tx.QueryRow(ctx, `
		SELECT id::text, name, role
		FROM users
		WHERE id::text = $1
	`, id).Scan(&summary.ID, &summary.Name, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserSummary{}, ErrAssigneeNotFound
	}
	if err != nil {
		return UserSummary{}, err
	}
	if role != users.RoleAgent {
		return UserSummary{}, ErrAssigneeNotAgent
	}
	return summary, nil
}

func getUserSummary(ctx context.Context, tx pgx.Tx, id string) (UserSummary, error) {
	var summary UserSummary
	if err := tx.QueryRow(ctx, `SELECT id::text, name FROM users WHERE id::text = $1`, id).Scan(&summary.ID, &summary.Name); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return UserSummary{}, ErrNotFound
		}
		return UserSummary{}, err
	}
	return summary, nil
}

func insertEvent(ctx context.Context, tx pgx.Tx, ticketID, actorID, eventType, description string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO ticket_events (ticket_id, actor_id, event_type, description)
		VALUES ($1, $2, $3, $4)
	`, ticketID, actorID, eventType, description)
	return err
}

func commitDetail(ctx context.Context, tx pgx.Tx, actor users.User, id string) (Detail, error) {
	detail, err := getDetail(ctx, tx, actor, id)
	if err != nil {
		return Detail{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Detail{}, err
	}
	return detail, nil
}

func getDetail(ctx context.Context, database queryer, actor users.User, id string) (Detail, error) {
	ticket, err := scanTicket(database.QueryRow(ctx, ticketSelect+" WHERE t.id = $1", id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, err
	}
	if actor.Role != users.RoleSupervisor && !agentCanView(actor.ID, ticket) {
		return Detail{}, ErrForbidden
	}

	comments, err := scanComments(ctx, database, id)
	if err != nil {
		return Detail{}, err
	}
	history, err := scanHistory(ctx, database, id)
	if err != nil {
		return Detail{}, err
	}
	return Detail{Ticket: ticket, Comments: comments, History: history}, nil
}

func scanComments(ctx context.Context, database queryer, id string) ([]Comment, error) {
	rows, err := database.Query(ctx, `
		SELECT comment.id, author.id::text, author.name, comment.body, comment.created_at
		FROM ticket_comments AS comment
		JOIN users AS author ON author.id = comment.author_id
		WHERE comment.ticket_id = $1
		ORDER BY comment.created_at ASC, comment.id ASC
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	comments := make([]Comment, 0)
	for rows.Next() {
		var comment Comment
		if err := rows.Scan(&comment.ID, &comment.Author.ID, &comment.Author.Name, &comment.Body, &comment.CreatedAt); err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	return comments, rows.Err()
}

func scanHistory(ctx context.Context, database queryer, id string) ([]Event, error) {
	rows, err := database.Query(ctx, `
		SELECT event.id, actor.id::text, actor.name, event.event_type, event.description, event.created_at
		FROM ticket_events AS event
		JOIN users AS actor ON actor.id = event.actor_id
		WHERE event.ticket_id = $1
		ORDER BY event.created_at ASC, event.id ASC
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	history := make([]Event, 0)
	for rows.Next() {
		var event Event
		if err := rows.Scan(&event.ID, &event.Actor.ID, &event.Actor.Name, &event.EventType, &event.Description, &event.CreatedAt); err != nil {
			return nil, err
		}
		history = append(history, event)
	}
	return history, rows.Err()
}

func agentCanView(agentID string, ticket Ticket) bool {
	if ticket.Assignee != nil && ticket.Assignee.ID == agentID {
		return true
	}
	return ticket.Status == StatusOpen && ticket.Assignee == nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanTicket(row scanner) (Ticket, error) {
	var ticket Ticket
	var assigneeID string
	var assigneeName string
	if err := row.Scan(
		&ticket.ID,
		&ticket.Title,
		&ticket.Description,
		&ticket.CustomerName,
		&ticket.CustomerContact,
		&ticket.Priority,
		&ticket.Status,
		&assigneeID,
		&assigneeName,
		&ticket.CreatedBy.ID,
		&ticket.CreatedBy.Name,
		&ticket.CreatedAt,
		&ticket.UpdatedAt,
	); err != nil {
		return Ticket{}, err
	}
	if assigneeID != "" {
		ticket.Assignee = &UserSummary{ID: assigneeID, Name: assigneeName}
	}
	return applySLA(ticket, time.Now()), nil
}

func newUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	raw := hex.EncodeToString(value)
	return raw[0:8] + "-" + raw[8:12] + "-" + raw[12:16] + "-" + raw[16:20] + "-" + raw[20:32], nil
}
