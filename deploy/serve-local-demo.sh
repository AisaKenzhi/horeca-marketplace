#!/usr/bin/env bash
#
# Publish the HoReCa marketplace STATIC DEMO on this host, reversibly.
#
# What this does (and does NOT do):
#   - builds `dist/` and copies it to /var/www/horeca-demo
#   - serves it with nginx on a DEDICATED port (default 8080)
#   - it does NOT touch any existing site, domain, certificate, DNS record,
#     cloud firewall rule, or paid resource
#   - the app is a client-only SPA with in-memory state: no backend, no DB,
#     no real orders, no data collection
#
# Usage:  ./deploy/serve-local-demo.sh [PORT]
# Undo:   sudo rm /etc/nginx/sites-enabled/horeca-demo && sudo systemctl reload nginx
#         sudo rm -rf /var/www/horeca-demo
set -euo pipefail

PORT="${1:-8080}"
ROOT="/var/www/horeca-demo"
SITE="/etc/nginx/sites-available/horeca-demo"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building the static demo"
( cd "$HERE" && npm run build )

echo "==> Publishing to $ROOT"
sudo mkdir -p "$ROOT"
sudo rm -rf "${ROOT:?}"/*
sudo cp -r "$HERE/dist/." "$ROOT/"
printf 'User-agent: *\nDisallow: /\n' | sudo tee "$ROOT/robots.txt" >/dev/null

echo "==> Installing the nginx site (port $PORT)"
sudo tee "$SITE" >/dev/null <<NGINX
# HoReCa Marketplace — private static demo (synthetic data only).
# Dedicated port; does not touch any other site on this host.
server {
    listen $PORT;
    listen [::]:$PORT;
    server_name _;

    root $ROOT;
    index index.html;

    add_header X-Robots-Tag "noindex, nofollow" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location /assets/ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800, immutable";
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX
sudo ln -sf "$SITE" /etc/nginx/sites-enabled/horeca-demo

echo "==> Validating and reloading nginx"
sudo nginx -t
sudo systemctl reload nginx

echo "==> Local check"
curl -s -o /dev/null -w "GET / -> %{http_code}\n" "http://127.0.0.1:$PORT/"
echo "Done. Serving on 127.0.0.1:$PORT (add a firewall/DNS entry to expose it)."
