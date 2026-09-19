import type { TicketPriority, TicketStatus } from "../api/tickets";
import { priorityLabels, statusLabels } from "../domain/tickets";

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span className={`badge priority-${priority}`}>
      {priorityLabels[priority]}
    </span>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`badge status-${status}`}>{statusLabels[status]}</span>
  );
}
