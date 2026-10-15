from dataclasses import dataclass, field
from typing import Dict, Tuple


@dataclass
class Record:
    table: str
    natural_key: str
    fields: Dict
    refs: Dict[str, Tuple[str, str]] = field(default_factory=dict)  # col -> (entity, nk)
