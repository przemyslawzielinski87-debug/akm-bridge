# 04 — Revoke Access / Rollback

**Data:** 2026-06-18  
**Status:** Plan referencyjny — **nie wykonano** (brak dostępu do VPS w tej misji)

---

## Kiedy używać

Gdy chcesz cofnąć dostęp agentów (`wpagent`) do VPS — np. po zakończeniu prac lub podejrzeniu kompromitacji klucza.

---

## Procedura cofnięcia dostępu

### 1. Usuń klucze publiczne agentów

Na VPS jako root/admin:

```bash
# Edytuj authorized_keys (ręcznie lub selektywnie)
sudo -u wpagent nano /home/wpagent/.ssh/authorized_keys
```

Usuń linie z komentarzami:
- `# cursor-wpagent YYYY-MM-DD`
- `# minimax-wpagent YYYY-MM-DD`

Lub usuń cały plik jeśli chcesz zablokować wszystkie logowania kluczem:

```bash
sudo rm -f /home/wpagent/.ssh/authorized_keys
```

### 2. Opcjonalnie: zablokuj lub usuń konto `wpagent`

```bash
# Zablokuj hasło i shell (konto pozostaje, logowanie niemożliwe)
sudo usermod -L -s /usr/sbin/nologin wpagent

# LUB całkowite usunięcie konta i home
sudo userdel -r wpagent
```

### 3. Usuń sudoers (jeśli kiedyś zainstalowano — w tej misji NIE instalowano)

```bash
sudo rm -f /etc/sudoers.d/wpagent
sudo visudo -c   # weryfikacja składni sudoers
```

### 4. Weryfikacja — logowanie musi FAIL

Z maszyny agenta:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=8 wpagent@<VPS_IP> 'echo should_not_work'
```

Oczekiwany wynik: odmowa dostępu (Permission denied).

### 5. Lokalne czyszczenie (opcjonalnie)

Na środowisku Cursor/MiniMax:
- Usuń `~/.ssh/id_ed25519_wpagent_*` jeśli nie są już potrzebne
- Usuń wpis `Host netcup` z `~/.ssh/config`
- Usuń klucz z vault/secrets platformy

---

## Czego NIE robić przy rollbacku

- Nie restartuj SSH bez potrzeby (chyba że zmieniałeś `sshd_config`).
- Nie usuwaj istniejących kont admin/root użytkownika.
- Nie modyfikuj WordPressa, Dockera, nginx, bazy danych.

---

## Fingerprint klucza Cursor do identyfikacji przy usuwaniu

`SHA256:lYxbNwvcFDKXyZNaTLGct1OmU5puHbIGrGteer3wq9E`  
Komentarz w authorized_keys: `cursor-wpagent-2026-06-18`
