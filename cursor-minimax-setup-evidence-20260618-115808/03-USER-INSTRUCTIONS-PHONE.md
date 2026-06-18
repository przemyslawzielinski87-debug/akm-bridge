# 03 — Instrukcja na telefon (Android / Cursor)

## Szybka konfiguracja (5 kroków)

1. **Otwórz Cursor** → ikona koła zębatego **Settings**
2. Wejdź w **Models** (Modele)
3. W sekcji **OpenAI API Key** wklej swój klucz MiniMax (tymczasowy)
4. Włącz **Override OpenAI Base URL** i ustaw dokładnie:
   ```
   https://api.minimax.io/v1
   ```
5. Kliknij **Add model** / **Dodaj model** i dodaj po kolei:
   - MiniMax-M3
   - MiniMax-M2.7
   - MiniMax-M2.7-highspeed
   - MiniMax-M2.5
   - MiniMax-M2.5-highspeed
   - MiniMax-M2.1
   - MiniMax-M2

Zapisz ustawienia. Jeśli jest przycisk **Verify** — użyj go.

---

## Który model wybrać?

| Priorytet | Model | Kiedy |
|-----------|-------|-------|
| 1 | **MiniMax-M3** | Kodowanie, agenci, złożone zadania |
| 2 | **MiniMax-M2.7-highspeed** | Szybkie odpowiedzi |
| 3 | **MiniMax-M2.7** | Stabilny fallback |

---

## Test w czacie

Wybierz **MiniMax-M3** i wyślij:

```
Reply with exactly: CURSOR_MINIMAX_M3_OK
```

Jeśli odpowiedź jest sensowna — konfiguracja działa.

---

## Kiedy włączać/wyłączać override MiniMax

- **Włącz** override Base URL → gdy chcesz używać MiniMax
- **Wyłącz** override → gdy wracasz do domyślnych modeli Cursor/subskrypcji

Override wpływa na wszystkie wywołania OpenAI-compatible w Cursor.

---

## Problemy z połączeniem

Settings → **Network** → **HTTP Compatibility Mode** → wybierz **HTTP/1.1** i spróbuj ponownie.

---

## Wymiana klucza później

1. Wygeneruj nowy klucz w panelu MiniMax
2. Cursor → Settings → Models → zamień OpenAI API Key
3. Stary klucz unieważnij w panelu MiniMax
4. **Nie wklejaj kluczy na czat** — tylko w pole API Key w Cursor

⚠️ Klucz podany na czacie powinien zostać **zrotowany** po testach.
