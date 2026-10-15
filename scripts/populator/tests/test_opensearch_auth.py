"""install_opensearch_auth(): the copies agree, and they authenticate and verify."""
import ast
import base64
import http.server
import importlib.util
import pathlib
import shutil
import ssl
import subprocess
import threading
import urllib.error
import urllib.request

import pytest

REPO = pathlib.Path(__file__).resolve().parents[3]
COPIES = [
    "scripts/populator/tools/browse_index_lifecycle.py",
    "scripts/populator/tools/build_facet_vocab.py",
    "scripts/populator/tools/gcf_scalar_patch.py",
    "scripts/populator/tools/browse_subset_patch.py",
    "scripts/populator/tools/os_bulk_load_parallel.py",
    "scripts/populator/tools/gcf_scroll_reindex.py",
]


def _function_source(path: pathlib.Path) -> str:
    text = path.read_text()
    for node in ast.parse(text).body:
        if isinstance(node, ast.FunctionDef) and node.name == "install_opensearch_auth":
            return ast.get_source_segment(text, node)
    raise AssertionError(f"{path} has no install_opensearch_auth")


def test_every_copy_is_identical():
    sources = {p: _function_source(REPO / p) for p in COPIES}
    assert len(set(sources.values())) == 1, "install_opensearch_auth copies have drifted"


def test_every_copy_is_called_before_main():
    for p in COPIES:
        text = (REPO / p).read_text()
        tail = text[text.index('if __name__ == "__main__":'):]
        assert tail.index("install_opensearch_auth()") < tail.index("main("), p


def _load():
    spec = importlib.util.spec_from_file_location(
        "os_bulk_load_parallel", REPO / "scripts/populator/tools/os_bulk_load_parallel.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.install_opensearch_auth


@pytest.fixture
def https_server(tmp_path):
    """A localhost https server, signed by a throwaway CA, that wants Basic auth."""
    if shutil.which("openssl") is None:
        pytest.skip("openssl not available")
    ca_key, ca_crt = tmp_path / "ca.key", tmp_path / "ca.crt"
    key, csr, crt = tmp_path / "srv.key", tmp_path / "srv.csr", tmp_path / "srv.crt"
    ext = tmp_path / "ext.cnf"
    ext.write_text("subjectAltName=DNS:localhost,IP:127.0.0.1\n")
    run = lambda *a: subprocess.run(a, check=True, capture_output=True)  # noqa: E731
    run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=test-ca", "-keyout", str(ca_key), "-out", str(ca_crt))
    run("openssl", "req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost",
        "-keyout", str(key), "-out", str(csr))
    run("openssl", "x509", "-req", "-in", str(csr), "-CA", str(ca_crt), "-CAkey", str(ca_key),
        "-CAcreateserial", "-days", "1", "-extfile", str(ext), "-out", str(crt))

    expected = "Basic " + base64.b64encode(b"bgc_reader:s3cret").decode()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            ok = self.headers.get("Authorization") == expected
            self.send_response(200 if ok else 401)
            self.end_headers()
            self.wfile.write(b'{"ok":true}' if ok else b"{}")

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(crt, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"https://localhost:{server.server_address[1]}", ca_crt
    server.shutdown()
    urllib.request.install_opener(None)


def test_authenticates_and_verifies_against_the_ca(https_server, monkeypatch):
    url, ca = https_server
    monkeypatch.setenv("OPENSEARCH_USERNAME", "bgc_reader")
    monkeypatch.setenv("OPENSEARCH_PASSWORD", "s3cret")
    monkeypatch.setenv("OPENSEARCH_CA_CERT", str(ca))
    _load()()
    with urllib.request.urlopen(url + "/bgc_browse/_count") as resp:
        assert resp.status == 200


def test_wrong_password_is_refused(https_server, monkeypatch):
    url, ca = https_server
    monkeypatch.setenv("OPENSEARCH_USERNAME", "bgc_reader")
    monkeypatch.setenv("OPENSEARCH_PASSWORD", "wrong")
    monkeypatch.setenv("OPENSEARCH_CA_CERT", str(ca))
    _load()()
    with pytest.raises(urllib.error.HTTPError) as err:
        urllib.request.urlopen(url + "/")
    assert err.value.code == 401


def test_an_untrusted_certificate_is_rejected(https_server, monkeypatch):
    url, _ = https_server
    monkeypatch.setenv("OPENSEARCH_USERNAME", "bgc_reader")
    monkeypatch.setenv("OPENSEARCH_PASSWORD", "s3cret")
    monkeypatch.delenv("OPENSEARCH_CA_CERT", raising=False)
    _load()()
    with pytest.raises(urllib.error.URLError) as err:
        urllib.request.urlopen(url + "/")
    assert isinstance(err.value.reason, ssl.SSLCertVerificationError)
