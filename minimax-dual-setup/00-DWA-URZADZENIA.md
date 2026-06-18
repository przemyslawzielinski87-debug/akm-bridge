# Dwa urządzenia — dwa osobne setupy MiniMax

| Urządzenie | Co to jest | Setup | Status |
|------------|------------|-------|--------|
| **A — Cloud Agent** | Serwer Cursor (`/workspace`, agent w chmurze) | `cloud-agent/install.sh` | Skrypty, `.env`, API testy |
| **B — Lokalny Cursor** | Twój telefon/komputer z aplikacją Cursor | `local-cursor/install.sh` | Picker modeli, `state.vscdb` |

**Nie mieszaj:** konfiguracja A nie pojawia się w pickerze na B i odwrotnie.

## A — Cloud Agent (już na serwerze)

```bash
bash minimax-dual-setup/cloud-agent/install.sh
bash minimax-dual-setup/cloud-agent/status.sh
```

## B — Lokalny Cursor (na Twoim PC — zamknij Cursor wcześniej)

```bash
cd /ścieżka/do/repo
bash minimax-dual-setup/local-cursor/install.sh
```

Klucz: skopiuj `minimax-dual-setup/local-cursor/.env.template` → `~/.cursor-minimax/local.env` i wklej klucz MiniMax (lub skrypt zapyta).

## Wymagania MiniMax w pickerze (urządzenie B)

- Cursor **Pro**
- Base URL: `https://api.minimax.io/v1`
- Model: `MiniMax-M3` (dokładna nazwa)
