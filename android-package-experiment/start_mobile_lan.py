"""Expose the main Shiju server to a trusted local network."""

from __future__ import annotations

import os
import socket
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["SHIJU_HOST"] = "0.0.0.0"
os.environ.setdefault("SHIJU_PORT", "8000")

import server  # noqa: E402


def local_ip() -> str:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return str(probe.getsockname()[0])
    except OSError:
        return socket.gethostbyname(socket.gethostname())
    finally:
        probe.close()


if __name__ == "__main__":
    address = f"http://{local_ip()}:{server.PORT}"
    print("拾句手机局域网模式")
    print(f"请让手机连接同一可信 Wi-Fi，然后打开：{address}")
    print("此模式使用普通 HTTP，请勿在公共 Wi-Fi 中运行。按 Ctrl+C 停止。")
    server.ThreadingHTTPServer((server.HOST, server.PORT), server.Handler).serve_forever()
