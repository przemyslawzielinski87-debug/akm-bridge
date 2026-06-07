---
name: cloudflare-coolify-routing
description: Use when diagnosing DNS, Cloudflare proxy, TLS, Coolify, or Traefik routing issues. Triggers on keywords: cloudflare, dns, proxy, tls, ssl, coolify, traefik, origin, domain, route, redirect loop, cname, a record.
---

# Cloudflare Coolify Routing

Diagnose and fix DNS and routing issues.

## AKM Integration
Search AKM for: cloudflare config, dns routing, coolify deploy, traefik

## Full Request Path
Client -> Cloudflare -> Public IP -> Coolify/Traefik -> Container -> App

## Diagnostic Checks

### DNS
- dig +short domain.com A CNAME MX
- Check Cloudflare dashboard status (orange/grey cloud)

### Cloudflare Proxy
- curl -sI https://domain.com | grep cf-ray
- Check SSL/TLS mode (Flexible/Full/Strict)

### Origin
- curl -sI http://origin-ip:port
- curl -sI https://origin-ip:port
- Compare external vs internal headers

### Coolify/Traefik
- Check Coolify dashboard for service status
- docker ps for container health
- docker logs <container> for errors
- Check forwarded headers (X-Forwarded-For, Host)

### Common Issues
- Cloudflare proxying to wrong origin
- SSL mode mismatch
- Port not exposed in container
- Traefik rule misconfiguration
- Caching stale content
- Redirect loops

## Changes (ask)
- DNS record modifications
- Cloudflare SSL/TLS mode change
- Traefik config change
- Container port exposure
- Nginx config for origin
