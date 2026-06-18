# 03 — MiniMax SSH Instructions

**Data:** 2026-06-18  
**Stan:** `WAITING_FOR_PUBLIC_KEY` + `BLOCKED_PENDING_VPS_HOST`

---

## WKLEJ DO MINIMAX (teraz — krok 1: wygeneruj klucz)

```
Wygeneruj w tym środowisku MiniMax dedykowaną parę kluczy SSH ed25519 do dostępu do VPS WordPress (projekt The Meridian / Strategikon).

Wymagania:
- Nazwa klucza np. id_ed25519_wpagent_minimax
- NIE drukuj klucza prywatnego
- Zwróć TYLKO linię klucza publicznego zaczynającą się od ssh-ed25519
- Podaj ścieżkę gdzie zapisany jest klucz prywatny w Twoim środowisku (bez jego treści)
- Jeśli platforma ma vault/secrets — zapisz klucz prywatny tam, nie na czacie

NIE łącz się jeszcze z serwerem. Czekaj aż użytkownik potwierdzi, że Twój klucz publiczny został dodany do konta wpagent na VPS.

Po potwierdzeniu dostępu wrócimy do opcji 1 (realna inspekcja read-only).
```

---

## WKLEJ DO MINIMAX (po autoryzacji klucza i skonfigurowaniu SSH — krok 2)

Użyj dopiero gdy:
- użytkownik podał IP/host VPS,
- `wpagent` istnieje na serwerze,
- Twój klucz publiczny jest w `/home/wpagent/.ssh/authorized_keys`,
- alias `netcup` działa w Twoim środowisku.

```
Wybierz opcję 1 — realna inspekcja VPS przez SSH.

Dostęp do serwera ma iść przez dedykowane konto wpagent oraz klucz SSH wygenerowany w Twoim środowisku. Nie używaj haseł i nie pokazuj klucza prywatnego.

Najpierw zweryfikuj:
  whoami
  hostname
  id
  pwd
  date -u
  uptime

Następnie wykonaj context-builder WordPress/VPS w trybie read-only. Nie modyfikuj WordPressa, Dockera, nginx, bazy, Cloudflare ani kodu produkcyjnego.

Jedyny dozwolony zapis: katalog dowodów np. /home/wpagent/wp-context-builder-YYYYMMDD-HHMMSS/ lub /root/wp-context-builder-YYYYMMDD-HHMMSS/ jeśli masz dostęp.

Wszystkie dane, których nie możesz odczytać, oznacz jako UNKNOWN_WITH_REASON.

Na końcu oddaj krótkie podsumowanie po polsku, ścieżkę do evidence i plik 07-SUPERVISING-AGENT-HANDOFF.md.
```

---

## Klucz publiczny Cursor (do autoryzacji na VPS przez użytkownika)

Ten klucz można bezpiecznie dodać do `wpagent` na serwerze:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGs0aisXeA/9RjsC4C4dSWiwZwDePnjz5B3BIGhW7SZC cursor-wpagent-2026-06-18
```

**Fingerprint:** `SHA256:lYxbNwvcFDKXyZNaTLGct1OmU5puHbIGrGteer3wq9E`

Plik w dowodach: `public-keys/cursor-wpagent.pub`

---

## Szablon SSH config dla MiniMax (po otrzymaniu IP od użytkownika)

```
Host netcup
    HostName <IP_LUB_HOSTNAME_VPS>
    User wpagent
    Port 22
    IdentityFile <ścieżka_do_klucza_prywatnego_minimax>
    IdentitiesOnly yes
    BatchMode yes
```

Zastąp `<IP_LUB_HOSTNAME_VPS>` i ścieżkę klucza — **bez wklejania klucza prywatnego na czat**.
