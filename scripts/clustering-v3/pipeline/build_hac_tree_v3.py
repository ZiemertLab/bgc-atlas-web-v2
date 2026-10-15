"""Build ward and average HAC linkages over the GCF centroids.

The condensed distance array is filled in row blocks to avoid an n x n matrix. At ~370k GCFs it
is ~550 GB and scipy's linkage copies it, so peak memory is ~1.1 TB.
"""
from __future__ import annotations
import math
import time
import numpy as np
import scipy.sparse as sp
from scipy.cluster.hierarchy import linkage

HAC = "/work/atlas-clustering-v2/hac-v3"
BLK = 2000

A = sp.load_npz(f"{HAC}/centroids.npz")
n, d = A.shape
Ad = np.asarray(A.todense(), dtype=np.float32)
print(f"A dense {Ad.shape} ~{Ad.nbytes/1e9:.1f} GB", flush=True)

m = n * (n - 1) // 2
cond = np.full(m, math.sqrt(2.0), dtype=np.float64)
print(f"condensed {m:,} entries ~{cond.nbytes/1e9:.0f} GB", flush=True)

t0 = time.monotonic()
for b, i0 in enumerate(range(0, n, BLK)):
    i1 = min(i0 + BLK, n)
    Gb = Ad[i0:i1] @ Ad[i0:].T
    D2 = 2.0 - 2.0 * Gb
    np.clip(D2, 0.0, None, out=D2)
    Db = np.sqrt(D2)
    for r in range(i1 - i0):
        i = i0 + r
        start = i * n - (i * (i + 1)) // 2
        tail = Db[r, (i - i0 + 1):]
        cond[start:start + tail.shape[0]] = tail
    if b % 10 == 0:
        el = time.monotonic() - t0
        eta = el / max(i1, 1) * (n - i1)
        print(f"[{el:.0f}s] rows {i1:,}/{n:,} ({100*i1/n:.1f}%) eta {eta/3600:.1f}h", flush=True)
print(f"[{time.monotonic()-t0:.0f}s] Gram + condensed done", flush=True)

for method in ("ward", "average"):
    t = time.monotonic()
    Z = linkage(cond, method=method)
    np.save(f"{HAC}/linkage_{method}.npy", Z)
    print(f"[{time.monotonic()-t:.0f}s] linkage {method} -> {HAC}/linkage_{method}.npy", flush=True)
