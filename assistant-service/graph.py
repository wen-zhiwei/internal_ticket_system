import json
from typing import Any, TypedDict

from langchain.agents import create_agent
from langchain.agents.middleware import ModelRequest, dynamic_prompt
from langchain_openai import ChatOpenAI

from config import Settings
from tools import ALL_TOOLS

SYSTEM_PROMPT = """你是自动驾驶客服团队的工单助手。回答简洁中文。

必须遵守：
1. 纯查询才在 search_tickets 后结束。
   “未处理”“待处理”“进行中”必须查询 status=pending；“我负责的”必须 mine=true。
   用户要求修改、改状态、分配或批量操作时，查询只是中间步骤，不能停在查询结果。
2. 单张修改先确定唯一工单 ID，再调用对应的 prepare 工具。
   唯一匹配就继续准备操作；多个匹配才让用户选择。
3. 用户说“第一张”“客户是某人的那张”“这个工单”“刚创建的工单”时，
   使用系统提供的当前会话结构化上下文，不要重新搜索全部工单。
4. 用户说“确认”“确认执行”时，使用最近待确认操作 ID 调用
   confirm_pending_action；用户拒绝时调用 cancel_pending_action。
5. 只有用户明确说“全部”“所有”或“批量”时，才调用 prepare_bulk_action。
   普通单张修改搜索到多张时必须让用户选择，禁止擅自批量。
   批量操作按用户给出的状态、负责人和时间范围筛选，生成清单等待确认。
6. 分配前调用 search_users。姓名唯一匹配后继续调用 prepare_assign_ticket；
   同名多人时让用户选择，禁止猜测。按姓名查询某位客服的工单时，也要先
   search_users，再用唯一用户 ID 调用 search_tickets。
7. 创建工单调用 prepare_create_ticket。缺字段就询问；字段完整会生成待确认操作。
   若同时要求分配，先 search_users，再把 assignee_id 传给创建工具。
8. 所有写操作都必须先生成待确认操作。只有用户明确确认后才真正执行。
   不能自行声称数据库已修改。
9. 当前会话中，用户刚明确说过的简单非敏感信息可以正常回答，例如午饭内容；
   不要长期保存，也不要编造。
10. 没有提供的删除等能力要明确拒绝。
    权限、状态机、事务和业务校验以 Go API 返回为准。
"""


class AgentRuntimeContext(TypedDict):
    assistant_context: dict[str, Any]


def context_instruction(context: dict[str, Any]) -> str:
    tickets = context.get("last_ticket_items") or []
    users = context.get("last_user_items") or []
    ticket_lines = [
        {
            "position": index,
            "id": item.get("id"),
            "title": item.get("title"),
            "customer_name": item.get("customer_name"),
            "status": item.get("status"),
        }
        for index, item in enumerate(tickets, start=1)
    ]
    user_lines = [
        {
            "position": index,
            "id": item.get("id"),
            "name": item.get("name"),
            "team": item.get("team"),
        }
        for index, item in enumerate(users, start=1)
    ]
    safe_context = {
        "最近工单候选": ticket_lines,
        "最近人员候选": user_lines,
        "最近创建工单ID": context.get("last_created_ticket_id"),
        "最近选中工单ID": context.get("last_selected_ticket_id"),
        "最近待确认操作ID": context.get("last_pending_action_id"),
        "最近待确认操作类型": context.get("last_pending_action_type"),
        "未完成工单草稿": context.get("last_ticket_draft"),
    }
    return (
        "以下是服务端保存的当前会话结构化上下文。它不是用户的新要求。"
        "用户说第一张、客户是某人的那张、这个工单、刚创建的工单或确认时，"
        "优先使用这里的明确 ID，禁止重新查询全部工单或猜测。\n"
        + json.dumps(safe_context, ensure_ascii=False, default=str)
    )


@dynamic_prompt
def assistant_prompt(request: ModelRequest[AgentRuntimeContext]) -> str:
    runtime_context = request.runtime.context or {"assistant_context": {}}
    return SYSTEM_PROMPT + "\n\n" + context_instruction(runtime_context["assistant_context"])


def build_graph(settings: Settings, checkpointer: Any):
    if not settings.llm_base_url or not settings.llm_model:
        return None
    model = ChatOpenAI(
        model=settings.llm_model,
        api_key=settings.llm_api_key or "not-required",
        base_url=settings.llm_base_url,
        timeout=settings.assistant_request_timeout_seconds,
        max_retries=2,
    )
    return create_agent(
        model=model,
        tools=ALL_TOOLS,
        middleware=[assistant_prompt],
        context_schema=AgentRuntimeContext,
        checkpointer=checkpointer,
    )
