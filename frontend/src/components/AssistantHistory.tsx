import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  listAssistantConversations,
  type AssistantConversationSummary,
} from "../api/assistant";
import type { User } from "../api/users";
import { formatDateTime } from "../domain/tickets";

type Props = {
  currentUser: User;
  activeConversationId: string | null;
  refreshKey: number;
  onSelect: (conversationId: string) => void;
  onNewConversation: () => void;
};

export function AssistantHistory({
  currentUser,
  activeConversationId,
  refreshKey,
  onSelect,
  onNewConversation,
}: Props) {
  const [items, setItems] = useState<AssistantConversationSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAssistantConversations(currentUser.id)
      .then((response) => {
        if (cancelled) return;
        setItems(response.items);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : "暂时无法读取历史会话",
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, refreshKey]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleItems = normalizedQuery
    ? items.filter((item) => item.title.toLowerCase().includes(normalizedQuery))
    : items;

  return (
    <section className="assistant-history" aria-labelledby="history-heading">
      <div className="assistant-history-heading">
        <div>
          <h2 id="history-heading">最近会话</h2>
          <p>查看之前的沟通，点击后可继续和我的助手处理工单。</p>
        </div>
        <span>仅显示当前用户</span>
      </div>

      <div className="assistant-history-toolbar">
        <label className="assistant-history-search">
          <span className="visually-hidden">搜索历史会话</span>
          <input
            aria-label="搜索历史会话"
            placeholder="搜索历史会话"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <button
          className="button primary assistant-history-new"
          type="button"
          onClick={onNewConversation}
        >
          <span aria-hidden="true">＋</span>
          新对话
        </button>
      </div>

      {error && <div className="assistant-history-state error">{error}</div>}
      {!error && isLoading && (
        <div className="assistant-history-state">正在读取历史会话…</div>
      )}
      {!error && !isLoading && items.length === 0 && (
        <div className="assistant-history-state empty">
          第一次对话后，会话会保存在这里。
        </div>
      )}
      {!error &&
        !isLoading &&
        items.length > 0 &&
        visibleItems.length === 0 && (
          <div className="assistant-history-state empty">没有匹配的会话。</div>
        )}
      {!error && !isLoading && visibleItems.length > 0 && (
        <div className="assistant-history-list">
          {visibleItems.map((item) => (
            <button
              className={`assistant-history-item ${activeConversationId === item.id ? "active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
            >
              <span className="assistant-history-icon" aria-hidden="true">
                ◷
              </span>
              <span className="assistant-history-copy">
                <strong>{item.title}</strong>
                <small>与我的助手的工单协作会话</small>
                <em>
                  {item.message_count} 条消息 · 更新于{" "}
                  {formatDateTime(item.updated_at)}
                </em>
              </span>
              <span className="assistant-history-open">继续会话</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
