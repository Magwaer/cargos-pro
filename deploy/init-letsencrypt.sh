#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Copy .env.example to .env and set DOMAIN, ACME_EMAIL, POSTGRES_PASSWORD, and JWT_SECRET."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${DOMAIN:?Set DOMAIN in .env}"
: "${ACME_EMAIL:?Set ACME_EMAIL in .env}"

docker compose -f docker-compose.prod.yml up -d db api web

docker compose -f docker-compose.prod.yml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$ACME_EMAIL" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  --keep-until-expiring

docker compose -f docker-compose.prod.yml restart web
echo "Certificate installed for ${DOMAIN}. Nginx reloaded the new files on restart."
