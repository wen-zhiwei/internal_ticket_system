package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"internal_ticket_system/backend/internal/assistant"
	"internal_ticket_system/backend/internal/tickets"
)

type assistantChatInput struct {
	Message        string `json:"message"`
	ConversationID string `json:"conversation_id,omitempty"`
}

func (h *Handler) assistantChat(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.requireCurrentUser(w, r)
	if !ok {
		return
	}
	if h.assistant == nil {
		writeError(w, http.StatusServiceUnavailable, "assistant_not_configured", "AI 助手尚未配置模型服务")
		return
	}

	var input assistantChatInput
	if err := decodeJSONBody(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "请求体必须是合法且字段完整的 JSON 对象")
		return
	}
	input.Message = strings.TrimSpace(input.Message)
	if input.Message == "" || len([]rune(input.Message)) > 4000 {
		writeError(w, http.StatusBadRequest, "assistant_invalid_request", "消息不能为空且不能超过 4000 个字符")
		return
	}

	input.ConversationID = strings.TrimSpace(input.ConversationID)
	if input.ConversationID != "" && !tickets.IsUUID(input.ConversationID) {
		writeError(w, http.StatusBadRequest, "assistant_invalid_conversation", "会话编号不正确")
		return
	}

	if input.ConversationID != "" && h.assistantConversations != nil {
		if _, err := h.assistantConversations.Get(r.Context(), actor, input.ConversationID); err != nil {
			if errors.Is(err, assistant.ErrConversationNotFound) {
				writeError(w, http.StatusNotFound, "assistant_conversation_not_found", "历史会话不存在")
				return
			}
			writeError(w, http.StatusServiceUnavailable, "assistant_history_unavailable", "暂时无法读取会话记录")
			return
		}
	}

	response, err := h.assistant.Chat(r.Context(), actor, input.ConversationID, input.Message)
	if err != nil {
		status, code, message := assistantError(err)
		writeError(w, status, code, message)
		return
	}
	if h.assistantConversations != nil {
		conversationID := strings.TrimSpace(response.ConversationID)
		if conversationID == "" {
			conversationID = input.ConversationID
		}
		conversation, err := h.assistantConversations.AppendExchange(
			r.Context(), actor, conversationID, input.Message, response,
		)
		if err != nil {
			if errors.Is(err, assistant.ErrConversationNotFound) {
				writeError(w, http.StatusNotFound, "assistant_conversation_not_found", "历史会话不存在")
				return
			}
			writeError(w, http.StatusServiceUnavailable, "assistant_history_unavailable", "暂时无法保存会话记录")
			return
		}
		response.ConversationID = conversation.ID
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) listAssistantConversations(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.requireCurrentUser(w, r)
	if !ok {
		return
	}
	if h.assistantConversations == nil {
		writeError(w, http.StatusServiceUnavailable, "assistant_history_unavailable", "历史会话尚未启用")
		return
	}
	items, err := h.assistantConversations.List(r.Context(), actor, 12)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "assistant_history_unavailable", "暂时无法读取历史会话")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) getAssistantConversation(w http.ResponseWriter, r *http.Request) {
	actor, ok := h.requireCurrentUser(w, r)
	if !ok {
		return
	}
	if h.assistantConversations == nil {
		writeError(w, http.StatusServiceUnavailable, "assistant_history_unavailable", "历史会话尚未启用")
		return
	}
	conversation, err := h.assistantConversations.Get(r.Context(), actor, strings.TrimSpace(r.PathValue("id")))
	if errors.Is(err, assistant.ErrConversationNotFound) {
		writeError(w, http.StatusNotFound, "assistant_conversation_not_found", "历史会话不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "assistant_history_unavailable", "暂时无法读取历史会话")
		return
	}
	writeJSON(w, http.StatusOK, conversation)
}

func assistantError(err error) (int, string, string) {
	switch {
	case errors.Is(err, assistant.ErrInvalidMessage):
		return http.StatusBadRequest, "assistant_invalid_request", "助手请求参数不正确"
	case errors.Is(err, tickets.ErrNotFound):
		return http.StatusNotFound, "ticket_not_found", "工单不存在"
	case errors.Is(err, tickets.ErrForbidden):
		return http.StatusForbidden, "ticket_access_denied", "无权查看该工单"
	case errors.Is(err, assistant.ErrConversationNotFound):
		return http.StatusNotFound, "assistant_conversation_not_found", "历史会话不存在"
	case errors.Is(err, assistant.ErrUnavailable):
		return http.StatusServiceUnavailable, "assistant_unavailable", "AI 助手暂时不可用，请稍后重试"
	default:
		return http.StatusServiceUnavailable, "assistant_tool_failed", "助手暂时无法完成这个操作，请稍后重试"
	}
}
