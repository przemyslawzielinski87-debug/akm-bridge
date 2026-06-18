# 05 — Next Handoff for Supervising Agent

**Data:** 2026-06-18  
**Misja:** ETAP 1/04 — bootstrap SSH dla agentów WordPress VPS

---

## Status dostępu

| Pole | Wartość |
|------|---------|
| **ACCESS_STATUS** | `BLOCKED` |
| **SSH_NETCUP** | `FAIL` |
| **AGENT_USER** | `wpagent` — nie utworzono |
| **MINIMAX_ACCESS** | `WAITING_FOR_PUBLIC_KEY` |
| **CURSOR_ACCESS** | Klucz wygenerowany, nie autoryzowany na VPS |

---

## Co zostało zrobione (lokalnie w Cursor)

1. Preflight SSH — potwierdzono brak aliasu `netcup` i brak config.
2. Wygenerowano dedykowany klucz ed25519 Cursor: `id_ed25519_wpagent_cursor`.
3. Public key zapisany w `public-keys/cursor-wpagent.pub`.
4. Przygotowano skrypt bootstrap VPS i szablon SSH config.
5. Przygotowano instrukcje MiniMax (generowanie własnego klucza).
6. Przygotowano plan rollback i draft sudoers (niezainstalowany).

---

## Co zostało zmienione na VPS

**Nic.** Brak połączenia SSH — zero zmian produkcyjnych.

---

## Ścieżki dowodów

```
/workspace/agent-server-access-20260618-105703/
├── 00-ACCESS-BOOTSTRAP-LOG.md
├── 01-LOCAL-SSH-DIAGNOSTICS.md
├── 02-SERVER-ACCESS-STATUS.md
├── 03-MINIMAX-SSH-INSTRUCTIONS.md
├── 04-REVOKE-ACCESS-ROLLBACK.md
├── 05-NEXT-HANDOFF-FOR-SUPERVISING-AGENT.md
├── optional-wpagent-sudoers-draft.txt
├── public-keys/cursor-wpagent.pub
└── scripts/
    ├── ssh-config-netcup.template
    └── vps-bootstrap-wpagent.sh
```

---

## Fingerprint klucza Cursor (public)

`SHA256:lYxbNwvcFDKXyZNaTLGct1OmU5puHbIGrGteer3wq9E`

---

## Gotowość MiniMax

| Etap | Stan |
|------|------|
| Wygenerowanie własnego klucza ed25519 | **DO ZROBIENIA** przez MiniMax |
| Autoryzacja klucza na VPS | **CZEKA** na użytkownika + bootstrap |
| Realna inspekcja WordPress (opcja 1) | **ZABLOKOWANA** do czasu SSH |

---

## Co agent nadzorujący może bezpiecznie zrobić dalej

### Teraz (bez SSH)
- Przejrzeć pliki dowodów w `/workspace/agent-server-access-20260618-105703/`.
- Poprowadzić użytkownika przez bootstrap (IP → skrypt VPS → config SSH).
- Koordynować wymianę **tylko kluczy publicznych** Cursor + MiniMax.

### Po odblokowaniu SSH
- Uruchomić context-builder WordPress w trybie **read-only**.
- Zbierać inwentarz: `/var/www/strategikon`, `/opt/strategikon`, Docker, nginx, WP-CLI.
- Produkcja: zero zapisów poza katalogiem dowodów.

### Wymaga osobnej zgody użytkownika
- Deployment, zmiany pluginów/motywów, migracje DB.
- Instalacja sudoers dla `wpagent`.
- Dodanie `wpagent` do grupy `docker` (root-equivalent).
- Restart usług, zmiany Cloudflare.

---

## Guardrails

| Tryb | Dozwolone | Zakazane |
|------|-----------|----------|
| Read-only inspection | ls, cat, wp list, docker ps, status usług | edycja plików prod, restart, wp update |
| Access bootstrap | utworzenie wpagent, authorized_keys | hasła SSH, broad sudo bez zgody |
| Deployment | — | wymaga osobnego promptu i approval |

---

## Otwarte pytania do użytkownika

1. Jaki jest **IP lub hostname** VPS netcup?
2. Jaki **user admin** masz do pierwszego bootstrapu (root/inny)?
3. Czy potwierdzasz utworzenie konta **`wpagent`**?
4. Czy chcesz później zatwierdzić profil sudo (draft w `optional-wpagent-sudoers-draft.txt`)?

**Nie odpowiadaj hasłami ani kluczami prywatnymi.**
