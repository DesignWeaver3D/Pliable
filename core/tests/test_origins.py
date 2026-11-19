import asyncio

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from pliable.origins import allowed_origins
from pliable.serving import run


def accepts(host: str, origin: str | None) -> bool:
    return any(origin is None if rule is None else origin is not None and rule.fullmatch(origin) for rule in allowed_origins(host))


@pytest.mark.parametrize("origin", [
    None,
    "http://127.0.0.1:8770",
    "http://localhost:5180",
    "http://localhost",
    "http://[::1]:8770",
    "https://localhost:8443",
])
def test_pages_from_this_computer_are_accepted(origin: str | None) -> None:
    assert accepts("127.0.0.1", origin)


@pytest.mark.parametrize("origin", [
    "https://example.invalid",
    "http://example.invalid:8770",
    "http://127.0.0.1.example.invalid:8770",
    "http://localhost.example.invalid",
    "http://evil-localhost:8770",
    "http://127.0.0.1:8770/",
    "http://127.0.0.1:8770@example.invalid",
    "null",
    "file://",
    "",
])
def test_pages_from_elsewhere_are_refused(origin: str) -> None:
    assert not accepts("127.0.0.1", origin)


def test_the_address_the_core_listens_on_is_accepted_too() -> None:
    assert accepts("192.168.1.20", "http://192.168.1.20:8770")
    assert not accepts("192.168.1.20", "http://192.168.1.21:8770")
    assert accepts("::1", "http://[::1]:8770")


async def _try(origin: str | None) -> bool:
    """Start a core on a free port and say whether a connection with this origin is let in."""
    ready: asyncio.Future = asyncio.get_running_loop().create_future()
    server = asyncio.create_task(run("127.0.0.1", 0, ready=ready))
    try:
        port = await asyncio.wait_for(ready, 10)
        try:
            async with connect(f"ws://127.0.0.1:{port}", origin=origin, open_timeout=5):
                return True
        except InvalidStatus as refused:
            assert refused.response.status_code == 403
            return False
    finally:
        server.cancel()
        await asyncio.gather(server, return_exceptions=True)


def test_the_running_core_refuses_a_page_from_another_site(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PLIABLE_DATA", str(tmp_path))
    assert asyncio.run(_try("https://example.invalid")) is False


def test_the_running_core_lets_in_its_own_page_and_plain_programs(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PLIABLE_DATA", str(tmp_path))
    assert asyncio.run(_try("http://127.0.0.1:5180")) is True
    assert asyncio.run(_try(None)) is True
