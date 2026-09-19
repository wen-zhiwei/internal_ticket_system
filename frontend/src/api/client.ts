const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api";

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { userId?: string } = {},
): Promise<T> {
  const { userId, headers, ...requestOptions } = options;
  const requestHeaders = new Headers(headers);
  requestHeaders.set("Accept", "application/json");
  if (requestOptions.body && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  if (userId) {
    requestHeaders.set("X-User-ID", userId);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...requestOptions,
    headers: requestHeaders,
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = getErrorBody(payload);
    throw new ApiError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ?? "请求失败，请稍后重试",
      error?.fields,
    );
  }
  return payload as T;
}

type ErrorBody = {
  code?: string;
  message?: string;
  fields?: Record<string, string>;
};

function getErrorBody(value: unknown): ErrorBody | undefined {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return undefined;
  }
  const error = value.error;
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const fields =
    "fields" in error && isStringRecord(error.fields)
      ? error.fields
      : undefined;
  return {
    code:
      "code" in error && typeof error.code === "string"
        ? error.code
        : undefined,
    message:
      "message" in error && typeof error.message === "string"
        ? error.message
        : undefined,
    fields,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
