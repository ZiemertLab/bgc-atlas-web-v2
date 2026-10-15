"""Write L2-normalised GCF centroids from gcf_models, so Euclidean dist^2 = 2 - 2*cosine."""
from __future__ import annotations
import os
import sqlite3
import numpy as np
import scipy.sparse as sp
import polars as pl

WORK = "/work/atlas-clustering-v2"
DB = f"{WORK}/bigslice-output-v3/result/data.db"
HAC = f"{WORK}/hac-v3"
os.makedirs(HAC, exist_ok=True)

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
gm = pl.read_database("SELECT gcf_id, hmm_id, value FROM gcf_models", con)
print(f"gcf_models rows: {gm.height:,}")

gcf_ids = np.sort(gm["gcf_id"].unique().to_numpy())
hmm_ids = np.sort(gm["hmm_id"].unique().to_numpy())
rows = np.searchsorted(gcf_ids, gm["gcf_id"].to_numpy())
cols = np.searchsorted(hmm_ids, gm["hmm_id"].to_numpy())
vals = gm["value"].to_numpy().astype(np.float32)

A = sp.csr_matrix((vals, (rows, cols)), shape=(len(gcf_ids), len(hmm_ids)))
norms = np.sqrt(np.asarray(A.multiply(A).sum(axis=1)).ravel())
norms[norms == 0] = 1.0
A = sp.diags((1.0 / norms).astype(np.float32)) @ A
A = A.tocsr()

sp.save_npz(f"{HAC}/centroids.npz", A)
np.save(f"{HAC}/gcf_ids.npy", gcf_ids)
print(f"centroids: {A.shape[0]:,} GCFs x {A.shape[1]:,} HMMs, nnz {A.nnz:,} "
      f"(avg {A.nnz/A.shape[0]:.1f}/GCF) -> {HAC}/centroids.npz")
