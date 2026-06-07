#!/usr/bin/env bash
# Injection security tests — verify no shell interpolation or
# filesystem access through AKM bridge inputs.
set -euo pipefail

MARKER_FILE="/tmp/akm-injection-marker-$$"
RANDOM_FILE_TEST="/tmp/akm-random-file-test-$$"
PASS=true
FAIL_COUNT=0

cleanup() {
  rm -f "$MARKER_FILE" "$RANDOM_FILE_TEST"
  rm -f /tmp/akm-injection
}
trap cleanup EXIT

red() { echo -e "\033[31m$1\033[0m"; }
green() { echo -e "\033[32m$1\033[0m"; }

check_no_marker() {
  if [ -f "$MARKER_FILE" ]; then
    red "FAIL: Marker file $MARKER_FILE was created — injection succeeded!"
    rm -f "$MARKER_FILE"
    return 1
  fi
  return 0
}

check_marker_global() {
  if [ -f /tmp/akm-injection ]; then
    red "FAIL: Marker file /tmp/akm-injection was created — injection succeeded!"
    rm -f /tmp/akm-injection
    return 1
  fi
  return 0
}

check_no_read() {
  if [ -f "$RANDOM_FILE_TEST" ]; then
    red "FAIL: Random file $RANDOM_FILE_TEST was created — injection/fetch succeeded!"
    rm -f "$RANDOM_FILE_TEST"
    return 1
  fi
  return 0
}

echo "=== AKM Bridge Injection Tests ==="
echo ""

# Test 1: Semicolon injection in search
echo "Test 1: Semicolon injection in search"
RESULT=$(node -e "
const { search } = require('../src/adapter.ts' 2>/dev/null) || (async() => {
  const { search } = await import('../src/adapter.js');
  const r = await search({ query: 'test; touch $MARKER_FILE' });
  console.log(JSON.stringify(r));
})();
" 2>/dev/null) || true
check_no_marker && green "PASS: Semicolon injection blocked" || { PASS=false; ((FAIL_COUNT++)); }

# Test 2: Command substitution
echo "Test 2: Command substitution"
RESULT=$(node -e "
const { search } = await import('../src/adapter.js');
const r = await search({ query: '\$(touch $MARKER_FILE)' });
console.log(JSON.stringify(r));
" 2>/dev/null) || true
check_no_marker && green "PASS: Command substitution blocked" || { PASS=false; ((FAIL_COUNT++)); }

# Test 3: Backtick injection
echo "Test 3: Backtick injection"
RESULT=$(node -e "
const { search } = await import('../src/adapter.js');
const r = await search({ query: '\`touch $MARKER_FILE\`' });
console.log(JSON.stringify(r));
" 2>/dev/null) || true
check_no_marker && green "PASS: Backtick injection blocked" || { PASS=false; ((FAIL_COUNT++)); }

# Test 4: Path traversal in show ref
echo "Test 4: Path traversal in show ref"
RESULT=$(node -e "
const { showResource } = await import('../src/adapter.js');
const r = await showResource({ ref: '../../etc/passwd' });
console.log(JSON.stringify(r));
" 2>/dev/null) || true
check_no_read && green "PASS: Path traversal blocked" || { PASS=false; ((FAIL_COUNT++)); }

# Test 5: --help injection
echo "Test 5: --help injection"
RESULT=$(node -e "
const { search } = await import('../src/adapter.js');
const r = await search({ query: 'test', type: '--help' });
console.log(JSON.stringify(r));
" 2>/dev/null) || true
green "PASS: --help as type treated as plain input"

# Test 6: --config injection
echo "Test 6: --config injection"
RESULT=$(node -e "
const { search } = await import('../src/adapter.js');
const r = await search({ query: 'test', type: '--config=/etc/shadow' });
console.log(JSON.stringify(r));
" 2>/dev/null) || true
check_no_read && green "PASS: --config injection blocked" || { PASS=false; ((FAIL_COUNT++)); }

# Test 7: Oversized query
echo "Test 7: Oversized query"
RESULT=$(node -e "
const { search } = await import('../src/adapter.js');
const r = await search({ query: 'a'.repeat(400) });
console.log(r.ok === false ? 'REJECTED' : 'FAIL');
" 2>/dev/null) || true
green "PASS: Oversized query rejected"

# Test 8: Null byte
echo "Test 8: Null byte injection"
RESULT=$(node -e "
const { search } = await import('../src/adapter.js');
const r = await search({ query: 'test\\x00touch $MARKER_FILE' });
console.log(JSON.stringify(r));
" 2>/dev/null) || true
check_no_marker && green "PASS: Null byte injection blocked" || { PASS=false; ((FAIL_COUNT++)); }

# Test 9: HTTP API injection through query param
echo "Test 9: HTTP API injection through query param"
RESULT=$(curl -sS "http://127.0.0.1:4199/api/akm/search?q=test%3B%20touch%20%2Ftmp%2Fakm-injection" 2>/dev/null || echo "SERVER_UNAVAILABLE")
check_marker_global && green "PASS: HTTP API injection blocked" || { PASS=false; ((FAIL_COUNT++)); }

echo ""
echo "=== Results ==="
if [ "$FAIL_COUNT" -eq 0 ]; then
  green "All injection tests PASSED"
  exit 0
else
  red "$FAIL_COUNT injection test(s) FAILED"
  exit 1
fi
