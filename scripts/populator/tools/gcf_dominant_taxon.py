"""Dominant taxon per rank for a GCF, derived from its taxonomy distribution.

Shared by the scroll patch and the corpus builder so both derive the same values:

  * ``*__Unknown`` is excluded from the argmax; it marks unassigned members, not a
    taxon, and averages 42.9% of a family at species.
  * The share is emitted, never an is-dominant flag, so the reader picks the cutoff.

A rank with no resolved taxon yields (None, None), i.e. absent fields.
"""
from __future__ import annotations

TAXONOMIC_RANKS = ("domain", "phylum", "class", "order", "family", "genus", "species")

UNKNOWN_SUFFIX = "__Unknown"


def dominant_taxon(distribution: dict | None) -> tuple[str | None, float | None]:
    """Largest non-Unknown taxon in one rank's distribution, and its share.

    Ties break on the taxon name so a rebuild is reproducible.
    """
    if not distribution:
        return None, None
    real = {
        taxon: share for taxon, share in distribution.items()
        if not taxon.endswith(UNKNOWN_SUFFIX) and isinstance(share, (int, float))
    }
    if not real:
        return None, None
    top = max(real.items(), key=lambda kv: (kv[1], [-ord(c) for c in kv[0]]))
    return top[0], float(top[1])


def dominant_fields(taxonomy_distributions: dict | None) -> dict:
    """The ``dom_<rank>`` / ``dom_<rank>_pct`` fields for one GCF document.

    Unresolved ranks are omitted, not null, so the query side can use `exists`.
    """
    distributions = taxonomy_distributions or {}
    fields: dict = {}
    for rank in TAXONOMIC_RANKS:
        taxon, share = dominant_taxon(distributions.get(rank))
        if taxon is None:
            continue
        fields[f"dom_{rank}"] = taxon
        fields[f"dom_{rank}_pct"] = share
    return fields
