"""Thread-safe in-memory LRU + TTL cache for parsed metadata documents.

Intentionally process-local and non-durable: ids are content hashes, so the
frontend simply reloads the source when an entry has expired.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from typing import Generic, TypeVar

from app.config import settings

T = TypeVar("T")


@dataclass
class _Entry(Generic[T]):
    value: T
    expires_at: float


class TtlCache(Generic[T]):
    """Thread-safe LRU + TTL cache, small enough to keep in memory per process."""

    def __init__(self, max_entries: int, ttl_seconds: float) -> None:
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._store: OrderedDict[str, _Entry[T]] = OrderedDict()
        self._lock = Lock()

    def get(self, key: str) -> T | None:
        now = time.monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if entry.expires_at <= now:
                self._store.pop(key, None)
                return None
            # Sliding expiry: a document someone is still working with stays.
            entry.expires_at = now + self._ttl_seconds
            self._store.move_to_end(key)
            return entry.value

    def put(self, key: str, value: T) -> None:
        expires_at = time.monotonic() + self._ttl_seconds
        with self._lock:
            self._store[key] = _Entry(value=value, expires_at=expires_at)
            self._store.move_to_end(key)
            while len(self._store) > self._max_entries:
                self._store.popitem(last=False)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)


def _make_cache() -> TtlCache:
    return TtlCache(
        max_entries=settings.cache_max_entries,
        ttl_seconds=settings.cache_ttl_min * 60,
    )


# Holds app.api.metadata.StoredMetadata entries.
metadata_cache: TtlCache = _make_cache()
