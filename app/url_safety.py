"""SSRF + outbound-fetch guardrails for the capture pipeline.

Why this module exists
----------------------
Public capture endpoints (``POST /capture`` and ``POST /capture/session``)
let the caller hand us an arbitrary URL that the backend then fetches.
Without protections this gives an attacker two wins:

1. **Cost / resource amplification.** Each request triggers an outbound
   download AND a paid LLM analysis call. With no byte cap and no
   per-IP throttle, a single attacker can drive bandwidth, memory and
   model-spend at will.
2. **SSRF-style content access.** A server-side fetch can reach hosts
   the attacker's own browser cannot — Cloud Run loopback, the GCP
   metadata server (169.254.169.254), and any RFC1918 service the
   instance happens to be peered with. The fetched body is then summarised
   by the LLM and returned in the response.

This module provides two primitives the capture flow uses everywhere:

* ``validate_url_shape(url)`` — fast sync sanity check (scheme, length,
  hostname present, no embedded credentials).
* ``safe_get(...)`` — async fetch that resolves the host, blocks every
  non-public address, manually re-validates every redirect target, caps
  the response body before buffering, and optionally enforces a
  content-type allowlist.

DNS rebinding is a real concern in theory: between the resolution check
and the actual TCP connect, the answer can change. We accept that risk
for now (it requires an attacker-controlled domain whose TTL collapses
to zero) and recommend mitigation at the network layer (egress firewall
on Cloud Run) for a defence-in-depth follow-up.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from typing import Iterable, Optional, Tuple
from urllib.parse import urlsplit

import httpx


# Hard upper bounds. These exist to stop a single capture from saturating
# the worker; the per-IP rate limiter (app/rate_limit.py) caps frequency.
MAX_URL_LENGTH = 2048
DEFAULT_MAX_REDIRECTS = 3
DEFAULT_MAX_BYTES_WEB = 5 * 1024 * 1024     # 5 MiB — generous for HTML+CSS
DEFAULT_MAX_BYTES_PDF = 25 * 1024 * 1024    # 25 MiB — most papers fit
DEFAULT_MAX_BYTES_JSON = 64 * 1024          # 64 KiB — oembed responses are tiny


class UnsafeURLError(ValueError):
    """Raised when a URL fails any of the safety checks (scheme, host,
    address class, redirect target, response size, content type)."""


def validate_url_shape(url: str) -> str:
    """Synchronous structural validation. Cheap, and run before every
    network call (including each redirect hop) so a malformed Location
    header can't slip past the address check.

    Returns the original URL string (trimmed) on success.
    """
    if not url:
        raise UnsafeURLError("URL is required")
    candidate = url.strip()
    if len(candidate) > MAX_URL_LENGTH:
        raise UnsafeURLError(f"URL exceeds {MAX_URL_LENGTH} chars")
    try:
        parsed = urlsplit(candidate)
    except ValueError as e:
        raise UnsafeURLError(f"URL parse error: {e}") from e
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        # Reject file://, data://, gopher://, ftp://, etc. — every
        # historical SSRF amplifier.
        raise UnsafeURLError(f"Only http/https schemes allowed (got {scheme!r})")
    if not parsed.hostname:
        raise UnsafeURLError("URL must include a hostname")
    if parsed.username or parsed.password:
        # Embedded creds change the request semantics and have been used
        # to slip past naive allowlists ("user@evil.com:80@trusted.com").
        raise UnsafeURLError("URL must not include credentials")
    return candidate


def _ip_is_public(ip_str: str) -> bool:
    """True only for globally routable, non-special IPs.

    Uses ``ip.is_global`` as the authoritative gate (default-deny). That
    flag is False for every special-purpose range we care about — including
    CGNAT/shared 100.64.0.0/10 and deprecated IPv6 site-local fec0::/10
    — which an enumerated denylist on ``is_private``/``is_link_local``
    misses. Any earlier review of "we may want CGNAT to pass for some
    CDNs" was wrong: those addresses are by definition non-globally
    routable and have no business being targets of an outbound capture
    fetch from Cloud Run.

    IPv4-mapped IPv6 addresses are unwrapped first so ``::ffff:10.0.0.1``
    can't sneak through under the IPv6 codepath.
    """
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if not bool(getattr(ip, "is_global", False)):
        return False
    # Defence-in-depth: Python now treats deprecated IPv6 site-local
    # (fec0::/10) as global unicast per RFC 4291, so ``is_global``
    # returns True for those addresses. They're still commonly used on
    # internal IPv6 networks where a misconfigured Cloud Run egress
    # might reach them, so we keep the explicit deny.
    if isinstance(ip, ipaddress.IPv6Address):
        if ipaddress.IPv6Network("fec0::/10").supernet_of(
            ipaddress.IPv6Network(f"{ip}/128")
        ):
            return False
    return True


async def _resolve_and_validate(host: str) -> None:
    """Resolve ``host`` and raise ``UnsafeURLError`` if any returned IP
    is non-public. All addresses must pass — a single private answer
    rejects the request, so multi-record DNS responses can't smuggle a
    private IP behind a public one.
    """
    if not host:
        raise UnsafeURLError("Empty hostname")
    # Reject literal IP addresses pointing at non-public ranges directly,
    # which spares us a DNS round-trip and makes the policy obvious.
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        if not _ip_is_public(str(literal)):
            raise UnsafeURLError(f"Address {host!r} is not publicly routable")
        return

    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError as e:
        raise UnsafeURLError(f"Cannot resolve host {host!r}: {e}") from e
    if not infos:
        raise UnsafeURLError(f"No DNS records for {host!r}")
    for info in infos:
        sockaddr = info[4]
        ip_str = sockaddr[0]
        if not _ip_is_public(ip_str):
            raise UnsafeURLError(
                f"Host {host!r} resolves to a blocked address ({ip_str})"
            )


def _content_type_allowed(
    response: httpx.Response,
    allowed_prefixes: Optional[Iterable[str]],
) -> Tuple[bool, str]:
    if not allowed_prefixes:
        return True, ""
    raw = (response.headers.get("content-type") or "").split(";", 1)[0]
    ct = raw.strip().lower()
    if not ct:
        # Some misconfigured servers omit content-type entirely. We let
        # those through rather than over-block, since the body cap and
        # downstream parsers (BeautifulSoup, pypdf) are robust enough.
        return True, ""
    for prefix in allowed_prefixes:
        if ct.startswith(prefix):
            return True, ct
    return False, ct


async def safe_get(
    *,
    url: str,
    timeout: float = 15.0,
    headers: Optional[dict] = None,
    max_bytes: int,
    allowed_content_types: Optional[Tuple[str, ...]] = None,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
) -> httpx.Response:
    """SSRF-safe GET with byte cap and optional content-type allowlist.

    Behaviour notes:

    * Redirects are followed manually so each hop's ``Location`` target
      is re-validated through ``validate_url_shape`` + DNS resolution.
      ``follow_redirects=True`` on the underlying client would let
      httpx silently chase a 302 into 169.254.169.254.
    * The body is streamed in chunks; if the running total crosses
      ``max_bytes`` mid-stream the connection is closed and an
      ``UnsafeURLError`` is raised. The declared ``Content-Length``
      header is also pre-checked when present.
    * The returned ``Response`` has ``.content`` populated so callers
      can use ``resp.text`` / ``resp.content`` / ``resp.json()`` exactly
      as they would with a buffered request.
    """
    current_url = validate_url_shape(url)
    final_headers = dict(headers or {})

    # ``follow_redirects=False`` is critical — see docstring above.
    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=timeout,
        max_redirects=0,
    ) as client:
        for hop in range(max_redirects + 1):
            parsed = urlsplit(current_url)
            await _resolve_and_validate(parsed.hostname or "")

            req = client.build_request("GET", current_url, headers=final_headers)
            resp = await client.send(req, stream=True)
            try:
                if resp.is_redirect:
                    if hop >= max_redirects:
                        raise UnsafeURLError(
                            f"Too many redirects (>{max_redirects})"
                        )
                    location = resp.headers.get("location") or ""
                    if not location:
                        raise UnsafeURLError("Redirect missing Location header")
                    # Resolve relative redirects against the current URL so
                    # ``Location: /admin`` doesn't bypass the host check.
                    next_url = str(httpx.URL(current_url).join(location))
                    current_url = validate_url_shape(next_url)
                    await resp.aclose()
                    continue

                ok, ct = _content_type_allowed(resp, allowed_content_types)
                if not ok:
                    raise UnsafeURLError(f"Disallowed content-type: {ct!r}")

                cl = resp.headers.get("content-length")
                if cl and cl.isdigit() and int(cl) > max_bytes:
                    raise UnsafeURLError(
                        f"Response too large: declared {cl} bytes (cap {max_bytes})"
                    )

                buf = bytearray()
                async for chunk in resp.aiter_bytes():
                    if not chunk:
                        continue
                    buf.extend(chunk)
                    if len(buf) > max_bytes:
                        raise UnsafeURLError(
                            f"Response exceeded {max_bytes} bytes mid-stream"
                        )
                # Populate Response._content so callers can use .text /
                # .content / .json() without re-issuing the request.
                resp._content = bytes(buf)
                return resp
            except UnsafeURLError:
                if not resp.is_closed:
                    await resp.aclose()
                raise
            except Exception:
                if not resp.is_closed:
                    await resp.aclose()
                raise
        # The for-loop runs (max_redirects + 1) times so the only way
        # out is a return inside the loop or an exception. This line
        # is defensive — should be unreachable.
        raise UnsafeURLError("Exhausted redirect budget without a final response")
