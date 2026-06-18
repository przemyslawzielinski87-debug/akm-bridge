#!/usr/bin/env python3
"""Patch Cursor IDE (state.vscdb) for MiniMax OpenAI-compatible API.

Reads API key from MINIMAX_API_KEY env or /workspace/.env.
Never prints the API key.

Usage:
  python3 scripts/patch-cursor-minimax-vscdb.py apply
  python3 scripts/patch-cursor-minimax-vscdb.py inspect
  python3 scripts/patch-cursor-minimax-vscdb.py verify

Close Cursor completely before apply/verify.
"""
from __future__ import annotations

import json
import os
import platform
import sqlite3
import sys
from pathlib import Path
from typing import Any

BASE_URL = "https://api.minimax.io/v1"
APP_USER_KEY = (
    "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl."
    "persistentStorage.applicationUser"
)
MODELS = [
    "MiniMax-M3",
    "MiniMax-M2.7",
    "MiniMax-M2.7-highspeed",
    "MiniMax-M2.5",
    "MiniMax-M2.5-highspeed",
    "MiniMax-M2.1",
    "MiniMax-M2",
]


def cursor_db_paths() -> list[Path]:
    home = Path.home()
    system = platform.system()
    paths: list[Path] = []
    if system == "Darwin":
        base = home / "Library/Application Support/Cursor/User"
    elif system == "Windows":
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            base = Path(appdata) / "Cursor/User"
        else:
            base = home / "AppData/Roaming/Cursor/User"
    else:
        base = home / ".config/Cursor/User"

    paths.append(base / "globalStorage/state.vscdb")
    profiles = base / "profiles"
    if profiles.is_dir():
        for profile in profiles.iterdir():
            p = profile / "globalStorage/state.vscdb"
            if p.is_file():
                paths.append(p)
    return paths


def load_api_key() -> str:
    key = os.environ.get("MINIMAX_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if key:
        return key.strip()
    env_file = Path(os.environ.get("MINIMAX_ENV_FILE", "/workspace/.env"))
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() in ("MINIMAX_API_KEY", "OPENAI_API_KEY") and v.strip():
                return v.strip().strip('"').strip("'")
    raise SystemExit(
        "Brak MINIMAX_API_KEY. Ustaw zmienną lub plik /workspace/.env"
    )


def connect_rw(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, timeout=10.0)
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("BEGIN IMMEDIATE")
    return conn


def get_json(conn: sqlite3.Connection, key: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT value FROM ItemTable WHERE key = ?", (key,)
    ).fetchone()
    if not row or not row[0]:
        return None
    try:
        return json.loads(row[0])
    except json.JSONDecodeError:
        return None


def set_json(conn: sqlite3.Connection, key: str, data: dict[str, Any]) -> None:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if conn.execute(
        "UPDATE ItemTable SET value = ? WHERE key = ?", (payload, key)
    ).rowcount == 0:
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?, ?)", (key, payload)
        )


def upsert_plain(conn: sqlite3.Connection, key: str, value: str) -> None:
    if conn.execute(
        "UPDATE ItemTable SET value = ? WHERE key = ?", (value, key)
    ).rowcount == 0:
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?, ?)", (key, value)
        )


def merge_models(existing: Any) -> list[str]:
    out: list[str] = []
    if isinstance(existing, list):
        out.extend(str(x) for x in existing)
    for m in MODELS:
        if m not in out:
            out.append(m)
    return out


def patch_application_user(data: dict[str, Any]) -> dict[str, Any]:
    data["openAIBaseUrl"] = BASE_URL
    data["useOpenAIKey"] = True
    data["openAIKeyEnabled"] = True
    data["overrideOpenAIBaseUrl"] = True

    ai = data.get("aiSettings")
    if not isinstance(ai, dict):
        ai = {}
    ai["openAIBaseUrl"] = BASE_URL
    ai["useOpenAIKey"] = True

    for field in (
        "userAddedModels",
        "addedModels",
        "customModels",
        "openAIModels",
        "enabledModels",
    ):
        ai[field] = merge_models(ai.get(field))

    data["aiSettings"] = ai
    return data


def patch_settings_json() -> list[str]:
    system = platform.system()
    home = Path.home()
    if system == "Darwin":
        settings = home / "Library/Application Support/Cursor/User/settings.json"
    elif system == "Windows":
        appdata = os.environ.get("APPDATA", "")
        settings = (
            Path(appdata) / "Cursor/User/settings.json"
            if appdata
            else home / "AppData/Roaming/Cursor/User/settings.json"
        )
    else:
        settings = home / ".config/Cursor/User/settings.json"

    if not settings.parent.is_dir():
        return [f"brak katalogu settings: {settings.parent}"]

    current: dict[str, Any] = {}
    if settings.is_file():
        try:
            current = json.loads(settings.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            current = {}

    current.update(
        {
            "cursor.openAiBaseUrl": BASE_URL,
            "cursor.general.openAiBaseUrl": BASE_URL,
            "cursor.general.enableOpenAiApiKey": True,
        }
    )
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(
        json.dumps(current, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    try:
        settings.chmod(0o600)
    except OSError:
        pass
    return [f"zapisano {settings}"]


def cmd_inspect() -> int:
    found = False
    for db in cursor_db_paths():
        if not db.is_file():
            print(f"BRAK: {db}")
            continue
        found = True
        print(f"\n=== {db} ===")
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        row = conn.execute(
            "SELECT value FROM ItemTable WHERE key = ?", (APP_USER_KEY,)
        ).fetchone()
        if row and row[0]:
            data = json.loads(row[0])
            interesting = {
                k: data[k]
                for k in sorted(data)
                if any(
                    x in k.lower()
                    for x in ("openai", "model", "ai", "custom", "override")
                )
            }
            print(json.dumps(interesting, indent=2, ensure_ascii=False)[:8000])
        else:
            print("brak applicationUser")
        key_row = conn.execute(
            "SELECT CASE WHEN value IS NOT NULL AND length(value) > 0 "
            "THEN 'SET' ELSE 'EMPTY' END FROM ItemTable "
            "WHERE key = 'cursorAuth/openAIKey'"
        ).fetchone()
        print(f"cursorAuth/openAIKey: {key_row[0] if key_row else 'BRAK'}")
        conn.close()
    return 0 if found else 1


def cmd_verify() -> int:
    ok = False
    for db in cursor_db_paths():
        if not db.is_file():
            continue
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        data = get_json(conn, APP_USER_KEY) or {}
        base = data.get("openAIBaseUrl") or (data.get("aiSettings") or {}).get(
            "openAIBaseUrl"
        )
        has_key = conn.execute(
            "SELECT 1 FROM ItemTable WHERE key = 'cursorAuth/openAIKey' "
            "AND value IS NOT NULL AND length(value) > 0"
        ).fetchone()
        models = []
        ai = data.get("aiSettings") or {}
        for field in ("userAddedModels", "addedModels", "customModels"):
            if isinstance(ai.get(field), list):
                models.extend(ai[field])
        print(f"DB: {db}")
        print(f"  base_url: {base}")
        print(f"  api_key: {'SET' if has_key else 'BRAK'}")
        print(f"  modele w aiSettings: {', '.join(models) if models else 'BRAK'}")
        ok = bool(has_key and base == BASE_URL)
        conn.close()
    return 0 if ok else 1


def cmd_apply() -> int:
    api_key = load_api_key()
    touched: list[str] = []
    for db in cursor_db_paths():
        if not db.is_file():
            continue
        backup = db.with_suffix(db.suffix + ".bak-minimax")
        if not backup.exists():
            backup.write_bytes(db.read_bytes())
        conn = connect_rw(db)
        upsert_plain(conn, "cursorAuth/openAIKey", api_key)
        for flag_key in (
            "cursorAuth/useOpenAIKey",
            "cursorAuth/openAIKeyEnabled",
            "cursorAuth/openAIBaseUrl",
        ):
            upsert_plain(
                conn,
                flag_key,
                "true" if flag_key.endswith(("Key", "KeyEnabled")) else BASE_URL,
            )
        app = get_json(conn, APP_USER_KEY) or {}
        app = patch_application_user(app)
        set_json(conn, APP_USER_KEY, app)
        conn.commit()
        conn.close()
        touched.append(str(db))

    touched.extend(patch_settings_json())
    if not touched:
        raise SystemExit(
            "Nie znaleziono state.vscdb. Uruchom na komputerze z zainstalowanym Cursor."
        )
    print("OK — zaktualizowano:")
    for line in touched:
        print(f"  - {line}")
    print("\nZamknij i uruchom ponownie Cursor.")
    print("W pickerze: Settings → Models → włącz MiniMax-M3.")
    print("Wymagane: Cursor Pro dla custom modeli MiniMax.")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1].lower()
    if cmd == "apply":
        return cmd_apply()
    if cmd == "inspect":
        return cmd_inspect()
    if cmd == "verify":
        return cmd_verify()
    print(f"Nieznana komenda: {cmd}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
