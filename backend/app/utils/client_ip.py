"""The visitor's IP address, as the trusted proxies in front of the app saw it.

One rule for every caller (rate limiting, login audit, request logs). Three copies
of it used to drift: two read one entry too far left in X-Forwarded-For and one
read the leftmost, so a client could choose its own rate-limit bucket.
"""

from starlette.requests import Request

from ..core.config import get_settings


def get_client_ip(request: Request) -> str:
    """Each of the TRUSTED_PROXY_COUNT proxies appends one X-Forwarded-For entry, so
    the client is N entries from the end; anything left of that the client wrote
    itself. On the Pi (Cloudflare, then Caddy, N=2) the header reads
    "<client>, <docker gateway>". With N=0, headers are ignored and the TCP peer
    is used, since nothing in front of the app vouches for them.
    """
    trusted_proxies = get_settings().TRUSTED_PROXY_COUNT

    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for and trusted_proxies > 0:
        ips = [ip.strip() for ip in forwarded_for.split(",") if ip.strip()]
        if ips:
            # Fewer entries than proxies: the request skipped one (a LAN request
            # straight to Caddy), so the first entry is the one a proxy wrote.
            return ips[max(0, len(ips) - trusted_proxies)]

    real_ip = request.headers.get("x-real-ip")
    if real_ip and trusted_proxies > 0:
        return real_ip.strip()

    return getattr(request.client, "host", None) or "unknown"
