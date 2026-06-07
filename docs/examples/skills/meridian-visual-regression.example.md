---
name: meridian-visual-regression
description: Use when checking UI layout, CSS, responsive design, or visual consistency in The Meridian. Triggers on keywords: ui, css, layout, mobile, responsive, visual, screenshot, header, hero, cards, footer, broken image, overflow, spacing.
---

# Meridian Visual Regression

Check and prevent visual regressions in The Meridian.

## AKM Integration
Search AKM for: visual regression, UI issues, css fixes, meridian frontend

## Scope
Check these viewports:
- Desktop (1920x1080)
- Laptop (1366x768)
- Tablet (768x1024)
- Mobile (375x667)

## Visual Checks
For each critical page (homepage, interior, product/page):
- Header: logo position, menu alignment, sticky behavior
- Hero section: image loading, overlay, text positioning
- Cards/grid: consistent sizing, spacing, alignment
- Typography: font loading, sizes, line-height
- Spacing: padding, margin consistency
- Overflow: no horizontal scroll, no clipped content
- Images: no broken src, proper aspect ratio
- Footer: full width, links, copyright

## With Playwright (full mode)
- Take screenshots of critical views
- Compare against baseline if available

## Without Playwright (quick mode)
- Check HTML structure for proper classes
- Check CSS for responsive breakpoints
- Verify media queries are active
- Check for missing assets (404 images)

## Rules
- Do not change content to fix layout
- Report visual evidence
- No deploy without explicit approval
