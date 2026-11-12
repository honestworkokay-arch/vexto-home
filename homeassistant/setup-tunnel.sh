#!/bin/sh
set -eu
cd "$(dirname "$0")"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "Немає входу в Cloudflare."
  echo "Потрібен один секрет: CLOUDFLARE_API_TOKEN"
  echo "Права токена: Account Cloudflare Tunnel Edit і Zone DNS Edit для smarthub.fun."
  echo "Після цього знову запустіть: ./setup-tunnel.sh"
  exit 1
fi

TOKEN="${CLOUDFLARE_API_TOKEN:-}"
AUTH=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")

ACCOUNT=$(curl -fsS "${AUTH[@]}" https://api.cloudflare.com/client/v4/accounts | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")
ZONE=$(curl -fsS "${AUTH[@]}" "https://api.cloudflare.com/client/v4/zones?name=smarthub.fun" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'][0]['id'])")

TUNNEL=$(curl -fsS "${AUTH[@]}" -X POST "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/cfd_tunnel" \
  --data '{"name":"smarthub","config_src":"cloudflare"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['id'])")

curl -fsS "${AUTH[@]}" -X PUT "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/cfd_tunnel/${TUNNEL}/configurations" \
  --data '{"config":{"ingress":[{"hostname":"smarthub.fun","service":"http://homeassistant:8123"},{"service":"http_status:404"}]}}' >/dev/null

curl -fsS "${AUTH[@]}" -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records" \
  --data "{\"type\":\"CNAME\",\"name\":\"smarthub.fun\",\"content\":\"${TUNNEL}.cfargotunnel.com\",\"proxied\":true}" >/dev/null || true

CONNECTOR=$(curl -fsS "${AUTH[@]}" "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/cfd_tunnel/${TUNNEL}/token" | python3 -c "import json,sys; print(json.load(sys.stdin)['result'])")

touch .env
grep -v '^TUNNEL_TOKEN=' .env > .env.tmp || true
printf 'TUNNEL_TOKEN=%s\n' "$CONNECTOR" >> .env.tmp
mv .env.tmp .env

/usr/local/bin/docker --context desktop-linux compose --profile tunnel up -d
echo "Тунель піднято: https://smarthub.fun"
