#!/usr/bin/env python3
"""
patch-cursor-minimax-vscdb.py

Patches a local Cursor state.vscdb to add MiniMax OpenAI-compatible API settings.

REQUIREMENTS:
- Cursor must be FULLY CLOSED before running
- Backs up the DB before patching

USAGE:
    python3 patch-cursor-minimax-vscdb.py \
        --db ~/.config/Cursor/User/globalStorage/state.vscdb \
        --base-url https://api.minimax.io/v1 \
        --models MiniMax-M3 MiniMax-M2.7-highspeed \
        --env-file ~/.cursor-minimax/local.env

SECURITY:
- Does not print or log API key
- Reads key from env file or MINIMAX_API_KEY environment variable
- Creates backup before any patch
"""

import argparse
import json
import os
import shutil
import sqlite3
import sys
import time


DEFAULT_MODELS = [
    "MiniMax-M3",
    "MiniMax-M2.7-highspeed",
    "MiniMax-M2.7",
    "MiniMax-M2.5-highspeed",
    "MiniMax-M2.5",
    "MiniMax-M2.1",
    "MiniMax-M2",
]

MINIMAX_BASE_URL = "https://api.minimax.io/v1"

# Cursor state.vscdb keys known to hold model/API config
CURSOR_OPENAI_KEY_SETTING = "cursor.aiSettings.openaiApiKey"
CURSOR_OPENAI_BASE_URL_SETTING = "cursor.aiSettings.openaiBaseUrl"
CURSOR_CUSTOM_MODELS_SETTING = "cursor.aiSettings.customModels"


def load_api_key(env_file=None):
    """Load API key from env file or environment variable. Never print."""
    key = os.environ.get("MINIMAX_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not key and env_file and os.path.isfile(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line.startswith("MINIMAX_API_KEY="):
                    key = line.split("=", 1)[1].strip()
                    break
    return key


def backup_db(db_path):
    """Create timestamped backup of the database."""
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    backup_path = f"{db_path}.backup-{timestamp}"
    shutil.copy2(db_path, backup_path)
    print(f"✓ Backup created: {backup_path}")
    return backup_path


def read_cursor_settings(conn):
    """Read all Cursor settings from the ItemTable."""
    cur = conn.execute("SELECT key, value FROM ItemTable WHERE key LIKE 'cursor.%'")
    return {row[0]: row[1] for row in cur.fetchall()}


def upsert_setting(conn, key, value):
    """Insert or update a key in Cursor's ItemTable."""
    conn.execute(
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)",
        (key, value),
    )


def patch_db(db_path, api_key, base_url, models):
    """Patch the Cursor state.vscdb with MiniMax settings."""
    conn = sqlite3.connect(db_path)

    try:
        existing = read_cursor_settings(conn)
        print(f"Found {len(existing)} existing cursor.* settings")

        # Store API key
        upsert_setting(conn, CURSOR_OPENAI_KEY_SETTING, api_key)
        print(f"✓ Set {CURSOR_OPENAI_KEY_SETTING} (key hidden)")

        # Store base URL
        upsert_setting(conn, CURSOR_OPENAI_BASE_URL_SETTING, base_url)
        print(f"✓ Set {CURSOR_OPENAI_BASE_URL_SETTING} = {base_url}")

        # Merge custom models (preserve existing, add new ones)
        existing_models_raw = existing.get(CURSOR_CUSTOM_MODELS_SETTING, "[]")
        try:
            existing_models = json.loads(existing_models_raw)
        except (json.JSONDecodeError, TypeError):
            existing_models = []

        existing_names = {
            m.get("name") if isinstance(m, dict) else m
            for m in existing_models
        }

        added = []
        for model_name in models:
            if model_name not in existing_names:
                existing_models.append({"name": model_name, "enabled": True})
                added.append(model_name)

        upsert_setting(
            conn,
            CURSOR_CUSTOM_MODELS_SETTING,
            json.dumps(existing_models),
        )

        if added:
            print(f"✓ Added {len(added)} new models: {', '.join(added)}")
        else:
            print("✓ All models already present, no changes to model list")

        conn.commit()
        print("✓ Database patched and committed")

    finally:
        conn.close()


def verify_db(db_path, base_url, models):
    """Verify patch was applied correctly."""
    conn = sqlite3.connect(db_path)
    try:
        settings = read_cursor_settings(conn)

        ok = True

        stored_url = settings.get(CURSOR_OPENAI_BASE_URL_SETTING, "")
        if stored_url == base_url:
            print(f"✓ Base URL verified: {stored_url}")
        else:
            print(f"✗ Base URL mismatch: expected {base_url}, got {stored_url}")
            ok = False

        stored_key = settings.get(CURSOR_OPENAI_KEY_SETTING, "")
        if stored_key:
            print(f"✓ API key present (hidden)")
        else:
            print("✗ API key missing after patch")
            ok = False

        stored_models_raw = settings.get(CURSOR_CUSTOM_MODELS_SETTING, "[]")
        stored_models = json.loads(stored_models_raw)
        stored_names = {
            m.get("name") if isinstance(m, dict) else m
            for m in stored_models
        }
        for model in models:
            if model in stored_names:
                print(f"✓ Model present: {model}")
            else:
                print(f"✗ Model MISSING: {model}")
                ok = False

        return ok
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Patch Cursor state.vscdb for MiniMax API"
    )
    parser.add_argument(
        "--db",
        required=True,
        help="Path to state.vscdb",
    )
    parser.add_argument(
        "--base-url",
        default=MINIMAX_BASE_URL,
        help=f"MiniMax base URL (default: {MINIMAX_BASE_URL})",
    )
    parser.add_argument(
        "--models",
        nargs="+",
        default=DEFAULT_MODELS,
        help="Model names to add",
    )
    parser.add_argument(
        "--env-file",
        default=os.path.expanduser("~/.cursor-minimax/local.env"),
        help="Path to local.env with MINIMAX_API_KEY",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without modifying DB",
    )
    args = parser.parse_args()

    db_path = os.path.expanduser(args.db)

    if not os.path.isfile(db_path):
        print(f"ERROR: DB not found: {db_path}")
        sys.exit(1)

    api_key = load_api_key(args.env_file)
    if not api_key:
        print("ERROR: No API key found.")
        print("Set MINIMAX_API_KEY env var or create ~/.cursor-minimax/local.env")
        sys.exit(1)

    print(f"\nDB: {db_path}")
    print(f"Base URL: {args.base_url}")
    print(f"Models: {', '.join(args.models)}")
    print(f"Dry run: {args.dry_run}")
    print()

    if args.dry_run:
        print("[DRY RUN] No changes made.")
        return

    backup_db(db_path)

    print("\nPatching...")
    patch_db(db_path, api_key, args.base_url, args.models)

    print("\nVerifying...")
    ok = verify_db(db_path, args.base_url, args.models)

    if ok:
        print("\n✓ Patch successful.")
        print("\nNext steps:")
        print("  1. Open Cursor")
        print("  2. Go to Settings → Models")
        print("  3. Verify MiniMax-M3 appears and toggle is ON")
        print("  4. Select MiniMax-M3 as active model")
        print("  5. Test with a small prompt")
    else:
        print("\n✗ Patch verification failed. Check output above.")
        print("  Consider using manual UI setup instead.")
        sys.exit(1)


if __name__ == "__main__":
    main()
