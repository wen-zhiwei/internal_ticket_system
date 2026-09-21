package assistant

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"internal_ticket_system/backend/internal/tickets"
	"internal_ticket_system/backend/internal/users"
)

type searchArguments struct {
	Q             string `json:"q"`
	Status        string `json:"status"`
	Priority      string `json:"priority"`
	AssigneeID    string `json:"assignee_id"`
	Page          int    `json:"page"`
	PageSize      int    `json:"page_size"`
	SortBy        string `json:"sort_by"`
	SortDirection string `json:"sort_direction"`
}

func (s *Service) searchTickets(ctx context.Context, actor users.User, raw string) (Response, error) {
	var args searchArguments
	if err := decodeArguments(raw, &args); err != nil {
		return Response{}, fmt.Errorf("%w: invalid search arguments", ErrInvalidMessage)
	}
	filter := tickets.ListFilter{Search: strings.TrimSpace(args.Q), Page: args.Page, PageSize: args.PageSize}
	if filter.Page == 0 {
		filter.Page = 1
	}
	if filter.PageSize == 0 {
		filter.PageSize = 20
	}
	if filter.PageSize > 50 {
		return Response{}, fmt.Errorf("%w: page_size cannot exceed 50", ErrInvalidMessage)
	}
	if args.Status != "" {
		status, err := tickets.ParseStatus(args.Status)
		if err != nil {
			return Response{}, fmt.Errorf("%w: invalid status", ErrInvalidMessage)
		}
		filter.Status = &status
	}
	if args.Priority != "" {
		priority, err := tickets.ParsePriority(args.Priority)
		if err != nil {
			return Response{}, fmt.Errorf("%w: invalid priority", ErrInvalidMessage)
		}
		filter.Priority = &priority
	}
	if args.AssigneeID != "" {
		if args.AssigneeID != "unassigned" && !tickets.IsUUID(args.AssigneeID) {
			return Response{}, fmt.Errorf("%w: invalid assignee_id", ErrInvalidMessage)
		}
		filter.AssigneeID = args.AssigneeID
	}
	if args.SortBy != "" {
		filter.SortBy = tickets.SortField(args.SortBy)
	} else {
		filter.SortBy = tickets.SortCreatedAt
	}
	if args.SortDirection == "asc" {
		filter.SortDirection = tickets.SortAscending
	} else {
		filter.SortDirection = tickets.SortDescending
	}
	result, err := s.ticketReader.List(ctx, actor, filter)
	if err != nil {
		return Response{}, err
	}
	return Response{
		Reply: fmt.Sprintf("找到 %d 张工单。", result.Total),
		Card:  &Card{Type: "ticket_list", Title: "查询结果", Items: result.Items},
	}, nil
}

func (s *Service) getTicketDetail(ctx context.Context, actor users.User, raw string) (Response, error) {
	var args struct {
		TicketID string `json:"ticket_id"`
	}
	if err := decodeArguments(raw, &args); err != nil || !tickets.IsUUID(strings.TrimSpace(args.TicketID)) {
		return Response{}, fmt.Errorf("%w: invalid ticket_id", ErrInvalidMessage)
	}
	result, err := s.ticketReader.Get(ctx, actor, strings.TrimSpace(args.TicketID))
	if err != nil {
		return Response{}, err
	}
	return Response{
		Reply: "已找到这张工单。",
		Card:  &Card{Type: "ticket_detail", Title: result.Ticket.Title, Ticket: &result},
	}, nil
}

type createArguments struct {
	Title           string `json:"title"`
	Description     string `json:"description"`
	CustomerName    string `json:"customer_name"`
	CustomerContact string `json:"customer_contact"`
	Priority        string `json:"priority"`
}

func (s *Service) prepareCreateTicket(raw string, sourceMessage string) (Response, error) {
	var args createArguments
	if err := decodeArguments(raw, &args); err != nil {
		return Response{}, fmt.Errorf("%w: invalid create draft arguments", ErrInvalidMessage)
	}
	draft := CreateDraft{
		Title:           strings.TrimSpace(args.Title),
		Description:     strings.TrimSpace(args.Description),
		CustomerName:    strings.TrimSpace(args.CustomerName),
		CustomerContact: strings.TrimSpace(args.CustomerContact),
		Priority:        strings.TrimSpace(args.Priority),
	}
	// 模型偶尔会漏填标题。用用户原话做一个保守兜底，避免明显完整的请求
	// 被错误地显示为“缺少标题”；真正的字段校验仍由后端创建接口负责。
	if draft.Title == "" {
		draft.Title = inferTicketTitle(sourceMessage, draft.Description)
	}
	if draft.Priority == "" {
		draft.Priority = string(tickets.PriorityNormal)
	}
	if _, err := tickets.ParsePriority(draft.Priority); err != nil {
		return Response{}, fmt.Errorf("%w: invalid priority", ErrInvalidMessage)
	}
	missing := make([]string, 0, 4)
	if draft.Title == "" {
		missing = append(missing, "title")
	}
	if draft.Description == "" {
		missing = append(missing, "description")
	}
	if draft.CustomerName == "" {
		missing = append(missing, "customer_name")
	}
	if draft.CustomerContact == "" {
		missing = append(missing, "customer_contact")
	}
	draft.MissingFields = missing
	if len(missing) > 0 {
		return Response{
			Reply: "工单草稿已整理，还缺少必填信息，请补充后再创建。",
			Card:  &Card{Type: "ticket_draft", Title: "工单草稿", Draft: &draft},
		}, nil
	}
	return Response{
		Reply: "工单草稿已整理，请核对内容后确认创建。",
		Card:  &Card{Type: "ticket_draft", Title: "工单草稿", Draft: &draft},
	}, nil
}

func classifyToolError(err error) (int, string) {
	switch {
	case errors.Is(err, ErrInvalidMessage):
		return 400, "assistant_invalid_request"
	case errors.Is(err, tickets.ErrNotFound):
		return 404, "ticket_not_found"
	case errors.Is(err, tickets.ErrForbidden):
		return 403, "ticket_access_denied"
	case errors.Is(err, ErrUnavailable):
		return 503, "assistant_unavailable"
	default:
		return 503, "assistant_tool_failed"
	}
}

func inferTicketTitle(sourceMessage, description string) string {
	message := strings.TrimSpace(sourceMessage)
	for _, prefix := range []string{"创建一个", "创建一张", "新建一个", "新建一张", "创建", "新建"} {
		index := strings.Index(message, prefix)
		if index < 0 {
			continue
		}
		candidate := strings.TrimSpace(message[index+len(prefix):])
		if end := strings.Index(candidate, "工单"); end >= 0 {
			candidate = candidate[:end]
		}
		candidate = strings.Trim(candidate, " ，。,.：:；;！!？?")
		if candidate != "" {
			return candidate
		}
	}
	if description == "" {
		return ""
	}
	runes := []rune(description)
	if len(runes) > 40 {
		runes = runes[:40]
	}
	return strings.TrimSpace(string(runes))
}
