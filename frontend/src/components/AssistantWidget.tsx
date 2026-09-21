import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  getAssistantConversation,
  sendAssistantMessage,
  type AssistantCard,
  type AssistantDraft,
} from "../api/assistant";
import { saveAssistantDraft } from "../domain/assistantDraft";
import { rememberAssistantMemory } from "../domain/assistantMemory";
import { createTicket } from "../api/tickets";
import type { User } from "../api/users";
import { formatDateTime } from "../domain/tickets";

const MAX_MESSAGE_LENGTH = 4000;

type Props = {
  currentUser: User;
};

type ConversationProps = Props & {
  embedded?: boolean;
  onClose?: () => void;
  selectedConversationId?: string | null;
  onConversationChange?: (conversationId: string | null) => void;
  onHistoryChange?: () => void;
};

type ChatEntry = {
  id: string;
  role: "user" | "assistant";
  content: string;
  card?: AssistantCard;
  error?: boolean;
};

function ticketStatusLabel(status: string) {
  return (
    {
      open: "待领取",
      in_progress: "处理中",
      resolved: "已解决",
      closed: "已关闭",
    }[status] ?? status
  );
}

function priorityLabel(priority: string) {
  return (
    {
      urgent: "紧急",
      high: "高",
      normal: "普通",
      low: "低",
    }[priority] ?? priority
  );
}

function missingFieldLabel(field: string) {
  return (
    {
      title: "工单标题",
      description: "问题描述",
      customer_name: "客户名称",
      customer_contact: "联系方式",
    }[field] ?? field
  );
}

function TicketListCard({ card }: { card: AssistantCard }) {
  const items = card.items ?? [];
  return (
    <div className="assistant-card" data-card-type="ticket_list">
      <div className="assistant-card-heading">
        <strong>{card.title}</strong>
        <span>{items.length} 条</span>
      </div>
      {items.length === 0 ? (
        <p className="assistant-card-empty">没有符合条件的工单。</p>
      ) : (
        <div className="assistant-ticket-list">
          {items.map((ticket) => (
            <a
              className="assistant-ticket-item"
              href={`#/tickets/${ticket.id}`}
              key={ticket.id}
            >
              <span>
                <strong>{ticket.title}</strong>
                <small>
                  {ticket.customer_name} · {ticketStatusLabel(ticket.status)}
                </small>
              </span>
              <em>{priorityLabel(ticket.priority)}</em>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function TicketDetailCard({ card }: { card: AssistantCard }) {
  const detail = card.ticket;
  if (!detail) return null;
  const ticket = detail.ticket;
  return (
    <div className="assistant-card" data-card-type="ticket_detail">
      <div className="assistant-card-heading">
        <strong>{card.title}</strong>
        <span>{ticketStatusLabel(ticket.status)}</span>
      </div>
      <a className="assistant-detail-link" href={`#/tickets/${ticket.id}`}>
        查看完整工单
      </a>
      <dl className="assistant-detail-fields">
        <div>
          <dt>客户</dt>
          <dd>{ticket.customer_name}</dd>
        </div>
        <div>
          <dt>优先级</dt>
          <dd>{priorityLabel(ticket.priority)}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{formatDateTime(ticket.updated_at)}</dd>
        </div>
      </dl>
    </div>
  );
}

function TicketDraftCard({
  draft,
  currentUser,
}: {
  draft: AssistantDraft;
  currentUser: User;
}) {
  const missingFields = draft.missing_fields ?? [];
  const [createdTicketId, setCreatedTicketId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function continueToCreate() {
    saveAssistantDraft(draft);
    window.location.hash = "#/new-ticket";
  }

  async function confirmCreate() {
    if (missingFields.length > 0 || isCreating) return;
    setIsCreating(true);
    setCreateError(null);
    try {
      const detail = await createTicket(currentUser.id, {
        title: draft.title,
        description: draft.description,
        customer_name: draft.customer_name,
        customer_contact: draft.customer_contact,
        priority: draft.priority,
      });
      setCreatedTicketId(detail.ticket.id);
      rememberAssistantMemory(currentUser.id, { favorite_view: "all" });
      window.dispatchEvent(new CustomEvent("ticket-created"));
      window.location.hash = "#/tickets";
    } catch (error) {
      setCreateError(
        error instanceof ApiError ? error.message : "创建失败，请稍后重试。",
      );
    } finally {
      setIsCreating(false);
    }
  }

  if (createdTicketId) {
    return (
      <div className="assistant-card" data-card-type="ticket-created">
        <div className="assistant-card-heading">
          <strong>工单已创建</strong>
          <span>已写入工单中心</span>
        </div>
        <p className="assistant-card-success">
          工单已保存，编号：{createdTicketId}
        </p>
        <a
          className="assistant-detail-link"
          href={`#/tickets/${createdTicketId}`}
        >
          查看工单详情
        </a>
      </div>
    );
  }

  return (
    <div className="assistant-card" data-card-type="ticket_draft">
      <div className="assistant-card-heading">
        <strong>工单草稿</strong>
        <span>{missingFields.length > 0 ? "待补充" : "待确认"}</span>
      </div>
      <dl className="assistant-draft-fields">
        <div>
          <dt>标题</dt>
          <dd>{draft.title || "未填写"}</dd>
        </div>
        <div>
          <dt>描述</dt>
          <dd>{draft.description || "未填写"}</dd>
        </div>
        <div>
          <dt>客户</dt>
          <dd>{draft.customer_name || "未填写"}</dd>
        </div>
        <div>
          <dt>优先级</dt>
          <dd>{priorityLabel(draft.priority)}</dd>
        </div>
      </dl>
      {missingFields.length > 0 && (
        <p className="assistant-card-warning">
          还缺少：{missingFields.map(missingFieldLabel).join("、")}。
        </p>
      )}
      {createError && <p className="assistant-card-warning">{createError}</p>}
      <div className="assistant-card-actions">
        <button
          className="button primary assistant-card-action"
          type="button"
          disabled={isCreating}
          onClick={missingFields.length > 0 ? continueToCreate : confirmCreate}
        >
          {isCreating
            ? "正在创建…"
            : missingFields.length > 0
              ? "补充工单信息"
              : "确认创建工单"}
        </button>
        {missingFields.length === 0 && (
          <button
            className="button ghost assistant-card-action"
            type="button"
            onClick={continueToCreate}
          >
            先检查并修改
          </button>
        )}
      </div>
    </div>
  );
}

function AssistantCardView({
  card,
  currentUser,
}: {
  card: AssistantCard;
  currentUser: User;
}) {
  if (card.type === "ticket_list") return <TicketListCard card={card} />;
  if (card.type === "ticket_detail") return <TicketDetailCard card={card} />;
  if (card.type === "ticket_draft" && card.draft) {
    return <TicketDraftCard draft={card.draft} currentUser={currentUser} />;
  }
  return null;
}

function assistantErrorMessage(error: ApiError) {
  if (error.code === "assistant_not_configured") {
    return "助手还没有连接模型服务，请在后端 .env 配置模型后重启 Go API。";
  }
  if (error.code === "assistant_unavailable") {
    return "模型服务暂时不可用，请检查后端配置或稍后重试。";
  }
  return error.message;
}

const welcomeEntry: ChatEntry = {
  id: "welcome",
  role: "assistant",
  content: "你好，我可以帮你查工单、整理客户问题；你确认后，我再帮你创建。",
};

export function AssistantConversation({
  currentUser,
  embedded = false,
  onClose,
  selectedConversationId,
  onConversationChange,
  onHistoryChange,
}: ConversationProps) {
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [internalConversationId, setInternalConversationId] = useState<
    string | null
  >(null);
  const [entries, setEntries] = useState<ChatEntry[]>([welcomeEntry]);
  const activeConversationId =
    selectedConversationId === undefined
      ? internalConversationId
      : selectedConversationId;

  useEffect(() => {
    if (selectedConversationId === undefined) return;
    if (!selectedConversationId) return;

    let cancelled = false;
    getAssistantConversation(currentUser.id, selectedConversationId)
      .then((conversation) => {
        if (cancelled) return;
        setEntries(
          conversation.messages.map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
            card: item.card,
            error: item.is_error,
          })),
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEntries([
          welcomeEntry,
          {
            id: `history-error-${Date.now()}`,
            role: "assistant",
            content:
              error instanceof ApiError
                ? error.message
                : "暂时无法打开这段历史会话。",
            error: true,
          },
        ]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, selectedConversationId]);

  function startNewConversation() {
    setInternalConversationId(null);
    onConversationChange?.(null);
    setEntries([welcomeEntry]);
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSending || trimmed.length > MAX_MESSAGE_LENGTH) return;

    const userEntry: ChatEntry = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    setEntries((current) => [...current, userEntry]);
    setMessage("");
    setIsSending(true);

    try {
      const response = await sendAssistantMessage(
        currentUser.id,
        trimmed,
        activeConversationId,
      );
      setEntries((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: response.reply,
          card: response.card,
        },
      ]);
      if (response.conversation_id) {
        setInternalConversationId(response.conversation_id);
        onConversationChange?.(response.conversation_id);
        onHistoryChange?.();
      }
    } catch (error) {
      const content =
        error instanceof ApiError
          ? assistantErrorMessage(error)
          : "助手暂时无法连接，请稍后重试。";
      setEntries((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content,
          error: true,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section
      className={`assistant-panel ${embedded ? "assistant-panel-embedded" : ""}`}
      aria-label="我的助手"
    >
      <header className="assistant-panel-header">
        <div>
          <strong>我的助手</strong>
          <span>查工单、整理草稿，创建前由你确认</span>
        </div>
        <div className="assistant-header-actions">
          <button
            className="assistant-new-conversation"
            type="button"
            onClick={startNewConversation}
          >
            新对话
          </button>
          {onClose && (
            <button
              aria-label="关闭我的助手"
              className="assistant-close"
              type="button"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
      </header>
      <div className="assistant-messages" aria-live="polite">
        {entries.map((entry) => (
          <div className={`assistant-message ${entry.role}`} key={entry.id}>
            <div className={`assistant-bubble ${entry.error ? "error" : ""}`}>
              {entry.content}
            </div>
            {entry.card && (
              <AssistantCardView card={entry.card} currentUser={currentUser} />
            )}
          </div>
        ))}
        {isSending && (
          <div className="assistant-message assistant">
            <div className="assistant-bubble pending">正在处理…</div>
          </div>
        )}
      </div>
      <form className="assistant-composer" onSubmit={handleSubmit}>
        <textarea
          aria-label="输入助手问题"
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="例如：帮我查一下本周未处理的自动驾驶工单"
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <div className="assistant-composer-footer">
          <span>{message.length}/4000</span>
          <button
            className="button primary"
            disabled={!message.trim() || isSending}
            type="submit"
          >
            发送
          </button>
        </div>
      </form>
    </section>
  );
}

export function AssistantWidget({ currentUser }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`assistant-widget ${isOpen ? "is-open" : ""}`}>
      {isOpen && (
        <AssistantConversation
          currentUser={currentUser}
          onClose={() => setIsOpen(false)}
        />
      )}
      <button
        aria-expanded={isOpen}
        aria-label={isOpen ? "关闭我的助手" : "打开我的助手"}
        className="assistant-launcher"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
      >
        <svg
          className="assistant-launcher-icon"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M5 16.5h14l-1.2-5.2a2 2 0 0 0-2-1.5H8.2a2 2 0 0 0-2 1.5L5 16.5Z" />
          <path d="M7.5 9.8 9 7.2h6l1.5 2.6M8 16.5v1.2m8-1.2v1.2" />
          <circle cx="8.2" cy="13.4" r=".8" />
          <circle cx="15.8" cy="13.4" r=".8" />
        </svg>
        <span>{isOpen ? "收起" : "助手"}</span>
      </button>
    </div>
  );
}
