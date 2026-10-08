import json
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb


class ConversationContextRepository:
    def __init__(self, database_url: str):
        self._database_url = database_url

    async def get(self, *, user_id: str, conversation_id: str) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    SELECT context
                    FROM assistant_conversation_context
                    WHERE user_id = %s AND conversation_id = %s
                    """,
                    (UUID(user_id), UUID(conversation_id)),
                )
            ).fetchone()
        if row is None:
            return {}
        value = row[0]
        return json.loads(value) if isinstance(value, str) else dict(value)

    async def merge(
        self,
        *,
        user_id: str,
        conversation_id: str,
        values: dict[str, Any],
    ) -> dict[str, Any]:
        async with await psycopg.AsyncConnection.connect(self._database_url) as conn:
            row = await (
                await conn.execute(
                    """
                    INSERT INTO assistant_conversation_context (
                        user_id, conversation_id, context
                    ) VALUES (%s, %s, %s)
                    ON CONFLICT (user_id, conversation_id) DO UPDATE
                    SET context = assistant_conversation_context.context || EXCLUDED.context,
                        updated_at = NOW()
                    RETURNING context
                    """,
                    (UUID(user_id), UUID(conversation_id), Jsonb(values)),
                )
            ).fetchone()
        value = row[0]
        return json.loads(value) if isinstance(value, str) else dict(value)
