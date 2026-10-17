#!/bin/sh
set -eu
DOMAIN="${DOMAIN:-app.cargos.pro}"
mkdir -p /etc/nginx/certs

sync_once() {
  live="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
  key="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"
  if [ -f "$live" ] && [ -f "$key" ]; then
    cp -L "$live" /etc/nginx/certs/fullchain.pem
    cp -L "$key" /etc/nginx/certs/privkey.pem
  elif [ ! -f /etc/nginx/certs/fullchain.pem ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 2 \
      -keyout /etc/nginx/certs/privkey.pem \
      -out /etc/nginx/certs/fullchain.pem \
      -subj "/CN=${DOMAIN}"
  fi
}

if [ "${1:-once}" = "watch" ]; then
  while true; do
    sleep 21600
    sync_once
    nginx -s reload || true
  done
else
  sync_once
fi
