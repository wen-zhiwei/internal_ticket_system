import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  addTicketComment,
  assignTicket,
  changeTicketStatus,
  claimTicket,
  getTicket,
  reassignTicket,
  updateTicket,
  type TicketDetail,
  type UpdateTicketInput,
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

const emptyEditForm: UpdateTicketInput = {
  title: "",
  description: "",
  customer_name: "",
  customer_contact: "",
  priority: "normal",
};

function ticketToEditForm(ticket: TicketDetail["ticket"]): UpdateTicketInput {
  return {
    title: ticket.title,
    description: ticket.description,
    customer_name: ticket.customer_name,
    customer_contact: ticket.customer_contact,
    priority: ticket.priority,
  };
}

function validateEditForm(form: UpdateTicketInput) {
  const errors: Record<string, string> = {};
  const fields: Array<[keyof UpdateTicketInput, string, number]> = [
    ["title", "标题", 200],
    ["description", "问题描述", 10000],
    ["customer_name", "客户名称", 100],
    ["customer_contact", "联系方式", 200],
  ];
  for (const [field, label, maximum] of fields) {
    const value = form[field].trim();
    if (!value) errors[field] = `${label}不能为空`;
    else if ([...value].length > maximum) {
      errors[field] = `${label}不能超过 ${maximum} 个字符`;
    }
  }
  return errors;
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
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [isAssigneePickerOpen, setIsAssigneePickerOpen] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<UpdateTicketInput>(emptyEditForm);
  const [editFieldErrors, setEditFieldErrors] = useState<
    Record<string, string>
  >({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getTicket(currentUser.id, ticketId)
      .then((response) => {
        if (!cancelled) {
          setDetail(response);
          setSelectedAssignee(response.ticket.assignee?.id ?? "");
          setEditForm(ticketToEditForm(response.ticket));
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
            返回工单中心
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
  const canEdit = ticket.status !== "closed" && (isSupervisor || isOwnTicket);
  const canComment = isSupervisor || isOwnTicket;
  const canClaim =
    currentUser.role === "agent" &&
    ticket.status === "open" &&
    !ticket.assignee;
  const canAssign =
    isSupervisor && ticket.status === "open" && !ticket.assignee;
  const canReassign =
    isSupervisor && ticket.status === "in_progress" && Boolean(ticket.assignee);
  const normalizedAssigneeQuery = assigneeQuery.trim().toLowerCase();
  const filteredAgents = agents.filter((agent) => {
    if (!normalizedAssigneeQuery) return true;
    return `${agent.name} ${agent.team}`
      .toLowerCase()
      .includes(normalizedAssigneeQuery);
  });
  const selectedAgent = agents.find((agent) => agent.id === selectedAssignee);
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
      setEditForm(ticketToEditForm(next.ticket));
      setCommentBody("");
      setAssigneeQuery("");
      setIsAssigneePickerOpen(false);
    } catch (requestError: unknown) {
      setActionError(actionErrorMessage(requestError));
    } finally {
      setIsMutating(false);
    }
  }

  function updateEditField(field: keyof UpdateTicketInput, value: string) {
    setEditForm((current) => ({ ...current, [field]: value }));
    setEditFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function beginEdit() {
    setEditForm(ticketToEditForm(ticket));
    setEditFieldErrors({});
    setActionError(null);
    setIsEditing(true);
  }

  function cancelEdit() {
    setEditForm(ticketToEditForm(ticket));
    setEditFieldErrors({});
    setIsEditing(false);
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validateEditForm(editForm);
    if (Object.keys(errors).length > 0) {
      setEditFieldErrors(errors);
      setActionError("请先修正编辑表单中的问题");
      return;
    }

    setIsMutating(true);
    setActionError(null);
    setEditFieldErrors({});
    try {
      const next = await updateTicket(currentUser.id, ticket.id, {
        ...editForm,
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        customer_name: editForm.customer_name.trim(),
        customer_contact: editForm.customer_contact.trim(),
      });
      setDetail(next);
      setEditForm(ticketToEditForm(next.ticket));
      setIsEditing(false);
    } catch (requestError: unknown) {
      setActionError(actionErrorMessage(requestError));
    } finally {
      setIsMutating(false);
    }
  }

  return (
    <section className="page-stack detail-page" aria-labelledby="ticket-title">
      <div className="detail-breadcrumb">
        <a href="#/tickets">工单中心</a>
        <span>/</span>
        <span>工单详情</span>
      </div>

      <div className="detail-hero">
        <div className="detail-title">
          <div className="detail-badges">
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
            {ticket.overdue && (
              <span className="ticket-meta overdue">SLA 已逾期</span>
            )}
          </div>
          <h2 id="ticket-title">{ticket.title}</h2>
          <p className="ticket-reference">工单 ID · {ticket.id}</p>
          <div className="detail-key-facts" aria-label="工单关键信息">
            <div>
              <span>当前处理人</span>
              <strong>{ticket.assignee?.name ?? "未分配"}</strong>
              <small>{ticket.assignee?.team ?? "等待分配"}</small>
            </div>
            <div>
              <span>客户</span>
              <strong>{ticket.customer_name}</strong>
              <small>{ticket.customer_contact}</small>
            </div>
            <div>
              <span>SLA 截止</span>
              <strong className={ticket.overdue ? "overdue-text" : ""}>
                {formatFullDateTime(ticket.sla_due_at)}
              </strong>
              <small>
                {ticket.overdue ? "已逾期，需优先处理" : "按时限跟踪"}
              </small>
            </div>
          </div>
        </div>
        <div className="detail-hero-actions">
          {canEdit && !isEditing && (
            <button className="button ghost" type="button" onClick={beginEdit}>
              编辑工单
            </button>
          )}
          <a className="button ghost" href="#/tickets">
            返回工单中心
          </a>
        </div>
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
          {isEditing ? (
            <article className="detail-card edit-card">
              <div className="card-heading">
                <h3>编辑工单</h3>
                <span>保存后写入操作历史</span>
              </div>
              <form
                className="edit-form"
                noValidate
                onSubmit={handleEditSubmit}
              >
                <label className="field full-width">
                  <span>工单标题</span>
                  <input
                    aria-invalid={Boolean(editFieldErrors.title)}
                    maxLength={200}
                    value={editForm.title}
                    onChange={(event) =>
                      updateEditField("title", event.target.value)
                    }
                  />
                  <small
                    className={
                      editFieldErrors.title ? "field-error" : "field-help"
                    }
                  >
                    {editFieldErrors.title ??
                      `${[...editForm.title].length}/200`}
                  </small>
                </label>
                <label className="field full-width">
                  <span>问题描述</span>
                  <textarea
                    aria-invalid={Boolean(editFieldErrors.description)}
                    maxLength={10000}
                    rows={7}
                    value={editForm.description}
                    onChange={(event) =>
                      updateEditField("description", event.target.value)
                    }
                  />
                  <small
                    className={
                      editFieldErrors.description ? "field-error" : "field-help"
                    }
                  >
                    {editFieldErrors.description ??
                      `${[...editForm.description].length}/10000`}
                  </small>
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>客户名称</span>
                    <input
                      aria-invalid={Boolean(editFieldErrors.customer_name)}
                      maxLength={100}
                      value={editForm.customer_name}
                      onChange={(event) =>
                        updateEditField("customer_name", event.target.value)
                      }
                    />
                    <small
                      className={
                        editFieldErrors.customer_name
                          ? "field-error"
                          : "field-help"
                      }
                    >
                      {editFieldErrors.customer_name ??
                        `${[...editForm.customer_name].length}/100`}
                    </small>
                  </label>
                  <label className="field">
                    <span>联系方式</span>
                    <input
                      aria-invalid={Boolean(editFieldErrors.customer_contact)}
                      maxLength={200}
                      value={editForm.customer_contact}
                      onChange={(event) =>
                        updateEditField("customer_contact", event.target.value)
                      }
                    />
                    <small
                      className={
                        editFieldErrors.customer_contact
                          ? "field-error"
                          : "field-help"
                      }
                    >
                      {editFieldErrors.customer_contact ??
                        `${[...editForm.customer_contact].length}/200`}
                    </small>
                  </label>
                </div>
                <label className="field">
                  <span>优先级</span>
                  <select
                    value={editForm.priority}
                    onChange={(event) =>
                      updateEditField(
                        "priority",
                        event.target.value as UpdateTicketInput["priority"],
                      )
                    }
                  >
                    <option value="urgent">紧急</option>
                    <option value="high">高</option>
                    <option value="normal">普通</option>
                    <option value="low">低</option>
                  </select>
                </label>
                <div className="form-actions">
                  <span>当前用户：{currentUser.name}</span>
                  <div>
                    <button
                      className="button ghost"
                      type="button"
                      disabled={isMutating}
                      onClick={cancelEdit}
                    >
                      取消
                    </button>
                    <button
                      className="button primary"
                      type="submit"
                      disabled={isMutating}
                    >
                      {isMutating ? "保存中…" : "保存修改"}
                    </button>
                  </div>
                </div>
              </form>
            </article>
          ) : (
            <article className="detail-card">
              <div className="card-heading">
                <h3>问题描述</h3>
                <span>由 {ticket.created_by.name} 创建</span>
              </div>
              <p className="description-copy">{ticket.description}</p>
            </article>
          )}

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
                  <button
                    className="button ghost assignment-toggle"
                    type="button"
                    disabled={isMutating}
                    aria-expanded={isAssigneePickerOpen}
                    aria-controls="ticket-assignment-panel"
                    onClick={() => {
                      setIsAssigneePickerOpen((open) => !open);
                      setAssigneeQuery("");
                    }}
                  >
                    {isAssigneePickerOpen
                      ? "收起选择"
                      : canReassign
                        ? "改派处理人"
                        : "分配处理人"}
                  </button>
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
              {(canAssign || canReassign) && isAssigneePickerOpen && (
                <div
                  className="assignment-control"
                  id="ticket-assignment-panel"
                >
                  <div className="assignment-picker">
                    <label htmlFor="ticket-assignee-search">
                      {canReassign ? "选择新的处理人" : "选择处理人"}
                    </label>
                    <input
                      id="ticket-assignee-search"
                      aria-label="搜索处理人或团队"
                      placeholder="搜索姓名或团队"
                      value={assigneeQuery}
                      disabled={isMutating}
                      onChange={(event) => setAssigneeQuery(event.target.value)}
                    />
                    <div
                      className="assignee-options"
                      role="listbox"
                      aria-label="可选处理人"
                    >
                      {filteredAgents.map((agent) => (
                        <button
                          className={`assignee-option ${selectedAssignee === agent.id ? "selected" : ""}`}
                          key={agent.id}
                          type="button"
                          role="option"
                          aria-selected={selectedAssignee === agent.id}
                          onClick={() => {
                            setSelectedAssignee(agent.id);
                            setAssigneeQuery("");
                          }}
                        >
                          <span>
                            <strong>{agent.name}</strong>
                            <small>{agent.team}</small>
                          </span>
                          {selectedAssignee === agent.id && (
                            <span aria-hidden="true">已选</span>
                          )}
                        </button>
                      ))}
                      {filteredAgents.length === 0 && (
                        <div className="assignee-empty">
                          没有找到匹配的客服或团队
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="selected-assignee" aria-live="polite">
                    <span>本次选择</span>
                    <strong>{selectedAgent?.name ?? "尚未选择"}</strong>
                    <small>{selectedAgent?.team ?? "请选择一位客服"}</small>
                  </div>
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
            </article>
          )}

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

        <aside className="detail-sidebar" aria-label="评论与工单属性">
          <article className="detail-card comment-card">
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
                <dd>
                  {ticket.assignee?.name ?? "未分配"}
                  {ticket.assignee?.team && (
                    <small className="property-subvalue">
                      {ticket.assignee.team}
                    </small>
                  )}
                </dd>
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
