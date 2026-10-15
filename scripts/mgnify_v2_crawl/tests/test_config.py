from pathlib import Path

from scripts.mgnify_v2_crawl import config


def test_base_url_is_v2():
    assert config.BASE_URL == "https://www.ebi.ac.uk/metagenomics/api/v2/"
    assert config.BASE_URL.startswith("https://")
    assert config.BASE_URL.endswith("/")


def test_out_dir_is_path_under_mgnify_asms_v2():
    assert isinstance(config.OUT_DIR, Path)
    assert config.OUT_DIR.name == "mgnify_asms_v2"


def test_numeric_constants_have_sane_types_and_values():
    assert isinstance(config.CONCURRENCY, int) and config.CONCURRENCY == 8
    assert isinstance(config.PAGE_SIZE, int) and config.PAGE_SIZE == 100
    assert isinstance(config.CONNECT_TIMEOUT, (int, float)) and config.CONNECT_TIMEOUT == 10
    assert isinstance(config.READ_TIMEOUT, (int, float)) and config.READ_TIMEOUT == 60
    assert isinstance(config.MAX_RETRIES, int) and config.MAX_RETRIES == 5
    assert isinstance(config.BACKOFF_BASE, (int, float)) and config.BACKOFF_BASE == 1.5
    assert isinstance(config.BACKOFF_CAP, (int, float)) and config.BACKOFF_CAP == 60


def test_all_numeric_constants_positive():
    for name in (
        "CONCURRENCY", "PAGE_SIZE", "CONNECT_TIMEOUT", "READ_TIMEOUT",
        "MAX_RETRIES", "BACKOFF_BASE", "BACKOFF_CAP",
    ):
        assert getattr(config, name) > 0, name
