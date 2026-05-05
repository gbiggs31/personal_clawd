"""Shared PostHog analytics client for the Avenra bot."""

import atexit
import os

from posthog import Posthog

_client: Posthog | None = None


def get_posthog() -> Posthog | None:
    """Return the shared PostHog instance, initializing it on first call."""
    global _client
    if _client is not None:
        return _client

    token = os.getenv("POSTHOG_PROJECT_TOKEN")
    if not token:
        return None

    host = os.getenv("POSTHOG_HOST")
    if not host:
        return None

    _client = Posthog(
        token,
        host=host,
        enable_exception_autocapture=True,
    )
    atexit.register(_client.shutdown)
    return _client


def capture(distinct_id: str | int, event: str, properties: dict | None = None) -> None:
    """Capture a PostHog event. No-ops silently if PostHog is not configured."""
    client = get_posthog()
    if client is None:
        return
    client.capture(
        distinct_id=str(distinct_id),
        event=event,
        properties=properties or {},
    )


def set_person(distinct_id: str | int, properties: dict) -> None:
    """Set person properties on a user profile."""
    client = get_posthog()
    if client is None:
        return
    client.set(
        distinct_id=str(distinct_id),
        properties=properties,
    )
