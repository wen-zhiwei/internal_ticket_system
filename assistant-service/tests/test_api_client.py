import asyncio

import httpx

from api_client import TicketAPI, TicketAPIError


def test_reads_nested_go_api_error_payload():
    async def run():
        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                409,
                json={
                    "error": {
                        "code": "invalid_status_transition",
                        "message": "不允许从当前状态流转到目标状态",
                    }
                },
            )

        api = TicketAPI("http://ticket-api")
        await api._client.aclose()
        api._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        try:
            await api.change_status("user-id", "ticket-id", "resolved")
        except TicketAPIError as error:
            assert error.status_code == 409
            assert error.code == "invalid_status_transition"
            assert error.message == "不允许从当前状态流转到目标状态"
        else:
            raise AssertionError("expected TicketAPIError")
        finally:
            await api.close()

    asyncio.run(run())
