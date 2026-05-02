#!/usr/bin/env bash
# Fails CI if a third-party AI vendor name appears in product copy / code under src/
# outside of the small set of files where mentioning the vendor is intentional.
#
# To intentionally allow a new file to mention a vendor name (for example, a new
# settings or marketing page), add its path to ALLOWLIST below.
set -u
set -o pipefail

PATTERN='Gemini|Whisper|Anthropic|Claude|OpenAI|GPT|gpt-[0-9]|claude-[0-9]|gemini-[0-9]|Vertex AI'

ALLOWLIST=(
  "src/pages/Landing.tsx"
  "src/pages/SettingsPage.tsx"
  "src/pages/IntegrationsPage.tsx"
  "src/lib/gemini.ts"
  "src/lib/liveClient.ts"
)

ALLOW_PREFIXES=(
  "src/agents/"
)

if ! command -v rg >/dev/null 2>&1; then
  echo "check-no-vendor-leaks: ripgrep (rg) is required but not installed." >&2
  exit 2
fi

if [ ! -d src ]; then
  echo "check-no-vendor-leaks: src/ directory not found (run from repo root)." >&2
  exit 2
fi

is_allowed() {
  local file="$1"
  local entry
  for entry in "${ALLOWLIST[@]}"; do
    if [ "$file" = "$entry" ]; then
      return 0
    fi
  done
  for entry in "${ALLOW_PREFIXES[@]}"; do
    case "$file" in
      "$entry"*) return 0 ;;
    esac
  done
  return 1
}

matches=$(rg -n --no-heading --color=never -e "$PATTERN" src/ || true)

leaks=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  file="${line%%:*}"
  if ! is_allowed "$file"; then
    leaks+="$line"$'\n'
  fi
done <<< "$matches"

if [ -n "$leaks" ]; then
  printf '%s' "$leaks" | while IFS= read -r leak; do
    [ -z "$leak" ] && continue
    file_line="${leak%%:*}:$(echo "$leak" | cut -d: -f2)"
    echo "Provider name leaked in ${file_line}. If this is intentional and user-safe, add the file to ALLOWLIST in scripts/check-no-vendor-leaks.sh." >&2
  done
  exit 1
fi

echo "check-no-vendor-leaks: no unexpected vendor mentions found."
exit 0
