# 01 — Status konfiguracji MiniMax w Cursor

**Data UTC:** 2026-06-18  
**Środowisko:** Cursor Cloud Agent (Linux, `/workspace`)  
**Klucz API:** ustawiony tymczasowo przez użytkownika — **MINIMAX_API_KEY_REDACTED** (nigdy nie logowany)

---

## Podsumowanie

| Pole | Wartość |
|------|---------|
| `CURSOR_MINIMAX_SETUP_STATUS` | **PARTIAL → WORKSPACE_READY** |
| `DIRECT_API` | **PASS** |
| `CURSOR_CONFIG` | **WORKSPACE_AUTO** (`.env` + settings na VM + skrypt desktop) |
| `PRIMARY_MODEL` | `MiniMax-M3` |
| `FALLBACK_MODEL` | `MiniMax-M2.7-highspeed` |
| `BASE_URL` | `https://api.minimax.io/v1` |

---

## Wynik testu bezpośredniego API

Wszystkie 7 modeli tekstowych/kodujących zwróciło **HTTP 200** z poprawnym obiektem `chat.completion`:

- MiniMax-M3 — PASS
- MiniMax-M2.7 — PASS
- MiniMax-M2.7-highspeed — PASS
- MiniMax-M2.5 — PASS
- MiniMax-M2.5-highspeed — PASS
- MiniMax-M2.1 — PASS
- MiniMax-M2 — PASS

Endpoint: `https://api.minimax.io/v1/chat/completions`

---

## Konfiguracja Cursor UI

**Nie wykonano automatycznie** — Cloud Agent nie ma dostępu do ustawień Cursor Desktop na telefonie użytkownika.

Wymagane ręcznie (patrz `03-USER-INSTRUCTIONS-PHONE.md`):

1. Cursor → Settings → Models
2. OpenAI API Key → wklej tymczasowy klucz MiniMax
3. Włącz **Override OpenAI Base URL** → `https://api.minimax.io/v1`
4. Dodaj modele custom (7 ID z listy)
5. Verify / test w czacie

---

## Ograniczenia Cursor

- Override OpenAI Base URL może wpływać na inne modele OpenAI-compatible — przełączaj tylko gdy używasz MiniMax.
- Jeśli błędy TLS/HTTP2: Settings → Network → HTTP Compatibility Mode → HTTP/1.1.
- Testy w UI Cursor: **NOT_TESTED** z tego środowiska.

---

## Następny krok

Skonfiguruj MiniMax w Cursor na telefonie według `03-USER-INSTRUCTIONS-PHONE.md`, wybierz `MiniMax-M3` i wyślij test: `Reply with exactly: CURSOR_MINIMAX_M3_OK`.

Po zakończeniu testów **zrotuj klucz API** w panelu MiniMax (klucz był widoczny na czacie).
