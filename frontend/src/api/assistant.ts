import { apiRequest } from "./client";
import type { Ticket, TicketDetail } from "./tickets";
import type { User } from "./users";

export type AssistantDraft = {
  title: string;
  description: string;
  customer_name: string;
  customer_contact: string;
  priority: "urgent" | "high" | "normal" | "low";
  missing_fields?: string[];
};

export type AssistantPendingAction = {
  id: string;
  action_type:
    | "create_ticket"
    | "update_ticket"
    | "assign_ticket"
    | "change_status"
    | "bulk_change_status";
  summary: string;
  status: "pending" | "executing" | "completed" | "cancelled" | "failed";
  items?: Ticket[];
  expires_at?: string;
};

export type AssistantCard = {
  type:
    | "ticket_list"
    | "ticket_detail"
    | "ticket_draft"
    | "user_list"
    | "pending_action";
  title: string;
  items?: Ticket[];
  ticket?: TicketDetail;
  draft?: AssistantDraft;
  action?: AssistantPendingAction;
  users?: User[];
};

export type AssistantResponse = {
  reply: string;
  card?: AssistantCard;
  conversation_id?: string;
};

export type AssistantConversationSummary = {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
};

export type AssistantConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  card?: AssistantCard;
  is_error: boolean;
  created_at: string;
};

export type AssistantConversation = AssistantConversationSummary & {
  messages: AssistantConversationMessage[];
};

export function sendAssistantMessage(
  userId: string,
  message: string,
  conversationId?: string | null,
): Promise<AssistantResponse> {
  return apiRequest<AssistantResponse>("/assistant/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
    userId,
  });
}

export function listAssistantConversations(
  userId: string,
): Promise<{ items: AssistantConversationSummary[] }> {
  return apiRequest("/assistant/conversations", { userId });
}

export function getAssistantConversation(
  userId: string,
  conversationId: string,
): Promise<AssistantConversation> {
  return apiRequest(`/assistant/conversations/${conversationId}`, { userId });
}
