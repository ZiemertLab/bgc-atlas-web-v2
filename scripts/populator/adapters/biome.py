from typing import List, Optional, Tuple


def biome_nodes(lineage: str) -> List[Tuple[str, int, Optional[str]]]:
    """`root:A:B` -> [("root",0,None), ("root:A",1,"root"), ("root:A:B",2,"root:A")]."""
    segs = [s.strip() for s in lineage.split(":") if s.strip()]
    nodes = []
    for i, _ in enumerate(segs):
        path = ":".join(segs[: i + 1])
        parent = ":".join(segs[:i]) if i > 0 else None
        nodes.append((path, i, parent))
    return nodes
