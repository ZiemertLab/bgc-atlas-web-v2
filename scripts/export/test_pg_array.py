"""Dependency-free so it runs without pytest: python scripts/export/test_pg_array.py"""

import sys

from pg_array import PgArrayError, parse_pg_array

PARSES = [
    (None, None),
    ("{}", []),
    ("{terpene-precursor}", ["terpene-precursor"]),
    ("{a,b,c}", ["a", "b", "c"]),
    ("{9eedc1b2-5007-5481-a684-550f9b3892f7}", ["9eedc1b2-5007-5481-a684-550f9b3892f7"]),
    ("{NULL}", [None]),
    ('{"NULL"}', ["NULL"]),
    ("{a,NULL,b}", ["a", None, "b"]),
    ('{""}', [""]),
    ('{a,"",b}', ["a", "", "b"]),
    ('{"b,c"}', ["b,c"]),
    ('{a,"b,c"}', ["a", "b,c"]),
    ('{"has space"}', ["has space"]),
    ('{" leading"}', [" leading"]),
    ('{"a\\"b"}', ['a"b']),
    ('{"a\\\\b"}', ["a\\b"]),
    ('{"{braced}"}', ["{braced}"]),
    ("{NRPS,T1PKS}", ["NRPS", "T1PKS"]),
    ('{"NRPS-like",betalactone}', ["NRPS-like", "betalactone"]),
    ("{z,a,m}", ["z", "a", "m"]),
]

REJECTS = [
    "not-an-array",
    "{a,b",
    "a,b}",
    '{"unterminated}',
    "{{1,2},{3,4}}",
]


def main() -> int:
    failures = []

    for literal, expected in PARSES:
        try:
            got = parse_pg_array(literal)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"parse({literal!r}) raised {exc!r}, expected {expected!r}")
            continue
        if got != expected:
            failures.append(f"parse({literal!r}) == {got!r}, expected {expected!r}")

    for literal in REJECTS:
        try:
            got = parse_pg_array(literal)
        except PgArrayError:
            continue
        except Exception as exc:  # noqa: BLE001
            failures.append(f"parse({literal!r}) raised {type(exc).__name__}, expected PgArrayError")
            continue
        failures.append(f"parse({literal!r}) == {got!r}, expected PgArrayError")

    total = len(PARSES) + len(REJECTS)
    if failures:
        for line in failures:
            print(f"FAIL {line}")
        print(f"\n{len(failures)}/{total} failed")
        return 1

    print(f"ok — {total}/{total} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
