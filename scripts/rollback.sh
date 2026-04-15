#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/rollback.sh — Emergency rollback procedures for VEMA Equipment Bot
#
# Each function corresponds to a rollback scenario.
# Run with: bash scripts/rollback.sh <command>
#
# Commands:
#   app-previous      Roll app container back to previous Docker image
#   db-migration      Roll back last DB migration (node-pg-migrate down)
#   db-restore        Restore PostgreSQL from latest backup file
#   redis-flush       Flush all Redis sessions (forces re-login for all users)
#   full-reset        Nuclear option: stop everything, restore DB from backup
#
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
APP_SERVICE="app"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

log()  { echo "[$(date +%T)] $*"; }
die()  { echo "[ERROR] $*" >&2; exit 1; }

# ─── Check prerequisites ──────────────────────────────────────────────────────
check_compose() {
  docker compose -f "$COMPOSE_FILE" ps --quiet "$APP_SERVICE" &>/dev/null \
    || die "Docker Compose stack not running. Start with: docker compose -f $COMPOSE_FILE up -d"
}

# ─── 1. Roll app back to previous image tag ──────────────────────────────────
rollback_app_previous() {
  log "Rolling back app to previous image..."

  local prev_image
  prev_image=$(docker images "vema-equipment-bot" --format "{{.Repository}}:{{.Tag}}" \
    | grep -v ':latest' | head -1)

  if [[ -z "$prev_image" ]]; then
    die "No previous image found. Only 'latest' exists — use db-restore instead."
  fi

  log "Previous image: $prev_image"
  log "Stopping current app container..."
  docker compose -f "$COMPOSE_FILE" stop "$APP_SERVICE"

  log "Starting previous image..."
  APP_IMAGE="$prev_image" docker compose -f "$COMPOSE_FILE" up -d --no-deps "$APP_SERVICE"

  log "Waiting for health check..."
  sleep 10
  docker compose -f "$COMPOSE_FILE" ps "$APP_SERVICE"
  log "Done. Verify: docker compose -f $COMPOSE_FILE logs -f $APP_SERVICE"
}

# ─── 2. Roll back last DB migration ──────────────────────────────────────────
rollback_db_migration() {
  log "Rolling back last database migration..."

  read -r -p "⚠️  This will revert schema changes. Confirm? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { log "Aborted."; exit 0; }

  log "Running: node-pg-migrate down (1 step)"
  docker compose -f "$COMPOSE_FILE" run --rm \
    -e NODE_ENV=production \
    "$APP_SERVICE" \
    npx node-pg-migrate down --count 1

  log "Migration rolled back. Check: docker compose -f $COMPOSE_FILE run --rm $APP_SERVICE npm run migrate"
}

# ─── 3. Restore PostgreSQL from backup ───────────────────────────────────────
rollback_db_restore() {
  log "Available backups in $BACKUP_DIR:"
  ls -lt "$BACKUP_DIR"/*.dump 2>/dev/null | head -10 \
    || die "No .dump files found in $BACKUP_DIR"

  read -r -p "Enter backup filename (just the file, not path): " backup_file
  local backup_path="$BACKUP_DIR/$backup_file"
  [[ -f "$backup_path" ]] || die "File not found: $backup_path"

  read -r -p "⚠️  This will DROP and restore the database. ALL current data will be LOST. Confirm? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { log "Aborted."; exit 0; }

  # Load env
  # shellcheck disable=SC1091
  source .env

  log "Stopping app to prevent writes during restore..."
  docker compose -f "$COMPOSE_FILE" stop "$APP_SERVICE"

  log "Restoring from $backup_path..."
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_restore \
      --username="$POSTGRES_USER" \
      --dbname="$POSTGRES_DB" \
      --clean \
      --if-exists \
      --no-owner \
      < "$backup_path"

  log "Restore complete. Starting app..."
  docker compose -f "$COMPOSE_FILE" start "$APP_SERVICE"

  log "Verifying integrity..."
  node scripts/verify-integrity.js || log "⚠️  Integrity check reported issues — review above"

  log "Done. Monitor: docker compose -f $COMPOSE_FILE logs -f $APP_SERVICE"
}

# ─── 4. Flush Redis sessions (force re-login) ─────────────────────────────────
rollback_redis_flush() {
  log "Flushing Redis sessions..."

  read -r -p "⚠️  This will log out ALL users. Confirm? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { log "Aborted."; exit 0; }

  # Load env
  # shellcheck disable=SC1091
  source .env

  local redis_cmd="redis-cli"
  [[ -n "${REDIS_PASSWORD:-}" ]] && redis_cmd="redis-cli -a $REDIS_PASSWORD"

  docker compose -f "$COMPOSE_FILE" exec redis \
    sh -c "$redis_cmd --scan --pattern 'session:*' | xargs -r $redis_cmd del"

  log "Sessions flushed. Rate-limit keys preserved."
}

# ─── 5. Full reset (nuclear) ─────────────────────────────────────────────────
rollback_full_reset() {
  log "FULL RESET: This will stop all containers, flush Redis, and restore DB from backup."
  read -r -p "⚠️  DESTRUCTIVE. ALL data since last backup will be LOST. Type 'RESET' to confirm: " confirm
  [[ "$confirm" == "RESET" ]] || { log "Aborted."; exit 0; }

  log "Stopping all services..."
  docker compose -f "$COMPOSE_FILE" down

  log "Starting dependencies..."
  docker compose -f "$COMPOSE_FILE" up -d postgres redis
  sleep 15

  rollback_db_restore

  log "Starting full stack..."
  docker compose -f "$COMPOSE_FILE" up -d

  log "Full reset complete."
}

# ─── Main ─────────────────────────────────────────────────────────────────────
case "${1:-}" in
  app-previous)    rollback_app_previous ;;
  db-migration)    rollback_db_migration ;;
  db-restore)      rollback_db_restore ;;
  redis-flush)     rollback_redis_flush ;;
  full-reset)      rollback_full_reset ;;
  *)
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  app-previous    Roll app container back to previous Docker image"
    echo "  db-migration    Roll back last DB migration (node-pg-migrate down)"
    echo "  db-restore      Restore PostgreSQL from a .dump backup file"
    echo "  redis-flush     Flush all Redis sessions (forces re-login)"
    echo "  full-reset      Nuclear: stop all, restore DB, restart stack"
    exit 1
    ;;
esac
