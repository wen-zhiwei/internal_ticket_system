import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
from psycopg.types.json import Jsonb


@dataclass(frozen=True)
class PendingActionRecord:
    id: str
    action_type: str
    payload: dict[str, Any]
    status: str
    expires_at: datetime
    result: dict[str, Any] | None = None


class PendingActionRepository:
    def __init__(self, database_url: str):
        self._database_url = database_url

    async def create(
        self,
        *,
        user_id: str,
        conversation_id: str,
        action_type: str,
        payload: dict[str, Any],
    ) -> PendingActionRecord:
        action_id = str(uuid4())
        async with await psycopg.AsyncConnection.connect(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    INSERT INTO assistant_pending_actions (
                        id, user_id, conversation_id, action_type, payload
                    ) VALUES (%s, %s, %s, %s, %s)
                    RETURNING id::text, action_type, payload, status, expires_at, result
                    """,
                    (
                        action_id,
                        UUID(user_id),
                        UUID(conversation_id),
                        action_type,
                        Jsonb(payload),
                    ),
                )
            ).fetchone()
        return self._record(row)

    async def claim(
        self, *, action_id: str, user_id: str, conversation_id: str
    ) -> PendingActionRecord:
        async with await psycopg.AsyncConnection.connect(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    UPDATE assistant_pending_actions
                    SET status = 'executing', updated_at = NOW()
                    WHERE id = %s AND user_id = %s AND conversation_id = %s
                      AND status = 'pending' AND expires_at > NOW()
                    RETURNING id::text, action_type, payload, status, expires_at, result
                    """,
                    (UUID(action_id), UUID(user_id), UUID(conversation_id)),
                )
            ).fetchone()
            if row is None:
                row = await (
                    await conn.execute(
                        """
                        SELECT id::text, action_type, payload, status, expires_at, result
                        FROM assistant_pending_actions
                        WHERE id = %s AND user_id = %s AND conversation_id = %s
                        """,
                        (UUID(action_id), UUID(user_id), UUID(conversation_id)),
                    )
                ).fetchone()
        if row is None:
            raise ValueError("待确认操作不存在")
        return self._record(row)

    async def complete(self, action_id: str, result: dict[str, Any]) -> None:
        await self._set_status(action_id, "completed", result)

    async def fail(self, action_id: str, result: dict[str, Any]) -> None:
        await self._set_status(action_id, "failed", result)

    async def cancel(
        self, *, action_id: str, user_id: str, conversation_id: str
    ) -> PendingActionRecord:
        async with await psycopg.AsyncConnection.connect(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    UPDATE assistant_pending_actions
                    SET status = 'cancelled', updated_at = NOW()
                    WHERE id = %s AND user_id = %s AND conversation_id = %s
                      AND status = 'pending'
                    RETURNING id::text, action_type, payload, status, expires_at, result
                    """,
                    (UUID(action_id), UUID(user_id), UUID(conversation_id)),
                )
            ).fetchone()
        if row is None:
            raise ValueError("该操作不存在，或已经处理")
        return self._record(row)

    async def _set_status(self, action_id: str, status: str, result: dict[str, Any]) -> None:
        async with await psycopg.AsyncConnection.connect(self._database_url) as conn:
            await conn.execute(
                """
                UPDATE assistant_pending_actions
                SET status = %s, result = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (status, Jsonb(result), UUID(action_id)),
            )

    @staticmethod
    def _record(row: tuple[Any, ...]) -> PendingActionRecord:
        payload = row[2]
        result = row[5]
        if isinstance(payload, str):
            payload = json.loads(payload)
        if isinstance(result, str):
            result = json.loads(result)
        return PendingActionRecord(
            id=row[0],
            action_type=row[1],
            payload=payload,
            status=row[3],
            expires_at=row[4],
            result=result,
        )
