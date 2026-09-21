import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  listTickets,
  type TicketListFilters,
  type TicketListResponse,
  type TicketSortDirection,
  type TicketSortField,
} from "../api/tickets";
import type { User } from "../api/users";
import { PriorityBadge, StatusBadge } from "../components/TicketBadges";
import type { TicketOverviewSelection } from "../components/TicketOverview";
import { OVERVIEW_FILTER_EVENT } from "../components/TicketOverviewDashboard";
import { formatDateTime } from "../domain/tickets";
import {
  loadAssistantMemory,
  rememberAssistantMemory,
} from "../domain/assistantMemory";

type Props = {
  currentUser: User;
  agents: User[];
};

type FilterDraft = {
  q: string;
  status: NonNullable<TicketListFilters["status"]>;
  priority: NonNullable<TicketListFilters["priority"]>;
  assigneeId: string;
  sortBy: TicketSortField;
  sortDirection: TicketSortDirection;
  overdue: boolean;
};

type SavedTicketView = {
  id: string;
  name: string;
  draft: FilterDraft;
};

function savedViewsKey(userId: string) {
  return `internal_ticket_system.ticket-views.${userId}`;
}

function readSavedViews(userId: string): SavedTicketView[] {
  try {
    const raw = window.localStorage.getItem(savedViewsKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedTicketView[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedViews(userId: string, views: SavedTicketView[]) {
  window.localStorage.setItem(savedViewsKey(userId), JSON.stringify(views));
}

function quickViews(currentUser: User): SavedTicketView[] {
  const base = { ...initialDraft };
  return [
    {
      id: "all",
      name: "全部工单",
      draft: { ...base },
    },
    {
      id: "my_pending",
      name: "我的待处理",
      draft: { ...base, status: "in_progress", assigneeId: currentUser.id },
    },
    {
      id: "unassigned",
      name: "待领取",
      draft: { ...base, status: "open", assigneeId: "unassigned" },
    },
    {
      id: "urgent",
      name: "高优先级",
      draft: { ...base, priority: "urgent" },
    },
    {
      id: "resolved",
      name: "已解决",
      draft: { ...base, status: "resolved" },
    },
  ];
}

function filtersFromDraft(
  draft: FilterDraft,
  pageSize: number,
): TicketListFilters {
  return {
    ...draft,
    page: 1,
    pageSize,
  };
}

const initialDraft: FilterDraft = {
  q: "",
  status: "",
  priority: "",
  assigneeId: "",
  sortBy: "created_at",
  sortDirection: "desc",
  overdue: false,
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
    : "无法读取工单，请确认 Go API 与 PostgreSQL 已启动";
}

export function TicketQueue({ currentUser, agents }: Props) {
  const availableQuickViews = quickViews(currentUser);
  const initialMemory = loadAssistantMemory(currentUser.id);
  const initialView = availableQuickViews.find(
    (view) => view.id === initialMemory.favorite_view,
  );
  const [savedViews, setSavedViews] = useState<SavedTicketView[]>(() =>
    readSavedViews(currentUser.id),
  );
  const [activeViewId, setActiveViewId] = useState(initialView?.id ?? "");
  const [draft, setDraft] = useState<FilterDraft>(
    initialView?.draft ?? initialDraft,
  );
  const [filters, setFilters] = useState<TicketListFilters>(() =>
    filtersFromDraft(initialView?.draft ?? initialDraft, 20),
  );
  const [result, setResult] = useState<TicketListResponse>(initialResult);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

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

  useEffect(() => {
    function handleTicketCreated() {
      // 新建工单默认是“待领取”，不能继续停留在“我的待处理”视图。
      setActiveViewId("all");
      setDraft(initialDraft);
      rememberAssistantMemory(currentUser.id, { favorite_view: "all" });
      setError(null);
      setIsLoading(true);
      setFilters(filtersFromDraft(initialDraft, filters.pageSize ?? 20));
      setReloadKey((value) => value + 1);
    }

    window.addEventListener("ticket-created", handleTicketCreated);
    return () =>
      window.removeEventListener("ticket-created", handleTicketCreated);
  }, [currentUser.id, filters.pageSize]);

  useEffect(() => {
    function handleOverviewFilter(event: Event) {
      const selection =
        (event as CustomEvent<TicketOverviewSelection>).detail ?? {};
      const nextDraft: FilterDraft = {
        ...initialDraft,
        ...selection,
        sortBy: selection.overdue ? "sla_due_at" : initialDraft.sortBy,
        sortDirection: selection.overdue ? "asc" : initialDraft.sortDirection,
      };
      setIsLoading(true);
      setError(null);
      setActiveViewId("");
      setDraft(nextDraft);
      setFilters(filtersFromDraft(nextDraft, filters.pageSize ?? 20));
    }
    window.addEventListener(OVERVIEW_FILTER_EVENT, handleOverviewFilter);
    return () =>
      window.removeEventListener(OVERVIEW_FILTER_EVENT, handleOverviewFilter);
  }, [filters.pageSize]);

  function applyView(view: SavedTicketView) {
    startLoading();
    setActiveViewId(view.id);
    setDraft(view.draft);
    setFilters(filtersFromDraft(view.draft, filters.pageSize ?? 20));
    rememberAssistantMemory(currentUser.id, { favorite_view: view.id });
  }

  function saveCurrentView() {
    const name = window.prompt("给当前查询起个名字，例如：我的高优先级");
    const trimmedName = name?.trim();
    if (!trimmedName) return;

    const view: SavedTicketView = {
      id: `saved-${Date.now()}`,
      name: trimmedName.slice(0, 30),
      draft: { ...draft },
    };
    const nextViews = [...savedViews, view];
    setSavedViews(nextViews);
    writeSavedViews(currentUser.id, nextViews);
    setActiveViewId(view.id);
    rememberAssistantMemory(currentUser.id, { favorite_view: view.id });
  }

  function deleteSavedView(viewId: string) {
    const nextViews = savedViews.filter((view) => view.id !== viewId);
    setSavedViews(nextViews);
    writeSavedViews(currentUser.id, nextViews);
    if (activeViewId === viewId) setActiveViewId("");
  }

  function startLoading() {
    setIsLoading(true);
    setError(null);
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startLoading();
    setActiveViewId("");
    setFilters({
      q: draft.q.trim(),
      status: draft.status,
      priority: draft.priority,
      assigneeId: draft.assigneeId,
      sortBy: draft.sortBy,
      sortDirection: draft.sortDirection,
      overdue: draft.overdue,
      page: 1,
      pageSize: filters.pageSize,
    });
  }

  function resetFilters() {
    startLoading();
    setActiveViewId("");
    setDraft(initialDraft);
    setFilters({
      page: 1,
      pageSize: filters.pageSize,
      sortBy: "created_at",
      sortDirection: "desc",
      overdue: false,
    });
  }

  function goToPage(page: number) {
    startLoading();
    setFilters((current) => ({ ...current, page }));
  }

  const selectedSavedView = savedViews.find((view) => view.id === activeViewId);

  return (
    <section className="page-stack" aria-label="工单列表">
      <div className="view-toolbar queue-toolbar" aria-label="工单视图">
        <label className="queue-view-picker">
          <span>视图</span>
          <select
            aria-label="切换工单视图"
            value={activeViewId}
            onChange={(event) => {
              const selectedView = [...availableQuickViews, ...savedViews].find(
                (view) => view.id === event.target.value,
              );
              if (selectedView) applyView(selectedView);
            }}
          >
            {activeViewId === "" && <option value="">当前筛选</option>}
            <optgroup label="常用视图">
              {availableQuickViews.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </optgroup>
            {savedViews.length > 0 && (
              <optgroup label="我的视图">
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button
          className="button ghost save-view-button"
          type="button"
          onClick={saveCurrentView}
        >
          保存视图
        </button>
        {selectedSavedView && (
          <button
            className="button ghost delete-view-button"
            type="button"
            onClick={() => deleteSavedView(selectedSavedView.id)}
          >
            删除视图
          </button>
        )}
        <a className="button primary queue-create-button" href="#/new-ticket">
          <span aria-hidden="true">＋</span>
          新建工单
        </a>
      </div>

      <form
        className={`filter-panel ${showAdvancedFilters ? "is-expanded" : ""}`}
        onSubmit={applyFilters}
      >
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
            <option value="pending">待处理</option>
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
        {showAdvancedFilters && (
          <>
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
            <label className="field">
              <span>排序字段</span>
              <select
                value={draft.sortBy}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sortBy: event.target.value as TicketSortField,
                  }))
                }
              >
                <option value="created_at">创建时间</option>
                <option value="updated_at">更新时间</option>
                <option value="priority">优先级</option>
                <option value="sla_due_at">SLA 截止</option>
              </select>
            </label>
            <label className="field">
              <span>排序方向</span>
              <select
                value={draft.sortDirection}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    sortDirection: event.target.value as TicketSortDirection,
                  }))
                }
              >
                <option value="desc">倒序</option>
                <option value="asc">正序</option>
              </select>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={draft.overdue}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    overdue: event.target.checked,
                  }))
                }
              />
              <span>只看已逾期</span>
            </label>
          </>
        )}
        <div className="filter-actions">
          <button
            aria-expanded={showAdvancedFilters}
            className="button ghost advanced-filter-toggle"
            type="button"
            onClick={() => setShowAdvancedFilters((visible) => !visible)}
          >
            {showAdvancedFilters ? "收起条件" : "更多条件"}
          </button>
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
            <span>
              按
              {filters.sortBy === "created_at"
                ? "创建时间"
                : filters.sortBy === "updated_at"
                  ? "更新时间"
                  : filters.sortBy === "priority"
                    ? "优先级"
                    : "SLA 截止"}
              {filters.sortDirection === "asc" ? "正序" : "倒序"}
            </span>
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
                    <td className="ticket-title-cell" data-label="工单">
                      <a href={`#/tickets/${ticket.id}`}>{ticket.title}</a>
                      <span>{ticket.description}</span>
                    </td>
                    <td data-label="客户">
                      <strong className="cell-primary">
                        {ticket.customer_name}
                      </strong>
                      <span className="cell-secondary">
                        {ticket.customer_contact}
                      </span>
                    </td>
                    <td data-label="优先级">
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td data-label="状态">
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td data-label="处理人">
                      {ticket.assignee?.name ?? "未分配"}
                    </td>
                    <td data-label="SLA 截止">
                      <span className={ticket.overdue ? "overdue-text" : ""}>
                        {formatDateTime(ticket.sla_due_at)}
                      </span>
                      {ticket.overdue && (
                        <span className="overdue-flag">已逾期</span>
                      )}
                    </td>
                    <td data-label="创建时间">
                      {formatDateTime(ticket.created_at)}
                    </td>
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
