"""LAN entry point for uploads from one station. Run the full dashboard on localhost."""
import os

from starlette.responses import PlainTextResponse

from dashboard.server import app as dashboard


STATION_IP = os.environ["CHIRP_STATION_IP"]


async def app(scope, receive, send):
    if scope["type"] == "http":
        method, path = scope["method"], scope["path"]
        is_upload = (method == "POST" and path == "/api/windows") or (
            method == "PUT" and path.startswith("/api/evidence/")
        )
        if not is_upload or scope["client"][0] != STATION_IP:
            await PlainTextResponse("Not found", status_code=404)(scope, receive, send)
            return
    await dashboard(scope, receive, send)
