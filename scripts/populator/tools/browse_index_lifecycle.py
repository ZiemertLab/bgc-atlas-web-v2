#!/usr/bin/env python3
"""Create and atomically promote versioned relational browse indexes.

Load and validate a new corpus before ``promote``; a failed load leaves the
served alias unchanged.

Usage:
  python3 browse_index_lifecycle.py create samples v1
  python3 browse_index_lifecycle.py promote samples v1 --expected-count 123
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from scripts.populator.tools.browse_index_mapping import build_mapping

OS_URL = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
_SAFE_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


def alias_for(entity: str) -> str:
    return {"bgcs": "bgc_browse", "gcfs": "gcf_browse", "samples": "sample_browse"}[entity]


def versioned_index_name(alias: str, version: str) -> str:
    if not _SAFE_VERSION.fullmatch(version):
        raise ValueError(f"unsafe index version: {version}")
    return f"{alias}_{version}"


def alias_actions(alias: str, index: str, current_indices: list[str]) -> dict:
    actions = [{"remove": {"index": current, "alias": alias}} for current in current_indices]
    actions.append({"add": {"index": index, "alias": alias}})
    return {"actions": actions}


def request(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{OS_URL}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"{}")


def require_ok(code: int, response: dict, operation: str) -> None:
    if code >= 300:
        raise RuntimeError(f"{operation} failed ({code}): {response}")


def current_alias_indices(alias: str) -> list[str]:
    code, response = request("GET", f"/_alias/{alias}")
    if code == 404:
        return []
    require_ok(code, response, f"read alias {alias}")
    return sorted(response.keys())


def install_opensearch_auth() -> None:
    """Route every urllib request through the cluster's credentials and CA.

    Verification is never switched off. Standalone scripts carry identical
    copies of this function; a test keeps them in sync.
    """
    import base64
    import os
    import ssl
    import urllib.request

    handlers = []
    ca = os.environ.get("OPENSEARCH_CA_CERT")
    if ca:
        handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=ca)))
    opener = urllib.request.build_opener(*handlers)
    user = os.environ.get("OPENSEARCH_USERNAME")
    if user:
        token = base64.b64encode(f"{user}:{os.environ.get('OPENSEARCH_PASSWORD', '')}".encode()).decode()
        opener.addheaders = [("Authorization", f"Basic {token}")]
    urllib.request.install_opener(opener)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["create", "promote"])
    parser.add_argument("entity", choices=["bgcs", "gcfs", "samples"])
    parser.add_argument("version")
    parser.add_argument("--expected-count", type=int)
    args = parser.parse_args()

    alias = alias_for(args.entity)
    index = versioned_index_name(alias, args.version)
    if args.command == "create":
        code, response = request("PUT", f"/{index}", build_mapping(args.entity))
        require_ok(code, response, f"create {index}")
        print(f"created {index}")
        return

    # Refresh before counting: _count reads refreshed segments only, so a count
    # right after a bulk load comes up short and --expected-count would refuse.
    code, refresh_response = request("POST", f"/{index}/_refresh")
    require_ok(code, refresh_response, f"refresh {index}")

    code, count_response = request("GET", f"/{index}/_count")
    require_ok(code, count_response, f"count {index}")
    count = int(count_response.get("count", 0))
    if args.expected_count is not None and count != args.expected_count:
        raise RuntimeError(f"refusing promotion: {index} has {count} docs, expected {args.expected_count}")
    code, response = request("POST", "/_aliases", alias_actions(alias, index, current_alias_indices(alias)))
    require_ok(code, response, f"promote {alias}")
    print(f"promoted {alias} -> {index} ({count} documents)")


if __name__ == "__main__":
    install_opensearch_auth()
    try:
        main()
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
