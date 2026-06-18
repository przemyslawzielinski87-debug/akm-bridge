# URZĄDZENIE B — lokalny Cursor (telefon/komputer)

Ten folder konfiguruje **picker modeli** w Twojej aplikacji Cursor.

## Jedna komenda (zamknij Cursor wcześniej!)

```bash
bash minimax-dual-setup/local-cursor/install.sh
```

## Co robi instalator

1. Tworzy `~/.cursor-minimax/local.env` (jeśli brak) — **tylko na Twoim PC**
2. Patchuje `state.vscdb` (API key + base URL + modele MiniMax)
3. Aktualizuje `settings.json` Cursor
4. Weryfikuje bez drukowania klucza

## Pliki na Twoim urządzeniu (nie na serwerze agenta)

| Plik | Opis |
|------|------|
| `~/.cursor-minimax/local.env` | Klucz MiniMax — lokalny, gitignored |
| `~/.config/Cursor/.../state.vscdb` | Baza pickera modeli |
| `state.vscdb.bak-minimax` | Backup przed patchem |

## Po instalacji

1. Uruchom Cursor
2. Settings → Models → **OpenAI API Key = ON**
3. Włącz **MiniMax-M3**
4. Wybierz w pickerze

## Wymagania

- **Cursor Pro** (custom modele MiniMax)
- Cursor **2.4+** zalecany

## Nie działa?

Zobacz `../cursor-minimax-setup-evidence-20260618-115808/06-MODEL-PICKER-FIX.md`
