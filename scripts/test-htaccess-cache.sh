#!/usr/bin/env bash
# Local Apache check for issue #30 cache headers and issue #35 deny rules.
# Usage: ./scripts/test-htaccess-cache.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${APACHE_TEST_PORT:-18080}"
TMP="$(mktemp -d)"
WELL_KNOWN_CLEANUP=0
APACHE_PID=""

cleanup() {
  if [[ -n "${APACHE_PID}" ]] && kill -0 "$APACHE_PID" 2>/dev/null; then
    kill "$APACHE_PID" 2>/dev/null || true
    wait "$APACHE_PID" 2>/dev/null || true
  fi
  if [[ "${WELL_KNOWN_CLEANUP}" == "1" ]]; then
    rm -f "$ROOT/.well-known/acme-challenge/cache-test"
    rmdir "$ROOT/.well-known/acme-challenge" 2>/dev/null || true
    rmdir "$ROOT/.well-known" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

APACHE_BIN="$(command -v apache2 || command -v httpd || true)"
if [[ -z "$APACHE_BIN" ]]; then
  echo "Apache not installed; skipping header probe." >&2
  exit 0
fi

mkdir -p "$TMP/tmp" "$TMP/logs" "$ROOT/.well-known/acme-challenge"
echo "ok" > "$ROOT/.well-known/acme-challenge/cache-test"
WELL_KNOWN_CLEANUP=1

# Module paths differ between Debian apache2 and generic httpd.
MOD_DIR=""
for d in /usr/lib/apache2/modules /usr/lib64/httpd/modules /usr/lib/httpd/modules; do
  if [[ -d "$d" ]]; then
    MOD_DIR="$d"
    break
  fi
done

{
  echo "ServerName localhost"
  echo "Listen 127.0.0.1:${PORT}"
  echo "PidFile ${TMP}/httpd.pid"
  echo "ErrorLog ${TMP}/logs/error.log"
  echo "LogFormat \"%h %s %r\" common"
  echo "CustomLog ${TMP}/logs/access.log common"
  echo "DefaultRuntimeDir ${TMP}/tmp"
  echo "Mutex file:${TMP}/tmp default"
  if [[ -n "$MOD_DIR" ]]; then
    BUILTIN="$(apache2 -l 2>/dev/null || true)"
    load_mod() {
      local name="$1"
      local file="$2"
      if printf '%s\n' "$BUILTIN" | grep -q "mod_${name}.c"; then
        return 0
      fi
      if [[ -f "${MOD_DIR}/${file}" ]]; then
        echo "LoadModule ${name}_module ${MOD_DIR}/${file}"
      fi
    }
    load_mod mpm_event mod_mpm_event.so
    load_mod authz_core mod_authz_core.so
    load_mod mime mod_mime.so
    load_mod dir mod_dir.so
    load_mod rewrite mod_rewrite.so
    load_mod headers mod_headers.so
    load_mod expires mod_expires.so
    load_mod unixd mod_unixd.so
    load_mod access_compat mod_access_compat.so
    echo "TypesConfig /etc/mime.types"
  fi
  echo "DocumentRoot ${ROOT}"
  echo "DirectoryIndex index.html"
  echo "<Directory ${ROOT}>"
  echo "  Options FollowSymLinks"
  echo "  AllowOverride All"
  echo "  Require all granted"
  echo "</Directory>"
} > "$TMP/httpd.conf"

"$APACHE_BIN" -f "$TMP/httpd.conf" -D FOREGROUND &
APACHE_PID=$!
sleep 0.4

if ! kill -0 "$APACHE_PID" 2>/dev/null; then
  echo "Apache failed to start. Log:" >&2
  cat "$TMP/logs/error.log" >&2 || true
  exit 1
fi

fail=0
probe() {
  local path="$1"
  local expect_status="$2"
  local expect_cache_regex="${3:-}"
  local extra_regex="${4:-}"
  local headers
  headers="$(curl -sS -D - -o /dev/null "http://127.0.0.1:${PORT}${path}")"
  local status
  status="$(printf '%s\n' "$headers" | awk 'NR==1 {print $2}')"
  printf '=== %s (expect %s, got %s)\n' "$path" "$expect_status" "$status"
  printf '%s\n' "$headers" | grep -iE '^(HTTP/|cache-control:|expires:|content-type:|etag:)' || true
  if [[ "$status" != "$expect_status" ]]; then
    echo "FAIL status for ${path}" >&2
    fail=1
  fi
  if [[ -n "$expect_cache_regex" ]]; then
    if ! printf '%s\n' "$headers" | grep -iE "^cache-control:.*${expect_cache_regex}" >/dev/null; then
      echo "FAIL Cache-Control for ${path} (wanted /${expect_cache_regex}/)" >&2
      fail=1
    fi
  fi
  if [[ -n "$extra_regex" ]]; then
    if ! printf '%s\n' "$headers" | grep -iE "$extra_regex" >/dev/null; then
      echo "FAIL extra header match for ${path} (wanted /${extra_regex}/)" >&2
      fail=1
    fi
  fi
}

probe /assets/css/style.min.css 200 "max-age=31536000"
probe /assets/js/forms.min.js 200 "max-age=31536000"
probe /assets/img/solon-logo.png 200 "max-age=31536000"
probe / 200 "no-cache" "charset=utf-8"
probe /index.html 200 "no-cache"
probe /feedback/ 200 "no-cache"
probe /blog/posts.json 200 "no-cache"
probe /sitemap.xml 200 "max-age=3600"
probe /robots.txt 200 "max-age=3600"
probe /.well-known/acme-challenge/cache-test 200
probe /package.json 403
probe /scripts/build.js 403
probe /tests/forms.test.js 403
probe /.git/config 403
probe /blog/posts/prompt-engineering-juridic-pentru-avocati.md 403

if [[ "$fail" -ne 0 ]]; then
  echo "Apache cache/deny probe failed." >&2
  cat "$TMP/logs/error.log" >&2 || true
  exit 1
fi

echo "Apache cache/deny probe passed."
