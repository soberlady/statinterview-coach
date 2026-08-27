from statinterview_agent.livekit_worker import _api_request_headers


def test_api_auth_is_absent_for_local_development(monkeypatch) -> None:
    monkeypatch.delenv("STATINTERVIEW_API_AUTH_BEARER_TOKEN", raising=False)
    monkeypatch.delenv("STATINTERVIEW_API_AUTH_HEADER", raising=False)

    assert _api_request_headers() == {}


def test_api_auth_uses_configured_bearer_header(monkeypatch) -> None:
    monkeypatch.setenv("STATINTERVIEW_API_AUTH_BEARER_TOKEN", "test-token")
    monkeypatch.setenv(
        "STATINTERVIEW_API_AUTH_HEADER",
        "OAI-Sites-Authorization",
    )

    assert _api_request_headers() == {
        "OAI-Sites-Authorization": "Bearer test-token"
    }


def test_api_auth_rejects_an_empty_header_name(monkeypatch) -> None:
    monkeypatch.setenv("STATINTERVIEW_API_AUTH_BEARER_TOKEN", "test-token")
    monkeypatch.setenv("STATINTERVIEW_API_AUTH_HEADER", "   ")

    try:
        _api_request_headers()
    except ValueError as error:
        assert "cannot be empty" in str(error)
    else:
        raise AssertionError("expected an empty auth header name to fail")
