# Static snapshots

A few read-heavy chart/map surfaces are served from pre-generated
content-hashed JSON snapshots under `bgc-atlas/public/data/` rather
than from live API endpoints. Each snapshot has two files:

- `<name>-<hash>.json` — the data, served immutable
  (`Cache-Control: public, max-age=31536000, immutable`), so the
  browser caches it forever.
- `<name>.manifest.json` — a ~200-byte pointer to the current data
  file, served with a short cache
  (`Cache-Control: public, max-age=60, stale-while-revalidate=300`)
  so refreshed snapshots roll out within about a minute.

The matching cache headers are configured generically in
`bgc-atlas/next.config.ts` under `headers()` — any new
`<name>-<hash>.json` + `<name>.manifest.json` pair under `/data/`
inherits the same treatment automatically.

The live API endpoints stay in place for surfaces that filter or
re-aggregate the data dynamically; only the specific page-level
consumer below is switched to the snapshot.

| Snapshot | Consumed by | Script |
|---|---|---|
| `map-samples`   | Homepage map (`/`) | `bgc-atlas/scripts/generate-map-snapshot.ts` |
| `bgc-charts`    | `/bgcs` distribution charts | `bgc-atlas/scripts/generate-bgc-charts-snapshot.ts` |
| `gcf-charts`    | `/gcfs` distribution charts | `bgc-atlas/scripts/generate-gcf-charts-snapshot.ts` |
| `sample-charts` | `/samples` distribution charts (unfiltered only) | `bgc-atlas/scripts/generate-sample-charts-snapshot.ts` |

Refresh **after every ingestion run** (typically twice a year), or
whenever the underlying counts shift enough to matter visually.

## Refresh workflow (any snapshot)

From `bgc-atlas/`:

```bash
cd bgc-atlas
npx tsx scripts/generate-map-snapshot.ts           # homepage map
npx tsx scripts/generate-bgc-charts-snapshot.ts    # /bgcs charts
npx tsx scripts/generate-gcf-charts-snapshot.ts    # /gcfs charts
npx tsx scripts/generate-sample-charts-snapshot.ts # /samples charts (unfiltered)
```

Each script connects via `DATABASE_URL` (loaded from `bgc-atlas/.env`),
runs the same queries the live API would, hashes the resulting payload
to produce a versioned filename, writes the data + manifest, and
prints any older hashed snapshot files left over from previous runs.

Commit the result and deploy:

```bash
git add bgc-atlas/public/data/*.json
git commit -m "data: refresh static snapshots"
```

Manifest's 60 s `max-age` means visitors pick up the new version
within about a minute; the old hashed data file is still valid for any
browser that has it cached, so there's no broken-asset window during
rollout.

## Pruning old snapshot files

Old `<name>-<hash>.json` files are harmless — nothing references them
once the manifest moves — but they accumulate in the repo. To delete
ones not currently pointed at by their manifests:

```bash
cd bgc-atlas
for manifest in public/data/*.manifest.json; do
  prefix=$(basename "$manifest" .manifest.json)
  current=$(jq -r '.url' "$manifest" | sed 's|^/data/||')
  find public/data/ -maxdepth 1 -name "${prefix}-*.json" ! -name "$current" -delete
done
```

(Or just let them pile up — git deltas compress old versions well.)

## How a snapshot is consumed by the frontend

Each snapshot has a matching React component that accepts an optional
`staticManifestUrl` prop:

- `bgc-atlas/src/components/ui/sample-map-dots.client.tsx` — when set,
  fetches the manifest then the data file via React Query
  (`staleTime: Infinity`) instead of calling `useMapSamples`.
- `bgc-atlas/src/components/statistics/BgcCharts.client.tsx` — when
  set, loads ALL chart variants in one shot from the snapshot and
  switches between them synchronously (no fetch on dropdown change),
  instead of calling `useBgcStats`.
- `bgc-atlas/src/components/charts/gcf-charts.client.tsx` — when set,
  fetches the snapshot once and serves the productDistribution,
  sizeDistribution, and fullSizeDistribution plots from it instead
  of calling `useGcfStats`.
- `bgc-atlas/src/components/statistics/SampleCharts.client.tsx` —
  when set AND no /samples filters are active, fetches the
  unfiltered-case snapshot and switches between the 5 gold-level
  variants synchronously. Any active filter (search, biome, host,
  source type, etc.) falls back to the live `/api/statistics/samples`
  endpoint with the user's filters applied.

The page-level consumers (`bgc-atlas/src/app/page.tsx`,
`bgc-atlas/src/app/bgcs/page.tsx`, `bgc-atlas/src/app/gcfs/page.tsx`,
`bgc-atlas/src/app/samples/page.tsx`) pass the relevant manifest URL.
`/genome-collections` keeps hitting the live API for filtered queries.

## Adding a new static snapshot

1. Write `bgc-atlas/scripts/generate-<name>-snapshot.ts` modeled on the
   existing scripts. Output `bgc-atlas/public/data/<name>-<hash>.json`
   plus `<name>.manifest.json` with the standard
   `{ version, generatedAt, url, ... }` shape.
2. Add a `staticManifestUrl?` prop to the React component that should
   consume it; gate the existing live-API hook behind
   `enabled: !useStatic`.
3. Pass `staticManifestUrl="/data/<name>.manifest.json"` from the
   page-level consumer.
4. The `headers()` rules in `bgc-atlas/next.config.ts` already match
   `/data/:name-:hash.json` and `/data/:name.manifest.json`, so the
   caching is automatic.
5. Add the snapshot to the table above.
