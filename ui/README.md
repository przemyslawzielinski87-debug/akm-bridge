# AKM Knowledge Panel — UI

Read-only visual panel for AKM Knowledge Bridge.

## Quick Start

Service runs at `http://127.0.0.1:4199`.

| Route | Purpose |
|---|---|
| `/` or `/akm` | Panel HTML |
| `/assets/*` | JS, CSS assets |
| `/api/akm/*` | REST API (same-origin) |

## Pages

- **Overview**: health, version, stats, search modes, recent activity
- **Search**: full-text/semantic/hybrid search with type filters, result cards, split preview
- **Sources**: source cards with writable/read-only badges, paths, entry counts
- **Activity**: operation log with timestamps, durations, status badges
- **Capabilities**: read-only banner, available operations, supported asset types

## Build

```sh
npx esbuild ui/src/app.ts --bundle --outfile=ui/assets/app.js --format=esm --target=es2020
cp ui/styles/akm-panel.css ui/assets/akm-panel.css
```

## Design

- No framework, no dependencies
- `textContent`-based rendering — no innerHTML
- Tab navigation, keyboard accessible
- Mobile responsive (horizontal tab scroll, full-screen preview drawer)
- Error states preserve previous valid data
