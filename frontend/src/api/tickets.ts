import { apiRequest } from "./client";

export type TicketPriority = "urgent" | "high" | "normal" | "low";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketSortField =
  "created_at" | "updated_at" | "priority" | "sla_due_at";
export type TicketSortDirection = "asc" | "desc";

export type UserSummary = {
  id: string;
  name: string;
};

export type Ticket = {
  id: string;
  title: string;
  description: string;
  customer_name: string;
  customer_contact: string;
  priority: TicketPriority;
  status: TicketStatus;
  assignee: UserSummary | null;
  created_by: UserSummary;
  sla_due_at: string;
  overdue: boolean;
  created_at: string;
  updated_at: string;
};

export type TicketEvent = {
  id: number;
  actor: UserSummary;
  event_type: string;
  description: string;
  created_at: string;
};

export type TicketDetail = {
  ticket: Ticket;
  comments: TicketComment[];
  history: TicketEvent[];
};

export type TicketListResponse = {
  items: Ticket[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export type TicketListFilters = {
  q?: string;
  status?: TicketStatus | "";
  priority?: TicketPriority | "";
  assigneeId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: TicketSortField;
  sortDirection?: TicketSortDirection;
};

export type CreateTicketInput = {
  title: string;
  description: string;
  customer_name: string;
  customer_contact: string;
  priority: TicketPriority;
};

export function listTickets(
  userId: string,
  filters: TicketListFilters,
): Promise<TicketListResponse> {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.status) query.set("status", filters.status);
  if (filters.priority) query.set("priority", filters.priority);
  if (filters.assigneeId) query.set("assignee_id", filters.assigneeId);
  query.set("page", String(filters.page ?? 1));
  query.set("page_size", String(filters.pageSize ?? 20));
  if (filters.sortBy) query.set("sort_by", filters.sortBy);
  if (filters.sortDirection) query.set("sort_direction", filters.sortDirection);
  return apiRequest<TicketListResponse>(`/tickets?${query.toString()}`, {
    userId,
  });
}

export function getTicket(
  userId: string,
  ticketId: string,
): Promise<TicketDetail> {
  return apiRequest<TicketDetail>(`/tickets/${encodeURIComponent(ticketId)}`, {
    userId,
  });
}

export function createTicket(
  userId: string,
  input: CreateTicketInput,
): Promise<TicketDetail> {
  return apiRequest<TicketDetail>("/tickets", {
    method: "POST",
    body: JSON.stringify(input),
    userId,
  });
}

export type TicketComment = {
  id: number;
  author: UserSummary;
  body: string;
  created_at: string;
};

export type TicketActionInput = {
  assignee_id: string;
};

export function claimTicket(
  userId: string,
  ticketId: string,
): Promise<TicketDetail> {
  return apiRequest<TicketDetail>(
    `/tickets/${encodeURIComponent(ticketId)}/claim`,
    { method: "POST", userId },
  );
}

export function assignTicket(
  userId: string,
  ticketId: string,
  assigneeId: string,
): Promise<TicketDetail> {
  return apiRequest<TicketDetail>(
    `/tickets/${encodeURIComponent(ticketId)}/assign`,
    {
      method: "POST",
      body: JSON.stringify({ assignee_id: assigneeId }),
      userId,
    },
  );
}

export function reassignTicket(
  userId: string,
  ticketId: string,
  assigneeId: string,
): Promise<TicketDetail> {
  return apiRequest<TicketDetail>(
    `/tickets/${encodeURIComponent(ticketId)}/reassign`,
    {
      method: "POST",
      body: JSON.stringify({ assignee_id: assigneeId }),
      userId,
    },
  );
}

export function changeTicketStatus(
  userId: string,
  ticketId: string,
  status: TicketStatus,
): Promise<TicketDetail> {
  return apiRequest<TicketDetail>(
    `/tickets/${encodeURIComponent(ticketId)}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
      userId,
    },
  );
}

export function addTicketComment(
  userId: string,
  ticketId: string,
  body: string,
): Promise<TicketDetail> {
  return apiRequest<TicketDetail>(
    `/tickets/${encodeURIComponent(ticketId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
      userId,
    },
  );
}
