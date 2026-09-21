import type { TicketPriority, TicketStatus } from "../api/tickets";
import { priorityLabels, statusLabels } from "../domain/tickets";

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span className={`ticket-meta priority-${priority}`}>
      {priorityLabels[priority]}
    </span>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`ticket-meta status-${status}`}>
      {statusLabels[status]}
    </span>
  );
}
