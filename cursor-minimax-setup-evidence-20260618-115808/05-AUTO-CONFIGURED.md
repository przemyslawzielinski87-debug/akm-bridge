# 05 — Auto-konfiguracja (bez UI telefonu)

**Data:** 2026-06-18  
**Na żądanie użytkownika:** pełna automatyzacja (telefon niedostępny)

---

## Co zostało ustawione automatycznie

| Element | Status | Ścieżka |
|---------|--------|---------|
| Klucz API MiniMax | **OK** | `/workspace/.env` (chmod 600, **gitignored**) |
| Zmienne OPENAI_* | **OK** | w `.env` + auto-load w `~/.bashrc` |
| Base URL MiniMax | **OK** | `https://api.minimax.io/v1` |
| Walidacja API (7 modeli) | **PASS** | ponowny test po `.env` |
| Cursor settings (Linux VM) | **OK** | `~/.config/Cursor/User/settings.json` |
| Cloud agent bootstrap | **OK** | `.cursor/environment.json` |
| Instalator na komputer | **OK** | `scripts/install-cursor-minimax-desktop.sh` |

---

## Modele skonfigurowane

- MiniMax-M3 (primary)
- MiniMax-M2.7-highspeed (fast)
- MiniMax-M2.7 (stable)
- MiniMax-M2.5, MiniMax-M2.5-highspeed, MiniMax-M2.1, MiniMax-M2

---

## Ograniczenie Cloud Agent

Ustawienia zapisane na **tym serwerze agenta** (`~/.config/Cursor/User/settings.json`).  
Jeśli na telefonie używasz **aplikacji Cursor** (nie tego VM), wybór modelu MiniMax w UI telefonu nadal wymaga synchronizacji konta Cursor lub uruchomienia instalatora na komputerze.

**Na komputerze (jedna komenda):**
```bash
bash /workspace/scripts/install-cursor-minimax-desktop.sh
```
Skrypt czyta klucz z `/workspace/.env` jeśli istnieje.

---

## Bezpieczeństwo

- Klucz **nie** trafił do gita.
- Klucz był na czacie — **zrotuj po testach** w panelu MiniMax.
- Stary klucz zamień w `/workspace/.env` i uruchom ponownie instalator desktop.
