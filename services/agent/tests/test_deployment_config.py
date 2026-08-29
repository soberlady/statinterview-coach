from pathlib import Path


AGENT_ROOT = Path(__file__).resolve().parents[1]


def test_livekit_cloud_image_runs_unprivileged_start_mode() -> None:
    dockerfile = (AGENT_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "FROM python:3.11-slim" in dockerfile
    assert "USER appuser" in dockerfile
    assert (
        'CMD ["python", "-m", '
        '"statinterview_agent.livekit_worker", "start"]'
    ) in dockerfile
    assert "LIVEKIT_API_KEY" not in dockerfile
    assert "LIVEKIT_API_SECRET" not in dockerfile
    assert "LIVEKIT_URL" not in dockerfile


def test_livekit_cloud_dependencies_are_pinned_for_reproducible_builds() -> None:
    requirements = (
        (AGENT_ROOT / "requirements.txt")
        .read_text(encoding="utf-8")
        .splitlines()
    )

    assert "livekit-agents==1.6.7" in requirements
    assert all("==" in line for line in requirements if line.strip())


def test_cloud_build_context_excludes_local_state_and_tests() -> None:
    exclusions = {
        line.strip()
        for line in (AGENT_ROOT / ".dockerignore")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }

    assert {".env", ".env.*", ".venv", "tests", "__pycache__"} <= exclusions

