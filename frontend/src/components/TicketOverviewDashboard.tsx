import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { getTicketOverview, type TicketOverview } from "../api/overview";
import type { User } from "../api/users";
import {
  TicketOverview as TicketOverviewPanel,
  type TicketOverviewSelection,
} from "./TicketOverview";

export const OVERVIEW_FILTER_EVENT = "ticket-overview-filter";

type Props = {
  currentUser: User;
};

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : "无法读取工作概览，请确认 Go API 与 PostgreSQL 已启动";
}

export function TicketOverviewDashboard({ currentUser }: Props) {
  const [data, setData] = useState<TicketOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getTicketOverview(currentUser.id)
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setError(null);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setError(errorMessage(requestError));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.id, reloadKey]);

  useEffect(() => {
    const reload = () => setReloadKey((value) => value + 1);
    window.addEventListener("ticket-created", reload);
    return () => window.removeEventListener("ticket-created", reload);
  }, []);

  function select(selection: TicketOverviewSelection) {
    window.dispatchEvent(
      new CustomEvent<TicketOverviewSelection>(OVERVIEW_FILTER_EVENT, {
        detail: selection,
      }),
    );
  }

  return (
    <div className="workspace-overview">
      <TicketOverviewPanel
        data={data}
        isLoading={isLoading}
        error={error}
        onSelect={select}
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    </div>
  );
}
