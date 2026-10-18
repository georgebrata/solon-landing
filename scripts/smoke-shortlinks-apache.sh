#!/bin/bash
# Load the generated .htaccess in Apache 2.4 with and without mod_expires.
# Both passes refuse a 500, and short links keep a single Cache-Control.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8765}"
TMP="$(mktemp -d)"
APACHE_PID=""

cleanup() {
  if [[ -n "${APACHE_PID}" ]]; then
    kill "${APACHE_PID}" >/dev/null 2>&1 || true
    wait "${APACHE_PID}" >/dev/null 2>&1 || true
  fi
  rm -rf "${TMP}"
}
trap cleanup EXIT

if ! command -v apache2 >/dev/null 2>&1; then
  if [[ "$(id -u)" -eq 0 ]]; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y apache2
  else
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y apache2
  fi
fi

MODDIR=""
if [[ -d /usr/lib/apache2/modules ]]; then
  MODDIR="/usr/lib/apache2/modules"
elif [[ -d /usr/lib/httpd/modules ]]; then
  MODDIR="/usr/lib/httpd/modules"
else
  echo "::error::Apache module directory not found" >&2
  exit 1
fi

DOCROOT="${TMP}/htdocs"
mkdir -p "${TMP}/runtime" "${DOCROOT}/blog" "${DOCROOT}/r"
chmod 755 "${TMP}" "${TMP}/runtime" "${DOCROOT}"
cp "${ROOT}/.htaccess" "${DOCROOT}/.htaccess"
cp -a "${ROOT}/r/." "${DOCROOT}/r/"
cp "${ROOT}/403.html" "${ROOT}/404.html" "${ROOT}/500.html" "${DOCROOT}/"
printf '%s\n' '<!DOCTYPE html><html lang="ro"><title>home</title></html>' > "${DOCROOT}/index.html"
printf '%s\n' '<!DOCTYPE html><html lang="ro"><title>blog</title></html>' > "${DOCROOT}/blog/index.html"

APACHE_USER="$(id -un)"
APACHE_GROUP="$(id -gn)"

write_conf() {
  local with_expires="$1"
  local module
  local file
  local -a modules
  modules=(mod_mpm_event mod_authn_core mod_authz_core mod_mime mod_rewrite mod_headers mod_dir)
  if [[ "${with_expires}" == "1" ]]; then
    modules+=(mod_expires)
  fi
  {
    printf '%s\n' "ServerName localhost"
    printf '%s\n' "Listen 127.0.0.1:${PORT}"
    printf '%s\n' "ServerRoot \"/etc/apache2\""
    printf '%s\n' "DefaultRuntimeDir \"${TMP}/runtime\""
    printf '%s\n' "PidFile \"${TMP}/httpd.pid\""
    printf '%s\n' "ErrorLog \"${TMP}/error.log\""
    printf '%s\n' "CustomLog \"${TMP}/access.log\" combined"
    printf '%s\n' "User ${APACHE_USER}"
    printf '%s\n' "Group ${APACHE_GROUP}"
    printf '%s\n' "Mutex file:${TMP}/runtime default"
    for module in "${modules[@]}"; do
      file="${MODDIR}/${module}.so"
      if [[ ! -f "${file}" ]]; then
        echo "::error::missing ${file}" >&2
        exit 1
      fi
      printf 'LoadModule %s_module %s\n' "${module#mod_}" "${file}"
    done
    printf '%s\n' "TypesConfig /etc/mime.types"
    printf '%s\n' "DocumentRoot \"${DOCROOT}\""
    printf '%s\n' "<Directory \"${DOCROOT}\">"
    printf '%s\n' "  AllowOverride All"
    printf '%s\n' "  Require all granted"
    printf '%s\n' "  Options FollowSymLinks"
    printf '%s\n' "</Directory>"
    printf '%s\n' "DirectoryIndex index.html"
  } > "${TMP}/smoke.conf"
}

stop_apache() {
  local _
  if [[ -n "${APACHE_PID}" ]]; then
    kill "${APACHE_PID}" >/dev/null 2>&1 || true
    wait "${APACHE_PID}" >/dev/null 2>&1 || true
    APACHE_PID=""
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${PORT}/"; then
      break
    fi
    sleep 0.2
  done
  rm -f "${TMP}/httpd.pid"
}

start_apache() {
  local with_expires="$1"
  local label="$2"
  local ready=0
  local _
  stop_apache
  write_conf "${with_expires}"
  if [[ "${with_expires}" == "1" ]]; then
    if ! grep -q 'expires_module' "${TMP}/smoke.conf"; then
      echo "::error::mod_expires was not loaded" >&2
      exit 1
    fi
  elif grep -q 'expires_module' "${TMP}/smoke.conf"; then
    echo "::error::mod_expires was loaded in the unguarded pass" >&2
    exit 1
  fi
  : > "${TMP}/error.log"
  apache2 -t -f "${TMP}/smoke.conf"
  apache2 -f "${TMP}/smoke.conf" -D FOREGROUND &
  APACHE_PID="$!"
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${PORT}/"; then
      ready=1
      break
    fi
    sleep 0.2
  done
  if [[ "${ready}" -ne 1 ]]; then
    echo "::error::Apache did not start (${label})" >&2
    cat "${TMP}/error.log" >&2 || true
    exit 1
  fi
}

check() {
  local path="$1"
  local accept="$2"
  local expect="$3"
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
    -H "X-Forwarded-Proto: https" \
    -H "Accept: ${accept}" \
    "http://127.0.0.1:${PORT}${path}")"
  if [[ "${code}" == "500" ]]; then
    echo "::error::${path} returned 500" >&2
    cat "${TMP}/error.log" >&2 || true
    exit 1
  fi
  if [[ -n "${expect}" && "${code}" != "${expect}" ]]; then
    echo "::error::${path} returned ${code}, expected ${expect}" >&2
    cat "${TMP}/error.log" >&2 || true
    exit 1
  fi
}

echo "apache short-link smoke with mod_expires"
start_apache 1 "with mod_expires"
check "/" "text/html" "200"
check "/blog/" "text/html" "200"
check "/bronze/lunar" "text/html" "200"
check "/api" "*/*" "302"

one_cache_control() {
  local path="$1"
  local accept="$2"
  local headers
  local count
  headers="$(curl -sD - -o /dev/null --max-time 5 \
    -H "X-Forwarded-Proto: https" \
    -H "Accept: ${accept}" \
    "http://127.0.0.1:${PORT}${path}")"
  count="$(printf '%s\n' "${headers}" | grep -c -i '^Cache-Control:' || true)"
  if [[ "${count}" -ne 1 ]]; then
    echo "::error::${path} sent ${count} Cache-Control headers" >&2
    printf '%s\n' "${headers}" >&2
    cat "${TMP}/error.log" >&2 || true
    exit 1
  fi
  if ! printf '%s\n' "${headers}" | grep -q -i '^Cache-Control:[[:space:]]*no-store[[:space:]]*$'; then
    echo "::error::${path} Cache-Control is not a single no-store" >&2
    printf '%s\n' "${headers}" >&2
    exit 1
  fi
}

one_cache_control "/api" "*/*"
one_cache_control "/r/api/" "text/html"
one_cache_control "/bronze/lunar" "text/html"

echo "apache short-link smoke without mod_expires"
start_apache 0 "without mod_expires"
check "/" "text/html" "200"
check "/blog/" "text/html" "200"
check "/api" "*/*" "302"
check "/r/api/" "text/html" "200"
check "/no-such-short-link-page" "text/html" "404"
one_cache_control "/api" "*/*"
one_cache_control "/r/api/" "text/html"
one_cache_control "/bronze/lunar" "text/html"
echo "apache short-link smoke ok"
