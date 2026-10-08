import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

import main
from graph import context_instruction
from main import ChatRequest, UserContext

USER_ID = "00000000-0000-0000-0000-000000000001"


def test_chat_request_normalizes_message_and_validates_user():
    payload = ChatRequest(
        message="  查一下我的工单  ",
        user=UserContext(id=USER_ID, name="王芳", role="agent"),
    )
    assert payload.message == "查一下我的工单"


def test_chat_returns_503_when_model_is_not_configured():
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(graph=None)))
    payload = ChatRequest(
        message="查一下我的工单",
        user=UserContext(id=USER_ID, name="王芳", role="agent"),
    )

    with pytest.raises(HTTPException) as caught:
        asyncio.run(main.chat(payload, request))

    assert caught.value.status_code == 503


def test_service_token_is_checked(monkeypatch):
    monkeypatch.setattr(
        main,
        "settings",
        SimpleNamespace(assistant_service_token="service-secret"),
    )

    with pytest.raises(HTTPException) as caught:
        main.verify_service_token("Bearer wrong")

    assert caught.value.status_code == 401
    main.verify_service_token("Bearer service-secret")


def test_only_extracts_tool_card_from_current_turn():
    old_payload = json.dumps({"reply": "旧结果", "card": {"type": "ticket_list", "items": []}})
    messages = [
        HumanMessage(content="查工单"),
        ToolMessage(content=old_payload, tool_call_id="old"),
        AIMessage(content="旧回复"),
        HumanMessage(content="谢谢"),
        AIMessage(content="不客气"),
    ]

    current = main._current_turn_messages(messages)

    assert main._last_ai_text(current) == "不客气"
    assert main._last_tool_payload(current) is None


def test_extracts_structured_card_from_current_turn():
    payload = {"reply": "找到 1 张工单", "card": {"type": "ticket_list"}}
    messages = [
        HumanMessage(content="查今天的工单"),
        AIMessage(content="", tool_calls=[]),
        ToolMessage(content=json.dumps(payload), tool_call_id="current"),
        AIMessage(content="已查询"),
    ]

    current = main._current_turn_messages(messages)

    assert main._last_tool_payload(current) == payload


class FakeConversationContext:
    async def get(self, **kwargs):
        return {
            "last_ticket_items": [
                {
                    "id": "10000000-0000-0000-0000-000000000001",
                    "title": "重复扣费",
                    "customer_name": "123",
                    "status": "open",
                }
            ]
        }


class FakeGraph:
    async def ainvoke(self, state, config, context):
        assert context["assistant_context"]["last_ticket_items"][0]["id"]
        human = state["messages"][-1]
        tool_payload = json.dumps(
            {
                "reply": "找到 5 张工单。",
                "card": {"type": "ticket_list", "items": []},
            }
        )
        return {
            "messages": [
                human,
                ToolMessage(content=tool_payload, tool_call_id="current"),
                AIMessage(content="找到多张重复扣费工单，请选择客户是 123 的那张。"),
            ]
        }


def test_chat_prefers_models_final_clarification_over_tool_reply():
    state = SimpleNamespace(
        graph=FakeGraph(),
        ticket_api=SimpleNamespace(),
        pending_actions=SimpleNamespace(),
        conversation_context=FakeConversationContext(),
    )
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    payload = ChatRequest(
        message="把重复扣费的工单改成已解决",
        conversation_id="20000000-0000-0000-0000-000000000001",
        user=UserContext(id=USER_ID, name="王芳", role="agent"),
    )

    response = asyncio.run(main.chat(payload, request))

    assert response.reply == "找到多张重复扣费工单，请选择客户是 123 的那张。"
    assert response.card == {"type": "ticket_list", "items": []}


def test_context_instruction_preserves_ticket_position_and_id():
    text = context_instruction(
        {
            "last_ticket_items": [
                {
                    "id": "ticket-1",
                    "title": "重复扣费",
                    "customer_name": "123",
                    "status": "open",
                }
            ],
            "last_pending_action_id": "action-1",
        }
    )

    assert '"position": 1' in text
    assert '"id": "ticket-1"' in text
    assert '"最近待确认操作ID": "action-1"' in text


class FakeErrorGraph:
    async def ainvoke(self, state, config, context):
        human = state["messages"][-1]
        error_payload = json.dumps(
            {"reply": "操作未完成：当前状态不允许这样修改（invalid_status_transition）"}
        )
        return {
            "messages": [
                human,
                ToolMessage(
                    content=error_payload,
                    tool_call_id="failed",
                    status="error",
                ),
                AIMessage(content="工单服务暂时不可用，请稍后再试。"),
            ]
        }


def test_chat_prefers_exact_tool_error_over_model_rewrite():
    state = SimpleNamespace(
        graph=FakeErrorGraph(),
        ticket_api=SimpleNamespace(),
        pending_actions=SimpleNamespace(),
        conversation_context=FakeConversationContext(),
    )
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    payload = ChatRequest(
        message="确认执行",
        conversation_id="20000000-0000-0000-0000-000000000001",
        user=UserContext(id=USER_ID, name="王芳", role="agent"),
    )

    response = asyncio.run(main.chat(payload, request))

    assert response.reply == "操作未完成：当前状态不允许这样修改（invalid_status_transition）"
