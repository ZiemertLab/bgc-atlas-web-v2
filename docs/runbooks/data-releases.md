# Data releases

Everything under `/downloads/` belongs to a numbered release. Tool:
`scripts/export/cut_release.py`, run on the app host from the repo root. Release notes live in git:
`docs/releases/<id>.md`.

## Where things are

```
data-v2/populator-out-sequences/          nginx /downloads/
  releases/<id>/                          one release, read-only once cut
  releases/latest -> <id>                 what the top level serves
  releases/releases.json                  every release, status, when each became latest
  regions_nuc.fasta -> releases/latest/regions_nuc.fasta     (every published name, db/, clustering-v3/,
  ...                                                         RELEASE.md, manifest.json, SHA256SUMS)
data-v2/seqsearch-db/diamond/regions_prot.dmnd -> regions_prot.<id>.dmnd   (sequence search)
```

Paths are relative to the data root (`/data/bgc-atlas`). The site reads `releases.json` and the latest
`manifest.json` (`/api/releases`, cached 5 min): the `/downloads` page, its sizes and counts, and the
footer's "Data release …" need no deploy.

## Naming

`R<major>.<minor>[.<patch>][-alpha.N|-beta.N]`, patch shown only when not 0. R1 = the archived v1 atlas.

| Bump | When |
|---|---|
| major | BGC ids or file formats cannot be relied on across the change |
| minor | the corpus changes, existing ids stay valid (BGCs added/removed, re-clustering, a new source) |
| patch | corrections only, same BGCs (metadata, a download gap, a checksum) |

Until the paper is published every cut is `R2.0-beta.N`; the notes say whether it was minor- or patch-sized.
`R2.0` is cut at publication. An alpha is never served at the top level and may be deleted without notice.

**Every change that reaches the downloads is a new release.**

## Cutting a release

1. `db/`: `export_db_snapshot.py --out <snapshot>` (with the populator venv's python: it needs pyarrow), then
   `build_download_bundle.py --snapshot <snapshot> --out <build dir>/db`. It only builds (it refuses to write
   into the served directory) and it reconciles every table, and the derived `genomes`, against the live
   database.
   Other files: build the changed files on a compute node into a build directory under their **published
   names**, each with its `.sha256` (`<hash>  <anything>`): e.g. `regions_nuc.fasta`, `db/` (whole directory),
   `all_regions_gbk.tar.gz` + the plain `all_regions_gbk.index.tsv`. Unchanged files are hard-linked
   from the latest release automatically.
2. Files built under another user lack the `www-data` ACL (nginx would 403): run
   `setfacl -m u:www-data:r-x <files>` as their owner.
3. Write `docs/releases/<id>.md` (`## Changes`, `## Known issues`) and, for files whose record count the
   script does not compute, `docs/releases/<id>.counts.json` (`{"regions_nuc.fasta": 15977384, ...}`).
4. Make the stats cache current: the script aborts if `/api/statistics` disagrees with `count(*) FROM bgcs`.
5. Cut (queues must be idle; it checks):

   ```bash
   python3 scripts/export/cut_release.py cut R2.0-beta.2 --build <dir> \
       --notes docs/releases/R2.0-beta.2.md --counts docs/releases/R2.0-beta.2.counts.json \
       [--diamond <dir>/regions_prot.new.dmnd] [--after-flip <script>]
   ```

   It stages `releases/<id>.staging`, writes `RELEASE.md`, `manifest.json`, `SHA256SUMS` and the added/removed
   id lists, runs the gates (archive index and nucleotide FASTA = live `bgcs`, checksums, ACLs), renames,
   makes it read-only, flips `latest`, the DIAMOND link, and checks every URL.
6. **A new archive also needs the database side**, right after the flip (pass it as `--after-flip`, which gets
   `RELEASE_DIR`): `load_gbk_offsets.sql` with the new sha256, then `bgc_browse` offsets (append-only: patch
   the new docs; otherwise `gbk_offset_scroll_reindex.py --slices=8` into a new version + alias swap). The
   public index, redirects and extractor are written into the release by the script (`publish_gbk_index.sh`).
7. `status`, then `retire` (dry run) and `retire --yes` for what retention lists.

## Changelog

`cut_release.py` writes each release's changelog entry into `releases.json` when it cuts it: counts with the
change since the previous release (including BGCs in a GCF, the coverage every GCF count needs), BGC ids
added/removed, files changed/added/removed (by sha256 between the two manifests), and the notes parsed from
`docs/releases/<id>.md` (`## ` headings, paragraphs, `- ` lists, `code` spans; nothing else renders).
Every save regenerates `releases/CHANGELOG.md` (served at /downloads/releases/CHANGELOG.md); the site shows
the same entries at `/releases`. To correct notes after a cut: edit the file, then
`cut_release.py changelog <id> --notes docs/releases/<id>.md` (the release directory is not touched).

## Retention

Kept: current, previous (what was latest before it), anything newer than current, the first final release of
every major (R2.0, R3.0) and the last final release of a major once a later major is final. Everything else
is retired: data files deleted, `RELEASE.md`/`manifest.json`/`SHA256SUMS`/id lists kept. Shared files are
hard links, so retiring frees only what no kept release still uses. DIAMOND indexes no kept release uses are
deleted with it.

## Rollback

`cut_release.py flip <id>`: `latest` and the DIAMOND link go back (a retired release refuses). If the
archive changed, reload its offsets too (step 6 with the old release's index).
