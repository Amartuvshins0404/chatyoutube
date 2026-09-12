#!/usr/bin/env bash
# One-shot SearXNG installer for a personal server (idempotent).
# Usage on the server:  bash install.sh   (or pipe from curl/scp it over)
set -euo pipefail

DIR=/opt/searxng
mkdir -p "$DIR"
cd "$DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found. Install it first (https://docs.docker.com/engine/install/)." >&2
  exit 1
fi

SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')

cat > settings.yml <<YAML
use_default_settings: true

server:
  secret_key: "${SECRET}"
  bind_address: "127.0.0.1"   # loopback only — put TLS reverse proxy in front
  port: 8080
  limiter: false              # REQUIRED: extension JSON calls are not browsers
  public_instance: false
  image_proxy: false

search:
  safe_search: 0
  formats:
    - html
    - json                    # REQUIRED: enables /search?format=json

outgoing:
  request_timeout: 6.0
YAML

cat > docker-compose.yml <<'YAML'
services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./settings.yml:/etc/searxng/settings.yml:ro
      - searxng-data:/var/cache/searxng
    cap_drop: [ALL]
    cap_add: [CHOWN, SETGID, SETUID]
    logging:
      driver: json-file
      options: { max-size: "1m", max-file: "3" }

volumes:
  searxng-data:
YAML

if docker compose version >/dev/null 2>&1; then
  docker compose up -d --pull always
else
  docker-compose pull
  docker-compose up -d
fi

echo "Waiting for SearXNG to boot…"
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8080/healthz >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "Testing the JSON API the extension will use…"
curl -s 'http://127.0.0.1:8080/search?q=chatyoutube&format=json' | head -c 200
echo

cat <<'NEXT'

DONE. SearXNG is listening on 127.0.0.1:8080 (loopback only).

Next:
1. Expose it with TLS (Caddy example):
     searx.yourdomain.com { reverse_proxy 127.0.0.1:8080 }
   or keep it private via Tailscale/SSH tunnel — the extension only needs a reachable URL.
2. In Chrome: ChatYouTube toolbar popup → Web search provider → SearXNG →
   paste the URL → "Connect & test". It will ask for site access once, then verify with a live query.

NEXT
