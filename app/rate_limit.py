"""In-process sliding-window rate limiter.

Used to throttle the public capture endpoints so a single attacker can't
drive unbounded outbound fetches + paid LLM calls. The window is per
*key* — typically the client IP — so legitimate users on a shared NAT
still get their own quotas.

Caveats
-------
* This is per-process state. Cloud Run may scale to N replicas and each
  one keeps its own counter, so the effective cap is up to N×limit. For
  single-attacker abuse this is still a sharp ceiling because requests
  fan out over the same handful of source IPs and each hit is amplified
  many-fold by an LLM call. A future hardening step would move this to
  a shared store (Redis / Firestore counter) when traffic justifies it.
* Memory is bounded by ``max_keys`` — when the table grows past that
  threshold, empty buckets get pruned first, then the oldest non-empty
  buckets are evicted. This protects the process from a memory-amplifier
  attack that just rotates the source IP every request.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections import deque
from typing import Deque, Dict, Optional


# Whether to honour proxy-supplied IP headers (X-Forwarded-For,
# X-Real-IP) when computing the rate-limit key. OFF by default because
# trusting these headers from an untrusted upstream lets an attacker
# rotate the apparent client IP per request and bypass the limiter
# entirely. Operators must opt in (e.g. set TRUST_PROXY_HEADERS=1 on
# Cloud Run / behind any reverse proxy that *overwrites* XFF).
_TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "").strip().lower() in (
    "1", "true", "yes", "on",
)


class SlidingWindowLimiter:
    """Track up to ``max_calls`` events per ``window_seconds`` per key."""

    def __init__(
        self,
        *,
        max_calls: int,
        window_seconds: float,
        max_keys: int = 5000,
    ) -> None:
        if max_calls <= 0 or window_seconds <= 0:
            raise ValueError("max_calls and window_seconds must be positive")
        self.max_calls = max_calls
        self.window = window_seconds
        self.max_keys = max_keys
        self._buckets: Dict[str, Deque[float]] = {}
        self._lock = asyncio.Lock()

    async def allow(self, key: str) -> bool:
        """Return True and record a hit if ``key`` is under quota.

        Empty / falsy keys are always allowed — the caller is expected
        to fall back to a sane default (e.g. ``"unknown"``) if it can't
        identify the client.
        """
        if not key:
            return True
        async with self._lock:
            now = time.monotonic()
            cutoff = now - self.window
            q = self._buckets.get(key)
            if q is None:
                q = deque()
                self._buckets[key] = q
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_calls:
                # Don't grow the bucket past the cap so a sustained burst
                # can't inflate the deque.
                return False
            q.append(now)
            self._maybe_evict()
            return True

    def _maybe_evict(self) -> None:
        if len(self._buckets) <= self.max_keys:
            return
        # Drop empty buckets first.
        empties = [k for k, v in self._buckets.items() if not v]
        for k in empties[: max(1000, len(empties) // 2)]:
            self._buckets.pop(k, None)
        if len(self._buckets) <= self.max_keys:
            return
        # Still over budget — evict the oldest 10% by most-recent hit.
        ranked = sorted(
            self._buckets.items(),
            key=lambda item: item[1][-1] if item[1] else 0.0,
        )
        target = max(1, len(ranked) // 10)
        for k, _ in ranked[:target]:
            self._buckets.pop(k, None)


def client_ip_from_request(request) -> str:
    """Extract a client IP for rate-limit keys.

    Default behaviour is socket-peer-only — proxy headers (XFF, X-Real-IP)
    are ignored unless ``TRUST_PROXY_HEADERS=1`` is set in the environment.
    Without that opt-in, an attacker who can reach the API directly (or
    forge the header through any unfiltered proxy) could rotate the
    apparent client IP every request and effectively disable the limiter.

    When the env flag IS set, we trust the leftmost X-Forwarded-For entry
    (which the trusted proxy is expected to have already overwritten with
    the real client IP — this is what Google Cloud Run's load balancer
    does). Operators MUST only set this flag when every upstream in the
    chain strips/overwrites these headers.

    Returns ``"unknown"`` only when nothing is available.
    """
    try:
        if _TRUST_PROXY_HEADERS:
            xff = request.headers.get("x-forwarded-for") or ""
            if xff:
                first = xff.split(",", 1)[0].strip()
                if first:
                    return first
            real = request.headers.get("x-real-ip") or ""
            if real:
                return real.strip()
        client = getattr(request, "client", None)
        if client and client.host:
            return client.host
    except Exception:
        pass
    return "unknown"


# Public capture endpoints — generous enough for a real user committing
# a multi-item tray, tight enough to make abuse obvious. Tuned per-minute
# because the dominant cost (LLM analysis) is also a per-minute spend.
capture_limiter = SlidingWindowLimiter(max_calls=30, window_seconds=60.0)
