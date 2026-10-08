package tickets

import (
	"errors"
	"regexp"
	"strings"
	"time"
)

type Priority string

const (
	PriorityUrgent Priority = "urgent"
	PriorityHigh   Priority = "high"
	PriorityNormal Priority = "normal"
	PriorityLow    Priority = "low"
)

type Status string

const (
	StatusOpen       Status = "open"
	StatusInProgress Status = "in_progress"
	StatusResolved   Status = "resolved"
	StatusClosed     Status = "closed"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

var (
	ErrNotFound          = errors.New("ticket not found")
	ErrForbidden         = errors.New("ticket access forbidden")
	ErrConflict          = errors.New("ticket business conflict")
	ErrAssigneeNotFound  = errors.New("assignee not found")
	ErrAssigneeNotAgent  = errors.New("assignee must be an agent")
	ErrInvalidTransition = errors.New("invalid status transition")
	ErrTicketClosed      = errors.New("closed ticket cannot be edited")
)

type UserSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Team string `json:"team"`
}

type Ticket struct {
	ID              string       `json:"id"`
	Title           string       `json:"title"`
	Description     string       `json:"description"`
	CustomerName    string       `json:"customer_name"`
	CustomerContact string       `json:"customer_contact"`
	Priority        Priority     `json:"priority"`
	Status          Status       `json:"status"`
	Assignee        *UserSummary `json:"assignee"`
	CreatedBy       UserSummary  `json:"created_by"`
	SLADueAt        time.Time    `json:"sla_due_at"`
	Overdue         bool         `json:"overdue"`
	CreatedAt       time.Time    `json:"created_at"`
	UpdatedAt       time.Time    `json:"updated_at"`
}

type Event struct {
	ID          int64       `json:"id"`
	Actor       UserSummary `json:"actor"`
	EventType   string      `json:"event_type"`
	Description string      `json:"description"`
	CreatedAt   time.Time   `json:"created_at"`
}

type Comment struct {
	ID        int64       `json:"id"`
	Author    UserSummary `json:"author"`
	Body      string      `json:"body"`
	CreatedAt time.Time   `json:"created_at"`
}

type Detail struct {
	Ticket   Ticket    `json:"ticket"`
	Comments []Comment `json:"comments"`
	History  []Event   `json:"history"`
}

type CreateInput struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	CustomerName    string   `json:"customer_name"`
	CustomerContact string   `json:"customer_contact"`
	Priority        Priority `json:"priority"`
}

type UpdateInput CreateInput

type AssignmentInput struct {
	AssigneeID string `json:"assignee_id"`
}

type StatusInput struct {
	Status Status `json:"status"`
}

type CommentInput struct {
	Body string `json:"body"`
}

func (input AssignmentInput) NormalizeAndValidate() (AssignmentInput, error) {
	input.AssigneeID = strings.TrimSpace(input.AssigneeID)
	if !IsUUID(input.AssigneeID) {
		return AssignmentInput{}, ValidationErrors{"assignee_id": "必须是合法的用户 UUID"}
	}
	return input, nil
}

func (input StatusInput) NormalizeAndValidate() (StatusInput, error) {
	input.Status = Status(strings.TrimSpace(string(input.Status)))
	if _, err := ParseStatus(string(input.Status)); err != nil {
		return StatusInput{}, ValidationErrors{"status": "必须是 open、in_progress、resolved 或 closed"}
	}
	return input, nil
}

func (input CommentInput) NormalizeAndValidate() (CommentInput, error) {
	input.Body = strings.TrimSpace(input.Body)
	if input.Body == "" {
		return CommentInput{}, ValidationErrors{"body": "评论内容不能为空"}
	}
	if len([]rune(input.Body)) > 5000 {
		return CommentInput{}, ValidationErrors{"body": "评论内容不能超过 5000 个字符"}
	}
	return input, nil
}

type SortField string

const (
	SortCreatedAt SortField = "created_at"
	SortUpdatedAt SortField = "updated_at"
	SortPriority  SortField = "priority"
	SortSLADueAt  SortField = "sla_due_at"
)

type SortDirection string

const (
	SortAscending  SortDirection = "asc"
	SortDescending SortDirection = "desc"
)

type ListFilter struct {
	Status        *Status
	Pending       bool
	Overdue       bool
	Priority      *Priority
	AssigneeID    string
	Search        string
	Page          int
	PageSize      int
	SortBy        SortField
	SortDirection SortDirection
	CreatedFrom   *time.Time
	CreatedTo     *time.Time
}

type ListResult struct {
	Items      []Ticket `json:"items"`
	Page       int      `json:"page"`
	PageSize   int      `json:"page_size"`
	Total      int      `json:"total"`
	TotalPages int      `json:"total_pages"`
}

type Overview struct {
	Total        int            `json:"total"`
	Pending      int            `json:"pending"`
	Urgent       int            `json:"urgent"`
	SLAAttention int            `json:"sla_attention"`
	ByStatus     map[string]int `json:"by_status"`
}

type ValidationErrors map[string]string

func (e ValidationErrors) Error() string {
	return "ticket validation failed"
}

func IsUUID(value string) bool {
	return uuidPattern.MatchString(value)
}

func ParsePriority(value string) (Priority, error) {
	switch Priority(value) {
	case PriorityUrgent, PriorityHigh, PriorityNormal, PriorityLow:
		return Priority(value), nil
	default:
		return "", errors.New("invalid priority")
	}
}

func ParseStatus(value string) (Status, error) {
	switch Status(value) {
	case StatusOpen, StatusInProgress, StatusResolved, StatusClosed:
		return Status(value), nil
	default:
		return "", errors.New("invalid status")
	}
}

func ParseSortField(value string) (SortField, error) {
	switch SortField(value) {
	case SortCreatedAt, SortUpdatedAt, SortPriority, SortSLADueAt:
		return SortField(value), nil
	default:
		return "", errors.New("invalid sort field")
	}
}

func ParseSortDirection(value string) (SortDirection, error) {
	switch SortDirection(value) {
	case SortAscending, SortDescending:
		return SortDirection(value), nil
	default:
		return "", errors.New("invalid sort direction")
	}
}

func CanTransition(from, to Status) bool {
	switch {
	case from == StatusOpen && to == StatusInProgress:
		return true
	case from == StatusInProgress && to == StatusResolved:
		return true
	case from == StatusResolved && (to == StatusInProgress || to == StatusClosed):
		return true
	default:
		return false
	}
}

func slaDuration(priority Priority) time.Duration {
	switch priority {
	case PriorityUrgent:
		return 2 * time.Hour
	case PriorityHigh:
		return 8 * time.Hour
	case PriorityNormal:
		return 24 * time.Hour
	case PriorityLow:
		return 72 * time.Hour
	default:
		return 0
	}
}

func applySLA(ticket Ticket, now time.Time) Ticket {
	ticket.SLADueAt = ticket.CreatedAt.Add(slaDuration(ticket.Priority))
	ticket.Overdue = ticket.Status != StatusResolved &&
		ticket.Status != StatusClosed &&
		now.After(ticket.SLADueAt)
	return ticket
}

func (input CreateInput) NormalizeAndValidate() (CreateInput, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.CustomerName = strings.TrimSpace(input.CustomerName)
	input.CustomerContact = strings.TrimSpace(input.CustomerContact)

	errorsByField := ValidationErrors{}
	validateRequiredLength(errorsByField, "title", input.Title, 200)
	validateRequiredLength(errorsByField, "description", input.Description, 10000)
	validateRequiredLength(errorsByField, "customer_name", input.CustomerName, 100)
	validateRequiredLength(errorsByField, "customer_contact", input.CustomerContact, 200)
	if _, err := ParsePriority(string(input.Priority)); err != nil {
		errorsByField["priority"] = "必须是 urgent、high、normal 或 low"
	}
	if len(errorsByField) > 0 {
		return CreateInput{}, errorsByField
	}
	return input, nil
}

func (input UpdateInput) NormalizeAndValidate() (UpdateInput, error) {
	normalized, err := CreateInput(input).NormalizeAndValidate()
	return UpdateInput(normalized), err
}

func validateRequiredLength(result ValidationErrors, field, value string, maximum int) {
	if value == "" {
		result[field] = "不能为空"
		return
	}
	if len([]rune(value)) > maximum {
		result[field] = "长度不能超过 " + integerString(maximum) + " 个字符"
	}
}

func integerString(value int) string {
	if value == 0 {
		return "0"
	}
	var digits [20]byte
	position := len(digits)
	for value > 0 {
		position--
		digits[position] = byte('0' + value%10)
		value /= 10
	}
	return string(digits[position:])
}
