import { useEffect, useMemo, useState } from "react";
import { ApiError } from "./api/client";
import { getCurrentUser, listUsers, type User } from "./api/users";
import { NewTicketPage } from "./pages/NewTicketPage";
import { TicketDetailPage } from "./pages/TicketDetailPage";
import { TicketQueue } from "./pages/TicketQueue";
import {
  AssistantConversation,
  AssistantWidget,
} from "./components/AssistantWidget";
import { AssistantHistory } from "./components/AssistantHistory";
import { TicketOverviewDashboard } from "./components/TicketOverviewDashboard";
import { currentGreeting } from "./domain/greeting";

const CURRENT_USER_KEY = "internal_ticket_system.current-user-id";
const SIDEBAR_COLLAPSED_KEY = "internal_ticket_system.sidebar-collapsed";

type Route =
  | { page: "tickets" }
  | { page: "assistant-history" }
  | { page: "new-ticket" }
  | { page: "ticket-detail"; ticketId: string };

function roleLabel(role: User["role"]) {
  return role === "supervisor" ? "Supervisor · 主管" : "Agent · 客服";
}

function getErrorMessage(requestError: unknown, fallback: string) {
  return requestError instanceof ApiError ? requestError.message : fallback;
}

function readRoute(): Route {
  const path = window.location.hash.replace(/^#\/?/, "");
  if (path === "assistant-history") return { page: "assistant-history" };
  if (path === "new-ticket") return { page: "new-ticket" };
  const match = path.match(/^tickets\/([^/]+)$/);
  if (match) {
    return { page: "ticket-detail", ticketId: decodeURIComponent(match[1]) };
  }
  return { page: "tickets" };
}

function routeTitle(route: Route) {
  if (route.page === "assistant-history") return "历史会话";
  if (route.page === "new-ticket") return "新建工单";
  if (route.page === "ticket-detail") return "工单详情";
  return "工单中心";
}

export function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState(
    () => window.localStorage.getItem(CURRENT_USER_KEY) ?? "",
  );
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [usersReloadKey, setUsersReloadKey] = useState(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  );
  const [selectedAssistantConversationId, setSelectedAssistantConversationId] =
    useState<string | null>(null);
  const [assistantHistoryRefreshKey, setAssistantHistoryRefreshKey] =
    useState(0);
  const [isHistoryAssistantOpen, setIsHistoryAssistantOpen] = useState(false);

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/tickets");
    }
    const handleHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    listUsers()
      .then((response) => {
        if (cancelled) return;
        setUsers(response.items);
        setUsersError(null);
        setIdentityError(null);
        setCurrentUserId((selectedId) => {
          const selectedStillExists = response.items.some(
            (user) => user.id === selectedId,
          );
          const nextId = selectedStillExists
            ? selectedId
            : (response.items[0]?.id ?? "");
          if (nextId) window.localStorage.setItem(CURRENT_USER_KEY, nextId);
          return nextId;
        });
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setUsersError(
          getErrorMessage(requestError, "无法连接 Go API，请先启动后端服务"),
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingUsers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [usersReloadKey]);

  useEffect(() => {
    if (!currentUserId || !users.some((user) => user.id === currentUserId)) {
      return;
    }

    let cancelled = false;
    getCurrentUser(currentUserId)
      .then((user) => {
        if (!cancelled) setCurrentUser(user);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setIdentityError(
          getErrorMessage(requestError, "无法读取当前用户，请稍后重试"),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, users]);

  const agents = useMemo(
    () => users.filter((user) => user.role === "agent"),
    [users],
  );
  const isLoadingIdentity =
    !isLoadingUsers &&
    Boolean(currentUserId) &&
    !identityError &&
    currentUser?.id !== currentUserId;

  function toggleSidebar() {
    setIsSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  function openAssistantConversation(conversationId: string) {
    setSelectedAssistantConversationId(conversationId);
    setIsHistoryAssistantOpen(true);
  }

  function startHistoryConversation() {
    setSelectedAssistantConversationId(null);
    setIsHistoryAssistantOpen(true);
  }

  function handleUserChange(userId: string) {
    setIdentityError(null);
    setCurrentUser(null);
    setSelectedAssistantConversationId(null);
    setIsHistoryAssistantOpen(false);
    setAssistantHistoryRefreshKey((value) => value + 1);
    setCurrentUserId(userId);
    window.localStorage.setItem(CURRENT_USER_KEY, userId);
  }

  return (
    <div
      className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="presentation">
              <path d="M7.5 18.5c1.6-3.1 3.8-5.2 6.6-6.3 2.4-.9 3.5-2.3 3.5-4.2 0-2.3-1.8-4-4.1-4-2.1 0-3.7 1.4-4 3.4" />
              <circle cx="9.2" cy="8.2" r="2.1" />
              <path d="M5 20h13" />
            </svg>
          </span>
          <div>
            <strong>客服协作工作台</strong>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={isSidebarCollapsed ? "展开目录栏" : "收起目录栏"}
            title={isSidebarCollapsed ? "展开目录栏" : "收起目录栏"}
            aria-expanded={!isSidebarCollapsed}
            onClick={toggleSidebar}
          >
            {isSidebarCollapsed ? "›" : "‹"}
          </button>
        </div>
        <nav className="nav" aria-label="主导航">
          <a
            className={`nav-item ${route.page === "tickets" ? "active" : ""}`}
            href="#/tickets"
          >
            <span aria-hidden="true">▤</span>
            <span className="nav-label">工单中心</span>
          </a>
          <a
            className={`nav-item ${route.page === "assistant-history" ? "active" : ""}`}
            href="#/assistant-history"
          >
            <span aria-hidden="true">◷</span>
            <span className="nav-label">历史会话</span>
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          <span className="sidebar-note-label">开发环境</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            {route.page === "tickets" && currentUser ? (
              <h1 className="greeting-title">
                {currentGreeting()}，{currentUser.name}，今天工作也要稳稳推进。
              </h1>
            ) : (
              <>
                {currentUser && (
                  <p className="welcome-line">
                    {currentGreeting()}，{currentUser.name}
                  </p>
                )}
                <h1>{routeTitle(route)}</h1>
              </>
            )}
          </div>
          <label className="identity-switcher">
            <span>当前用户</span>
            <select
              aria-label="切换当前用户"
              disabled={isLoadingUsers || users.length === 0}
              value={currentUserId}
              onChange={(event) => handleUserChange(event.target.value)}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} · {roleLabel(user.role)}
                </option>
              ))}
            </select>
          </label>
        </header>

        {isLoadingUsers && (
          <div className="state-card">正在从 Go API 加载演示用户…</div>
        )}
        {usersError && (
          <div className="state-card error" role="alert">
            <div>
              <strong>无法初始化工作台</strong>
              <span>{usersError}</span>
            </div>
            <button
              className="button ghost"
              type="button"
              onClick={() => {
                setIsLoadingUsers(true);
                setUsersError(null);
                setUsersReloadKey((value) => value + 1);
              }}
            >
              重试
            </button>
          </div>
        )}
        {!isLoadingUsers && !usersError && users.length === 0 && (
          <div className="state-card error" role="alert">
            <div>
              <strong>没有可用的演示用户</strong>
              <span>请先执行数据库迁移并写入演示用户。</span>
            </div>
          </div>
        )}
        {!isLoadingUsers && !usersError && identityError && (
          <div className="state-card error" role="alert">
            <div>
              <strong>身份确认失败</strong>
              <span>{identityError}</span>
            </div>
          </div>
        )}
        {!isLoadingUsers && !usersError && isLoadingIdentity && (
          <div className="state-card">正在从 Go API 确认当前用户身份…</div>
        )}
        {!isLoadingUsers &&
          !usersError &&
          !identityError &&
          !isLoadingIdentity &&
          currentUser && (
            <>
              {route.page === "tickets" && (
                <>
                  <TicketOverviewDashboard currentUser={currentUser} />
                  <div className="ticket-workspace" aria-label="客服协作工作区">
                    <div className="ticket-assistant-island">
                      <AssistantConversation
                        key={`assistant:${currentUser.id}`}
                        currentUser={currentUser}
                        embedded
                        selectedConversationId={selectedAssistantConversationId}
                        onConversationChange={
                          setSelectedAssistantConversationId
                        }
                        onHistoryChange={() =>
                          setAssistantHistoryRefreshKey((value) => value + 1)
                        }
                      />
                    </div>
                    <div className="ticket-center-island">
                      <TicketQueue
                        key={`tickets:${currentUser.id}`}
                        currentUser={currentUser}
                        agents={agents}
                      />
                    </div>
                  </div>
                </>
              )}
              {route.page === "assistant-history" && (
                <div className="assistant-history-page">
                  <AssistantHistory
                    key={`assistant-history:${currentUser.id}`}
                    currentUser={currentUser}
                    activeConversationId={selectedAssistantConversationId}
                    refreshKey={assistantHistoryRefreshKey}
                    onSelect={openAssistantConversation}
                    onNewConversation={startHistoryConversation}
                  />
                  {isHistoryAssistantOpen && (
                    <div className="assistant-history-widget">
                      <AssistantConversation
                        key={`history-assistant:${currentUser.id}:${selectedAssistantConversationId ?? "new"}`}
                        currentUser={currentUser}
                        selectedConversationId={selectedAssistantConversationId}
                        onClose={() => setIsHistoryAssistantOpen(false)}
                        onConversationChange={
                          setSelectedAssistantConversationId
                        }
                        onHistoryChange={() =>
                          setAssistantHistoryRefreshKey((value) => value + 1)
                        }
                      />
                    </div>
                  )}
                </div>
              )}
              {route.page === "new-ticket" && (
                <NewTicketPage key={currentUser.id} currentUser={currentUser} />
              )}
              {route.page === "ticket-detail" && (
                <TicketDetailPage
                  key={`${currentUser.id}:${route.ticketId}`}
                  currentUser={currentUser}
                  agents={agents}
                  ticketId={route.ticketId}
                />
              )}
              {route.page !== "tickets" &&
                route.page !== "assistant-history" && (
                  <AssistantWidget currentUser={currentUser} />
                )}
            </>
          )}
      </main>
    </div>
  );
}
