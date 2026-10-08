import json
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic import BaseModel, Field, field_validator

from api_client import TicketAPI
from config import get_settings
from conversation_context import ConversationContextRepository
from graph import build_graph
from pending_actions import PendingActionRepository
from runtime import AssistantContext, current_context


class UserContext(BaseModel):
    id: str
    name: str
    role: str
    team: str = ""

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        return str(UUID(value))


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    user: UserContext

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("消息不能为空")
        return value

    @field_validator("conversation_id")
    @classmethod
    def validate_conversation_id(cls, value: str | None) -> str | None:
        return str(UUID(value)) if value else None


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    card: dict[str, Any] | None = None


settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    ticket_api = TicketAPI(settings.go_api_base_url, settings.assistant_request_timeout_seconds)
    pending_actions = PendingActionRepository(settings.database_url)
    conversation_context = ConversationContextRepository(settings.database_url)
    async with AsyncPostgresSaver.from_conn_string(settings.database_url) as checkpointer:
        await checkpointer.setup()
        app.state.graph = build_graph(settings, checkpointer)
        app.state.ticket_api = ticket_api
        app.state.pending_actions = pending_actions
        app.state.conversation_context = conversation_context
        yield
    await ticket_api.close()


app = FastAPI(title="Internal Ticket Assistant Service", lifespan=lifespan)


def verify_service_token(authorization: str | None = Header(default=None)) -> None:
    expected = settings.assistant_service_token.strip()
    if not expected:
        return
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未授权")


@app.get("/health")
async def health(request: Request) -> dict[str, str]:
    configured = "ready" if request.app.state.graph is not None else "model_not_configured"
    return {"status": "ok", "assistant": configured}


@app.post("/chat", response_model=ChatResponse, dependencies=[Depends(verify_service_token)])
async def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    graph = request.app.state.graph
    if graph is None:
        raise HTTPException(status_code=503, detail="模型服务尚未配置")

    conversation_id = payload.conversation_id or str(uuid4())
    context = AssistantContext(
        user_id=payload.user.id,
        user_name=payload.user.name,
        user_role=payload.user.role,
        user_team=payload.user.team,
        conversation_id=conversation_id,
        user_message=payload.message,
        ticket_api=request.app.state.ticket_api,
        pending_actions=request.app.state.pending_actions,
        conversation_context=request.app.state.conversation_context,
    )
    stored_context = await request.app.state.conversation_context.get(
        user_id=payload.user.id,
        conversation_id=conversation_id,
    )
    token = current_context.set(context)
    try:
        result = await graph.ainvoke(
            {"messages": [HumanMessage(content=payload.message)]},
            config={
                "configurable": {"thread_id": f"{payload.user.id}:{conversation_id}"},
                "recursion_limit": 16,
            },
            context={"assistant_context": stored_context},
        )
    except Exception as error:
        raise HTTPException(status_code=503, detail="助手暂时无法完成请求") from error
    finally:
        current_context.reset(token)

    turn_messages = _current_turn_messages(result.get("messages", []))
    tool_payload = _last_tool_payload(turn_messages)
    tool_error_payload = _last_tool_error_payload(turn_messages)
    reply = (
        str(tool_error_payload["reply"])
        if tool_error_payload and tool_error_payload.get("reply")
        else _last_ai_text(turn_messages)
    )
    if not reply and tool_payload and tool_payload.get("reply"):
        reply = str(tool_payload["reply"])
    if not reply:
        reply = "我暂时无法整理这次结果，请换一种说法再试。"
    return ChatResponse(
        reply=reply,
        conversation_id=conversation_id,
        card=tool_payload.get("card") if tool_payload else None,
    )


def _current_turn_messages(messages: list[Any]) -> list[Any]:
    for index in range(len(messages) - 1, -1, -1):
        if isinstance(messages[index], HumanMessage):
            return messages[index:]
    return messages


def _last_ai_text(messages: list[Any]) -> str:
    for message in reversed(messages):
        if isinstance(message, AIMessage):
            content = message.content
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                texts = [
                    str(block.get("text", ""))
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                return "".join(texts).strip()
    return ""


def _last_tool_payload(messages: list[Any]) -> dict[str, Any] | None:
    for message in reversed(messages):
        if not isinstance(message, ToolMessage):
            continue
        content = message.content
        if not isinstance(content, str):
            continue
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and ("reply" in payload or "card" in payload):
            return payload
    return None


def _last_tool_error_payload(messages: list[Any]) -> dict[str, Any] | None:
    for message in reversed(messages):
        if not isinstance(message, ToolMessage) or message.status != "error":
            continue
        content = message.content
        if not isinstance(content, str):
            continue
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("reply"):
            return payload
    return None
