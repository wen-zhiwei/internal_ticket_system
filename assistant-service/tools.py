import json
from datetime import datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from langchain_core.tools import ToolException, tool
from pydantic import BaseModel, Field

from api_client import TicketAPIError
from runtime import current_context

Priority = Literal["urgent", "high", "normal", "low"]
Status = Literal["open", "in_progress", "resolved", "closed"]
DateRange = Literal["today", "this_week", "last_7_days"]
BULK_REQUEST_MARKERS = ("全部", "所有", "批量", "这些", "它们", "都改", "统一")


def _result(reply: str, card: dict[str, Any] | None = None) -> str:
    payload: dict[str, Any] = {"reply": reply}
    if card is not None:
        payload["card"] = card
    return json.dumps(payload, ensure_ascii=False, default=str)


def _raise_api_error(error: TicketAPIError) -> None:
    raise ToolException(f"{error.code}: {error.message}") from error


def _date_params(date_range: DateRange | None) -> dict[str, str]:
    if date_range is None:
        return {}
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    if date_range == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif date_range == "this_week":
        start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    else:
        start = now - timedelta(days=7)
    return {"created_from": start.isoformat(), "created_to": now.isoformat()}


class SearchTicketsInput(BaseModel):
    q: str | None = Field(default=None, description="标题或客户名称关键词")
    status: Status | Literal["pending"] | None = Field(
        default=None, description="工单状态；用户说未处理、待处理或进行中时必须传 pending"
    )
    priority: Priority | None = None
    assignee_id: str | None = Field(default=None, description="处理人 UUID；未分配使用 unassigned")
    mine: bool = Field(default=False, description="只查询当前登录用户负责的工单")
    overdue: bool | None = None
    date_range: DateRange | None = Field(
        default=None, description="创建时间范围：今天、本周或最近 7 天"
    )
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=50)


@tool(args_schema=SearchTicketsInput)
async def search_tickets(
    q: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    assignee_id: str | None = None,
    mine: bool = False,
    overdue: bool | None = None,
    date_range: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> str:
    """查询工单。未处理、待处理或进行中使用 status=pending；我负责的使用 mine=true。"""
    context = current_context.get()
    params: dict[str, Any] = {"page": page, "page_size": page_size}
    if mine:
        assignee_id = context.user_id
    for key, value in {
        "q": q,
        "status": status,
        "priority": priority,
        "assignee_id": assignee_id,
        "overdue": overdue,
    }.items():
        if value is not None and value != "":
            params[key] = value
    params.update(_date_params(date_range))
    try:
        data = await context.ticket_api.search(context.user_id, params)
    except TicketAPIError as error:
        _raise_api_error(error)
    await context.conversation_context.merge(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        values={"last_ticket_items": data["items"]},
    )
    return _result(
        f"找到 {data['total']} 张工单。",
        {"type": "ticket_list", "title": "查询结果", "items": data["items"]},
    )


class SearchUsersInput(BaseModel):
    q: str | None = Field(default=None, description="人员姓名关键词")
    team: str | None = Field(default=None, description="团队关键词")


@tool(args_schema=SearchUsersInput)
async def search_users(q: str | None = None, team: str | None = None) -> str:
    """按姓名或团队查询可被分配工单的客服人员；分配前先用它获得用户 UUID。"""
    context = current_context.get()
    try:
        data = await context.ticket_api.users(context.user_id, role="agent")
    except TicketAPIError as error:
        _raise_api_error(error)
    q_text = (q or "").strip().casefold()
    team_text = (team or "").strip().casefold()
    items = [
        item
        for item in data.get("items", [])
        if (not q_text or q_text in str(item.get("name", "")).casefold())
        and (not team_text or team_text in str(item.get("team", "")).casefold())
    ]
    await context.conversation_context.merge(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        values={"last_user_items": items},
    )
    return _result(
        f"找到 {len(items)} 位客服。",
        {"type": "user_list", "title": "人员查询结果", "users": items},
    )


class TicketDetailInput(BaseModel):
    ticket_id: str = Field(description="工单 UUID")


@tool(args_schema=TicketDetailInput)
async def get_ticket_detail(ticket_id: str) -> str:
    """查看当前用户有权访问的一张工单的完整详情。"""
    context = current_context.get()
    try:
        detail = await context.ticket_api.detail(context.user_id, ticket_id)
    except TicketAPIError as error:
        _raise_api_error(error)
    await context.conversation_context.merge(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        values={"last_selected_ticket_id": ticket_id, "last_ticket_items": [detail["ticket"]]},
    )
    return _result(
        "已找到这张工单。",
        {
            "type": "ticket_detail",
            "title": detail["ticket"]["title"],
            "ticket": detail,
        },
    )


class CreateTicketDraftInput(BaseModel):
    title: str = ""
    description: str = ""
    customer_name: str = ""
    customer_contact: str = ""
    priority: Priority = "normal"
    assignee_id: str | None = Field(default=None, description="创建后要分配给的客服 UUID")


@tool(args_schema=CreateTicketDraftInput)
async def prepare_create_ticket(
    title: str = "",
    description: str = "",
    customer_name: str = "",
    customer_contact: str = "",
    priority: str = "normal",
    assignee_id: str | None = None,
) -> str:
    """整理新工单；缺字段时返回草稿，字段完整时生成待确认创建操作。"""
    context = current_context.get()
    draft = {
        "title": title.strip(),
        "description": description.strip(),
        "customer_name": customer_name.strip(),
        "customer_contact": customer_contact.strip(),
        "priority": priority,
    }
    missing = [
        field
        for field in ("title", "description", "customer_name", "customer_contact")
        if not draft[field]
    ]
    draft["missing_fields"] = missing
    await context.conversation_context.merge(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        values={"last_ticket_draft": draft},
    )
    if missing:
        return _result(
            "工单草稿已整理，还缺少必填信息，请补充后再创建。",
            {"type": "ticket_draft", "title": "工单草稿", "draft": draft},
        )

    assignee = None
    if assignee_id:
        try:
            users = await context.ticket_api.users(context.user_id, role="agent")
        except TicketAPIError as error:
            _raise_api_error(error)
        assignee = next(
            (item for item in users.get("items", []) if item.get("id") == assignee_id), None
        )
        if assignee is None:
            raise ToolException("指定的处理人不存在，请先查询人员")
    payload = {
        "input": {key: draft[key] for key in draft if key != "missing_fields"},
        "items": [],
    }
    if assignee:
        payload["assignee"] = assignee
    action = await context.pending_actions.create(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        action_type="create_ticket",
        payload=payload,
    )
    await _remember_pending_action(action.id, "create_ticket")
    summary = f"创建工单《{draft['title']}》"
    if assignee:
        summary += f"，并分配给 {assignee['name']}"
    return _result(
        "工单内容已整理，请确认后创建。",
        _pending_card(action.id, "create_ticket", summary, [], action.expires_at),
    )


class UpdateTicketDraftInput(BaseModel):
    ticket_id: str
    title: str | None = None
    description: str | None = None
    customer_name: str | None = None
    customer_contact: str | None = None
    priority: Priority | None = None


@tool(args_schema=UpdateTicketDraftInput)
async def prepare_update_ticket(
    ticket_id: str,
    title: str | None = None,
    description: str | None = None,
    customer_name: str | None = None,
    customer_contact: str | None = None,
    priority: str | None = None,
) -> str:
    """准备编辑一张工单；生成待确认操作，不立即修改。"""
    context = current_context.get()
    try:
        detail = await context.ticket_api.detail(context.user_id, ticket_id)
    except TicketAPIError as error:
        _raise_api_error(error)
    current = detail["ticket"]
    changes = {
        key: value.strip() if isinstance(value, str) else value
        for key, value in {
            "title": title,
            "description": description,
            "customer_name": customer_name,
            "customer_contact": customer_contact,
            "priority": priority,
        }.items()
        if value is not None
    }
    if not changes:
        raise ToolException("没有提供需要修改的字段")
    payload = {
        "ticket_id": ticket_id,
        "input": {
            key: changes.get(key, current[key])
            for key in (
                "title",
                "description",
                "customer_name",
                "customer_contact",
                "priority",
            )
        },
        "items": [current],
    }
    action = await context.pending_actions.create(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        action_type="update_ticket",
        payload=payload,
    )
    await context.conversation_context.merge(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        values={"last_selected_ticket_id": ticket_id},
    )
    await _remember_pending_action(action.id, "update_ticket")
    summary = f"编辑工单《{current['title']}》的 {len(changes)} 个字段"
    return _result(
        "已整理修改内容，请确认后执行。",
        _pending_card(action.id, "update_ticket", summary, [current], action.expires_at),
    )


class ChangeStatusDraftInput(BaseModel):
    ticket_id: str
    status: Status


@tool(args_schema=ChangeStatusDraftInput)
async def prepare_change_status(ticket_id: str, status: str) -> str:
    """准备修改一张工单的状态；生成待确认操作，不立即修改。"""
    context = current_context.get()
    try:
        detail = await context.ticket_api.detail(context.user_id, ticket_id)
    except TicketAPIError as error:
        _raise_api_error(error)
    ticket = detail["ticket"]
    action = await context.pending_actions.create(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        action_type="change_status",
        payload={"ticket_id": ticket_id, "status": status, "items": [ticket]},
    )
    await context.conversation_context.merge(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        values={"last_selected_ticket_id": ticket_id},
    )
    await _remember_pending_action(action.id, "change_status")
    summary = f"将工单《{ticket['title']}》改为 {status}"
    return _result(
        "状态修改已准备，请确认后执行。",
        _pending_card(action.id, "change_status", summary, [ticket], action.expires_at),
    )


class AssignTicketDraftInput(BaseModel):
    ticket_id: str = Field(description="要分配或改派的工单 UUID")
    assignee_id: str = Field(description="目标客服 UUID，必须来自 search_users")


@tool(args_schema=AssignTicketDraftInput)
async def prepare_assign_ticket(ticket_id: str, assignee_id: str) -> str:
    """准备把一张工单分配或改派给指定客服；只生成待确认操作。"""
    context = current_context.get()
    try:
        detail = await context.ticket_api.detail(context.user_id, ticket_id)
        users = await context.ticket_api.users(context.user_id, role="agent")
    except TicketAPIError as error:
        _raise_api_error(error)
    ticket = detail["ticket"]
    assignee = next(
        (item for item in users.get("items", []) if item.get("id") == assignee_id), None
    )
    if assignee is None:
        raise ToolException("指定的处理人不存在，请先查询人员")
    current_assignee = ticket.get("assignee")
    if current_assignee and current_assignee.get("id") == assignee_id:
        raise ToolException(f"该工单已经由 {assignee['name']} 处理")
    action = await context.pending_actions.create(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        action_type="assign_ticket",
        payload={
            "ticket_id": ticket_id,
            "assignee": assignee,
            "mode": "reassign" if current_assignee else "assign",
            "items": [ticket],
        },
    )
    await context.conversation_context.merge(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        values={"last_selected_ticket_id": ticket_id},
    )
    await _remember_pending_action(action.id, "assign_ticket")
    verb = "改派" if current_assignee else "分配"
    summary = f"将工单《{ticket['title']}》{verb}给 {assignee['name']}"
    return _result(
        f"{verb}操作已准备，请确认后执行。",
        _pending_card(action.id, "assign_ticket", summary, [ticket], action.expires_at),
    )


class BulkActionInput(BaseModel):
    ticket_ids: list[str] = Field(default_factory=list, description="明确选择的工单 UUID")
    status: Status = Field(default="resolved", description="批量设置的目标状态")
    q: str | None = None
    current_status: Status | Literal["pending"] | None = None
    priority: Priority | None = None
    assignee_id: str | None = None
    mine: bool = Field(default=False, description="只处理当前登录用户负责的工单")
    date_range: DateRange | None = None


@tool(args_schema=BulkActionInput)
async def prepare_bulk_action(
    ticket_ids: list[str] | None = None,
    status: str = "resolved",
    q: str | None = None,
    current_status: str | None = None,
    priority: str | None = None,
    assignee_id: str | None = None,
    mine: bool = False,
    date_range: str | None = None,
) -> str:
    """仅当用户明确要求全部、所有或批量处理时，准备批量状态修改并等待确认。"""
    context = current_context.get()
    explicit_bulk = any(marker in context.user_message for marker in BULK_REQUEST_MARKERS)
    if not ticket_ids and not any((q, current_status, priority, assignee_id, mine, date_range)):
        raise ToolException("批量操作必须提供工单编号或至少一个筛选条件")
    if mine:
        assignee_id = context.user_id
    items: list[dict[str, Any]] = []
    try:
        if ticket_ids:
            for ticket_id in ticket_ids[:50]:
                detail = await context.ticket_api.detail(context.user_id, ticket_id)
                items.append(detail["ticket"])
        else:
            params: dict[str, Any] = {"page": 1, "page_size": 50}
            for key, value in {
                "q": q,
                "status": current_status,
                "priority": priority,
                "assignee_id": assignee_id,
            }.items():
                if value:
                    params[key] = value
            params.update(_date_params(date_range))
            data = await context.ticket_api.search(context.user_id, params)
            items = data["items"]
    except TicketAPIError as error:
        _raise_api_error(error)
    if not items:
        return _result("没有找到可加入批量操作的工单。")
    if not explicit_bulk:
        await context.conversation_context.merge(
            user_id=context.user_id,
            conversation_id=context.conversation_id,
            values={"last_ticket_items": items},
        )
        return _result(
            f"找到 {len(items)} 张可能匹配的工单，请选择一张后再修改。",
            {"type": "ticket_list", "title": "请选择工单", "items": items},
        )
    action = await context.pending_actions.create(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        action_type="bulk_change_status",
        payload={
            "ticket_ids": [item["id"] for item in items],
            "status": status,
            "items": items,
        },
    )
    await _remember_pending_action(action.id, "bulk_change_status")
    summary = f"将 {len(items)} 张工单批量改为 {status}"
    return _result(
        "批量操作清单已准备，请核对后确认。",
        _pending_card(action.id, "bulk_change_status", summary, items, action.expires_at),
    )


class PendingActionInput(BaseModel):
    action_id: str = Field(description="待确认操作 UUID")


@tool(args_schema=PendingActionInput)
async def confirm_pending_action(action_id: str) -> str:
    """用户明确确认后，执行一项已经准备好的待处理操作。"""
    context = current_context.get()
    try:
        action = await context.pending_actions.claim(
            action_id=action_id,
            user_id=context.user_id,
            conversation_id=context.conversation_id,
        )
    except ValueError as error:
        raise ToolException(str(error)) from error
    if action.status == "completed":
        return _result("该操作已经完成，无需重复执行。")
    if action.status != "executing":
        raise ToolException(f"该操作当前状态为 {action.status}，不能执行")

    try:
        result = await _execute_action(action.action_type, action.payload)
    except TicketAPIError as error:
        await context.pending_actions.fail(
            action_id, {"code": error.code, "message": error.message}
        )
        _raise_api_error(error)
    await context.pending_actions.complete(action_id, result)
    items = result.get("items", action.payload.get("items", []))
    return _result(
        result["message"],
        _pending_card(
            action.id,
            action.action_type,
            result["message"],
            items,
            action.expires_at,
            status="completed",
        ),
    )


@tool(args_schema=PendingActionInput)
async def cancel_pending_action(action_id: str) -> str:
    """取消一项尚未执行的待确认操作。"""
    context = current_context.get()
    try:
        action = await context.pending_actions.cancel(
            action_id=action_id,
            user_id=context.user_id,
            conversation_id=context.conversation_id,
        )
    except ValueError as error:
        raise ToolException(str(error)) from error
    return _result(
        "已取消这项操作。",
        _pending_card(
            action.id,
            action.action_type,
            "操作已取消",
            action.payload.get("items", []),
            action.expires_at,
            status="cancelled",
        ),
    )


async def _execute_action(action_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    context = current_context.get()
    if action_type == "create_ticket":
        detail = await context.ticket_api.create(context.user_id, payload["input"])
        ticket = detail["ticket"]
        assignee = payload.get("assignee")
        if assignee:
            detail = await context.ticket_api.assign(context.user_id, ticket["id"], assignee["id"])
            ticket = detail["ticket"]
            message = f"工单已创建，并分配给 {assignee['name']}。"
        else:
            message = "工单已创建。"
        await context.conversation_context.merge(
            user_id=context.user_id,
            conversation_id=context.conversation_id,
            values={
                "last_created_ticket_id": ticket["id"],
                "last_selected_ticket_id": ticket["id"],
                "last_ticket_items": [ticket],
            },
        )
        return {
            "message": message,
            "completed": 1,
            "failed": 0,
            "ticket_id": ticket["id"],
            "items": [ticket],
        }
    if action_type == "update_ticket":
        await context.ticket_api.update(context.user_id, payload["ticket_id"], payload["input"])
        return {"message": "工单内容已更新。", "completed": 1, "failed": 0}
    if action_type == "change_status":
        await context.ticket_api.change_status(
            context.user_id, payload["ticket_id"], payload["status"]
        )
        return {"message": "工单状态已更新。", "completed": 1, "failed": 0}
    if action_type == "assign_ticket":
        method = (
            context.ticket_api.reassign
            if payload["mode"] == "reassign"
            else context.ticket_api.assign
        )
        detail = await method(context.user_id, payload["ticket_id"], payload["assignee"]["id"])
        ticket = detail["ticket"]
        await context.conversation_context.merge(
            user_id=context.user_id,
            conversation_id=context.conversation_id,
            values={"last_selected_ticket_id": ticket["id"], "last_ticket_items": [ticket]},
        )
        return {
            "message": f"工单已分配给 {payload['assignee']['name']}。",
            "completed": 1,
            "failed": 0,
            "items": [ticket],
        }
    if action_type == "bulk_change_status":
        completed = 0
        failures: list[dict[str, str]] = []
        for ticket_id in payload["ticket_ids"]:
            try:
                await context.ticket_api.change_status(
                    context.user_id, ticket_id, payload["status"]
                )
                completed += 1
            except TicketAPIError as error:
                failures.append(
                    {"ticket_id": ticket_id, "code": error.code, "message": error.message}
                )
        message = f"批量操作完成：成功 {completed} 张，失败 {len(failures)} 张。"
        return {
            "message": message,
            "completed": completed,
            "failed": len(failures),
            "failures": failures,
        }
    raise ToolException(f"不支持的操作类型：{action_type}")


async def _remember_pending_action(action_id: str, action_type: str) -> None:
    context = current_context.get()
    await context.conversation_context.merge(
        user_id=context.user_id,
        conversation_id=context.conversation_id,
        values={
            "last_pending_action_id": action_id,
            "last_pending_action_type": action_type,
        },
    )


def _pending_card(
    action_id: str,
    action_type: str,
    summary: str,
    items: list[dict[str, Any]],
    expires_at: datetime,
    *,
    status: str = "pending",
) -> dict[str, Any]:
    return {
        "type": "pending_action",
        "title": "待确认操作" if status == "pending" else "操作结果",
        "action": {
            "id": action_id,
            "action_type": action_type,
            "summary": summary,
            "status": status,
            "items": items,
            "expires_at": expires_at.isoformat(),
        },
    }


ALL_TOOLS = [
    search_tickets,
    get_ticket_detail,
    search_users,
    prepare_create_ticket,
    prepare_update_ticket,
    prepare_assign_ticket,
    prepare_change_status,
    prepare_bulk_action,
    confirm_pending_action,
    cancel_pending_action,
]


def _handled_tool_error(error: ToolException) -> str:
    message = str(error)
    if ": " in message:
        code, detail = message.split(": ", 1)
        return _result(f"操作未完成：{detail}（{code}）")
    return _result(f"操作未完成：{message}")


def _handled_validation_error(_: Exception) -> str:
    return _result("工具参数不完整或格式错误，请修正参数后重试。")


for assistant_tool in ALL_TOOLS:
    assistant_tool.handle_tool_error = _handled_tool_error
    assistant_tool.handle_validation_error = _handled_validation_error
