"""Windows desktop launcher for the local Shiju web application."""

from __future__ import annotations

import ctypes
import os
import sys
import threading
import time
import webbrowser
from pathlib import Path


APP_NAME = "拾句"
HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MUTEX_NAME = "Local\\ShijuVocabularyApp"


def message(text: str, title: str = APP_NAME, error: bool = False) -> None:
    flags = 0x10 if error else 0x40
    ctypes.windll.user32.MessageBoxW(None, text, title, flags)


def read_active_url(data_dir: Path) -> str | None:
    try:
        port = int((data_dir / "port.txt").read_text(encoding="ascii").strip())
        if 1 <= port <= 65535:
            return f"http://{HOST}:{port}"
    except (OSError, ValueError):
        pass
    return None


def acquire_single_instance(data_dir: Path) -> object:
    handle = ctypes.windll.kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if ctypes.windll.kernel32.GetLastError() == 183:
        url = None
        for _ in range(30):
            url = read_active_url(data_dir)
            if url:
                break
            time.sleep(0.1)
        webbrowser.open(url or f"http://{HOST}:{DEFAULT_PORT}")
        raise SystemExit(0)
    (data_dir / "port.txt").unlink(missing_ok=True)
    return handle


def configure_data_directory() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    data_dir = base / "Shiju"
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["SHIJU_HOST"] = HOST
    os.environ["SHIJU_USERS_FILE"] = str(data_dir / "users.json")
    os.environ["SHIJU_PROGRESS_FILE"] = str(data_dir / "progress.json")
    os.environ["SHIJU_SESSIONS_FILE"] = str(data_dir / "sessions.json")
    return data_dir


def create_local_server(server_module):
    last_error = None
    for port in (DEFAULT_PORT, 18765, 28765, 38765, 0):
        try:
            return server_module.ThreadingHTTPServer((HOST, port), server_module.Handler)
        except OSError as error:
            if getattr(error, "winerror", None) not in (10013, 10048):
                raise
            last_error = error
    raise last_error or OSError("No local port is available")


def main() -> None:
    data_dir = configure_data_directory()
    mutex = acquire_single_instance(data_dir)
    try:
        import server
        httpd = create_local_server(server)
    except Exception as error:
        ctypes.windll.kernel32.CloseHandle(mutex)
        message(f"拾句无法启动：\n\n{error}\n\n请保留此错误信息以便排查。", error=True)
        raise SystemExit(1) from error

    port = int(httpd.server_address[1])
    url = f"http://{HOST}:{port}"
    os.environ["SHIJU_PORT"] = str(port)
    port_file = data_dir / "port.txt"
    port_file.write_text(str(port), encoding="ascii")

    thread = threading.Thread(target=httpd.serve_forever, name="shiju-server", daemon=True)
    thread.start()

    import tkinter as tk
    from tkinter import ttk

    root = tk.Tk()
    root.title("拾句 · 本地词汇学习")
    icon_path = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "Shiju.ico"
    if icon_path.exists():
        root.iconbitmap(default=str(icon_path))
    root.geometry("440x275")
    root.resizable(False, False)

    frame = ttk.Frame(root, padding=30)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="拾句", font=("Microsoft YaHei UI", 24, "bold")).pack(anchor="w")
    ttk.Label(frame, text=f"本地学习服务正在运行 · {url}", font=("Microsoft YaHei UI", 10)).pack(anchor="w", pady=(5, 22))
    ttk.Button(frame, text="打开学习页面", command=lambda: webbrowser.open(url)).pack(fill="x", ipady=7)
    ttk.Label(frame, text=f"学习数据：{data_dir}", wraplength=370, foreground="#666666").pack(anchor="w", pady=(22, 5))
    ttk.Label(frame, text="关闭此窗口将停止本地服务，学习数据不会被删除。", foreground="#666666").pack(anchor="w")

    def close() -> None:
        httpd.shutdown()
        httpd.server_close()
        try:
            if port_file.read_text(encoding="ascii").strip() == str(port):
                port_file.unlink(missing_ok=True)
        except OSError:
            pass
        ctypes.windll.kernel32.CloseHandle(mutex)
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    root.after(450, lambda: webbrowser.open(url))
    root.mainloop()


if __name__ == "__main__":
    main()
