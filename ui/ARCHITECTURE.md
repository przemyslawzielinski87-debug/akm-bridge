# Architecture — AKM Knowledge Panel

## File Structure

```
ui/
├── index.html                  # Shell HTML
├── assets/
│   ├── app.js                  # Bundled SPA (~26 KB)
│   └── akm-panel.css           # Styles (~14 KB)
├── src/
│   ├── app.ts                  # Entry, layout, refreshAll, navigation
│   ├── api.ts                  # 7 API functions
│   ├── state.ts                # Simple pub/sub store
│   ├── render.ts               # escape, datum, badges, formatTime, spinner, errorBox
│   └── views/
│       ├── overview.ts         # Health, stats, search modes, recent activity
│       ├── search.ts           # Search input, filters, result cards, split preview
│       ├── sources.ts          # Source cards with writable/read-only state
│       ├── activity.ts         # Activity table with status badges
│       └── capabilities.ts     # Read-only banner, operations, asset types
└── styles/
    └── akm-panel.css           # Source CSS
```

## Data Flow

```
app.ts:refreshAll()
  → api.ts:getHealth/Status/Sources/Stats/Capabilities/Activity()
    → state.ts:setState({...})
      → subscriber: renderOverview/Sources/Activity/Capabilities()
        → render.ts helpers
```

## Key Design Decisions

- **No framework**: Vanilla TypeScript, 0 npm runtime deps
- **textContent over innerHTML**: All user data goes through `escape()` which uses `textContent` assignment — no XSS surface
- **State preservation**: Failed refresh leaves previous data intact; errors shown via `errorBox`
- **Same-origin only**: No CORS wildcard; API covered by existing auth proxy if present
- **Static file isolation**: Path traversal check ensures only files under `ui/` are served
