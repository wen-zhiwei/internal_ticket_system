export type AssistantMemory = {
  default_date_range: "this_week" | "today" | "last_7_days";
  timezone: string;
  favorite_view: string;
  preferred_reply_style: "简洁" | "详细";
};

const DEFAULT_MEMORY: AssistantMemory = {
  default_date_range: "this_week",
  timezone: "Asia/Shanghai",
  favorite_view: "all",
  preferred_reply_style: "简洁",
};

function storageKey(userId: string) {
  return `internal_ticket_system.assistant-memory.${userId}`;
}

export function loadAssistantMemory(userId: string): AssistantMemory {
  if (!userId) return { ...DEFAULT_MEMORY };

  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULT_MEMORY };
    const parsed = JSON.parse(raw) as Partial<AssistantMemory>;
    return {
      ...DEFAULT_MEMORY,
      ...parsed,
      default_date_range:
        parsed.default_date_range === "today" ||
        parsed.default_date_range === "last_7_days" ||
        parsed.default_date_range === "this_week"
          ? parsed.default_date_range
          : DEFAULT_MEMORY.default_date_range,
      preferred_reply_style:
        parsed.preferred_reply_style === "详细" ? "详细" : "简洁",
    };
  } catch {
    return { ...DEFAULT_MEMORY };
  }
}

export function rememberAssistantMemory(
  userId: string,
  patch: Partial<AssistantMemory>,
) {
  if (!userId) return;
  const next = { ...loadAssistantMemory(userId), ...patch };
  window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
}

export { DEFAULT_MEMORY };
