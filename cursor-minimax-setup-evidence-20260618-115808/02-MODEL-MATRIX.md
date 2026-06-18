# 02 — Model Matrix

| Model ID | Direct API | Cursor UI dodany? | Cursor test | Uwagi |
|----------|------------|-------------------|-------------|-------|
| MiniMax-M3 | **PASS** | nie (ręcznie) | NOT_TESTED | Rekomendowany primary |
| MiniMax-M2.7 | **PASS** | nie (ręcznie) | NOT_TESTED | Stabilny fallback |
| MiniMax-M2.7-highspeed | **PASS** | nie (ręcznie) | NOT_TESTED | Szybki fallback |
| MiniMax-M2.5 | **PASS** | nie (ręcznie) | NOT_TESTED | |
| MiniMax-M2.5-highspeed | **PASS** | nie (ręcznie) | NOT_TESTED | |
| MiniMax-M2.1 | **PASS** | nie (ręcznie) | NOT_TESTED | |
| MiniMax-M2 | **PASS** | nie (ręcznie) | NOT_TESTED | |

**Endpoint:** `https://api.minimax.io/v1`  
**Auth:** `Authorization: Bearer MINIMAX_API_KEY_REDACTED`

## Legenda statusów

- **PASS** — HTTP 200, poprawna odpowiedź chat completion
- **NOT_TESTED** — wymaga konfiguracji w Cursor UI na urządzeniu użytkownika
