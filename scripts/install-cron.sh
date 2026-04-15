#!/usr/bin/env bash
# Installs a daily 03:00 cron job for PostgreSQL backups.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
CRON_LINE="0 3 * * * bash $SCRIPT_DIR/backup.sh >> $LOG_DIR/backup.log 2>&1"

mkdir -p "$LOG_DIR"

# Add the cron line (replacing any previous backup.sh entry)
( crontab -l 2>/dev/null | grep -v "backup.sh"; echo "$CRON_LINE" ) | crontab -

echo "Cron job installed: daily backup at 03:00"
echo "Run 'crontab -l' to verify."
