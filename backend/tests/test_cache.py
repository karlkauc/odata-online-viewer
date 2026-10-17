"""Tests for the in-memory TTL cache."""

from __future__ import annotations

from unittest.mock import patch

from app.cache import TtlCache


def test_expires_after_the_ttl_of_disuse() -> None:
    cache: TtlCache[str] = TtlCache(max_entries=4, ttl_seconds=60)
    with patch("app.cache.time.monotonic", return_value=0.0):
        cache.put("a", "A")
    with patch("app.cache.time.monotonic", return_value=61.0):
        assert cache.get("a") is None


def test_use_extends_the_ttl() -> None:
    # A document loaded an hour ago and validated ever since must not vanish
    # mid-session ("XML not found or expired").
    cache: TtlCache[str] = TtlCache(max_entries=4, ttl_seconds=60)
    with patch("app.cache.time.monotonic", return_value=0.0):
        cache.put("a", "A")
    with patch("app.cache.time.monotonic", return_value=50.0):
        assert cache.get("a") == "A"
    with patch("app.cache.time.monotonic", return_value=100.0):
        assert cache.get("a") == "A"
    with patch("app.cache.time.monotonic", return_value=161.0):
        assert cache.get("a") is None


def test_least_recently_used_entry_is_evicted() -> None:
    cache: TtlCache[str] = TtlCache(max_entries=2, ttl_seconds=60)
    cache.put("a", "A")
    cache.put("b", "B")
    assert cache.get("a") == "A"
    cache.put("c", "C")
    assert cache.get("b") is None
    assert cache.get("a") == "A" and cache.get("c") == "C"
