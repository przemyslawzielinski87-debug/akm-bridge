# Integration Options — AKM Knowledge Panel

## Current Setup

- HTTP server on `127.0.0.1:4199`
- SPA served at `/` and `/akm`
- API at `/api/akm/*`
- Same-origin only (no CORS)

## Nginx Reverse Proxy

```nginx
# Existing OpenCode proxy — add these locations
location /akm {
    proxy_pass http://127.0.0.1:4199;
}
location /api/akm {
    proxy_pass http://127.0.0.1:4199;
}
location /assets/ {
    proxy_pass http://127.0.0.1:4199;
}
```

## Authentication

The panel has no built-in auth. Protect via:
- Nginx basic auth or OAuth2 proxy
- OpenCode SPA subdomain cookie check
- Existing upstream auth provider

## Embedding in OpenCode SPA

For full integration into the OpenCode dashboard:
1. Set `openApiSpec` route in `openapi.json` for `/akm`
2. Remove standalone `/` route to avoid root collision
3. Use OpenCode's `akmPanelMode: "embedded"` if implementing message passing
