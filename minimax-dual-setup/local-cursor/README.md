# MiniMax in Cursor — Local Setup

## Quick start (manual UI — recommended)

1. **Close** Cursor completely
2. **Reopen** Cursor
3. Go to `Settings → Models` (or `Cursor Settings → Models`)
4. Enable **OpenAI API Key** toggle → paste your MiniMax API key
5. Enable **Override OpenAI Base URL** toggle → enter:
   ```
   https://api.minimax.io/v1
   ```
6. Under **Custom Models**, add:
   ```
   MiniMax-M3
   ```
7. Optionally add fallback models:
   ```
   MiniMax-M2.7-highspeed
   MiniMax-M2.7
   MiniMax-M2.5-highspeed
   MiniMax-M2.5
   MiniMax-M2.1
   MiniMax-M2
   ```
8. Enable toggles for each model you added
9. Select `MiniMax-M3` as active model in the picker
10. Test with a simple prompt

---

## Quick start (script — one command)

Run this on your **local PC** with Cursor **fully closed**:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/minimax-dual-setup/local-cursor/install.sh)
```

Or clone the repo and run locally:

```bash
git clone <YOUR_REPO_URL>
cd <REPO>/minimax-dual-setup/local-cursor
bash install.sh
```

---

## Prerequisites

- Cursor Pro (or a plan that supports custom OpenAI-compatible models)
- MiniMax API key from: https://platform.minimax.io/
- Cursor must be **fully closed** when running the script

---

## Models

| Model | Notes |
|---|---|
| `MiniMax-M3` | Primary — best quality |
| `MiniMax-M2.7-highspeed` | Fast fallback |
| `MiniMax-M2.7` | Balanced |
| `MiniMax-M2.5-highspeed` | Fast |
| `MiniMax-M2.5` | Standard |
| `MiniMax-M2.1` | Older |
| `MiniMax-M2` | Legacy fallback |

**API base URL:** `https://api.minimax.io/v1`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Model not found in picker | Verify exact name, re-add in Settings → Models |
| Auth error | Check API key, re-paste in Settings |
| Wrong base URL | Must be exactly `https://api.minimax.io/v1` |
| Models not showing | Restart Cursor after adding |
| Still failing | Run direct curl test (see below) |

### Direct curl test (no Cursor)

```bash
# Store key safely first, never echo it
export MINIMAX_API_KEY="your-key-here"

curl -s -o /tmp/minimax-test.json \
  -H "Authorization: Bearer $MINIMAX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"ping"}],"max_tokens":16}' \
  https://api.minimax.io/v1/chat/completions

cat /tmp/minimax-test.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('choices') else d.get('error',{}).get('message','FAIL'))"
```

---

## After setup

- Rotate your MiniMax API key at https://platform.minimax.io/ after any test where the key was visible in plaintext
- Do not commit the key to any repository
