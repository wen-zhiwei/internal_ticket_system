package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"internal_ticket_system/backend/internal/tickets"
	"internal_ticket_system/backend/internal/users"
)

func (h *Handler) listTickets(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.requireCurrentUser(w, r)
	if !ok {
		return
	}
	filter, err := parseTicketListFilter(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_filter", err.Error())
		return
	}

	result, err := h.ticketStore.List(r.Context(), actor, filter)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "ticket_store_unavailable", "暂时无法读取工单列表")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) getTicket(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.requireCurrentUser(w, r)
	if !ok {
		return
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if !tickets.IsUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid_ticket_id", "工单 ID 格式不正确")
		return
	}

	detail, err := h.ticketStore.Get(r.Context(), actor, id)
	if err != nil {
		switch {
		case errors.Is(err, tickets.ErrNotFound):
			writeError(w, http.StatusNotFound, "ticket_not_found", "工单不存在")
		case errors.Is(err, tickets.ErrForbidden):
			writeError(w, http.StatusForbidden, "ticket_access_denied", "无权查看该工单")
		default:
			writeError(w, http.StatusServiceUnavailable, "ticket_store_unavailable", "暂时无法读取工单")
		}
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *Handler) createTicket(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.requireCurrentUser(w, r)
	if !ok {
		return
	}

	var input tickets.CreateInput
	if err := decodeJSONBody(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "请求体必须是合法且字段完整的 JSON 对象")
		return
	}
	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		var fields tickets.ValidationErrors
		if errors.As(err, &fields) {
			writeValidationError(w, "请检查工单字段", fields)
			return
		}
		writeError(w, http.StatusBadRequest, "validation_error", "请检查工单字段")
		return
	}

	detail, err := h.ticketStore.Create(r.Context(), actor, normalized)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "ticket_store_unavailable", "暂时无法创建工单")
		return
	}
	writeJSON(w, http.StatusCreated, detail)
}

func parseTicketListFilter(r *http.Request) (tickets.ListFilter, error) {
	query := r.URL.Query()
	filter := tickets.ListFilter{
		Search:   strings.TrimSpace(query.Get("q")),
		Page:     1,
		PageSize: 20,
	}
	if len([]rune(filter.Search)) > 100 {
		return tickets.ListFilter{}, errors.New("搜索内容不能超过 100 个字符")
	}

	if rawStatus := strings.TrimSpace(query.Get("status")); rawStatus != "" {
		status, err := tickets.ParseStatus(rawStatus)
		if err != nil {
			return tickets.ListFilter{}, errors.New("status 必须是 open、in_progress、resolved 或 closed")
		}
		filter.Status = &status
	}
	if rawPriority := strings.TrimSpace(query.Get("priority")); rawPriority != "" {
		priority, err := tickets.ParsePriority(rawPriority)
		if err != nil {
			return tickets.ListFilter{}, errors.New("priority 必须是 urgent、high、normal 或 low")
		}
		filter.Priority = &priority
	}
	if assigneeID := strings.TrimSpace(query.Get("assignee_id")); assigneeID != "" {
		if assigneeID != "unassigned" && !tickets.IsUUID(assigneeID) {
			return tickets.ListFilter{}, errors.New("assignee_id 必须是用户 UUID 或 unassigned")
		}
		filter.AssigneeID = assigneeID
	}

	var err error
	if rawPage := strings.TrimSpace(query.Get("page")); rawPage != "" {
		filter.Page, err = parseBoundedPositiveInt(rawPage, 1, 100000)
		if err != nil {
			return tickets.ListFilter{}, errors.New("page 必须是正整数")
		}
	}
	if rawPageSize := strings.TrimSpace(query.Get("page_size")); rawPageSize != "" {
		filter.PageSize, err = parseBoundedPositiveInt(rawPageSize, 1, 100)
		if err != nil {
			return tickets.ListFilter{}, errors.New("page_size 必须是 1 到 100 的整数")
		}
	}
	return filter, nil
}

func parseBoundedPositiveInt(value string, minimum, maximum int) (int, error) {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < minimum || parsed > maximum {
		return 0, errors.New("integer out of range")
	}
	return parsed, nil
}

func (h *Handler) claimTicket(w http.ResponseWriter, r *http.Request) {
	actor, id, ok := h.requireTicketActor(w, r)
	if !ok {
		return
	}
	detail, err := h.ticketStore.Claim(r.Context(), actor, id)
	if err != nil {
		writeTicketMutationError(w, err, "领取工单失败")
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *Handler) assignTicket(w http.ResponseWriter, r *http.Request) {
	h.handleAssignment(w, r, false)
}

func (h *Handler) reassignTicket(w http.ResponseWriter, r *http.Request) {
	h.handleAssignment(w, r, true)
}

func (h *Handler) handleAssignment(w http.ResponseWriter, r *http.Request, reassign bool) {
	actor, id, ok := h.requireTicketActor(w, r)
	if !ok {
		return
	}
	var input tickets.AssignmentInput
	if err := decodeJSONBody(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "请求体必须是合法且字段完整的 JSON 对象")
		return
	}
	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		writeValidationError(w, "请检查处理人", err.(tickets.ValidationErrors))
		return
	}
	var detail tickets.Detail
	if reassign {
		detail, err = h.ticketStore.Reassign(r.Context(), actor, id, normalized)
	} else {
		detail, err = h.ticketStore.Assign(r.Context(), actor, id, normalized)
	}
	if err != nil {
		writeTicketMutationError(w, err, "更新处理人失败")
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *Handler) changeTicketStatus(w http.ResponseWriter, r *http.Request) {
	actor, id, ok := h.requireTicketActor(w, r)
	if !ok {
		return
	}
	var input tickets.StatusInput
	if err := decodeJSONBody(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "请求体必须是合法且字段完整的 JSON 对象")
		return
	}
	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		writeValidationError(w, "请检查目标状态", err.(tickets.ValidationErrors))
		return
	}
	detail, err := h.ticketStore.ChangeStatus(r.Context(), actor, id, normalized)
	if err != nil {
		writeTicketMutationError(w, err, "更新工单状态失败")
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *Handler) addTicketComment(w http.ResponseWriter, r *http.Request) {
	actor, id, ok := h.requireTicketActor(w, r)
	if !ok {
		return
	}
	var input tickets.CommentInput
	if err := decodeJSONBody(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "请求体必须是合法且字段完整的 JSON 对象")
		return
	}
	normalized, err := input.NormalizeAndValidate()
	if err != nil {
		writeValidationError(w, "请检查评论内容", err.(tickets.ValidationErrors))
		return
	}
	detail, err := h.ticketStore.AddComment(r.Context(), actor, id, normalized)
	if err != nil {
		writeTicketMutationError(w, err, "添加评论失败")
		return
	}
	writeJSON(w, http.StatusCreated, detail)
}

func (h *Handler) requireTicketActor(w http.ResponseWriter, r *http.Request) (users.User, string, bool) {
	actor, ok := h.requireCurrentUser(w, r)
	if !ok {
		return users.User{}, "", false
	}
	id := strings.TrimSpace(r.PathValue("id"))
	if !tickets.IsUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid_ticket_id", "工单 ID 格式不正确")
		return users.User{}, "", false
	}
	return actor, id, true
}

func writeTicketMutationError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, tickets.ErrNotFound):
		writeError(w, http.StatusNotFound, "ticket_not_found", "工单不存在")
	case errors.Is(err, tickets.ErrForbidden):
		writeError(w, http.StatusForbidden, "ticket_action_forbidden", "当前用户无权执行此操作")
	case errors.Is(err, tickets.ErrConflict):
		writeError(w, http.StatusConflict, "ticket_conflict", "工单已被其他操作更新，或当前状态不允许此操作")
	case errors.Is(err, tickets.ErrInvalidTransition):
		writeError(w, http.StatusConflict, "invalid_status_transition", "不允许从当前状态流转到目标状态")
	case errors.Is(err, tickets.ErrAssigneeNotFound):
		writeError(w, http.StatusNotFound, "assignee_not_found", "指定的客服不存在")
	case errors.Is(err, tickets.ErrAssigneeNotAgent):
		writeError(w, http.StatusBadRequest, "assignee_not_agent", "处理人必须是客服 Agent")
	default:
		writeError(w, http.StatusServiceUnavailable, "ticket_store_unavailable", fallback)
	}
}
