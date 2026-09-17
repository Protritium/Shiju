#!/usr/bin/env python3
"""Dependency-free local server for the contextual vocabulary app."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
BOOKS = {
    "cet6": {"name": "六级 · 乱序", "book": ROOT / "4 六级-乱序.txt", "examples": ROOT / "data" / "examples.json"},
    "high-school": {"name": "高中 · 乱序", "book": ROOT / "2 高中-乱序.txt", "examples": ROOT / "data" / "high-school" / "examples.json"},
    "postgraduate": {"name": "考研 · 乱序", "book": ROOT / "5 考研-乱序.txt", "examples": ROOT / "data" / "postgraduate" / "examples.json"},
    "junior-high": {"name": "初中 · 乱序", "book": ROOT / "1 初中-乱序.txt", "examples": ROOT / "data" / "junior-high" / "examples.json"},
}
HOST = os.environ.get("SHIJU_HOST", "127.0.0.1")
PORT = int(os.environ.get("SHIJU_PORT", "8000"))
USERS_FILE = Path(os.environ.get("SHIJU_USERS_FILE", ROOT / "data" / "users.json"))
LEGACY_PROGRESS_FILE = Path(os.environ.get("SHIJU_PROGRESS_FILE", ROOT / "data" / "progress.json"))
SESSIONS_FILE = Path(os.environ.get("SHIJU_SESSIONS_FILE", ROOT / "data" / "sessions.json"))
DATA_LOCK = threading.RLock()
SESSIONS: dict[str, str] = {}
SESSION_LOCK = threading.Lock()
PBKDF2_ITERATIONS = 240_000
DEFAULT_GOAL = 20
SHANGHAI = timezone(timedelta(hours=8), name="Asia/Shanghai")
SYNC_EPOCH = "1970-01-01T00:00:00+00:00"

def sync_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")

def id_sort_key(value: str) -> tuple:
    return (0, int(value)) if value.isdigit() else (1, value)

def normalize_flag_state(raw: object, fallback_active: list[str]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    if isinstance(raw, dict):
        for word_id, item in raw.items():
            if isinstance(item, dict) and isinstance(item.get("active"), bool) and isinstance(item.get("updatedAt"), str):
                revision = item.get("revision", 0)
                result[str(word_id)] = {"active": item["active"], "updatedAt": item["updatedAt"], "revision": min(revision, 999999) if isinstance(revision, int) and not isinstance(revision, bool) and revision >= 0 else 0}
    for word_id in fallback_active:
        result.setdefault(word_id, {"active": True, "updatedAt": SYNC_EPOCH, "revision": 0})
    return result

def merge_flag_states(left: dict, right: dict, valid_ids: set[str]) -> dict:
    result = {}
    for word_id in (set(left) | set(right)) & valid_ids:
        a, b = left.get(word_id), right.get(word_id)
        if a is None: result[word_id] = b
        elif b is None: result[word_id] = a
        elif a.get("revision", 0) != b.get("revision", 0): result[word_id] = a if a.get("revision", 0) > b.get("revision", 0) else b
        elif a["updatedAt"] != b["updatedAt"] and a["active"] == b["active"]: result[word_id] = a if a["updatedAt"] > b["updatedAt"] else b
        else:
            chosen = a if not a["active"] else b if not b["active"] else a; result[word_id] = {"active": chosen["active"], "updatedAt": max(a["updatedAt"], b["updatedAt"]), "revision": a.get("revision", 0)}
    return result
WINDOWS_TTS_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $selected = $null
    foreach ($candidate in $speaker.GetInstalledVoices()) {
        if (-not $candidate.Enabled) { continue }
        $culture = $candidate.VoiceInfo.Culture
        if ($null -eq $culture -or $culture.TwoLetterISOLanguageName -ne 'en') { continue }
        if ($null -eq $selected -or $culture.Name -eq 'en-US') { $selected = $candidate }
        if ($culture.Name -eq 'en-US') { break }
    }
    if ($null -eq $selected) { throw 'No installed English Windows voice was found.' }
    $speaker.SelectVoice($selected.VoiceInfo.Name)
    $speaker.Rate = [int]$env:SHIJU_TTS_RATE
    $speaker.SetOutputToWaveFile($env:SHIJU_TTS_OUTPUT)
    $speaker.Speak($env:SHIJU_TTS_TEXT)
} finally {
    $speaker.Dispose()
}
"""


def empty_book() -> dict:
    return {"mistakes": [], "historicalMistakes": [], "mistakeAnswers": {}, "mistakeReviews": {}, "learned": [], "dailyGoal": DEFAULT_GOAL, "dailyStats": {}, "sync": {"mistakeState": {}, "learnedState": {}, "answerState": {}, "dailyGoalState": {"value": DEFAULT_GOAL, "updatedAt": SYNC_EPOCH}, "reviewBase": {}, "reviewEvents": {}}}


def normalize_book(raw: object) -> dict:
    result = empty_book()
    if not isinstance(raw, dict):
        return result
    for field in ("mistakes", "historicalMistakes", "learned"):
        if isinstance(raw.get(field), list):
            result[field] = [str(value) for value in raw[field]]
    if isinstance(raw.get("mistakeAnswers"), dict):
        result["mistakeAnswers"] = {
            str(word_id): answer.strip()[:120]
            for word_id, answer in raw["mistakeAnswers"].items()
            if isinstance(answer, str) and answer.strip()
        }
    if isinstance(raw.get("mistakeReviews"), dict):
        result["mistakeReviews"] = {
            str(word_id): min(count, 9999)
            for word_id, count in raw["mistakeReviews"].items()
            if isinstance(count, int) and not isinstance(count, bool) and count >= 0
        }
    result["historicalMistakes"] = list(dict.fromkeys(result["historicalMistakes"] + result["mistakes"]))
    goal = raw.get("dailyGoal", DEFAULT_GOAL)
    if isinstance(goal, int) and 1 <= goal <= 1000:
        result["dailyGoal"] = goal
    if isinstance(raw.get("dailyStats"), dict):
        for day, stats in raw["dailyStats"].items():
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(day)) or not isinstance(stats, dict):
                continue
            result["dailyStats"][str(day)] = {
                field: [str(value) for value in stats.get(field, [])] if isinstance(stats.get(field), list) else []
                for field in ("studied", "mistakes", "reviewed")
            }
            result["dailyStats"][str(day)]["extraReviewUsed"] = bool(stats.get("extraReviewUsed"))
    recorded_mistakes = [word_id for stats in result["dailyStats"].values() for word_id in stats["mistakes"]]
    result["historicalMistakes"] = list(dict.fromkeys(result["historicalMistakes"] + recorded_mistakes))
    sync = raw.get("sync") if isinstance(raw.get("sync"), dict) else {}
    if isinstance(sync.get("mistakeState"), dict):
        result["sync"]["mistakeState"] = normalize_flag_state(sync.get("mistakeState"), result["mistakes"])
    else:
        result["sync"]["mistakeState"] = {word_id: {"active": word_id in set(result["mistakes"]), "updatedAt": SYNC_EPOCH, "revision": 0} for word_id in set(result["historicalMistakes"]) | set(result["mistakes"])}
    result["sync"]["learnedState"] = normalize_flag_state(sync.get("learnedState"), result["learned"])
    if isinstance(sync.get("answerState"), dict):
        for word_id, item in sync["answerState"].items():
            if isinstance(item, dict) and isinstance(item.get("value"), str) and item["value"].strip() and isinstance(item.get("updatedAt"), str):
                result["sync"]["answerState"][str(word_id)] = {"value": item["value"].strip()[:120], "updatedAt": item["updatedAt"]}
    for word_id, value in result["mistakeAnswers"].items(): result["sync"]["answerState"].setdefault(word_id, {"value": value, "updatedAt": SYNC_EPOCH})
    goal_state = sync.get("dailyGoalState")
    result["sync"]["dailyGoalState"] = {"value": goal_state["value"], "updatedAt": goal_state["updatedAt"]} if isinstance(goal_state, dict) and isinstance(goal_state.get("value"), int) and not isinstance(goal_state.get("value"), bool) and 1 <= goal_state["value"] <= 1000 and isinstance(goal_state.get("updatedAt"), str) else {"value": result["dailyGoal"], "updatedAt": SYNC_EPOCH}
    result["sync"]["reviewBase"] = {str(k): min(v, 9999) for k, v in sync["reviewBase"].items() if isinstance(v, int) and not isinstance(v, bool) and v >= 0} if isinstance(sync.get("reviewBase"), dict) else dict(result["mistakeReviews"])
    if isinstance(sync.get("reviewEvents"), dict):
        result["sync"]["reviewEvents"] = {str(word_id): sorted({str(day) for day in days if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(day))}) for word_id, days in sync["reviewEvents"].items() if isinstance(days, list)}
    result["mistakes"] = sorted((word_id for word_id, item in result["sync"]["mistakeState"].items() if item["active"]), key=id_sort_key)
    result["learned"] = sorted((word_id for word_id, item in result["sync"]["learnedState"].items() if item["active"]), key=id_sort_key)
    result["mistakeAnswers"] = {word_id: item["value"] for word_id, item in result["sync"]["answerState"].items()}
    result["dailyGoal"] = result["sync"]["dailyGoalState"]["value"]
    review_ids = set(result["sync"]["reviewBase"]) | set(result["sync"]["reviewEvents"])
    result["mistakeReviews"] = {word_id: min(9999, result["sync"]["reviewBase"].get(word_id, 0) + len(result["sync"]["reviewEvents"].get(word_id, []))) for word_id in review_ids}
    return result


def load_users() -> dict:
    empty = {"version": 1, "legacyMigrated": False, "users": {}}
    if not USERS_FILE.exists():
        return empty
    try:
        saved = json.loads(USERS_FILE.read_text(encoding="utf-8"))
        if not isinstance(saved, dict) or not isinstance(saved.get("users"), dict):
            return empty
        saved.setdefault("version", 1)
        saved.setdefault("legacyMigrated", bool(saved["users"]))
        return saved
    except (OSError, json.JSONDecodeError):
        return empty


def write_users(data: dict) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = USERS_FILE.with_suffix(USERS_FILE.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(USERS_FILE)


def load_sessions() -> dict[str, str]:
    if not SESSIONS_FILE.exists():
        return {}
    try:
        saved = json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
        if not isinstance(saved, dict):
            return {}
        return {
            str(token): str(username)
            for token, username in saved.items()
            if isinstance(token, str) and isinstance(username, str)
        }
    except (OSError, json.JSONDecodeError):
        return {}


def write_sessions(sessions: dict[str, str]) -> None:
    SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = SESSIONS_FILE.with_suffix(SESSIONS_FILE.suffix + ".tmp")
    temporary.write_text(json.dumps(sessions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(SESSIONS_FILE)


def legacy_books() -> dict[str, dict]:
    result = {book_id: empty_book() for book_id in BOOKS}
    if not LEGACY_PROGRESS_FILE.exists():
        return result
    try:
        saved = json.loads(LEGACY_PROGRESS_FILE.read_text(encoding="utf-8"))
        for book_id in BOOKS:
            if isinstance(saved.get(book_id), dict):
                result[book_id] = normalize_book(saved[book_id])
    except (OSError, json.JSONDecodeError):
        pass
    return result


def public_progress(book: dict) -> dict:
    today = datetime.now(SHANGHAI).date().isoformat()
    history = []
    for day, stats in sorted(book["dailyStats"].items(), reverse=True)[:30]:
        history.append({"date": day, "studied": len(set(stats["studied"])), "mistakes": len(set(stats["mistakes"]))})
    today_stats = book["dailyStats"].get(today, {"studied": [], "mistakes": [], "reviewed": [], "extraReviewUsed": False})
    return {
        "mistakes": book["mistakes"],
        "historicalMistakes": book["historicalMistakes"],
        "mistakeAnswers": book["mistakeAnswers"],
        "mistakeReviews": book["mistakeReviews"],
        "learned": book["learned"],
        "dailyGoal": book["dailyGoal"],
        "today": {"date": today, "studied": len(set(today_stats["studied"])), "mistakes": len(set(today_stats["mistakes"])), "reviewed": today_stats.get("reviewed", []), "extraReviewUsed": bool(today_stats.get("extraReviewUsed"))},
        "history": history,
    }


def export_backup(user: dict) -> dict:
    return {
        "format": "shiju-learning-backup",
        "version": 2,
        "exportedAt": datetime.now(SHANGHAI).isoformat(timespec="seconds"),
        "bookFingerprints": BOOK_FINGERPRINTS,
        "books": {book_id: normalize_book(user.get("books", {}).get(book_id)) for book_id in BOOKS},
    }


def merge_book(local_raw: object, imported_raw: object, valid_ids: set[str]) -> dict:
    local = normalize_book(local_raw)
    imported = normalize_book(imported_raw)
    merged = empty_book()
    merged["sync"]["mistakeState"] = merge_flag_states(local["sync"]["mistakeState"], imported["sync"]["mistakeState"], valid_ids)
    merged["sync"]["learnedState"] = merge_flag_states(local["sync"]["learnedState"], imported["sync"]["learnedState"], valid_ids)
    for word_id in (set(local["sync"]["answerState"]) | set(imported["sync"]["answerState"])) & valid_ids:
        left, right = local["sync"]["answerState"].get(word_id), imported["sync"]["answerState"].get(word_id)
        merged["sync"]["answerState"][word_id] = right if left is None or (right is not None and right["updatedAt"] > left["updatedAt"]) else left
    left_goal, right_goal = local["sync"]["dailyGoalState"], imported["sync"]["dailyGoalState"]
    merged["sync"]["dailyGoalState"] = right_goal if right_goal["updatedAt"] > left_goal["updatedAt"] else left_goal
    review_ids = (set(local["sync"]["reviewBase"]) | set(imported["sync"]["reviewBase"]) | set(local["sync"]["reviewEvents"]) | set(imported["sync"]["reviewEvents"])) & valid_ids
    merged["sync"]["reviewBase"] = {word_id: max(local["sync"]["reviewBase"].get(word_id, 0), imported["sync"]["reviewBase"].get(word_id, 0)) for word_id in review_ids}
    merged["sync"]["reviewEvents"] = {word_id: sorted(set(local["sync"]["reviewEvents"].get(word_id, [])) | set(imported["sync"]["reviewEvents"].get(word_id, []))) for word_id in review_ids}
    merged["historicalMistakes"] = sorted((set(local["historicalMistakes"]) | set(imported["historicalMistakes"])) & valid_ids, key=int)
    for day in set(local["dailyStats"]) | set(imported["dailyStats"]):
        left = local["dailyStats"].get(day, {"studied": [], "mistakes": [], "reviewed": []})
        right = imported["dailyStats"].get(day, {"studied": [], "mistakes": [], "reviewed": []})
        merged["dailyStats"][day] = {
            field: sorted((set(left[field]) | set(right[field])) & valid_ids, key=int)
            for field in ("studied", "mistakes", "reviewed")
        }
        merged["dailyStats"][day]["extraReviewUsed"] = bool(left.get("extraReviewUsed") or right.get("extraReviewUsed"))
    return normalize_book(merged)


def hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS).hex()


def load_words(book_id: str = "cet6") -> list[dict[str, str]]:
    config = BOOKS[book_id]
    examples = json.loads(config["examples"].read_text(encoding="utf-8")) if config["examples"].exists() else {}
    words: list[dict[str, str]] = []
    for index, raw_line in enumerate(config["book"].read_text(encoding="utf-8").splitlines()):
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split(maxsplit=1)
        if len(parts) != 2:
            continue
        word, meaning = parts
        pos = meaning.split(".", 1)[0].lower() if "." in meaning else ""
        words.append({"id": str(index), "word": word, "meaning": meaning, "pos": pos, "example": examples.get(word)})
    return words


WORDS_JSON = {book_id: json.dumps(load_words(book_id), ensure_ascii=False).encode("utf-8") for book_id in BOOKS}
VALID_IDS = {book_id: {word["id"] for word in load_words(book_id)} for book_id in BOOKS}
BOOK_FINGERPRINTS = {book_id: hashlib.sha256(WORDS_JSON[book_id]).hexdigest() for book_id in BOOKS}


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: object, extra_headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 5_000_000:
            raise ValueError("请求内容过大")
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("请求格式错误")
        return payload

    def send_windows_tts(self, parsed) -> None:
        query = parse_qs(parsed.query)
        text = query.get("text", [""])[0].strip()
        if not text or len(text) > 1000:
            self.send_json(400, {"error": "朗读内容不能为空且不能超过 1000 个字符"})
            return
        try:
            requested_rate = float(query.get("rate", ["1"])[0])
        except ValueError:
            requested_rate = 1.0
        sapi_rate = max(-5, min(5, round((requested_rate - 1.0) * 5)))
        descriptor, output_name = tempfile.mkstemp(prefix="shiju-tts-", suffix=".wav")
        os.close(descriptor)
        output_path = Path(output_name)
        output_path.unlink(missing_ok=True)
        environment = os.environ.copy()
        environment.update({
            "SHIJU_TTS_TEXT": text,
            "SHIJU_TTS_RATE": str(sapi_rate),
            "SHIJU_TTS_OUTPUT": str(output_path),
        })
        try:
            process = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_TTS_SCRIPT],
                capture_output=True,
                text=True,
                timeout=30,
                env=environment,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                check=False,
            )
            if process.returncode != 0 or not output_path.is_file():
                detail = (process.stderr or process.stdout or "Windows TTS failed").strip()[-500:]
                self.send_json(503, {"error": detail})
                return
            body = output_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (OSError, subprocess.SubprocessError) as error:
            self.send_json(503, {"error": f"Windows TTS unavailable: {error}"})
        finally:
            output_path.unlink(missing_ok=True)

    def session_username(self) -> str | None:
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get("Cookie", ""))
        except cookies.CookieError:
            return None
        token = jar.get("shiju_session")
        if not token:
            return None
        with SESSION_LOCK:
            username = SESSIONS.get(token.value)
            if username is None:
                username = load_sessions().get(token.value)
                if username is not None:
                    SESSIONS[token.value] = username
            return username

    def require_user(self) -> str | None:
        username = self.session_username()
        if username is None:
            self.send_json(401, {"error": "请先登录"})
        return username

    def create_session(self, username: str) -> str:
        token = secrets.token_urlsafe(32)
        with SESSION_LOCK:
            for old_token, old_username in list(SESSIONS.items()):
                if old_username == username:
                    SESSIONS.pop(old_token, None)
            SESSIONS[token] = username
            saved = {key: value for key, value in load_sessions().items() if value != username}
            saved[token] = username
            write_sessions(saved)
        return token

    @staticmethod
    def session_cookie(token: str) -> str:
        return f"shiju_session={token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/api/books":
            self.send_json(200, [{"id": key, "name": value["name"]} for key, value in BOOKS.items()])
            return
        if path == "/api/session":
            username = self.session_username()
            self.send_json(200, {"authenticated": username is not None, "username": username})
            return
        if path == "/api/progress":
            username = self.require_user()
            if username is None:
                return
            book_id = parse_qs(parsed.query).get("book", ["cet6"])[0]
            if book_id not in BOOKS:
                self.send_json(404, {"error": "未知词书"})
                return
            with DATA_LOCK:
                data = load_users()
                user = data["users"].get(username)
                if user is None:
                    self.send_json(401, {"error": "用户不存在，请重新登录"})
                    return
                book = normalize_book(user.setdefault("books", {}).get(book_id))
            self.send_json(200, public_progress(book))
            return
        if path == "/api/backup":
            username = self.require_user()
            if username is None:
                return
            with DATA_LOCK:
                user = load_users()["users"].get(username)
                if user is None:
                    self.send_json(401, {"error": "用户不存在，请重新登录"})
                    return
                backup = export_backup(user)
            self.send_json(200, backup)
            return
        if path == "/api/words":
            book_id = parse_qs(parsed.query).get("book", ["cet6"])[0]
            if book_id not in WORDS_JSON:
                self.send_json(404, {"error": "未知词书"})
                return
            self.send_json(200, json.loads(WORDS_JSON[book_id]))
            return
        if path == "/api/tts":
            self.send_windows_tts(parsed)
            return
        if path == "/":
            path = "/index.html"
        requested = (ROOT / path.lstrip("/")).resolve()
        if ROOT not in requested.parents or not requested.is_file():
            self.send_error(404)
            return
        body = requested.read_bytes()
        content_type = mimetypes.guess_type(requested.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        try:
            payload = self.read_json()
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
            self.send_json(400, {"error": str(error)})
            return
        if parsed.path == "/api/register":
            self.handle_register(payload)
            return
        if parsed.path == "/api/login":
            self.handle_login(payload)
            return
        if parsed.path == "/api/logout":
            jar = cookies.SimpleCookie()
            try:
                jar.load(self.headers.get("Cookie", ""))
                token = jar.get("shiju_session")
                if token:
                    with SESSION_LOCK:
                        SESSIONS.pop(token.value, None)
                        saved = load_sessions()
                        if token.value in saved:
                            saved.pop(token.value, None)
                            write_sessions(saved)
            except cookies.CookieError:
                pass
            self.send_json(200, {"ok": True}, {"Set-Cookie": "shiju_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"})
            return
        if parsed.path == "/api/progress":
            self.handle_progress(parsed, payload)
            return
        if parsed.path == "/api/backup/import":
            self.handle_backup_import(payload)
            return
        self.send_json(404, {"error": "接口不存在"})

    def handle_register(self, payload: dict) -> None:
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", ""))
        if not re.fullmatch(r"[\w\-\u4e00-\u9fff]{2,24}", username):
            self.send_json(400, {"error": "用户名需为 2–24 位中文、字母、数字、下划线或连字符"})
            return
        if len(password) < 6 or len(password) > 128:
            self.send_json(400, {"error": "密码长度需为 6–128 位"})
            return
        with DATA_LOCK:
            data = load_users()
            if username in data["users"]:
                self.send_json(409, {"error": "用户名已存在"})
                return
            salt = secrets.token_bytes(16)
            books = legacy_books() if not data.get("legacyMigrated") else {book_id: empty_book() for book_id in BOOKS}
            data["users"][username] = {
                "salt": salt.hex(), "passwordHash": hash_password(password, salt),
                "createdAt": datetime.now(SHANGHAI).isoformat(timespec="seconds"), "books": books,
            }
            data["legacyMigrated"] = True
            write_users(data)
        token = self.create_session(username)
        self.send_json(201, {"authenticated": True, "username": username}, {"Set-Cookie": self.session_cookie(token)})

    def handle_login(self, payload: dict) -> None:
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", ""))
        with DATA_LOCK:
            user = load_users()["users"].get(username)
        valid = False
        if isinstance(user, dict):
            try:
                expected = hash_password(password, bytes.fromhex(user["salt"]))
                valid = secrets.compare_digest(expected, user["passwordHash"])
            except (KeyError, ValueError, TypeError):
                pass
        if not valid:
            self.send_json(401, {"error": "用户名或密码错误"})
            return
        token = self.create_session(username)
        self.send_json(200, {"authenticated": True, "username": username}, {"Set-Cookie": self.session_cookie(token)})

    def handle_progress(self, parsed, payload: dict) -> None:
        username = self.require_user()
        if username is None:
            return
        book_id = parse_qs(parsed.query).get("book", ["cet6"])[0]
        if book_id not in BOOKS:
            self.send_json(404, {"error": "未知词书"})
            return
        valid_ids = VALID_IDS[book_id]
        try:
            cleaned: dict[str, list[str]] = {}
            for field in ("mistakes", "learned"):
                values = payload.get(field)
                if not isinstance(values, list):
                    raise ValueError(f"{field} 必须是列表")
                cleaned[field] = sorted({str(value) for value in values} & valid_ids, key=int)
            goal = payload.get("dailyGoal")
            if goal is not None and (not isinstance(goal, int) or isinstance(goal, bool) or not 1 <= goal <= 1000):
                raise ValueError("每日目标需为 1–1000")
            activity = payload.get("activity")
            extra_review_start = bool(payload.get("extraReviewStart"))
            if activity is not None and (not isinstance(activity, dict) or str(activity.get("wordId")) not in valid_ids):
                raise ValueError("学习记录中的单词无效")
            if activity is not None and "answer" in activity and (not isinstance(activity["answer"], str) or len(activity["answer"]) > 120):
                raise ValueError("作答内容不能超过 120 个字符")
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        with DATA_LOCK:
            data = load_users()
            user = data["users"].get(username)
            if user is None:
                self.send_json(401, {"error": "用户不存在，请重新登录"})
                return
            books = user.setdefault("books", {})
            book = normalize_book(books.get(book_id))
            previous_mistakes = set(book["mistakes"])
            previous_learned = set(book["learned"])
            day = datetime.now(SHANGHAI).date().isoformat()
            stats = book["dailyStats"].setdefault(day, {"studied": [], "mistakes": [], "reviewed": [], "extraReviewUsed": False}) if activity is not None or extra_review_start else {"studied": [], "mistakes": [], "reviewed": [], "extraReviewUsed": False}
            if extra_review_start:
                stats["extraReviewUsed"] = True
            review_ids: set[str] = set()
            if activity is not None and bool(activity.get("reviewSuccess")):
                raw_review_ids = activity.get("reviewIds")
                if isinstance(raw_review_ids, list):
                    review_ids = {str(word_id) for word_id in raw_review_ids if str(word_id) in valid_ids}
                else:
                    review_ids = {str(activity["wordId"])}
            already_reviewed = set(stats.get("reviewed", []))
            counted_review_ids = (review_ids & previous_mistakes) - already_reviewed
            for review_word_id in counted_review_ids:
                events = set(book["sync"]["reviewEvents"].get(review_word_id, [])); events.add(day); book["sync"]["reviewEvents"][review_word_id] = sorted(events)
            review_count_ids = set(book["sync"]["reviewBase"]) | set(book["sync"]["reviewEvents"])
            book["mistakeReviews"] = {word_id: min(9999, book["sync"]["reviewBase"].get(word_id, 0) + len(book["sync"]["reviewEvents"].get(word_id, []))) for word_id in review_count_ids}
            stats["reviewed"] = sorted(already_reviewed | counted_review_ids, key=int)
            protected_mistakes = {
                word_id for word_id in previous_mistakes
                if book["mistakeReviews"].get(word_id, 0) <= 2
            }
            cleaned["mistakes"] = sorted(set(cleaned["mistakes"]) | protected_mistakes, key=int)
            changed_at = sync_now(); final_mistakes = set(cleaned["mistakes"])
            for word_id in previous_mistakes | final_mistakes:
                if (word_id in previous_mistakes) != (word_id in final_mistakes):
                    old_revision = book["sync"]["mistakeState"].get(word_id, {}).get("revision", 0); book["sync"]["mistakeState"][word_id] = {"active": word_id in final_mistakes, "updatedAt": changed_at, "revision": old_revision + 1}
            final_learned = set(cleaned["learned"])
            for word_id in previous_learned | final_learned:
                if (word_id in previous_learned) != (word_id in final_learned):
                    old_revision = book["sync"]["learnedState"].get(word_id, {}).get("revision", 0); book["sync"]["learnedState"][word_id] = {"active": word_id in final_learned, "updatedAt": changed_at, "revision": old_revision + 1}
            book.update(cleaned)
            historical_mistakes = (set(book["historicalMistakes"]) & valid_ids) | set(cleaned["mistakes"])
            if activity is not None and bool(activity.get("mistake")):
                historical_mistakes.add(str(activity["wordId"]))
            book["historicalMistakes"] = sorted(historical_mistakes, key=int)
            if goal is not None:
                book["dailyGoal"] = goal
                if goal != book["sync"]["dailyGoalState"]["value"]: book["sync"]["dailyGoalState"] = {"value": goal, "updatedAt": changed_at}
            if activity is not None:
                word_id = str(activity["wordId"])
                if bool(activity.get("mistake")) and isinstance(activity.get("answer"), str) and activity["answer"].strip():
                    book["mistakeAnswers"][word_id] = activity["answer"].strip()
                    book["sync"]["answerState"][word_id] = {"value": activity["answer"].strip(), "updatedAt": changed_at}
                stats["studied"] = sorted(set(stats["studied"]) | {word_id}, key=int)
                if bool(activity.get("mistake")):
                    stats["mistakes"] = sorted(set(stats["mistakes"]) | {word_id}, key=int)
                elif bool(activity.get("correction")):
                    stats["mistakes"] = sorted(set(stats["mistakes"]) - {word_id}, key=int)
            book = normalize_book(book)
            books[book_id] = book
            write_users(data)
        self.send_json(200, public_progress(book))

    def handle_backup_import(self, payload: dict) -> None:
        username = self.require_user()
        if username is None:
            return
        backup = payload.get("backup")
        if not isinstance(backup, dict) or backup.get("format") != "shiju-learning-backup" or backup.get("version") not in (1, 2):
            self.send_json(400, {"error": "不是有效的拾句学习数据备份"})
            return
        imported_books = backup.get("books")
        if not isinstance(imported_books, dict):
            self.send_json(400, {"error": "备份缺少词书数据"})
            return
        if backup.get("version") == 2 and backup.get("bookFingerprints") != BOOK_FINGERPRINTS:
            self.send_json(400, {"error": "备份词书版本与当前应用不一致，为避免单词 ID 错位已停止导入"})
            return
        with DATA_LOCK:
            data = load_users()
            user = data["users"].get(username)
            if user is None:
                self.send_json(401, {"error": "用户不存在，请重新登录"})
                return
            books = user.setdefault("books", {})
            for book_id in BOOKS:
                if book_id in imported_books:
                    books[book_id] = merge_book(books.get(book_id), imported_books[book_id], VALID_IDS[book_id])
            write_users(data)
        legacy = backup.get("version") == 1
        self.send_json(200, {"ok": True, "legacy": legacy, "message": "旧版 v1 备份已兼容合并，但其中没有删除记录；建议两端升级后重新导出 v2" if legacy else "学习数据已同步合并（包含删除状态和温习记录）"})

    def log_message(self, fmt: str, *args: object) -> None:
        if sys.stdout is not None:
            print(f"[{self.log_date_time_string()}] {fmt % args}")


if __name__ == "__main__":
    for config in BOOKS.values():
        if not config["book"].exists() or not config["examples"].exists():
            raise SystemExit(f"词书数据不完整：{config}")
    print(f"拾句已启动：http://{HOST}:{PORT}")
    print("按 Ctrl+C 停止服务")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
