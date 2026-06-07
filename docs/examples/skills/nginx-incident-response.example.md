---
name: nginx-incident-response
description: Use when responding to nginx errors, 502/504/403, SSL issues, or reverse proxy problems. Triggers on keywords: 502, 504, 503, 403, nginx, ssl, reverse proxy, upstream, gateway timeout, bad gateway, port conflict.
---

# Nginx Incident Response

Respond to nginx and reverse proxy incidents.

## AKM Integration
Search AKM for: nginx incident, nginx outage, ssl issue, proxy failure

## Read-First Diagnostic Flow

### 1. Topology Discovery
Determine the full request path

### 2. Quick Checks
- nginx -t (config syntax)
- systemctl status nginx php-fpm
- ss -tlnp | grep -E 80|443|8080|8443
- curl localhost (internal)
- curl domain.com (external)

### 3. Log Analysis
- journalctl -u nginx
- journalctl -u php-fpm
- tail /var/log/nginx/error.log

### 4. Upstream Check
- PHP-FPM socket
- Docker upstream
- Socket connectivity

### 5. SSL/TLS
- openssl s_client
- Certificate expiry
- Cloudflare SSL mode

## Root Cause Identification
Do NOT assume the error source. Verify each component.

## Remediation (ask before applying)
- nginx -t && systemctl reload nginx
- Restart PHP-FPM
- Restart upstream container
- Fix config syntax

## Rollback
- git checkout <config file>
- nginx -t && systemctl reload nginx
- Verify HTTP 200
