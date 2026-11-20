#!/usr/bin/env bash
#
# Publish the HoReCa marketplace STATIC DEMO under a real hostname with free
# Let's Encrypt TLS, WITHOUT touching any other site on this host.
#
# Prerequisites (owner action, done once):
#   - a DNS A record pointing your chosen subdomain at THIS host's public IP,
#     e.g.  demo.spokogastro.bond  ->  34.116.173.67
#   - if the DNS provider proxies (Cloudflare orange cloud), set it DNS-only
#     (grey cloud) so the HTTP-01 challenge can be served.
#
# What this does (and does NOT do):
#   - builds `dist/` and copies it to /var/www/horeca-demo
#   - installs an nginx vhost for YOUR hostname only (server_name match)
#   - obtains a free Let's Encrypt certificate for that hostname via certbot
#   - it does NOT modify any other vhost, certificate, DNS record or firewall
#   - the app is a client-only SPA with in-memory state: no backend, no DB,
#     no real orders, no data collection
#
# Usage:  ./deploy/serve-domain-demo.sh demo.spokogastro.bond [email]
# Undo:   sudo certbot delete --cert-name <host>   # removes the cert
#         sudo rm /etc/nginx/sites-enabled/horeca-demo-domain && sudo systemctl reload nginx
#         sudo rm -rf /var/www/horeca-demo
set -euo pipefail

HOST="${1:-}"
EMAIL="${2:-}"
ROOT="/var/www/horeca-demo"
SITE="/etc/nginx/sites-available/horeca-demo-domain"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$HOST" ]]; then
  echo "Usage: $0 <hostname> [email]" >&2
  echo "  e.g. $0 demo.spokogastro.bond admin@example.com" >&2
  exit 2
fi

echo "==> Checking DNS for $HOST"
RESOLVED="$(getent hosts "$HOST" | awk '{print $1}' | head -1 || true)"
echo "    $HOST resolves to: ${RESOLVED:-<nothing>}"
if [[ "$RESOLVED" != "34.116.173.67" ]]; then
  echo "!! WARNING: $HOST does not resolve to this host (34.116.173.67)." >&2
  echo "!! Add the DNS A record first, or certbot's HTTP-01 challenge will fail." >&2
  echo "!! Continuing anyway (dry-run safe), but TLS issuance will likely fail." >&2
fi

echo "==> Building the static demo"
( cd "$HERE" && npm run build )

echo "==> Publishing to $ROOT"
sudo mkdir -p "$ROOT"
sudo rm -rf "${ROOT:?}"/*
sudo cp -r "$HERE/dist/." "$ROOT/"
printf 'User-agent: *\nDisallow: /\n' | sudo tee "$ROOT/robots.txt" >/dev/null
sudo chown -R www-data:www-data "$ROOT" 2>/dev/null || true

# If a live certificate already exists, do NOT overwrite the vhost with a plain
# HTTP draft: certbot managed that file and it already serves TLS. Reinstalling
# is enough. This keeps the script idempotent (a second run must not take the
# demo offline or ask an interactive question).
CERT_DIR="/etc/letsencrypt/live/$HOST"
EXISTING_CERT=0
if sudo test -f "$CERT_DIR/fullchain.pem"; then
  EXISTING_CERT=1
fi

if [[ "$EXISTING_CERT" -eq 1 ]]; then
  echo "==> Existing certificate found for $HOST — keeping its vhost, no rewrite"
  sudo ln -sf "$SITE" /etc/nginx/sites-enabled/horeca-demo-domain
else
  echo "==> Installing the nginx vhost for $HOST (HTTP first)"
  sudo tee "$SITE" >/dev/null <<NGINX
# HoReCa Marketplace — private static demo for $HOST (synthetic data only).
# This vhost matches ONLY this hostname; other sites on this host are untouched.
server {
    listen 80;
    listen [::]:80;
    server_name $HOST;

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
  sudo ln -sf "$SITE" /etc/nginx/sites-enabled/horeca-demo-domain

  echo "==> Validating and reloading nginx"
  sudo nginx -t
  sudo systemctl reload nginx
fi

echo "==> Requesting a Let's Encrypt certificate for $HOST (certbot --nginx)"
# --nginx edits ONLY the matching server block; other vhosts are left alone.
# Always non-interactive: re-running must never hang on a prompt.
CERTBOT_ARGS=(--nginx -d "$HOST" --agree-tos --redirect --no-eff-email --non-interactive)
if [[ "$EXISTING_CERT" -eq 1 ]]; then
  CERTBOT_ARGS+=(--reinstall)
fi
if [[ -n "$EMAIL" ]]; then
  CERTBOT_ARGS+=(-m "$EMAIL")
else
  CERTBOT_ARGS+=(--register-unsafely-without-email)
fi
sudo certbot "${CERTBOT_ARGS[@]}"

echo "==> Validating and reloading nginx after certbot"
sudo nginx -t
sudo systemctl reload nginx

echo "==> External check"
curl -s -o /dev/null -w "https://$HOST/ -> %{http_code}\n" "https://$HOST/" || true
curl -s -o /dev/null -w "https://$HOST/catalog -> %{http_code}\n" "https://$HOST/catalog" || true
echo "Done. Demo served at https://$HOST/ (noindex enforced; synthetic data only)."
