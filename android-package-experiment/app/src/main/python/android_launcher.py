"""Start the bundled Shiju HTTP server inside the Android process."""

from __future__ import annotations

import os
import threading


_httpd = None
_thread = None
_lock = threading.Lock()


def start_server(app_root: str, data_root: str) -> int:
    global _httpd, _thread
    with _lock:
        if _httpd is not None:
            return int(_httpd.server_address[1])

        index_file = os.path.join(app_root, "index.html")
        if not os.path.isfile(index_file):
            raise RuntimeError(f"APK 静态资源不完整，未找到首页文件：{index_file}")

        os.makedirs(data_root, exist_ok=True)
        os.environ["SHIJU_ROOT"] = app_root
        os.environ["SHIJU_USERS_FILE"] = os.path.join(data_root, "users.json")
        os.environ["SHIJU_PROGRESS_FILE"] = os.path.join(data_root, "progress.json")
        os.environ["SHIJU_SESSIONS_FILE"] = os.path.join(data_root, "sessions.json")
        os.environ["SHIJU_HOST"] = "127.0.0.1"
        os.environ["SHIJU_PORT"] = "0"

        import server

        _httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        _thread = threading.Thread(target=_httpd.serve_forever, name="shiju-http", daemon=True)
        _thread.start()
        return int(_httpd.server_address[1])


def stop_server() -> None:
    global _httpd, _thread
    with _lock:
        if _httpd is not None:
            _httpd.shutdown()
            _httpd.server_close()
            _httpd = None
            _thread = None
