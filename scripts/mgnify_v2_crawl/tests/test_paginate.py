
from scripts.mgnify_v2_crawl import paginate


def make_fake_get(count, items_by_page):
    """Pages missing from `items_by_page` return no items; every call is recorded."""
    calls = []

    def fake_get(path, params=None, **kwargs):
        calls.append({"path": path, "params": dict(params or {})})
        page = (params or {}).get("page", 1)
        return {"count": count, "items": items_by_page.get(page, [])}

    fake_get.calls = calls
    return fake_get


def test_three_pages_yield_all_items_in_order():
    get = make_fake_get(5, {1: [1, 2], 2: [3, 4], 3: [5]})
    out = list(paginate.iter_pages("assemblies/", page_size=2, get=get))
    assert out == [1, 2, 3, 4, 5]


def test_each_item_emitted_exactly_once():
    get = make_fake_get(4, {1: ["a", "b"], 2: ["c", "d"]})
    out = list(paginate.iter_pages("samples/", page_size=2, get=get))
    assert out == ["a", "b", "c", "d"]
    assert len(out) == len(set(out))


def test_empty_collection_yields_nothing():
    get = make_fake_get(0, {})
    out = list(paginate.iter_pages("biomes/", page_size=2, get=get))
    assert out == []


def test_does_not_request_a_page_past_the_count():
    get = make_fake_get(5, {1: [1, 2], 2: [3, 4], 3: [5]})
    list(paginate.iter_pages("assemblies/", page_size=2, get=get))
    requested_pages = [c["params"].get("page", 1) for c in get.calls]
    assert requested_pages == [1, 2, 3]
    assert 4 not in requested_pages


def test_empty_collection_only_fetches_page_one():
    get = make_fake_get(0, {})
    list(paginate.iter_pages("biomes/", page_size=2, get=get))
    assert len(get.calls) == 1


def test_page_size_passed_in_params():
    get = make_fake_get(2, {1: [1, 2]})
    list(paginate.iter_pages("runs/", page_size=2, get=get))
    assert get.calls[0]["params"]["page_size"] == 2


def test_extra_params_are_preserved_each_page():
    get = make_fake_get(3, {1: ["a", "b"], 2: ["c"]})
    list(paginate.iter_pages(
        "analyses/", params={"experiment_type": "assembly"},
        page_size=2, get=get,
    ))
    for call in get.calls:
        assert call["params"]["experiment_type"] == "assembly"


def test_single_full_page_exact_multiple():
    get = make_fake_get(2, {1: [1, 2]})
    out = list(paginate.iter_pages("x/", page_size=2, get=get))
    assert out == [1, 2]
    assert len(get.calls) == 1


def test_none_body_on_page_one_yields_nothing():
    def get(path, params=None, **kwargs):
        return None

    out = list(paginate.iter_pages("x/", page_size=2, get=get))
    assert out == []


def test_none_body_mid_stream_yields_only_prior_pages():
    def get(path, params=None, **kwargs):
        if (params or {}).get("page", 1) == 1:
            return {"count": 10, "items": [1, 2]}
        return None

    out = list(paginate.iter_pages("x/", page_size=2, get=get))
    assert out == [1, 2]


def test_null_count_yields_nothing_without_typeerror():
    get = make_fake_get(None, {})
    out = list(paginate.iter_pages("x/", page_size=2, get=get))
    assert out == []


def test_stops_when_page_returns_no_items_even_if_count_lies():
    get = make_fake_get(10, {1: [1, 2]})
    out = list(paginate.iter_pages("x/", page_size=2, get=get))
    assert out == [1, 2]
    assert len(get.calls) == 2
