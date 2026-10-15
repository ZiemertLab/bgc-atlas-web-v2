# scripts/bigslice-query

Offline setup for the Search page's "BGC clustering" tab: the query workspaces and the
centroid caches BiG-SLiCE reads.

## The workspaces

```sh
Q=/data/bgc-atlas/data-v2/bigslice-query
```

Two thin shells around the read-only clustering models, so user query reports never land
inside the canonical clustering bundle:

```
$Q/seed/result/data.db      -> clustering-v3/bigslice-output-v3/result/data.db          (@0.4, 371,651 centroids)
$Q/seed/result/cache/gcf_models_1.pkl
$Q/seed/reports/
$Q/residual/result/data.db  -> clustering-v3/bigslice-output-residual-v3/result/data.db (@0.4, 394,186 centroids)
$Q/residual/result/cache/gcf_models_1.pkl
$Q/residual/reports/
```

Recreate with `mkdir -p` plus `ln -sfn`; the symlinks resolve inside the container because
the whole of `/data/bgc-atlas` is bind-mounted at the same path.

Both models share the HMM db the image already carries
(`md5_biosyn_pfam 37495cac452bf1dd8aff2c4ad92065fe`, 8,371 features), so
`--program_db_folder /opt/bigslice-models` stays as it is.

## Building the centroid caches

**This is not an optimisation.** Without `result/cache/gcf_models_<clustering_id>.pkl`,
BiG-SLiCE rebuilds the centroid matrix as `dtype=np.uint8` and writes float centroids into
it one cell at a time; it can truncate them to zero and return wrong distances with no
error. It also saves what it built under a name it never reads back, so the cost repeats
on every query.

Run inside the image, so the pickle is written by the pandas that will read it:

```sh
Q=/data/bgc-atlas/data-v2/bigslice-query
cp scripts/bigslice-query/build_gcf_model_cache.py scripts/bigslice-query/verify_gcf_model_cache.py $Q/bin/

for m in "seed 371651" "residual 394186"; do
  set -- $m
  ssh docker-host "docker run --rm --user "$(id -u):$(id -g)" \
    -v /data/bgc-atlas:/data/bgc-atlas bigslice:2.0.2 \
    python3 -u $Q/bin/build_gcf_model_cache.py --workspace $Q/$1 --run-id 1 --expect-gcfs $2" \
    > $Q/logs/cache_$1.log 2>&1
done
```

`--user "$(id -u):$(id -g)"` makes the output owned by the app user; `python3 -u` because
a buffered background run looks like a silent failure.

The script asserts before it writes: centroid and feature counts, no duplicate ids,
nonzero cells equal to the rows it wrote, and 1,000 reservoir-sampled cells equal to their
stored value. It writes `<name>.pkl.tmp` and renames, so a killed run cannot leave a
half-written pickle for BiG-SLiCE to load.

Expect ~24 GB (seed) and ~26 GB (residual) on shared storage, never the root FS.

Then verify the artefact the way BiG-SLiCE will read it — a fresh process, through
`load_pickle` — rather than trusting the builder's in-memory assertions:

```sh
ssh docker-host "docker run --rm --user "$(id -u):$(id -g)" \
  -v /data/bgc-atlas:/data/bgc-atlas bigslice:2.0.2 \
  python3 -u $Q/bin/verify_gcf_model_cache.py --workspace $Q/seed --run-id 1"
```

The residual db's `gcf_models` holds two clusterings, so the build drops the rows that
belong to the other one: rows kept < rows scanned there is correct, and kept == scanned
would mean the filter had failed.

Loading a cache cold takes tens of seconds. That is the search's latency floor per model,
and it is why the worker queries the residual model only when the seed model finds no
family within the threshold.

## After ANY re-clustering

These caches hold centroids, so they go stale exactly the way the derived artefacts in
`scripts/clustering-v3/README.md` do — silently. A re-cluster leaves the search answering
from the previous clustering's models, with no error and no empty state, and the family
ids it returns resolve to the *new* `gcfs` rows: confidently wrong, not obviously broken.

Rebuild both caches, and query a sample of BGCs the clustering placed (expecting the same
family and distance back) before letting anything user-facing near them.
