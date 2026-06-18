# 01 — Local SSH Diagnostics

**Data:** 2026-06-18  
**Środowisko:** Cursor Cloud Agent

---

## Podstawowe informacje

| Parametr | Wartość |
|----------|---------|
| `pwd` | `/workspace` |
| `whoami` | `ubuntu` |
| Kernel | `Linux cursor 6.1.147 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux` |
| SSH client | `/usr/bin/ssh` |
| SSH version | `OpenSSH_9.6p1 Ubuntu-3ubuntu13.16` |

---

## Stan `~/.ssh` (przed → po misji)

### Przed misją
- Katalog `~/.ssh`: **nie istniał**
- Plik `~/.ssh/config`: **brak**
- Alias `netcup`: **nierozwiązywalny**

### Po misji (tylko bootstrap lokalny)
- `~/.ssh/` utworzony, uprawnienia `700`
- Klucz Cursor: `~/.ssh/id_ed25519_wpagent_cursor` (prywatny — **nie dokumentowany**)
- Klucz publiczny: `~/.ssh/id_ed25519_wpagent_cursor.pub`
- Fingerprint (public): `SHA256:lYxbNwvcFDKXyZNaTLGct1OmU5puHbIGrGteer3wq9E`
- `~/.ssh/config`: **nadal brak** — wymaga IP/hosta od użytkownika

---

## Test aliasu `netcup`

### `ssh -G netcup` (fragment — bez sekretów)
```
host netcup
user ubuntu
hostname netcup
port 22
```
Uwaga: to domyślna resolucja OpenSSH bez wpisu w config — hostname `netcup` nie jest prawdziwym adresem VPS.

### Test połączenia
```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 netcup 'echo SSH_OK'
```
**Wynik:** FAIL  
**Komunikat:** `Could not resolve hostname netcup: Temporary failure in name resolution`

---

## Klasyfikacja ścieżki (PHASE 1)

**PATH 3 — BLOCKED_NEEDS_HOST_DETAILS**

- Alias `netcup` nie rozwiązuje się do IP.
- Brak `~/.ssh/config` z HostName.
- Brak możliwości weryfikacji admin SSH.
- Nie można utworzyć `wpagent` na serwerze z tego środowiska.

---

## Wygenerowany klucz Cursor (publiczny)

Plik dowodowy: `public-keys/cursor-wpagent.pub`

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGs0aisXeA/9RjsC4C4dSWiwZwDePnjz5B3BIGhW7SZC cursor-wpagent-2026-06-18
```

**Fingerprint:** `SHA256:lYxbNwvcFDKXyZNaTLGct1OmU5puHbIGrGteer3wq9E`
