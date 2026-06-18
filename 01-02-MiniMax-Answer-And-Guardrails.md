# MiniMax — Odpowiedź i guardrails (Etap 1/01, Podkrok 2/02)

**Data przygotowania:** 2026-06-18  
**Środowisko Cursor:** `/workspace` (ubuntu, Linux)  
**Test SSH alias `netcup`:** **FAIL** — brak `~/.ssh`, brak wpisu `netcup` w konfiguracji SSH w tym środowisku.

---

## 1. Krótka odpowiedź do wklejenia w MiniMax (AKTUALNA — opcja 2)

```
Wybierz opcję 2 — na razie tylko lokalnie, bez połączenia z serwerem.

Nie masz dostępu SSH do VPS netcup z tego środowiska. Nie udawaj inspekcji produkcji.
Wygeneruj szablony procedur context-buildera i pliki markdown z placeholderami.
Wszystkie dane serwerowe oznacz jako UNKNOWN_PENDING_SSH.

Zapisuj wyłącznie w lokalnym katalogu roboczym (np. ./wp-context-builder-YYYYMMDD-HHMMSS/).
Produkcja pozostaje poza zasięgiem — zero modyfikacji WordPressa, Dockera, nginx, bazy, Cloudflare.

Na końcu: krótkie podsumowanie po polsku + ścieżka do katalogu dowodów + lista tego, czego brakuje do realnej inspekcji VPS.
Poproś użytkownika o skonfigurowanie aliasu SSH `netcup` (klucz/agent) — bez wklejania haseł ani sekretów na czacie.
```

---

## 2. Krótka odpowiedź do wklejenia w MiniMax (Gdy SSH `netcup` zadziała — opcja 1)

Użyj tej wersji dopiero po skonfigurowaniu aliasu `netcup` i pomyślnym teście:

```
Wybierz opcję 1 — wykonaj na VPS netcup przez SSH.

Użyj istniejącego aliasu SSH: netcup
Uwierzytelnianie wyłącznie przez już skonfigurowany klucz/agent — zero sekretów na czacie.

Produkcja jest READ-ONLY. Jedyny dozwolony zapis: nowy katalog dowodów:
/root/wp-context-builder-YYYYMMDD-HHMMSS/
(lub $HOME/wp-context-builder-YYYYMMDD-HHMMSS/ jeśli brak dostępu do /root)

NIE modyfikuj: /var/www/strategikon, /opt/strategikon, bazy WordPress, nginx, docker, systemd, cron, Cloudflare, motywów, pluginów, MU-pluginów, uploads.

Zbierz kontekst forensyczny i zapisz pliki markdown w katalogu dowodów.
Na końcu: krótkie podsumowanie po polsku + ścieżka do katalogu dowodów + ścieżka do 07-SUPERVISING-AGENT-HANDOFF.md
```

---

## 3. Guardrails dla MiniMax (dłuższy blok)

### Cel misji
- **NIE** deployment, **NIE** naprawa — wyłącznie odkrywanie kontekstu (forensics) dla przyszłego agenta nadzorującego WordPress The Meridian / Strategikon (TheMeridian.com.pl).
- Maksymalny kontekst: topologia serwera, instalacja WP, motywy, MU-pluginy, pluginy, routing, Docker/nginx/Traefik, SEO/AI-search, ryzyka, luki.

### Gdzie wykonywać
| Stan SSH | Działanie |
|----------|-----------|
| `netcup` działa (BatchMode, bez hasła) | Opcja 1 — SSH na VPS, zapis tylko w katalogu dowodów |
| Brak SSH / hasło wymagane | Opcja 2 — lokalne szablony, `UNKNOWN_PENDING_SSH` |

### Dozwolone operacje (read-only na produkcji)
- `ls`, `find`, `cat`, `head`, `tail`, `grep` (bez `-i` modyfikujących pliki)
- `docker ps`, `docker inspect`, `docker compose config` (bez `up`/`down`/`restart`)
- `systemctl status` (bez `restart`/`stop`/`start`)
- `wp --path=... core version`, `wp plugin list`, `wp theme list` (tylko odczyt)
- `nginx -t` tylko jeśli nie wymaga zapisu; preferuj `cat` konfiguracji
- Tworzenie **wyłącznie** katalogu `/root/wp-context-builder-YYYYMMDD-HHMMSS/` (lub `$HOME/...`)

### Zasady redakcji
- Redaguj: tokeny, hasła, API keys, cookies, klucze prywatne, sola WP, hasła DB, bearer credentials.
- W pliku `99-REDACTION-AND-SAFETY-NOTES.md` dokumentuj co zostało zredagowane (bez ujawniania wartości).

### Zatrzymaj się i zapytaj użytkownika gdy
- Nie wiesz która instalacja WP jest produkcyjna
- Komenda wymagałaby zapisu poza katalogiem dowodów
- Napotkasz sekrety w plain text — zredaguj i kontynuuj ostrożnie
- Ścieżki `/var/www/strategikon` lub `/opt/strategikon` nie istnieją — mapuj alternatywy bez zgadywania

---

## 4. Checklist — zakazane działania

- [ ] Modyfikacja plików aplikacji produkcyjnej
- [ ] Edycja motywów, pluginów, MU-pluginów, uploads
- [ ] Zmiany nginx, docker-compose, systemd, cron
- [ ] Zmiany Cloudflare
- [ ] `wp option update`, aktywacja/deaktywacja pluginów, migracje DB
- [ ] `composer install`, `npm install`, instalacja pakietów
- [ ] `docker compose up/down/restart`, `systemctl restart`, restart usług
- [ ] Cache purge (Cloudflare, WP, Redis itp.)
- [ ] `chmod`, `chown`, `rm`, `mv`, `truncate`
- [ ] `sed -i`, `perl -pi`, `wp search-replace`, `wp db import`
- [ ] `git reset`, `git clean`, `git checkout`, `git pull`, `git merge`
- [ ] Wklejanie lub logowanie sekretów w outputach
- [ ] Udawanie że serwer został zbadany gdy SSH nie działa

---

## 5. Oczekiwana struktura dowodów (na VPS — po przywróceniu SSH)

```
/root/wp-context-builder-YYYYMMDD-HHMMSS/
├── 00-RUN-METADATA.md
├── 01-SERVER-AND-RUNTIME-CONTEXT.md
├── 02-WORDPRESS-INVENTORY.md
├── 03-THEME-AND-MU-PLUGINS-CONTEXT.md
├── 04-ROUTING-DOMAIN-DOCKER-NGINX-CONTEXT.md
├── 05-SEO-AI-SEARCH-AUTOMATION-CONTEXT.md
├── 06-RISKS-GAPS-QUESTIONS.md
├── 07-SUPERVISING-AGENT-HANDOFF.md    ← NAJWAŻNIEJSZY
└── 99-REDACTION-AND-SAFETY-NOTES.md
```

### Zawartość `07-SUPERVISING-AGENT-HANDOFF.md` (dla przyszłego agenta ChatGPT)
1. Aktualny stan projektu
2. Topologia serwera
3. Szczegóły instalacji WordPress
4. Aktywny motyw + child/custom theme
5. Inwentarz MU-pluginów
6. Inwentarz zwykłych pluginów
7. CPT / taksonomie / schema / SEO / AI-search
8. Architektura frontend/UI
9. Ścieżka deploymentu i routingu
10. Znane ryzyka
11. Co **nie wolno** zmieniać bez jawnej zgody
12. Rekomendowane następne kroki
13. Otwarte pytania do użytkownika

### Lokalna struktura (opcja 2 — teraz)
Ten sam układ plików, ale:
- Prefiks ścieżek serwerowych: `UNKNOWN_PENDING_SSH`
- Sekcje „do wypełnienia po SSH” z checklistą komend read-only do uruchomienia później
- `00-RUN-METADATA.md` musi zawierać: `execution_mode: LOCAL_TEMPLATE_ONLY`, `ssh_alias_tested: FAIL`

---

## 6. Notatki z preflight Cursor (szczegóły)

| Test | Wynik |
|------|-------|
| `pwd` | `/workspace` |
| `whoami` | `ubuntu` |
| `uname -a` | Linux cursor 6.1.147 x86_64 |
| `ssh` | `/usr/bin/ssh`, OpenSSH_9.6p1 |
| `~/.ssh` | **brak katalogu** |
| `ssh -o BatchMode=yes netcup ...` | **FAIL** — `Could not resolve hostname netcup` |

### Co użytkownik musi zrobić aby odblokować opcję 1
1. Skonfigurować `~/.ssh/config` z hostem `netcup` (hostname/IP VPS, user, IdentityFile).
2. Załadować klucz do agenta lub zapewnić dostęp bez hasła w sesji MiniMax/Cursor.
3. Powtórzyć test:  
   `ssh -o BatchMode=yes -o ConnectTimeout=10 netcup 'echo SSH_OK; hostname; whoami'`
4. Po `SSH_OK` — wkleić MiniMax wersję odpowiedzi z sekcji 2 (opcja 1).

**Nie proś o hasła ani klucze prywatne na czacie.**
