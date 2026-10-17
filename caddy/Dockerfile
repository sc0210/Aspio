# Caddy built with the Cloudflare DNS plugin so it can solve the Let's Encrypt
# DNS-01 challenge (needed because the Pi isn't reachable from the public
# internet — cert issuance is proven via a Cloudflare TXT record instead).
# Multi-arch: builds natively for the Pi's arm64.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
