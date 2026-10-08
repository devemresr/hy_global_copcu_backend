#!/usr/bin/env bash
# Blue/green deploy, run on the VPS from the repo root: deploy/deploy.sh
#
# Host nginx proxies to `upstream $UPSTREAM_NAME`, defined alone in
# $UPSTREAM_FILE. The idle color is built and started next to the live one,
# health-checked, then nginx is pointed at it with a graceful reload (in-flight
# requests finish on the old workers), so there is no cutoff. A failed build
# or health check exits before the switch and the live color keeps serving.
# The old color is kept for $DRAIN_S seconds, then removed.
set -euo pipefail

# --- per-app config ---
APP=hy-backend
UPSTREAM_NAME=hy_backend
declare -A PORTS=([blue]=3011 [green]=3012)
HEALTH_PATH=/site/status
HEALTH_TIMEOUT_S=60
DRAIN_S=10
# ----------------------

UPSTREAM_FILE=/etc/nginx/conf.d/$UPSTREAM_NAME.conf

compose() {
	local color=$1
	shift
	HOST_PORT=${PORTS[$color]} docker compose -p "$APP-$color" "$@"
}

main() {
	cd "$(dirname "$0")/.."
	git pull --ff-only origin main

	local active live=none next port
	active=$(grep -oE '127\.0\.0\.1:[0-9]+' "$UPSTREAM_FILE" | cut -d: -f2 || true)
	for c in blue green; do
		if [[ $active == "${PORTS[$c]}" ]]; then live=$c; fi
	done
	if [[ $live == blue ]]; then next=green; else next=blue; fi
	port=${PORTS[$next]}
	echo "live: $live (:${active:-?}) -> deploying $next on :$port"

	compose "$next" build
	compose "$next" up -d --force-recreate

	local deadline=$((SECONDS + HEALTH_TIMEOUT_S))
	until curl -fsS -o /dev/null "http://127.0.0.1:$port$HEALTH_PATH"; do
		if ((SECONDS >= deadline)); then
			echo "health check failed on :$port - $live still live" >&2
			compose "$next" logs --tail 50
			compose "$next" down
			exit 1
		fi
		sleep 2
	done

	cp "$UPSTREAM_FILE" "$UPSTREAM_FILE.bak"
	printf 'upstream %s {\n\tserver 127.0.0.1:%s;\n}\n' "$UPSTREAM_NAME" "$port" >"$UPSTREAM_FILE"
	if ! nginx -t; then
		mv "$UPSTREAM_FILE.bak" "$UPSTREAM_FILE"
		compose "$next" down
		exit 1
	fi
	systemctl reload nginx
	rm "$UPSTREAM_FILE.bak"
	echo "switched to $next"

	if [[ $live != none ]]; then
		sleep "$DRAIN_S"
		compose "$live" down
	fi
	docker image prune -f >/dev/null
}

# On one line so bash has read it before git pull rewrites this file.
main "$@"; exit
