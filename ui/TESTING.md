# Testing — AKM Knowledge Panel

## Test Suite

```sh
# Run all ETAP 2 adapter tests
npx tsx tests/adapter.test.ts

# Run injection security tests
bash tests/run-injection-tests.sh
```

## Manual Verification Checklist

### Functional
- [ ] All 5 tabs render with real data
- [ ] Search returns results, shows loading, handles empty
- [ ] Resource preview opens, closes via button and Escape
- [ ] Refresh updates data across all tabs

### Security
- [ ] XSS vectors render as text (see SECURITY.md)
- [ ] Directory traversal returns 404
- [ ] Hidden files return 404

### Responsive
- [ ] 360×800 no horizontal overflow
- [ ] 390×844 preview drawer full screen
- [ ] 430×932 tabs scrollable
- [ ] 1280×720 split layout
- [ ] 1440×900 content readable
- [ ] 1920×1080 no stretch issues

### Error States
- [ ] Bridge unavailable shows error
- [ ] Failed refresh preserves previous state
- [ ] Search service failure shows error
- [ ] Invalid resource ref shows error

## Screenshots

Store screenshots as `screenshots/{mobile,desktop}-{width}.png`.
