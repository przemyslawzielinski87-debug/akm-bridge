#!/usr/bin/env bash
# Fake AKM binary for deterministic unit testing.
# Responds with canned JSON responses based on arguments.

set -euo pipefail

case "${1:-}" in
  health)
    if [ "${AKM_FAKE_HEALTH_EXIT_CODE_4:-}" = "1" ]; then
      cat <<'EOF'
{"schemaVersion":2,"ok":true,"status":"warn","since":"2026-06-06T00:00:00.000Z","hardChecks":[{"name":"state-db-schema","status":"pass"}],"advisories":[{"name":"semantic-search-runtime","status":"warn","evidence":{"status":"vec-err","entryCount":1866}}]}
EOF
      exit 4
    fi
    cat <<'EOF'
{"schemaVersion":2,"ok":true,"status":"pass","since":"2026-06-06T00:00:00.000Z","hardChecks":[{"name":"state-db-schema","status":"pass"}],"advisories":[{"name":"semantic-search-runtime","status":"pass","evidence":{"status":"ready-vec","entryCount":1866,"embeddingCount":1866}}]}
EOF
    ;;
  info)
    cat <<'EOF'
{"schemaVersion":1,"version":"0.8.1","assetTypes":["skill","command","agent","knowledge","workflow","script","memory","env","vault","secret","wiki","lesson","task"],"searchModes":["fts","semantic","hybrid"],"indexStats":{"entryCount":1866,"lastBuiltAt":"2026-06-06T00:00:00.000Z","hasEmbeddings":true,"vecAvailable":true,"embeddingCount":1866},"sourceProviders":[{"type":"filesystem","name":"meridian-docs","path":"/var/www/strategikon/docs"},{"type":"filesystem","name":"opencode-config","path":"/root/akm/opencode-safe"}]}
EOF
    ;;
  list)
    cat <<'EOF'
{"schemaVersion":1,"stashDir":"/root/akm","sources":[{"name":"meridian-docs","kind":"filesystem","path":"/var/www/strategikon/docs","writable":true,"status":{"exists":true}},{"name":"opencode-config","kind":"filesystem","path":"/root/akm/opencode-safe","writable":true,"status":{"exists":true}}],"totalSources":2}
EOF
    ;;
  search)
    QUERY="${2:-}"
    if [ -z "$QUERY" ]; then
      echo '{"ok":false,"error":"A search query is required.","code":"MISSING_REQUIRED_ARGUMENT"}'
      exit 1
    fi
    if [ "$QUERY" = "noresults" ]; then
      echo '{"hits":[],"tip":"No matching stash assets were found. Try a different query."}'
      exit 0
    fi
    cat <<'EOF'
{"hits":[{"type":"knowledge","name":"test-doc","ref":"test-source//knowledge:test-doc","source":"test-source","action":"akm show test-source//knowledge:test-doc","estimatedTokens":500,"snippet":"This is a test document snippet for searching."}],"total":1}
EOF
    ;;
  show)
    REF="${2:-}"
    if [ -z "$REF" ]; then
      echo '{"error":"ref is required"}'
      exit 1
    fi
    if [ "$REF" = "invalid:ref" ]; then
      echo '{"error":"no matching asset found"}'
      exit 1
    fi
    cat <<'EOF'
{"type":"knowledge","name":"test-doc","origin":"test-source","content":"# Test Document\n\nThis is a test document with some content for verification purposes.\n\n## Section 1\n\nLorem ipsum dolor sit amet.\n","path":"/tmp/test-doc.md","editable":true}
EOF
    ;;
  --version)
    echo "akm 0.8.1"
    ;;
  *)
    echo "akm $0 0.8.1 — unknown command: ${1:-}"
    exit 1
    ;;
esac
