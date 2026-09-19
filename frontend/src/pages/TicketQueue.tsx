import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  listTickets,
  type TicketListFilters,
  type TicketListResponse,
} from "../api/tickets";
import type { User } from "../api/users";
import { PriorityBadge, StatusBadge } from "../components/TicketBadges";
import { formatDateTime } from "../domain/tickets";

type Props = {
  currentUser: User;
  agents: User[];
};

type FilterDraft = {
  q: string;
  status: NonNullable<TicketListFilters["status"]>;
  priority: NonNullable<TicketListFilters["priority"]>;
  assigneeId: string;
};

const initialDraft: FilterDraft = {
  q: "",
  status: "",
  priority: "",
  assigneeId: "",
};

const initialResult: TicketListResponse = {
  items: [],
  page: 1,
  page_size: 20,
  total: 0,
  total_pages: 0,
};

function requestErrorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "无法读取工单队列，请确认 Go API 与 PostgreSQL 已启动";
}

export function TicketQueue({ currentUser, agents }: Props) {
  const [draft, setDraft] = useState<FilterDraft>(initialDraft);
  const [filters, setFilters] = useState<TicketListFilters>({
    page: 1,
    pageSize: 20,
  });
  const [result, setResult] = useState<TicketListResponse>(initialResult);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    listTickets(currentUser.id, filters)
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(requestErrorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser.id, filters, reloadKey]);

  function startLoading() {
    setIsLoading(true);
    setError(null);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startLoading();
    setFilters({
      q: draft.q.trim(),
      status: draft.status,
      priority: draft.priority,
      assigneeId: draft.assigneeId,
      page: 1,
      pageSize: filters.pageSize,
    });
  }

  function resetFilters() {
    startLoading();
    setDraft(initialDraft);
    setFilters({ page: 1, pageSize: filters.pageSize });
  }

  function goToPage(page: number) {
    startLoading();
    setFilters((current) => ({ ...current, page }));
  }

  const visibilityText =
    currentUser.role === "supervisor"
      ? "主管视图：可查看全部工单，并按处理人筛选。"
      : "客服视图：仅显示可领取的未分配工单，以及分配给你的工单。";

  return (
    <section className="page-stack" aria-labelledby="queue-heading">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Ticket queue</p>
          <h2 id="queue-heading">工单队列</h2>
          <p>{visibilityText}</p>
        </div>
        <a className="button primary" href="#/new-ticket">
          <span aria-hidden="true">＋</span>
          新建工单
        </a>
      </div>

      <form className="filter-panel" onSubmit={applyFilters}>
        <label className="field search-field">
          <span>搜索</span>
          <input
            maxLength={100}
            placeholder="搜索标题或客户名称"
            value={draft.q}
            onChange={(event) =>
              setDraft((current) => ({ ...current, q: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>状态</span>
          <select
            value={draft.status}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                status: event.target.value as FilterDraft["status"],
              }))
            }
          >
            <option value="">全部状态</option>
            <option value="open">待领取</option>
            <option value="in_progress">处理中</option>
            <option value="resolved">已解决</option>
            <option value="closed">已关闭</option>
          </select>
        </label>
        <label className="field">
          <span>优先级</span>
          <select
            value={draft.priority}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                priority: event.target.value as FilterDraft["priority"],
              }))
            }
          >
            <option value="">全部优先级</option>
            <option value="urgent">紧急</option>
            <option value="high">高</option>
            <option value="normal">普通</option>
            <option value="low">低</option>
          </select>
        </label>
        <label className="field">
          <span>处理人</span>
          <select
            value={draft.assigneeId}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                assigneeId: event.target.value,
              }))
            }
          >
            <option value="">全部处理人</option>
            <option value="unassigned">未分配</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
                {agent.id === currentUser.id ? "（我）" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="filter-actions">
          <button className="button primary" type="submit">
            查询
          </button>
          <button className="button ghost" type="button" onClick={resetFilters}>
            重置
          </button>
        </div>
      </form>

      <div className="table-card">
        <div className="table-toolbar">
          <div>
            <strong>
              {isLoading ? "正在加载…" : `${result.total} 条工单`}
            </strong>
            <span>按创建时间倒序</span>
          </div>
          <label className="page-size">
            每页
            <select
              aria-label="每页工单数"
              value={filters.pageSize}
              onChange={(event) => {
                startLoading();
                setFilters((current) => ({
                  ...current,
                  page: 1,
                  pageSize: Number(event.target.value),
                }));
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            条
          </label>
        </div>

        {error && (
          <div className="inline-state error" role="alert">
            <div>
              <strong>工单加载失败</strong>
              <p>{error}</p>
            </div>
            <button
              className="button ghost"
              type="button"
              onClick={() => {
                startLoading();
                setReloadKey((value) => value + 1);
              }}
            >
              重试
            </button>
          </div>
        )}

        {!error && isLoading && (
          <div className="inline-state">正在从 Go API 读取工单…</div>
        )}

        {!error && !isLoading && result.items.length === 0 && (
          <div className="inline-state empty">
            <span className="empty-icon small" aria-hidden="true">
              ✓
            </span>
            <div>
              <strong>没有符合条件的工单</strong>
              <p>可以调整筛选条件，或创建一张新工单。</p>
            </div>
          </div>
        )}

        {!error && !isLoading && result.items.length > 0 && (
          <div className="table-scroll">
            <table className="ticket-table">
              <thead>
                <tr>
                  <th>工单</th>
                  <th>客户</th>
                  <th>优先级</th>
                  <th>状态</th>
                  <th>处理人</th>
                  <th>SLA 截止</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td className="ticket-title-cell">
                      <a href={`#/tickets/${ticket.id}`}>{ticket.title}</a>
                      <span>{ticket.description}</span>
                    </td>
                    <td>
                      <strong className="cell-primary">
                        {ticket.customer_name}
                      </strong>
                      <span className="cell-secondary">
                        {ticket.customer_contact}
                      </span>
                    </td>
                    <td>
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td>
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td>{ticket.assignee?.name ?? "未分配"}</td>
                    <td>
                      <span className={ticket.overdue ? "overdue-text" : ""}>
                        {formatDateTime(ticket.sla_due_at)}
                      </span>
                      {ticket.overdue && (
                        <span className="overdue-flag">已逾期</span>
                      )}
                    </td>
                    <td>{formatDateTime(ticket.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!error && !isLoading && result.total > 0 && (
          <div className="pagination" aria-label="工单分页">
            <span>
              第 {result.page} / {Math.max(result.total_pages, 1)} 页
            </span>
            <div>
              <button
                className="button ghost compact"
                disabled={result.page <= 1}
                type="button"
                onClick={() => goToPage(result.page - 1)}
              >
                上一页
              </button>
              <button
                className="button ghost compact"
                disabled={result.page >= result.total_pages}
                type="button"
                onClick={() => goToPage(result.page + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
