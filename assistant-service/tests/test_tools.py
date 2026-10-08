import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace

from runtime import current_context
from tools import (
    ALL_TOOLS,
    confirm_pending_action,
    prepare_assign_ticket,
    prepare_bulk_action,
    prepare_create_ticket,
    search_tickets,
    search_users,
)

USER_ID = "00000000-0000-0000-0000-000000000001"
CONVERSATION_ID = "20000000-0000-0000-0000-000000000001"
ACTION_ID = "30000000-0000-0000-0000-000000000001"
ASSIGNEE_ID = "00000000-0000-0000-0000-000000000002"
TICKET_ID = "10000000-0000-0000-0000-000000000001"


def ticket(**overrides):
    value = {
        "id": TICKET_ID,
        "title": "接驾失败",
        "description": "车辆已到达但车门无法打开",
        "customer_name": "王先生",
        "customer_contact": "13900000000",
        "priority": "urgent",
        "status": "open",
        "assignee": None,
    }
    value.update(overrides)
    return value


class FakeTicketAPI:
    def __init__(self):
        self.search_params = None
        self.status_changes = []
        self.assignments = []
        self.reassignments = []
        self.created = []
        self.items = [ticket()]
        self.user_items = [
            {
                "id": ASSIGNEE_ID,
                "name": "李娜",
                "team": "自动驾驶客服二组",
                "role": "agent",
            }
        ]

    async def search(self, user_id, params):
        assert user_id == USER_ID
        self.search_params = params
        return {"total": len(self.items), "items": self.items}

    async def detail(self, user_id, ticket_id):
        assert user_id == USER_ID
        item = next(item for item in self.items if item["id"] == ticket_id)
        return {"ticket": item, "comments": [], "history": []}

    async def users(self, user_id, *, role=None):
        assert user_id == USER_ID
        assert role == "agent"
        return {"items": self.user_items}

    async def create(self, user_id, payload):
        assert user_id == USER_ID
        self.created.append(payload)
        created = ticket(**payload)
        self.items = [created]
        return {"ticket": created, "comments": [], "history": []}

    async def assign(self, user_id, ticket_id, assignee_id):
        self.assignments.append((user_id, ticket_id, assignee_id))
        assigned = ticket(
            id=ticket_id,
            status="in_progress",
            assignee={"id": assignee_id, "name": "李娜", "team": "自动驾驶客服二组"},
        )
        self.items = [assigned]
        return {"ticket": assigned, "comments": [], "history": []}

    async def reassign(self, user_id, ticket_id, assignee_id):
        self.reassignments.append((user_id, ticket_id, assignee_id))
        return await self.assign(user_id, ticket_id, assignee_id)

    async def update(self, user_id, ticket_id, payload):
        return {}

    async def change_status(self, user_id, ticket_id, status):
        self.status_changes.append((user_id, ticket_id, status))
        return {}


class FakeConversationContext:
    def __init__(self):
        self.values = {}

    async def merge(self, **kwargs):
        assert kwargs["user_id"] == USER_ID
        assert kwargs["conversation_id"] == CONVERSATION_ID
        self.values.update(kwargs["values"])
        return self.values


class FakePendingActions:
    def __init__(self, record=None):
        self.record = record
        self.created = []
        self.completed = []
        self.failed = []

    async def create(self, **kwargs):
        self.created.append(kwargs)
        return SimpleNamespace(
            id=ACTION_ID,
            action_type=kwargs["action_type"],
            payload=kwargs["payload"],
            status="pending",
            expires_at=datetime.now(UTC),
        )

    async def claim(self, **kwargs):
        assert kwargs == {
            "action_id": ACTION_ID,
            "user_id": USER_ID,
            "conversation_id": CONVERSATION_ID,
        }
        return self.record

    async def complete(self, action_id, result):
        self.completed.append((action_id, result))

    async def fail(self, action_id, result):
        self.failed.append((action_id, result))


def run_tool(
    tool,
    arguments,
    *,
    ticket_api=None,
    pending_actions=None,
    conversation_context=None,
    user_message="",
):
    context = SimpleNamespace(
        user_id=USER_ID,
        user_name="王芳",
        user_role="agent",
        user_team="自动驾驶客服一组",
        conversation_id=CONVERSATION_ID,
        user_message=user_message,
        ticket_api=ticket_api or FakeTicketAPI(),
        pending_actions=pending_actions or FakePendingActions(),
        conversation_context=conversation_context or FakeConversationContext(),
    )
    token = current_context.set(context)
    try:
        return asyncio.run(tool.ainvoke(arguments))
    finally:
        current_context.reset(token)


def test_registers_exactly_ten_tools():
    assert [item.name for item in ALL_TOOLS] == [
        "search_tickets",
        "get_ticket_detail",
        "search_users",
        "prepare_create_ticket",
        "prepare_update_ticket",
        "prepare_assign_ticket",
        "prepare_change_status",
        "prepare_bulk_action",
        "confirm_pending_action",
        "cancel_pending_action",
    ]


def test_prepare_create_ticket_returns_missing_fields():
    payload = json.loads(
        run_tool(
            prepare_create_ticket,
            {"title": "订单重复扣费", "description": "客户反馈重复扣费"},
        )
    )

    assert payload["card"]["type"] == "ticket_draft"
    assert payload["card"]["draft"]["missing_fields"] == [
        "customer_name",
        "customer_contact",
    ]


def test_complete_create_ticket_becomes_pending_action():
    pending = FakePendingActions()
    payload = json.loads(
        run_tool(
            prepare_create_ticket,
            {
                "title": "订单重复扣费",
                "description": "客户反馈重复扣费",
                "customer_name": "演示客户",
                "customer_contact": "13800000000",
                "priority": "high",
            },
            pending_actions=pending,
        )
    )

    assert payload["card"]["type"] == "pending_action"
    assert payload["card"]["action"]["action_type"] == "create_ticket"
    assert pending.created[0]["action_type"] == "create_ticket"
    assert pending.created[0]["payload"]["input"]["priority"] == "high"


def test_search_tickets_maps_filters_and_remembers_order():
    api = FakeTicketAPI()
    memory = FakeConversationContext()
    payload = json.loads(
        run_tool(
            search_tickets,
            {"mine": True, "status": "pending", "date_range": "this_week"},
            ticket_api=api,
            conversation_context=memory,
        )
    )

    assert api.search_params["assignee_id"] == USER_ID
    assert api.search_params["status"] == "pending"
    assert "created_from" in api.search_params
    assert "created_to" in api.search_params
    assert payload["card"]["type"] == "ticket_list"
    assert memory.values["last_ticket_items"][0]["id"] == TICKET_ID


def test_search_users_filters_by_name_and_team():
    memory = FakeConversationContext()
    payload = json.loads(
        run_tool(
            search_users,
            {"q": "李娜", "team": "二组"},
            conversation_context=memory,
        )
    )

    assert payload["card"]["type"] == "user_list"
    assert payload["card"]["users"][0]["id"] == ASSIGNEE_ID
    assert memory.values["last_user_items"][0]["name"] == "李娜"


def test_prepare_assign_ticket_creates_confirmation_without_mutating():
    api = FakeTicketAPI()
    pending = FakePendingActions()
    payload = json.loads(
        run_tool(
            prepare_assign_ticket,
            {"ticket_id": TICKET_ID, "assignee_id": ASSIGNEE_ID},
            ticket_api=api,
            pending_actions=pending,
        )
    )

    assert payload["card"]["action"]["action_type"] == "assign_ticket"
    assert pending.created[0]["payload"]["mode"] == "assign"
    assert api.assignments == []


def test_bulk_action_rejects_an_unbounded_request():
    payload = json.loads(
        run_tool(
            prepare_bulk_action,
            {},
            user_message="批量修改所有工单",
        )
    )

    assert "至少一个筛选条件" in payload["reply"]


def test_confirm_create_and_assign_executes_once_and_remembers_ticket():
    action = SimpleNamespace(
        id=ACTION_ID,
        action_type="create_ticket",
        payload={
            "input": {
                "title": "重复扣费",
                "description": "客户重复扣费 38 元",
                "customer_name": "张先生",
                "customer_contact": "13800000000",
                "priority": "high",
            },
            "assignee": {
                "id": ASSIGNEE_ID,
                "name": "李娜",
                "team": "自动驾驶客服二组",
            },
            "items": [],
        },
        status="executing",
        expires_at=datetime.now(UTC),
    )
    pending = FakePendingActions(action)
    api = FakeTicketAPI()
    memory = FakeConversationContext()

    payload = json.loads(
        run_tool(
            confirm_pending_action,
            {"action_id": ACTION_ID},
            ticket_api=api,
            pending_actions=pending,
            conversation_context=memory,
        )
    )

    assert payload["reply"] == "工单已创建，并分配给 李娜。"
    assert api.assignments == [(USER_ID, TICKET_ID, ASSIGNEE_ID)]
    assert memory.values["last_created_ticket_id"] == TICKET_ID
    assert len(pending.completed) == 1


def test_completed_action_is_idempotent():
    record = SimpleNamespace(
        id=ACTION_ID,
        action_type="change_status",
        payload={"ticket_id": TICKET_ID, "status": "resolved", "items": []},
        status="completed",
        expires_at=datetime.now(UTC),
    )
    pending = FakePendingActions(record)
    api = FakeTicketAPI()

    payload = json.loads(
        run_tool(
            confirm_pending_action,
            {"action_id": ACTION_ID},
            ticket_api=api,
            pending_actions=pending,
        )
    )

    assert payload["reply"] == "该操作已经完成，无需重复执行。"
    assert api.status_changes == []
    assert pending.completed == []


def test_bulk_action_without_explicit_bulk_language_degrades_to_selection():
    pending = FakePendingActions()
    memory = FakeConversationContext()
    payload = json.loads(
        run_tool(
            prepare_bulk_action,
            {"q": "重复扣费", "status": "resolved"},
            pending_actions=pending,
            conversation_context=memory,
            user_message="把重复扣费的工单改成已解决",
        )
    )

    assert payload["card"]["type"] == "ticket_list"
    assert payload["card"]["title"] == "请选择工单"
    assert pending.created == []
    assert memory.values["last_ticket_items"][0]["id"] == TICKET_ID


def test_bulk_action_accepts_explicit_all_language():
    pending = FakePendingActions()
    payload = json.loads(
        run_tool(
            prepare_bulk_action,
            {"q": "重复扣费", "status": "resolved"},
            pending_actions=pending,
            user_message="把所有重复扣费工单改成已解决",
        )
    )

    assert payload["card"]["action"]["action_type"] == "bulk_change_status"
    assert pending.created[0]["action_type"] == "bulk_change_status"


def test_all_tools_handle_runtime_and_validation_errors():
    assert all(tool.handle_tool_error for tool in ALL_TOOLS)
    assert all(tool.handle_validation_error for tool in ALL_TOOLS)
