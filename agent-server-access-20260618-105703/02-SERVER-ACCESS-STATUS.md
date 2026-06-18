# 02 — Server Access Status

**Data:** 2026-06-18  
**Status ogólny:** `BLOCKED`

---

## Podsumowanie

| Pole | Wartość |
|------|---------|
| `SSH_NETCUP` | **FAIL** |
| `ACCESS_PATH` | PATH 3 — `BLOCKED_NEEDS_HOST_DETAILS` |
| `AGENT_USER` | `wpagent` — **nie utworzono** (brak admin SSH) |
| `CURSOR_KEY` | Wygenerowany lokalnie — **nie autoryzowany na VPS** |
| `MINIMAX_KEY` | **oczekuje** — MiniMax ma wygenerować własny klucz |
| `SERVER_INSPECTION` | **nie wykonano** — brak połączenia |

---

## Co zablokowało dostęp

1. Brak rozwiązywalnego hostname/IP dla aliasu `netcup` w środowisku Cursor.
2. Brak pliku `~/.ssh/config` z metadanymi połączenia.
3. Brak istniejącego admin SSH z tego środowiska.

---

## Czego potrzebujemy od użytkownika (tylko nie-sekrety)

Podaj w czacie lub w pliku konfiguracyjnym:

| Metadane | Przykład | Wymagane |
|----------|----------|----------|
| Hostname lub IP VPS | `123.45.67.89` lub `vps.example.net` | TAK |
| Port SSH | `22` (domyślnie) | opcjonalnie |
| User admin do bootstrapu | `root` lub inny z sudo | TAK |
| Potwierdzenie konta `wpagent` | tak/nie | zalecane TAK |

**NIE podawaj:** haseł, kluczy prywatnych, tokenów API.

---

## Plan odblokowania (3 kroki)

### Krok A — Bootstrap na VPS (z Twojego zaufanego terminala)
Uruchom jako root/admin na VPS skrypt z `scripts/vps-bootstrap-wpagent.sh`  
(lub ręcznie dodaj klucz publiczny Cursor do `wpagent` — patrz skrypt).

### Krok B — Config SSH w Cursor
Uzupełnij szablon `scripts/ssh-config-netcup.template` → `~/.ssh/config`  
z prawdziwym IP i ścieżką do klucza `wpagent`.

### Krok C — Weryfikacja
```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 netcup 'echo SSH_OK; whoami; hostname'
```
Oczekiwany wynik: `SSH_OK`, `wpagent`, hostname VPS.

---

## Zmiany na VPS w tej misji

**Brak.** Serwer nie był dostępny — zero modyfikacji po stronie produkcji.
