# MiniMax w Cursor — naprawa pickera modeli

## Dlaczego nie widzisz MiniMax?

Poprzednia konfiguracja poszła na **serwer Cloud Agenta**, a nie do **Twojej aplikacji Cursor** (telefon/komputer).  
Picker modeli czyta lokalną bazę SQLite `state.vscdb` na Twoim urządzeniu.

## Wymagania MiniMax (oficjalnie)

1. **Cursor Pro** — bez Pro custom modele MiniMax nie działają
2. Base URL: `https://api.minimax.io/v1`
3. Klucz zweryfikowany w Settings → Models
4. Modele dodane ręcznie lub skryptem (dokładna nazwa: `MiniMax-M3`)

## Naprawa na komputerze (1 komenda)

1. **Zamknij Cursor całkowicie**
2. W terminalu:

```bash
cd /workspace   # lub ścieżka do repo po git clone
python3 scripts/patch-cursor-minimax-vscdb.py apply
```

3. Uruchom Cursor ponownie
4. Settings → Models → sprawdź czy **OpenAI API Key** jest włączony
5. W pickerze wybierz **MiniMax-M3**

## Weryfikacja

```bash
python3 scripts/patch-cursor-minimax-vscdb.py verify
python3 scripts/patch-cursor-minimax-vscdb.py inspect
```

## Jeśli nadal pusto w pickerze

- Sprawdź plan: **Cursor Pro**
- Settings → Models → **View All Models** → wpisz `MiniMax-M3` → **Add Custom Model**
- Settings → Network → **HTTP Compatibility Mode → HTTP/1.1**
- Usuń zmienne środowiskowe `OPENAI_API_KEY` / `OPENAI_BASE_URL` z systemu (kolidują z MiniMax)
- Zaktualizuj Cursor do wersji **2.4+** (stare wersje miały bugi z custom modelami)

## Ścieżki bazy Cursor

| OS | state.vscdb |
|----|-------------|
| Linux | `~/.config/Cursor/User/globalStorage/state.vscdb` |
| macOS | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
| Windows | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` |

Skrypt robi backup: `state.vscdb.bak-minimax`
