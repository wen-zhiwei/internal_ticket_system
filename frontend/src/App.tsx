import { useEffect, useMemo, useState } from "react";
import { ApiError } from "./api/client";
import { getCurrentUser, listUsers, type User } from "./api/users";
import { NewTicketPage } from "./pages/NewTicketPage";
import { TicketDetailPage } from "./pages/TicketDetailPage";
import { TicketQueue } from "./pages/TicketQueue";

const CURRENT_USER_KEY = "internal_ticket_system.current-user-id";

type Route =
  | { page: "tickets" }
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
  if (path === "new-ticket") return { page: "new-ticket" };
  const match = path.match(/^tickets\/([^/]+)$/);
  if (match) {
    return { page: "ticket-detail", ticketId: decodeURIComponent(match[1]) };
  }
  return { page: "tickets" };
}

function routeTitle(route: Route) {
  if (route.page === "new-ticket") return "新建工单";
  if (route.page === "ticket-detail") return "工单详情";
  return "工单队列";
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

  function handleUserChange(userId: string) {
    setIdentityError(null);
    setCurrentUser(null);
    setCurrentUserId(userId);
    window.localStorage.setItem(CURRENT_USER_KEY, userId);
  }

  const activePage = route.page === "ticket-detail" ? "tickets" : route.page;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">H</span>
          <div>
            <strong>Internal Ticket System</strong>
            <small>客服协作平台</small>
          </div>
        </div>
        <nav className="nav" aria-label="主导航">
          <a
            className={`nav-item ${activePage === "tickets" ? "active" : ""}`}
            href="#/tickets"
          >
            <span aria-hidden="true">▤</span>
            工单队列
          </a>
          <a
            className={`nav-item ${activePage === "new-ticket" ? "active" : ""}`}
            href="#/new-ticket"
          >
            <span aria-hidden="true">＋</span>
            新建工单
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" />
          本地演示环境
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">客服工作台</p>
            <h1>{routeTitle(route)}</h1>
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
              <div className="identity-banner">
                <span className={`role-chip ${currentUser.role}`}>
                  {roleLabel(currentUser.role)}
                </span>
                <p>
                  当前以 <strong>{currentUser.name}</strong>{" "}
                  操作；权限由后端根据 PostgreSQL 中的角色校验。
                </p>
              </div>
              {route.page === "tickets" && (
                <TicketQueue
                  key={currentUser.id}
                  currentUser={currentUser}
                  agents={agents}
                />
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
            </>
          )}
      </main>
    </div>
  );
}
