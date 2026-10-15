"""Parser for PostgreSQL 1-D array output literals (``{a,b,c}``).

Inside a quoted element, ``\\"`` and ``\\\\`` are the only escapes. Nested arrays raise
rather than silently flatten.
"""

from __future__ import annotations


class PgArrayError(ValueError):
    pass


def parse_pg_array(literal: str | None) -> list[str | None] | None:
    """An unquoted ``NULL`` element becomes None; a quoted ``"NULL"`` stays the string."""
    if literal is None:
        return None
    if not (literal.startswith("{") and literal.endswith("}")):
        raise PgArrayError(f"not an array literal: {literal!r}")

    inner = literal[1:-1]
    if inner == "":
        return []

    out: list[str | None] = []
    i, n = 0, len(inner)
    while True:
        if i < n and inner[i] == '"':
            buf: list[str] = []
            i += 1
            while True:
                if i >= n:
                    raise PgArrayError(f"unterminated quoted element: {literal!r}")
                ch = inner[i]
                if ch == "\\":
                    i += 1
                    if i >= n:
                        raise PgArrayError(f"trailing escape: {literal!r}")
                    buf.append(inner[i])
                    i += 1
                elif ch == '"':
                    i += 1
                    break
                else:
                    buf.append(ch)
                    i += 1
            out.append("".join(buf))
        else:
            start = i
            while i < n and inner[i] != ",":
                if inner[i] in "{}":
                    raise PgArrayError(f"nested arrays unsupported: {literal!r}")
                i += 1
            token = inner[start:i]
            out.append(None if token == "NULL" else token)

        if i >= n:
            break
        if inner[i] != ",":
            raise PgArrayError(f"expected ',' at offset {i}: {literal!r}")
        i += 1

    return out
