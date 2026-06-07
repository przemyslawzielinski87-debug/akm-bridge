---
name: meridian-wordpress-development
description: Use when developing or fixing WordPress code in The Meridian theme. Covers PHP, Gutenberg, REST API, plugins. Triggers on keywords: wordpress, php, theme, plugin, gutenberg, cpt, taxonomy, rest api, hook, filter, shortcode, mu-plugin.
---

# Meridian WordPress Development

WordPress development workflow for The Meridian project.

## AKM Integration
Search AKM for: meridian development, wordpress patterns, known regressions

## Pre-Flight Checks
1. Determine repository root (look for wp-content, style.css, .git, package.json)
2. Read project AGENTS.md if present
3. Check git status, branch, recent commits
4. Identify the correct theme/plugin directory

## Development Flow
1. Understand the problem before coding
2. Find relevant files using grep or code search
3. Read existing code to understand patterns
4. Make minimal changes
5. Run PHP syntax check: php -l <file>
6. Run project tests and linting
7. Check for regressions (frontend + backend)
8. Show diff before finalizing

## WordPress Security Checklist
- Sanitization: sanitize_text_field, sanitize_email
- Escaping: esc_html, esc_attr, esc_url, wp_kses
- Nonce verification for forms and AJAX
- Capability checks: current_user_can
- REST API permission callbacks
- Never trust $_GET, $_POST, $_REQUEST directly

## Project Structure (auto-detect)
- Theme: look for style.css with Theme Name
- Plugins: check wp-content/plugins/
- MU-Plugins: check wp-content/mu-plugins/

## Safety Rules
- No deploy without explicit command
- No push without approval
- No modification of nginx, systemd, or Docker config
- No access to .env or credentials
- For infrastructure changes, delegate to infra-ops
