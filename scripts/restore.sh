#!/usr/bin/env bash
# Usage: ./restore.sh <path/to/backup.sql.gz>
set -euo pipefail

FILE="${1:?Usage: restore.sh <backup.sql.gz>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ ! -f "$FILE" ]]; then
  echo "Error: backup file not found: $FILE" >&2
  exit 1
fi

echo "Restoring from: $FILE"
gunzip -c "$FILE" | docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  psql -U "${POSTGRES_USER:-vema}" "${POSTGRES_DB:-vema_bot}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Restore complete from $FILE"
