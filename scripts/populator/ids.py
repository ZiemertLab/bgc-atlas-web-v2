import uuid

# Never change: it would churn all IDs.
NS_ROOT = uuid.UUID("6f1a7e2c-0b3d-5a4e-9c8f-1d2e3a4b5c6d")

# Every entity table with an `id` column needs an entry here.
_ENTITIES = (
    "data_sources", "studies", "samples", "runs", "assemblies", "analyses",
    "biomes", "antismash_runs", "bgcs", "gcfs", "taxonomies",
    "sample_measurements",
    "mgnify_publications", "mgnify_super_studies", "mgnify_genome_catalogues",
    "mgnify_genomes",
)
NS = {e: uuid.uuid5(NS_ROOT, e) for e in _ENTITIES}

def entity_id(entity: str, natural_key: str) -> uuid.UUID:
    return uuid.uuid5(NS[entity], natural_key)

def scoped(source: str, key: str) -> str:
    """Source-scoped natural key, e.g. ('mgnify','SAMN1') -> 'mgnify|SAMN1'."""
    return f"{source}|{key}"
