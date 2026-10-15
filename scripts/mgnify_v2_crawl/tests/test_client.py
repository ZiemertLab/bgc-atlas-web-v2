import pytest

from scripts.mgnify_v2_crawl import client
from scripts.mgnify_v2_crawl import config


class FakeResponse:
    def __init__(self, status_code, json_data=None, headers=None):
        self.status_code = status_code
        self._json = json_data
        self.headers = headers or {}

    def json(self):
        return self._json


class FakeSession:
    """Queued entries are returned, or raised if they are exceptions."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture(autouse=True)
def no_real_sleep(monkeypatch):
    slept = []
    monkeypatch.setattr(client, "_sleep", lambda s: slept.append(s))
    return slept


def test_200_returns_json():
    sess = FakeSession([FakeResponse(200, {"count": 3, "items": [1, 2, 3]})])
    out = client.get_json("samples/ERS1", session=sess)
    assert out == {"count": 3, "items": [1, 2, 3]}
    assert sess.calls[0]["url"] == config.BASE_URL + "samples/ERS1"
    assert sess.calls[0]["timeout"] == (config.CONNECT_TIMEOUT, config.READ_TIMEOUT)


def test_params_passed_through():
    sess = FakeSession([FakeResponse(200, {"ok": True})])
    client.get_json("assemblies/", params={"page": 2, "page_size": 100}, session=sess)
    assert sess.calls[0]["params"] == {"page": 2, "page_size": 100}


def test_404_returns_none():
    sess = FakeSession([FakeResponse(404)])
    assert client.get_json("samples/GONE", session=sess) is None


def test_retries_on_503_then_succeeds(no_real_sleep):
    sess = FakeSession([
        FakeResponse(503),
        FakeResponse(503),
        FakeResponse(200, {"ok": 1}),
    ])
    out = client.get_json("analyses/", session=sess)
    assert out == {"ok": 1}
    assert len(sess.calls) == 3
    assert len(no_real_sleep) == 2


def test_retries_on_request_exception_then_succeeds(no_real_sleep):
    import requests
    sess = FakeSession([
        requests.exceptions.ConnectionError("boom"),
        FakeResponse(200, {"ok": 1}),
    ])
    assert client.get_json("runs/", session=sess) == {"ok": 1}
    assert len(no_real_sleep) == 1


def test_persistent_500_raises_crawl_error(no_real_sleep):
    sess = FakeSession([FakeResponse(500) for _ in range(config.MAX_RETRIES + 1)])
    with pytest.raises(client.CrawlError) as exc:
        client.get_json("studies/", session=sess)
    msg = str(exc.value)
    assert "studies/" in msg
    assert "500" in msg
    assert len(sess.calls) == config.MAX_RETRIES + 1


def test_400_raises_immediately_without_retry(no_real_sleep):
    sess = FakeSession([FakeResponse(400)])
    with pytest.raises(client.CrawlError):
        client.get_json("bad/", session=sess)
    assert len(sess.calls) == 1
    assert no_real_sleep == []


def test_retry_after_header_respected(no_real_sleep):
    sess = FakeSession([
        FakeResponse(429, headers={"Retry-After": "7"}),
        FakeResponse(200, {"ok": 1}),
    ])
    assert client.get_json("samples/", session=sess) == {"ok": 1}
    assert no_real_sleep == [7]


def test_retry_after_non_integer_falls_back_to_backoff(no_real_sleep):
    sess = FakeSession([
        FakeResponse(503, headers={"Retry-After": "soon"}),
        FakeResponse(200, {"ok": 1}),
    ])
    assert client.get_json("samples/", session=sess) == {"ok": 1}
    assert len(no_real_sleep) == 1
    assert no_real_sleep[0] > 0


def test_backoff_is_capped(no_real_sleep):
    sess = FakeSession(
        [FakeResponse(503) for _ in range(config.MAX_RETRIES)]
        + [FakeResponse(200, {"ok": 1})]
    )
    client.get_json("x/", session=sess)
    assert all(s <= config.BACKOFF_CAP for s in no_real_sleep)
    assert all(s >= 0 for s in no_real_sleep)


def test_uses_module_session_when_none_passed(monkeypatch):
    captured = {}

    def fake_get(self, url, params=None, timeout=None):
        captured["url"] = url
        return FakeResponse(200, {"ok": 1})

    import requests
    monkeypatch.setattr(requests.Session, "get", fake_get)
    client._SESSION = None
    out = client.get_json("biomes/")
    assert out == {"ok": 1}
    assert captured["url"] == config.BASE_URL + "biomes/"
