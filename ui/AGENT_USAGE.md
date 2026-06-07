# Agent Usage UI — AKM Panel

The Agent Usage view in the AKM Panel shows the current supervised workflow status.

## View location

Tab: **Agent Usage** in the AKM panel at `http://{bridge_host}:4199/akm/`.

## Displayed information

### Mode badge
- Supervised (green badge)
- Manual (yellow badge)
- Off (grey badge)

### Status card
- **Current mode**: off / manual / supervised
- **Supervised**: Yes (with badge) / No
- **AKM used**: Yes / No (green/grey)
- **Decision**: required / optional / skipped / null
- **Queries count**: number
- **Selected resources**: count
- **Loaded resources**: count
- **Feedback submitted**: count
- **Lesson proposal created**: Yes / No
- **Memory proposal created**: Yes / No
- **Fallback used**: Yes / No
- **Last activity**: timestamp

### Recent Agent Runs table
Up to 50 entries with columns:
- Run ID
- Timestamp
- Decision
- Queries
- Selected
- Loaded
- Feedback
- Lesson
- Memory
- Fallback
- Duration (ms)

## Data source

The UI fetches from:
- `GET /api/akm/agent/mode`
- `GET /api/akm/agent/runs`

## Security

- No prompts displayed
- No full resource content displayed
- No secrets displayed
- No chain of thought displayed
