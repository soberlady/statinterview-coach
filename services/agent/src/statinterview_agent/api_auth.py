"""Service authentication without loading optional speech SDKs or env files."""

import os


def api_request_headers() -> dict[str, str]:
    """Return an optional bearer header for an owner-only API deployment."""

    token = os.environ.get(
        "STATINTERVIEW_API_AUTH_BEARER_TOKEN", ""
    ).strip()
    header_name = os.environ.get(
        "STATINTERVIEW_API_AUTH_HEADER", "OAI-Sites-Authorization"
    ).strip()
    if not token:
        return {}
    if not header_name:
        raise ValueError(
            "STATINTERVIEW_API_AUTH_HEADER cannot be empty when an API "
            "auth token is configured"
        )
    return {header_name: f"Bearer {token}"}
