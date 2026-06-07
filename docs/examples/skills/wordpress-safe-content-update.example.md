---
name: wordpress-safe-content-update
description: Use when updating WordPress content, media, menus, metadata, or posts. Covers safe content changes with rollback. Triggers on keywords: content, post, page, media, image, menu, metadata, acf, cpt, import, bulk update, featured image.
---

# WordPress Safe Content Update

Safely update WordPress content.

## AKM Integration
Search AKM for: wordpress content, media handling, bulk update, import

## Pre-Change
1. Determine scope: db, files, or cache change
2. Identify specific records (post IDs, meta keys)
3. Check if dry-run mode is available

## Single Record Changes
- Verify record exists before modifying
- Keep backup of original value
- Test frontend after change

## Bulk Operations
- Never run unlimited bulk updates
- Use LIMIT and OFFSET
- Process in batches
- Log before/after mapping
- Keep IDs for rollback

## Media/Image Changes
- Verify file exists before deleting
- Check attachment IDs in post meta
- Featured image: check _thumbnail_id
- Regenerate thumbnails if needed

## Menu Changes
- Check wp_nav_menu locations
- Verify menu item IDs
- Test all menu items after change

## Cache Handling
- Clear only relevant cache
- OPcache: touch or restart PHP-FPM
- CDN: purge specific URLs
- Browser: version query strings

## Safety Rules
- No bulk delete without explicit approval
- No DROP/TRUNCATE
- No unlimited UPDATE without WHERE
- Keep before/after mapping
- Verify frontend after changes
