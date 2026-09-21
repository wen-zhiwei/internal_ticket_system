import type { TicketOverview as TicketOverviewData } from "../api/overview";
import type { TicketPriority, TicketStatusFilter } from "../api/tickets";

type Selection = {
  status?: TicketStatusFilter;
  priority?: TicketPriority;
  overdue?: boolean;
};

type Props = {
  data: TicketOverviewData | null;
  isLoading: boolean;
  error: string | null;
  onSelect: (selection: Selection) => void;
  onRetry: () => void;
};

const statusItems: Array<{
  key: keyof TicketOverviewData["by_status"];
  label: string;
  status: TicketStatusFilter;
}> = [
  { key: "open", label: "待领取", status: "open" },
  { key: "in_progress", label: "处理中", status: "in_progress" },
  { key: "resolved", label: "已解决", status: "resolved" },
  { key: "closed", label: "已关闭", status: "closed" },
];

export function TicketOverview({
  data,
  isLoading,
  error,
  onSelect,
  onRetry,
}: Props) {
  return (
    <section className="overview-section" aria-labelledby="overview-heading">
      <div className="overview-heading">
        <div>
          <h2 id="overview-heading">今日工作概览</h2>
        </div>
        <span className="overview-caption">数据按当前账号可见范围统计</span>
      </div>

      {error ? (
        <div className="overview-state error" role="alert">
          <span>{error}</span>
          <button
            className="button ghost compact"
            type="button"
            onClick={onRetry}
          >
            重试
          </button>
        </div>
      ) : (
        <>
          <div className="overview-cards">
            <button
              className="overview-card"
              type="button"
              onClick={() => onSelect({})}
            >
              <span>全部工单</span>
              <strong>{isLoading ? "—" : (data?.total ?? 0)}</strong>
              <small>当前可查看的全部记录</small>
            </button>
            <button
              className="overview-card"
              type="button"
              onClick={() => onSelect({ status: "pending" })}
            >
              <span>待处理</span>
              <strong>{isLoading ? "—" : (data?.pending ?? 0)}</strong>
              <small>待领取或正在处理</small>
            </button>
            <button
              className="overview-card"
              type="button"
              onClick={() => onSelect({ priority: "urgent" })}
            >
              <span>紧急工单</span>
              <strong>{isLoading ? "—" : (data?.urgent ?? 0)}</strong>
              <small>优先处理风险较高的事项</small>
            </button>
            <button
              className="overview-card"
              type="button"
              onClick={() => onSelect({ overdue: true })}
            >
              <span>SLA 需关注</span>
              <strong>{isLoading ? "—" : (data?.sla_attention ?? 0)}</strong>
              <small>已超过处理时限且未完成</small>
            </button>
          </div>

          <div className="overview-status" aria-label="工单状态分布">
            <span className="overview-status-title">状态分布</span>
            {statusItems.map((item) => (
              <button
                className="overview-status-item"
                key={item.key}
                type="button"
                onClick={() => onSelect({ status: item.status })}
              >
                <span>{item.label}</span>
                <strong>
                  {isLoading ? "—" : (data?.by_status[item.key] ?? 0)}
                </strong>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export type { Selection as TicketOverviewSelection };
