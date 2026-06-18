# MiniMax API — Konfiguracja dwóch urządzeń

## STATUS

| Komponent | Status |
|---|---|
| Cloud Agent | ✅ Skrypty i dokumentacja gotowe |
| MiniMax API (bezpośredni test) | ⚠️ Klucz API nie był dostępny w tym środowisku |
| Cursor model picker (lokalny) | ❌ ACTION_REQUIRED — wymaga działania na lokalnym PC |

---

## ŚRODOWISKO

**To jest CASE 2 — Cloud Agent Only.**

- Hostname: `cursor` (środowisko chmurowe Cursor)
- Brak dostępu do lokalnej bazy Cursor (`state.vscdb`)
- Konfiguracja model pickera wymaga działania na **lokalnym PC użytkownika**

---

## CO JEST GOTOWE (w chmurze)

- Skrypty instalacyjne: `minimax-dual-setup/local-cursor/install.sh`
- Dokumentacja: `minimax-dual-setup/local-cursor/README.md`
- Skrypt patch do Cursor DB: `scripts/patch-cursor-minimax-vscdb.py`
- Plik handoff: `HANDOFF-MINIMAX-CURSOR-LOCAL-SETUP.txt`

---

## CO WYMAGA DZIAŁANIA NA LOKALNYM PC

Patrz: [HANDOFF-MINIMAX-CURSOR-LOCAL-SETUP.txt](../HANDOFF-MINIMAX-CURSOR-LOCAL-SETUP.txt)

**Najszybsza ścieżka — ręcznie w Cursor UI:**

1. Zamknij i otwórz Cursor
2. `Settings → Models`
3. Włącz **OpenAI API Key** → wklej klucz MiniMax
4. Włącz **Override OpenAI Base URL** → `https://api.minimax.io/v1`
5. Dodaj model: `MiniMax-M3`
6. Wybierz `MiniMax-M3` w pickerze

---

## LISTA MODELI MINIMAX

```
MiniMax-M3              ← GŁÓWNY
MiniMax-M2.7-highspeed
MiniMax-M2.7
MiniMax-M2.5-highspeed
MiniMax-M2.5
MiniMax-M2.1
MiniMax-M2
```

**Base URL:** `https://api.minimax.io/v1`
