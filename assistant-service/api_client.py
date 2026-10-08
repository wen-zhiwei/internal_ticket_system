from typing import Any
from urllib.parse import quote

import httpx


class TicketAPIError(RuntimeError):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class TicketAPI:
    def __init__(self, base_url: str, timeout: float = 30.0):
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout)

    async def close(self) -> None:
        await self._client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        user_id: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = await self._client.request(
            method,
            f"{self._base_url}{path}",
            headers={"X-User-ID": user_id},
            params=params,
            json=json,
        )
        if response.is_error:
            try:
                payload = response.json()
            except ValueError:
                payload = {}
            error_payload = payload.get("error", payload) if isinstance(payload, dict) else {}
            raise TicketAPIError(
                response.status_code,
                str(error_payload.get("code", "ticket_api_error")),
                str(error_payload.get("message", "工单服务暂时不可用")),
            )
        return response.json()

    async def search(self, user_id: str, params: dict[str, Any]) -> dict[str, Any]:
        return await self.request("GET", "/tickets", user_id, params=params)

    async def detail(self, user_id: str, ticket_id: str) -> dict[str, Any]:
        return await self.request("GET", f"/tickets/{quote(ticket_id)}", user_id)

    async def users(self, user_id: str, *, role: str | None = None) -> dict[str, Any]:
        params = {"role": role} if role else None
        return await self.request("GET", "/users", user_id, params=params)

    async def create(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.request("POST", "/tickets", user_id, json=payload)

    async def update(self, user_id: str, ticket_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self.request("PATCH", f"/tickets/{quote(ticket_id)}", user_id, json=payload)

    async def change_status(self, user_id: str, ticket_id: str, status: str) -> dict[str, Any]:
        return await self.request(
            "PATCH",
            f"/tickets/{quote(ticket_id)}/status",
            user_id,
            json={"status": status},
        )

    async def assign(self, user_id: str, ticket_id: str, assignee_id: str) -> dict[str, Any]:
        return await self.request(
            "POST",
            f"/tickets/{quote(ticket_id)}/assign",
            user_id,
            json={"assignee_id": assignee_id},
        )

    async def reassign(self, user_id: str, ticket_id: str, assignee_id: str) -> dict[str, Any]:
        return await self.request(
            "POST",
            f"/tickets/{quote(ticket_id)}/reassign",
            user_id,
            json={"assignee_id": assignee_id},
        )
