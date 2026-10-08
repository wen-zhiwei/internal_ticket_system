from contextvars import ContextVar
from dataclasses import dataclass

from api_client import TicketAPI
from conversation_context import ConversationContextRepository
from pending_actions import PendingActionRepository


@dataclass(frozen=True)
class AssistantContext:
    user_id: str
    user_name: str
    user_role: str
    user_team: str
    conversation_id: str
    user_message: str
    ticket_api: TicketAPI
    pending_actions: PendingActionRepository
    conversation_context: ConversationContextRepository


current_context: ContextVar[AssistantContext] = ContextVar("assistant_context")
