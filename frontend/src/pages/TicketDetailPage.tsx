import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  addTicketComment,
  assignTicket,
  changeTicketStatus,
  claimTicket,
  getTicket,
  reassignTicket,
  type TicketDetail,
  type TicketStatus,
} from "../api/tickets";
import type { User } from "../api/users";
import { PriorityBadge, StatusBadge } from "../components/TicketBadges";
import {
  eventTypeLabels,
  formatFullDateTime,
  statusLabels,
} from "../domain/tickets";

type Props = {
  currentUser: User;
  agents: User[];
  ticketId: string;
};

function errorTitle(error: ApiError) {
  if (error.status === 404) return "工单不存在";
  if (error.status === 403) return "无权查看该工单";
  return "工单加载失败";
}

function actionErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "无法连接 Go API，请稍后重试";
}

export function TicketDetailPage({ currentUser, agents, ticketId }: Props) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ title: string; message: string } | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getTicket(currentUser.id, ticketId)
      .then((response) => {
        if (!cancelled) {
          setDetail(response);
          setSelectedAssignee(response.ticket.assignee?.id ?? "");
        }
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        if (requestError instanceof ApiError) {
          setError({
            title: errorTitle(requestError),
            message: requestError.message,
          });
        } else {
          setError({
            title: "工单加载失败",
            message: "无法连接 Go API，请稍后重试",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser.id, reloadKey, ticketId]);

  if (isLoading) {
    return <div className="content-state">正在读取工单详情与操作历史…</div>;
  }

  if (error || !detail) {
    return (
      <div className="content-state error" role="alert">
        <span className="state-symbol">!</span>
        <h2>{error?.title ?? "工单加载失败"}</h2>
        <p>{error?.message ?? "未能读取工单详情"}</p>
        <div className="state-actions">
          <a className="button ghost" href="#/tickets">
            返回队列
          </a>
          <button
            className="button primary"
            type="button"
            onClick={() => {
              setIsLoading(true);
              setError(null);
              setDetail(null);
              setReloadKey((value) => value + 1);
            }}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const { ticket, history, comments } = detail;
  const isSupervisor = currentUser.role === "supervisor";
  const isOwnTicket = ticket.assignee?.id === currentUser.id;
  const canComment = isSupervisor || isOwnTicket;
  const canClaim =
    currentUser.role === "agent" &&
    ticket.status === "open" &&
    !ticket.assignee;
  const canAssign =
    isSupervisor && ticket.status === "open" && !ticket.assignee;
  const canReassign =
    isSupervisor && ticket.status === "in_progress" && Boolean(ticket.assignee);
  const statusActions: TicketStatus[] =
    !isOwnTicket || currentUser.role !== "agent"
      ? []
      : ticket.status === "in_progress"
        ? ["resolved"]
        : ticket.status === "resolved"
          ? ["in_progress", "closed"]
          : [];

  async function runMutation(operation: () => Promise<TicketDetail>) {
    setIsMutating(true);
    setActionError(null);
    try {
      const next = await operation();
      setDetail(next);
      setSelectedAssignee(next.ticket.assignee?.id ?? "");
      setCommentBody("");
    } catch (requestError: unknown) {
      setActionError(actionErrorMessage(requestError));
    } finally {
      setIsMutating(false);
    }
  }

  return (
    <section className="page-stack detail-page" aria-labelledby="ticket-title">
      <div className="detail-breadcrumb">
        <a href="#/tickets">工单队列</a>
        <span>/</span>
        <span>工单详情</span>
      </div>

      <div className="detail-hero">
        <div className="detail-title">
          <div className="detail-badges">
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
            {ticket.overdue && (
              <span className="badge overdue">SLA 已逾期</span>
            )}
          </div>
          <h2 id="ticket-title">{ticket.title}</h2>
          <p className="ticket-reference">工单 ID · {ticket.id}</p>
        </div>
        <a className="button ghost" href="#/tickets">
          返回队列
        </a>
      </div>

      {actionError && (
        <div className="inline-alert error" role="alert">
          <strong>操作未完成</strong>
          <span>{actionError}</span>
          <button
            type="button"
            className="alert-dismiss"
            onClick={() => setActionError(null)}
          >
            关闭
          </button>
        </div>
      )}

      <div className="detail-layout">
        <div className="detail-main">
          <article className="detail-card">
            <div className="card-heading">
              <h3>问题描述</h3>
              <span>由 {ticket.created_by.name} 创建</span>
            </div>
            <p className="description-copy">{ticket.description}</p>
          </article>

          {(canClaim ||
            canAssign ||
            canReassign ||
            statusActions.length > 0) && (
            <article className="detail-card action-card">
              <div className="card-heading">
                <h3>处理操作</h3>
                <span>后端会再次校验角色与状态</span>
              </div>
              <div className="action-toolbar">
                {canClaim && (
                  <button
                    className="button primary"
                    type="button"
                    disabled={isMutating}
                    onClick={() =>
                      runMutation(() => claimTicket(currentUser.id, ticket.id))
                    }
                  >
                    {isMutating ? "处理中…" : "领取工单"}
                  </button>
                )}
                {(canAssign || canReassign) && (
                  <div className="assignment-control">
                    <select
                      aria-label="选择处理人"
                      value={selectedAssignee}
                      disabled={isMutating}
                      onChange={(event) =>
                        setSelectedAssignee(event.target.value)
                      }
                    >
                      <option value="">选择客服</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button primary"
                      type="button"
                      disabled={isMutating || !selectedAssignee}
                      onClick={() =>
                        runMutation(() =>
                          canReassign
                            ? reassignTicket(
                                currentUser.id,
                                ticket.id,
                                selectedAssignee,
                              )
                            : assignTicket(
                                currentUser.id,
                                ticket.id,
                                selectedAssignee,
                              ),
                        )
                      }
                    >
                      {canReassign ? "确认改派" : "确认分配"}
                    </button>
                  </div>
                )}
                {statusActions.map((nextStatus) => (
                  <button
                    key={nextStatus}
                    className="button ghost"
                    type="button"
                    disabled={isMutating}
                    onClick={() =>
                      runMutation(() =>
                        changeTicketStatus(
                          currentUser.id,
                          ticket.id,
                          nextStatus,
                        ),
                      )
                    }
                  >
                    {nextStatus === "resolved"
                      ? "标记已解决"
                      : nextStatus === "closed"
                        ? "关闭工单"
                        : "重新打开处理"}
                  </button>
                ))}
              </div>
            </article>
          )}

          <article className="detail-card">
            <div className="card-heading">
              <h3>评论</h3>
              <span>{comments.length} 条</span>
            </div>
            {comments.length === 0 ? (
              <div className="history-empty">暂无评论</div>
            ) : (
              <div className="comment-list">
                {comments.map((comment) => (
                  <div className="comment-item" key={comment.id}>
                    <div className="comment-meta">
                      <strong>{comment.author.name}</strong>
                      <time dateTime={comment.created_at}>
                        {formatFullDateTime(comment.created_at)}
                      </time>
                    </div>
                    <p>{comment.body}</p>
                  </div>
                ))}
              </div>
            )}
            {canComment && (
              <form
                className="comment-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (commentBody.trim())
                    void runMutation(() =>
                      addTicketComment(currentUser.id, ticket.id, commentBody),
                    );
                }}
              >
                <label htmlFor="ticket-comment">添加评论</label>
                <textarea
                  id="ticket-comment"
                  value={commentBody}
                  maxLength={5000}
                  disabled={isMutating}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="记录处理进展或给团队的说明…"
                />
                <div className="form-actions">
                  <span className="field-hint">{commentBody.length}/5000</span>
                  <button
                    className="button primary"
                    type="submit"
                    disabled={isMutating || !commentBody.trim()}
                  >
                    发布评论
                  </button>
                </div>
              </form>
            )}
          </article>

          <article className="detail-card">
            <div className="card-heading">
              <h3>操作历史</h3>
              <span>{history.length} 条记录</span>
            </div>
            {history.length === 0 ? (
              <div className="history-empty">暂无操作历史</div>
            ) : (
              <ol className="timeline">
                {history.map((event) => (
                  <li key={event.id}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <div className="timeline-content">
                      <div>
                        <strong>
                          {eventTypeLabels[event.event_type] ??
                            event.event_type}
                        </strong>
                        <time dateTime={event.created_at}>
                          {formatFullDateTime(event.created_at)}
                        </time>
                      </div>
                      <p>
                        <b>{event.actor.name}</b> · {event.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </article>
        </div>

        <aside className="detail-sidebar" aria-label="工单属性">
          <article className="detail-card property-card">
            <h3>工单属性</h3>
            <dl className="property-list">
              <div>
                <dt>客户</dt>
                <dd>{ticket.customer_name}</dd>
              </div>
              <div>
                <dt>联系方式</dt>
                <dd>{ticket.customer_contact}</dd>
              </div>
              <div>
                <dt>当前处理人</dt>
                <dd>{ticket.assignee?.name ?? "未分配"}</dd>
              </div>
              <div>
                <dt>创建人</dt>
                <dd>{ticket.created_by.name}</dd>
              </div>
            </dl>
          </article>
          <article
            className={`detail-card sla-card ${ticket.overdue ? "overdue" : ""}`}
          >
            <div className="card-heading">
              <h3>SLA</h3>
              <span>{ticket.overdue ? "已逾期" : "按时限跟踪"}</span>
            </div>
            <dl className="property-list compact-list">
              <div>
                <dt>截止时间</dt>
                <dd>{formatFullDateTime(ticket.sla_due_at)}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{formatFullDateTime(ticket.created_at)}</dd>
              </div>
              <div>
                <dt>最后更新</dt>
                <dd>{formatFullDateTime(ticket.updated_at)}</dd>
              </div>
            </dl>
          </article>
          <article className="detail-card status-guide">
            <h3>状态说明</h3>
            <p>
              允许流转：open → in_progress → resolved →
              closed；已解决工单可回到处理中，但已关闭工单不可恢复。
            </p>
            <small>当前：{statusLabels[ticket.status]}</small>
          </article>
        </aside>
      </div>
    </section>
  );
}
