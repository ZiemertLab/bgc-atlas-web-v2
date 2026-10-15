#!/usr/bin/env python3
"""Versioned data releases of /downloads (runbook: docs/runbooks/data-releases.md).

A release is a directory that never changes, releases/<id>/ under the served downloads directory. The
top-level names people already use (/downloads/regions_nuc.fasta, /downloads/db/...) are relative symlinks
through releases/latest, so switching release is one symlink flip and existing URLs keep working. A file
that did not change between releases is a hard link, not a copy.

Release ids: R<major>.<minor>[.<patch>][-alpha.N|-beta.N], patch shown only when not 0.
  R2.0-beta.1 < R2.0-beta.2 < R2.0 < R2.0.1 < R2.1 < R3.0-alpha.1 < R3.0

Commands (run on the host that serves /downloads, as the owner of the downloads directory; stdlib only):
  init    <id> --notes N.md --counts C.json   turn today's flat files into the first release
  uninit  <id>                                undo init: the top-level names become files again
  cut     <id> --build DIR --notes N.md       a new release from a build directory (see below)
  flip    <id>                                point latest at a release (rollback)
  status                                      releases, which is latest, what retention would retire
  changelog <id> --notes N.md                 rewrite a release's changelog entry (releases/CHANGELOG.md)
  retire  [--yes]                             delete the data files of releases retention no longer keeps

`cut --build DIR`: DIR holds the replaced files under their published names, each with its .sha256
(`<hash>  <any name>`, rewritten to the published name); `db/` or `clustering-v3/` replace the whole
directory. A new all_regions_gbk.tar.gz needs DIR/all_regions_gbk.index.tsv (the build's plain index):
publish_gbk_index.sh then writes the public index, redirects and extractor into the release. Everything
not in DIR is hard-linked from the latest release. `--counts C.json` gives record counts the script does
not compute itself ({"regions_nuc.fasta": 15977384, ...}); a file carried over keeps its count.

Retention: data files are kept for the current release, the previous one (the release that was latest
before it), releases newer than the current one (previews), the first final release of every major
(R2.0, R3.0) and the last final release of a major once a later major has a final release. Everything
else is listed by `status` and deleted only by `retire --yes`; its small files (RELEASE.md, manifest.json,
SHA256SUMS, the id lists) stay forever.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path('/data/bgc-atlas/data-v2/populator-out-sequences')
DIAMOND_DIR = Path('/data/bgc-atlas/data-v2/seqsearch-db/diamond')
# Files built on another host by another user can only be changed (chmod, hard-linked once read-only) by their
# owner; set this to an ssh host where that user can run the command. Unset: such files are an error.
OWNER_HOST = os.environ.get('RELEASE_OWNER_HOST')
SITE = 'https://bgc-atlas.cs.uni-tuebingen.de'
STATS_URL = 'http://localhost:3001/api/statistics'
REPO = Path(__file__).resolve().parents[2]

# What a release holds. Each file has a <name>.sha256 sidecar; each directory its own sidecars.
FILES = [
    'all_regions_gbk.tar.gz', 'all_regions_gbk.index.tsv.gz', 'extract_gbk.py',
    'regions_nuc.fasta', 'regions_prot.faa',
    'bgc_uuid_source.parquet', 'bgc_uuid_source.tsv.gz', 'README_bgc_uuid_source.md',
    'bgc_id_redirects.tsv.gz',
]
DIRS = ['db', 'clustering-v3']
# Written per release; small, kept forever, also linked at the top level.
META = ['RELEASE.md', 'manifest.json', 'SHA256SUMS']
ID_LISTS = ['bgc_ids_added.txt.gz', 'bgc_ids_removed.txt.gz']
KEEP_ON_RETIRE = set(META + ID_LISTS)

# The top level as it was before releases: moved out of the served directory by init.
BACKUP_RE = re.compile(r'\.prev-\d{8}(-\d+)?$|^db\.prev-')
BUILD_LOG_RE = re.compile(r'^_.*\.(log|sh)$|\.counts$')

QUEUES = ['export-jobs', 'search-jobs', 'metadata-search-jobs']

VERSION_RE = re.compile(r'^R(\d+)\.(\d+)(?:\.([1-9]\d*))?(?:-(alpha|beta)\.([1-9]\d*))?$')


# ── Versions ────────────────────────────────────────────────────────────────

def parse(rid: str) -> tuple:
    """Sort key. Raises on anything not canonical (R2.0.0 is written R2.0)."""
    m = VERSION_RE.match(rid)
    if not m:
        raise ValueError(f'{rid!r} is not a release id (R<major>.<minor>[.<patch>][-alpha.N|-beta.N])')
    major, minor, patch, stage, n = m.groups()
    rank = {'alpha': 0, 'beta': 1, None: 2}[stage]
    return (int(major), int(minor), int(patch or 0), rank, int(n or 0))


def stage(rid: str) -> str:
    return {0: 'alpha', 1: 'beta', 2: 'final'}[parse(rid)[3]]


def choose_latest(ids: list[str]) -> str | None:
    """The newest final release; while there is none, the newest beta. Never an alpha."""
    finals = [r for r in ids if stage(r) == 'final']
    betas = [r for r in ids if stage(r) == 'beta']
    pool = finals or betas
    return max(pool, key=parse) if pool else None


def keep_set(ids: list[str], current: str | None, previous: str | None) -> set[str]:
    keep = {r for r in (current, previous) if r}
    if current:
        keep |= {r for r in ids if parse(r) > parse(current)}
    finals = sorted((r for r in ids if stage(r) == 'final'), key=parse)
    majors = sorted({parse(r)[0] for r in finals})
    for major in majors:
        in_major = [r for r in finals if parse(r)[0] == major]
        keep.add(in_major[0])                         # what papers cite
        if any(m > major for m in majors):
            keep.add(in_major[-1])                    # the most complete state of that generation
    return keep


# ── releases.json ───────────────────────────────────────────────────────────

def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def load_index(root: Path) -> dict:
    p = root / 'releases' / 'releases.json'
    if not p.exists():
        return {'schema': 1, 'latest': None, 'latest_history': [], 'releases': []}
    return json.loads(p.read_text())


def previous_of(index: dict) -> str | None:
    hist = [h['id'] for h in index['latest_history']]
    cur = index['latest']
    before = [h for h in hist if h != cur]
    return before[-1] if before else None


def refresh_status(index: dict) -> None:
    ids = [r['id'] for r in index['releases']]
    cur, prev = index['latest'], previous_of(index)
    keep = keep_set(ids, cur, prev)
    permanent = keep_set(ids, None, None)
    for r in index['releases']:
        r['stage'] = stage(r['id'])
        r['status'] = ('current' if r['id'] == cur else 'previous' if r['id'] == prev
                       else 'preview' if cur and parse(r['id']) > parse(cur) else 'older')
        r['kept_permanently'] = r['id'] in permanent
        r['retention'] = 'keep' if r['id'] in keep else ('retired' if r.get('retired_at') else 'retire')
    index['releases'].sort(key=lambda r: parse(r['id']), reverse=True)


def save_index(root: Path, index: dict) -> None:
    refresh_status(index)
    p = root / 'releases' / 'releases.json'
    tmp = p.with_name('.releases.json.tmp')
    tmp.write_text(json.dumps(index, indent=2) + '\n')
    acl(tmp, 'r')
    os.replace(tmp, p)
    log = p.with_name('CHANGELOG.md')
    tmp = p.with_name('.CHANGELOG.md.tmp')
    tmp.write_text(changelog_markdown(index))
    acl(tmp, 'r')
    os.replace(tmp, log)


# ── Filesystem ──────────────────────────────────────────────────────────────

def acl(path: Path, perm: str) -> None:
    subprocess.run(['setfacl', '-m', f'u:www-data:{perm}', str(path)], check=False,
                   stderr=subprocess.DEVNULL)


def has_www_acl(path: Path) -> bool:
    out = subprocess.run(['getfacl', '-p', '--omit-header', str(path)], capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith('user:www-data:') and 'r' in line.split(':')[2][:3]:
            return True
    return False


def relink(target: str, link: Path) -> None:
    """Make `link` a symlink to `target`, atomically replacing a file or symlink there."""
    tmp = link.with_name(f'.{link.name}.lnk')
    if tmp.is_symlink() or tmp.exists():
        tmp.unlink()
    os.symlink(target, tmp)
    os.replace(tmp, link)


def as_owner(args: list[str], **kw) -> subprocess.CompletedProcess:
    """Run a command as the owner of files built elsewhere, over ssh to OWNER_HOST."""
    if not OWNER_HOST:
        raise SystemExit(f'{args[0]}: file owned by another user; set RELEASE_OWNER_HOST to run it as its owner')
    return subprocess.run(['ssh', '-o', 'BatchMode=yes', OWNER_HOST, *args], **kw)


def hardlink(src: Path, dst: Path) -> None:
    """os.link, or as the file's owner. A released file is read-only (lock()), and the kernel's
    protected_hardlinks then refuses a link by anyone but its owner."""
    try:
        os.link(src, dst)
    except PermissionError:
        if src.stat().st_uid == os.getuid():
            raise
        as_owner(['ln', str(src), str(dst)], check=True)


def link_tree(src: Path, dst: Path) -> None:
    """dst = a directory of hard links to src's files (recursively)."""
    dst.mkdir()
    for p in sorted(src.iterdir()):
        if p.name.startswith('.'):
            continue                                  # hidden build records are not published
        if p.is_dir() and not p.is_symlink():
            link_tree(p, dst / p.name)
        elif p.is_file():
            hardlink(p, dst / p.name)


def data_files(release: Path):
    """(relative path, Path) of every data file: no sidecars, no checksum lists, no release metadata."""
    for name in FILES:
        p = release / name
        if p.exists():
            yield name, p
    for d in DIRS:
        base = release / d
        if not base.exists():
            continue
        for p in sorted(base.rglob('*')):
            if p.is_file() and not p.name.endswith('.sha256') and p.name != 'SHA256SUMS' \
                    and not p.name.startswith('.'):
                yield str(p.relative_to(release)), p


def sidecar_hash(p: Path) -> str | None:
    s = p.with_name(p.name + '.sha256')
    if not s.exists():
        return None
    return s.read_text().split()[0]


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for buf in iter(lambda: f.read(1 << 22), b''):
            h.update(buf)
    return h.hexdigest()


def write_sidecar(p: Path, digest: str) -> None:
    s = p.with_name(p.name + '.sha256')
    s.write_text(f'{digest}  {p.name}\n')
    acl(s, 'r')


def lock(release: Path) -> None:
    """Read-only: files a-w (the ACL mask follows), directories a-w. Files owned by another user (built
    elsewhere) can only be changed by their owner, so those go through as_owner()."""
    mine, theirs = [], []
    for p in release.rglob('*'):
        if p.is_file() and not p.is_symlink():
            (mine if p.stat().st_uid == os.getuid() else theirs).append(str(p))
    for chunk in range(0, len(mine), 200):
        subprocess.run(['chmod', 'a-w', *mine[chunk:chunk + 200]], check=True)
    if theirs:
        r = as_owner(['xargs -0 chmod a-w'], input='\0'.join(theirs), text=True)
        if r.returncode:
            print(f'WARNING: {len(theirs)} files owned by another user are still writable '
                  f'(chmod on {OWNER_HOST} failed); rerun lock there', file=sys.stderr)
    # Deepest first. A directory moved in from a build elsewhere belongs to that user too.
    dirs = sorted([release, *[p for p in release.rglob('*') if p.is_dir()]], key=lambda p: -len(p.parts))
    for d in dirs:
        if d.stat().st_uid == os.getuid():
            os.chmod(d, 0o555)
        else:
            as_owner(['chmod', '555', str(d)], check=True)


def unlock_dirs(release: Path) -> None:
    # Like lock(): a directory moved in from a build elsewhere belongs to that user, and only its owner may chmod it.
    for d in [release, *[p for p in release.rglob('*') if p.is_dir()]]:
        if d.stat().st_uid == os.getuid():
            os.chmod(d, 0o775)
        else:
            as_owner(['chmod', '775', str(d)], check=True)


# ── Changelog ───────────────────────────────────────────────────────────────

def parse_notes(text: str) -> list[dict]:
    """docs/releases/<id>.md -> [{heading, blocks: [{type: 'p', text} | {type: 'ul', items}]}]. Only what the
    notes use: `## ` headings, paragraphs, `- ` lists (continuation lines indented)."""
    sections: list[dict] = []
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)   # drafting comments never publish
    for chunk in re.split(r'^## +', text.strip(), flags=re.M):
        if not chunk.strip():
            continue
        heading, _, body = chunk.partition('\n')
        blocks: list[dict] = []
        for para in re.split(r'\n\s*\n', body.strip()):
            lines = para.splitlines()
            if not lines:
                continue
            if lines[0].startswith('- '):
                items: list[str] = []
                for line in lines:
                    if line.startswith('- '):
                        items.append(line[2:].strip())
                    elif items:
                        items[-1] += ' ' + line.strip()
                blocks.append({'type': 'ul', 'items': items})
            else:
                blocks.append({'type': 'p', 'text': ' '.join(l.strip() for l in lines)})
        sections.append({'heading': heading.strip(), 'blocks': blocks})
    return sections


def changelog_entry(manifest: dict, prev_manifest: dict | None, notes: str) -> dict:
    """What changed from the previous release: counts, BGC ids, files (by sha256), and the written notes."""
    counts = manifest['counts']
    prev_counts = prev_manifest['counts'] if prev_manifest else None
    deltas = {k: (v - prev_counts[k] if prev_counts and v is not None and prev_counts.get(k) is not None else None)
              for k, v in counts.items()}
    files = {'changed': [], 'added': [], 'removed': [], 'unchanged': 0}
    if prev_manifest:
        old = {f['path']: f for f in prev_manifest['files']}
        new = {f['path']: f for f in manifest['files']}
        for path, f in new.items():
            o = old.get(path)
            if o is None:
                files['added'].append({'path': path, 'bytes': f['bytes'], 'records': f['records']})
            elif o['sha256'] != f['sha256']:
                files['changed'].append({'path': path, 'bytes': f['bytes'], 'prev_bytes': o['bytes'],
                                         'records': f['records'], 'prev_records': o.get('records')})
            else:
                files['unchanged'] += 1
        files['removed'] = [{'path': p, 'prev_bytes': o['bytes']} for p, o in old.items() if p not in new]
    return {
        'previous': manifest.get('previous'),
        'counts': counts,
        'deltas': deltas,
        'bgc_ids_added': manifest['bgc_ids_added'],
        'bgc_ids_removed': manifest['bgc_ids_removed'],
        'files': files,
        'notes': parse_notes(notes),
    }


def changelog_markdown(index: dict) -> str:
    """releases/CHANGELOG.md: every listed release, newest first, from the entries in releases.json."""
    out = ['# BGC Atlas data releases', '',
           'Newest first. Each release is in /downloads/releases/<id>/ (RELEASE.md, manifest.json, SHA256SUMS, '
           'bgc_ids_added.txt.gz, bgc_ids_removed.txt.gz). Alphas are not listed.', '']
    for r in index['releases']:
        c = r.get('changelog')
        if not c or r['stage'] == 'alpha':
            continue
        out += [f"## {r['id']} ({r['date']}{', ' + r['stage'] if r['stage'] != 'final' else ''})", '']
        if c['previous']:
            out += [f"Against {c['previous']}.", '', '| | count | change |', '|---|---:|---:|']
            for k, label in LABELS:
                if c['counts'].get(k) is not None:
                    d = c['deltas'].get(k)
                    out.append(f"| {label} | {c['counts'][k]:,} | {'' if not d else f'{d:+,}'} |")
            out += ['', f"BGC ids: {c['bgc_ids_added']:,} added, {c['bgc_ids_removed']:,} removed.", '']
        else:
            out += ['The first release.', '']
        for sec in c['notes']:
            out += [f"### {sec['heading']}", '']
            for b in sec['blocks']:
                out += ([f'- {i}' for i in b['items']] if b['type'] == 'ul' else [b['text']]) + ['']
        f = c['files']
        if c['previous'] and (f['changed'] or f['added'] or f['removed']):
            out += ['### Files', '']
            out += [f"- changed: `{x['path']}` ({human(x['prev_bytes'])} -> {human(x['bytes'])})" for x in f['changed']]
            out += [f"- added: `{x['path']}` ({human(x['bytes'])})" for x in f['added']]
            out += [f"- removed: `{x['path']}`" for x in f['removed']]
            out += [f"- {f['unchanged']} files unchanged", '']
    return '\n'.join(out)


# ── Describing a release ────────────────────────────────────────────────────

def count_index_rows(p: Path) -> int:
    n = 0
    with gzip.open(p, 'rb') as f:
        for line in f:
            if not line.startswith(b'#'):
                n += 1
    return n


def index_header(p: Path) -> tuple[str, int] | None:
    with gzip.open(p, 'rt') as f:
        first = f.readline().split()
    # "# archive sha256 <hex> size <bytes>"
    if len(first) >= 6 and first[1] == 'archive':
        return first[3], int(first[5])
    return None


def sorted_ids(index_gz: Path, out: Path) -> None:
    cmd = (f"zcat '{index_gz}' | grep -v '^#' | cut -c1-36 "
           f"| LC_ALL=C nice -n 19 sort -S 512M -T '{out.parent}' > '{out}'")
    subprocess.run(['bash', '-o', 'pipefail', '-c', cmd], check=True)


def id_diff(new: Path, old: Path | None) -> tuple[int, int]:
    """bgc_ids_added/removed.txt.gz in `new` against release `old` (by the archive index)."""
    added = new / 'bgc_ids_added.txt.gz'
    removed = new / 'bgc_ids_removed.txt.gz'
    if old is None or (old / 'all_regions_gbk.index.tsv.gz').samefile(new / 'all_regions_gbk.index.tsv.gz'):
        for p in (added, removed):
            with gzip.open(p, 'wt'):
                pass
        return 0, 0
    with tempfile.TemporaryDirectory(dir=new.parent, prefix='.ids-') as tmp:
        a, b = Path(tmp) / 'new', Path(tmp) / 'old'
        sorted_ids(new / 'all_regions_gbk.index.tsv.gz', a)
        sorted_ids(old / 'all_regions_gbk.index.tsv.gz', b)
        counts = []
        for flag, out in (('-13', added), ('-23', removed)):
            n = 0
            with subprocess.Popen(['comm', flag, str(b), str(a)], stdout=subprocess.PIPE,
                                  env={**os.environ, 'LC_ALL': 'C'}) as proc, gzip.open(out, 'wb') as gz:
                for line in proc.stdout:
                    gz.write(line)
                    n += 1
            if proc.returncode:
                sys.exit(f'ABORT: comm failed ({proc.returncode})')
            counts.append(n)
    return counts[0], counts[1]


def live_counts(args) -> dict:
    with urllib.request.urlopen(args.stats_url, timeout=60) as r:
        s = json.load(r)['data']
    counts = {
        'bgcs': s['totalBgcs'], 'complete_bgcs': s.get('totalCompleteBgcs'), 'gcfs': s['totalGcfs'],
        'samples': s['totalSamples'], 'metagenome_samples': s.get('totalMetagenomeSamples'),
        'genomes': s.get('totalGenomes'), 'assemblies': s['totalAssemblies'],
    }
    counts['clustered_bgcs'] = None
    if args.no_db:
        return counts
    sql = ('SELECT count(*), count(*) FILTER (WHERE EXISTS (SELECT 1 FROM bgc_gcf g WHERE g.bgc_id = b.id)) '
           'FROM bgcs b')
    exact = subprocess.run(['psql', '-d', args.db, '-AtF', ' ', '-c', sql], check=True,
                           capture_output=True, text=True, env={**os.environ, 'PGOPTIONS': '-c statement_timeout=0'})
    n, clustered = (int(x) for x in exact.stdout.split())
    # A GCF count is never shown without its coverage.
    counts['clustered_bgcs'] = clustered
    if n != counts['bgcs']:
        sys.exit(f'ABORT: /api/statistics says {counts["bgcs"]:,} BGCs, bgcs has {n:,}: the statistics '
                 'cache is stale (clear the stats: prefixes) or the corpus is mid-change')
    return counts


LABELS = [('bgcs', 'BGCs'), ('complete_bgcs', 'Complete BGCs'), ('gcfs', 'GCFs'),
          ('clustered_bgcs', 'BGCs in a GCF'), ('samples', 'Samples'),
          ('metagenome_samples', 'Metagenome samples'), ('genomes', 'Genomes'), ('assemblies', 'Assemblies')]


def human(n: int) -> str:
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if n < 1024 or unit == 'TB':
            return f'{n:.0f} B' if unit == 'B' else f'{n:.1f} {unit}'
        n /= 1024
    return str(n)


def describe(release: Path, rid: str, prev_id: str | None, prev: Path | None, notes: str,
             counts: dict, records: dict, cut_at: str) -> dict:
    files = []
    prev_manifest = {}
    if prev is not None and (prev / 'manifest.json').exists():
        prev_manifest = {f['path']: f for f in json.loads((prev / 'manifest.json').read_text())['files']}
    for rel, p in data_files(release):
        digest = sidecar_hash(p)
        size = p.stat().st_size
        if digest is None:
            if size > 1 << 30:
                sys.exit(f'ABORT: {rel} ({human(size)}) has no .sha256 sidecar; hash it where it was built')
            digest = sha256_file(p)
            write_sidecar(p, digest)
        elif size <= 1 << 30 and sha256_file(p) != digest:
            sys.exit(f'ABORT: {rel} does not match its .sha256')
        rec = records.get(rel)
        old = prev_manifest.get(rel)
        if rec is None and old and old['sha256'] == digest:
            rec = old.get('records')
        files.append({'path': rel, 'bytes': size, 'sha256': digest, 'records': rec})

    idx = release / 'all_regions_gbk.index.tsv.gz'
    if idx.exists():
        rows = next((f['records'] for f in files if f['path'] == idx.name and f['records']), None)
        if rows is None or not (prev and (prev / idx.name).exists() and (prev / idx.name).samefile(idx)):
            rows = count_index_rows(idx)
        for f in files:
            if f['path'] in (idx.name, 'all_regions_gbk.tar.gz'):
                f['records'] = rows

    added, removed = id_diff(release, prev)
    manifest = {'release': rid, 'stage': stage(rid), 'cut_at': cut_at, 'previous': prev_id,
                'counts': counts, 'bgc_ids_added': added, 'bgc_ids_removed': removed, 'files': files}
    (release / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

    sums = [f"{f['sha256']}  {f['path']}" for f in files]
    (release / 'SHA256SUMS').write_text('\n'.join(sums) + '\n')

    st = stage(rid)
    lines = [f'# BGC Atlas data release {rid}', '', f'Released {cut_at[:10]}.']
    if st == 'beta':
        lines += ['', 'Pre-release (beta): complete and public, but it may still change before the final release.']
    elif st == 'alpha':
        lines += ['', 'Alpha: a preview, not announced; it may be removed without notice.']
    lines += ['', '| | |', '|---|---:|']
    lines += [f'| {label} | {counts[k]:,} |' for k, label in LABELS if counts.get(k) is not None]
    lines += ['', notes.strip(), '', '## BGC ids', '']
    if prev_id:
        lines += [f'Against {prev_id}: {added:,} added (`bgc_ids_added.txt.gz`), {removed:,} removed '
                  f'(`bgc_ids_removed.txt.gz`). A BGC id is never reused.']
    else:
        lines += ['The first release: `bgc_ids_added.txt.gz` and `bgc_ids_removed.txt.gz` are empty.']
    total = sum(f['bytes'] for f in files)
    lines += ['', '## Files', '',
              f'{len(files)} files, {human(total)}. Sizes, checksums and record counts: `manifest.json`; '
              'verify with `sha256sum -c SHA256SUMS` from this directory.', '',
              '## Retention', '',
              'The first and last final release of each major version are kept permanently. Other releases keep '
              'their data files until superseded twice; this file, `manifest.json`, `SHA256SUMS` and the id lists '
              'are always kept.', '']
    (release / 'RELEASE.md').write_text('\n'.join(lines))
    return manifest


def gates(release: Path, manifest: dict, live_bgcs: int, require_records: list[str]) -> None:
    errors = []
    by_path = {f['path']: f for f in manifest['files']}
    for name in FILES:
        if name not in by_path:
            errors.append(f'{name} missing')
    for d in DIRS:
        if not (release / d).is_dir():
            errors.append(f'{d}/ missing')
    for name in require_records:
        f = by_path.get(name)
        if f is None:
            continue
        if f['records'] is None:
            errors.append(f'{name}: record count unknown (pass it in --counts)')
        elif f['records'] != live_bgcs:
            errors.append(f'{name}: {f["records"]:,} records, live bgcs {live_bgcs:,}')
    idx = release / 'all_regions_gbk.index.tsv.gz'
    arc = by_path.get('all_regions_gbk.tar.gz')
    if idx.exists() and arc:
        hdr = index_header(idx)
        if hdr != (arc['sha256'], arc['bytes']):
            errors.append(f'archive index header {hdr} does not describe the archive '
                          f'({arc["sha256"][:12]}…, {arc["bytes"]:,} bytes)')
    for rel, p in data_files(release):
        if not has_www_acl(p):
            errors.append(f'{rel}: no www-data read ACL (nginx would 403; setfacl as the file\'s owner)')
    if errors:
        print('GATES FAILED:\n  ' + '\n  '.join(errors), file=sys.stderr)
        sys.exit(1)
    print(f'gates ok: {len(manifest["files"])} files, records = live bgcs {live_bgcs:,}')


def acl_meta(release: Path) -> None:
    for d in [release, *[p for p in release.rglob('*') if p.is_dir()]]:
        acl(d, 'r-x')
    for p in release.rglob('*'):
        if p.is_file() and p.stat().st_uid == os.getuid() and not has_www_acl(p):
            acl(p, 'r')


# ── The served top level ────────────────────────────────────────────────────

def top_level_names() -> list[str]:
    return FILES + [f + '.sha256' for f in FILES] + META + DIRS


def point_top_level(root: Path, hidden_to: Path) -> None:
    """Every published name -> releases/latest/<name>. Directories are swapped by rename + symlink: a
    request in that microsecond 404s. Hidden files in them (build records) move to `hidden_to`."""
    for name in top_level_names():
        p = root / name
        target = f'releases/latest/{name}'
        if p.is_dir() and not p.is_symlink():
            for q in sorted(p.rglob('.*')):
                if q.is_file():
                    dest = hidden_to / name / q.relative_to(p)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    os.rename(q, dest)
            linked = root / 'releases' / 'latest' / name
            strays = [q for q in p.rglob('*') if q.is_file() and not (
                (linked / q.relative_to(p)).exists() and (linked / q.relative_to(p)).samefile(q))]
            if strays:
                sys.exit(f'ABORT: {len(strays)} files in {p} are not in the release (e.g. {strays[0]}); '
                         'not replacing it')
            away = root / f'.{name}.pre-releases'
            os.rename(p, away)
            os.symlink(target, p)
            shutil.rmtree(away)
        else:
            relink(target, p)


def flip_latest(root: Path, rid: str) -> None:
    relink(rid, root / 'releases' / 'latest')


def queues_idle(args) -> None:
    if args.no_queue_check:
        return
    for q in QUEUES:
        n = subprocess.run(['redis-cli', '-n', '0', 'LLEN', f'bull:{q}:active'], capture_output=True,
                           text=True, check=True).stdout.strip()
        if n != '0':
            sys.exit(f'ABORT: {q} has {n} active job(s); an export or search reads these files')


def http_check(root: Path, args, manifest: dict) -> None:
    if args.no_http:
        return
    bad = 0
    for f in manifest['files'] + [{'path': m, 'bytes': (root / 'releases' / 'latest' / m).stat().st_size}
                                  for m in META]:
        req = urllib.request.Request(f'{args.url_base}/{f["path"]}', method='HEAD')
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                ok = r.status == 200 and int(r.headers.get('Content-Length', -1)) == f['bytes']
                code = r.status
        except Exception as e:  # noqa: BLE001 -- report and go on
            ok, code = False, getattr(e, 'code', e)
        if not ok:
            bad += 1
            print(f'  HTTP {code}  {args.url_base}/{f["path"]}', file=sys.stderr)
    print(f'http: {len(manifest["files"]) + len(META) - bad} of {len(manifest["files"]) + len(META)} '
          f'served with the right length')
    if bad:
        sys.exit(1)


def diamond_to(rid: str, args, new: Path | None) -> str | None:
    """regions_prot.dmnd -> regions_prot.<rid>.dmnd (relative symlink: the search container mounts the
    same CephFS path). Returns the index file this release uses: its own, or, when the protein FASTA did
    not change, the one already live."""
    if args.no_diamond:
        return None
    d = args.diamond_dir
    live = d / 'regions_prot.dmnd'
    versioned = d / f'regions_prot.{rid}.dmnd'
    if new is not None:
        os.rename(new, versioned)
    elif not live.is_symlink():
        os.rename(live, versioned)              # init: the current index becomes this release's
    else:
        return os.readlink(live)                # no new index: the previous release's stays live
    point_diamond(args, versioned.name)
    return versioned.name


def point_diamond(args, name: str) -> None:
    live = args.diamond_dir / 'regions_prot.dmnd'
    n = subprocess.run(['redis-cli', '-n', '0', 'LLEN', 'bull:search-jobs:active'], capture_output=True,
                       text=True).stdout.strip()
    if n not in ('0', '') and not args.no_queue_check:
        print(f'DIAMOND: {n} search running; NOT flipped. Later: ln -sfn {name} {live}', file=sys.stderr)
        return
    relink(name, live)
    print(f'DIAMOND: regions_prot.dmnd -> {name}')


# ── Commands ────────────────────────────────────────────────────────────────

def cmd_init(args) -> None:
    root, rid = args.root, args.id
    parse(rid)
    rel = root / 'releases'
    if rel.exists() and any(p for p in rel.iterdir() if not p.name.startswith('.')):
        sys.exit(f'ABORT: {rel} is not empty; init runs once')
    for name in FILES:
        if not (root / name).is_file() or (root / name).is_symlink():
            sys.exit(f'ABORT: {root / name} is not a plain file')
    counts = live_counts(args)
    queues_idle(args)
    rel.mkdir(exist_ok=True)
    acl(rel, 'r-x')
    staging = rel / f'{rid}.staging'
    staging.mkdir()
    for name in FILES:
        hardlink(root / name, staging / name)
        if (root / f'{name}.sha256').exists():
            hardlink(root / f'{name}.sha256', staging / f'{name}.sha256')
    for d in DIRS:
        link_tree(root / d, staging / d)
    cut_at = now()
    manifest = describe(staging, rid, None, None, Path(args.notes).read_text(), counts,
                        json.loads(Path(args.counts).read_text()) if args.counts else {}, cut_at)
    acl_meta(staging)
    gates(staging, manifest, counts['bgcs'], ['regions_nuc.fasta', 'all_regions_gbk.index.tsv.gz'])
    final = rel / rid
    os.rename(staging, final)
    lock(final)
    flip_latest(root, rid)
    index = load_index(root)
    index['releases'].append({'id': rid, 'cut_at': cut_at, 'date': cut_at[:10], 'counts': counts,
                              'previous': None, 'retired_at': None,
                              'changelog': changelog_entry(manifest, None, Path(args.notes).read_text())})
    index['latest'] = rid
    index['latest_history'].append({'id': rid, 'from': cut_at})
    save_index(root, index)
    point_top_level(root, args.build_log_dir)
    moved = move_out_legacy(root, args)
    print(f'moved out of the served directory: {moved}')
    index['releases'][-1]['diamond'] = diamond_to(rid, args, None)
    save_index(root, index)
    http_check(root, args, manifest)
    print(f'RELEASED {rid}')


def move_out_legacy(root: Path, args) -> dict:
    """Pre-release backups (.prev-*) and build logs/scripts are served today; move them next door."""
    out = {'backups': 0, 'build_logs': 0}
    for p in sorted(root.iterdir()):
        if p.is_symlink() or p.name in ('releases',):
            continue
        if BACKUP_RE.search(p.name):
            dest, key = args.backup_dir, 'backups'
        elif BUILD_LOG_RE.search(p.name):
            dest, key = args.build_log_dir, 'build_logs'
        else:
            continue
        dest.mkdir(parents=True, exist_ok=True)
        os.rename(p, dest / p.name)
        out[key] += 1
    return out


def cmd_uninit(args) -> None:
    """Back to flat files: each top-level symlink is replaced by a hard link to the release's file."""
    root, rid = args.root, args.id
    src = root / 'releases' / rid
    for name in top_level_names():
        p = root / name
        if not p.is_symlink():
            continue
        s = src / name
        if s.is_dir():
            tmp = root / f'.{name}.uninit'
            link_tree(s, tmp)
            unlock_dirs(tmp)
            p.unlink()
            os.rename(tmp, p)
        elif s.exists():
            tmp = root / f'.{name}.uninit'
            hardlink(s, tmp)
            os.replace(tmp, p)
        else:
            p.unlink()
    live = args.diamond_dir / 'regions_prot.dmnd'
    if live.is_symlink() and not args.no_diamond:
        os.replace(args.diamond_dir / os.readlink(live), live)
    print(f'top level is flat again (files linked from releases/{rid}); releases/ left in place')


def cmd_cut(args) -> None:
    root, rid = args.root, args.id
    index = load_index(root)
    ids = [r['id'] for r in index['releases']]
    if rid in ids:
        sys.exit(f'ABORT: {rid} exists')
    if ids and parse(rid) < max(parse(r) for r in ids) and not args.allow_older:
        sys.exit(f'ABORT: {rid} sorts before {max(ids, key=parse)} (--allow-older for a patch to an older line)')
    latest = root / 'releases' / 'latest'
    prev_id = index['latest']
    prev = root / 'releases' / prev_id if prev_id else None
    build = Path(args.build)
    final = root / 'releases' / rid
    if args.resume:
        # A cut that failed after renaming the release into place (e.g. in lock()): the directory, its
        # manifest and notes are complete; re-check the gates and finish from the lock on.
        if not final.is_dir():
            sys.exit(f'ABORT: --resume but {final} does not exist')
        manifest = json.loads((final / 'manifest.json').read_text())
        if manifest['release'] != rid or manifest['previous'] != prev_id:
            sys.exit(f'ABORT: {final}/manifest.json is for {manifest["release"]} after {manifest["previous"]}')
        counts, cut_at = manifest['counts'], manifest['cut_at']
        gates(final, manifest, counts['bgcs'], ['regions_nuc.fasta', 'all_regions_gbk.index.tsv.gz'])
        return finish_cut(args, index, ids, rid, prev_id, prev, final, manifest, counts, cut_at)
    if final.exists():
        sys.exit(f'ABORT: {final} exists (a failed cut? --resume finishes it)')
    counts = live_counts(args)
    staging = root / 'releases' / f'{rid}.staging'
    staging.mkdir()
    replaced = []
    for name in FILES:
        b = build / name
        if b.exists():
            digest = sidecar_hash(b)
            os.rename(b, staging / name)
            if digest:
                write_sidecar(staging / name, digest)
                (build / f'{name}.sha256').unlink()
            replaced.append(name)
        elif (latest / name).exists():
            hardlink(latest / name, staging / name)
            if (latest / f'{name}.sha256').exists():
                hardlink(latest / f'{name}.sha256', staging / f'{name}.sha256')
    for d in DIRS:
        if (build / d).is_dir():
            os.rename(build / d, staging / d)
            replaced.append(f'{d}/')
        else:
            link_tree(latest / d, staging / d)
            unlock_dirs(staging / d)
    if 'all_regions_gbk.tar.gz' in replaced:
        plain = build / 'all_regions_gbk.index.tsv'
        if not plain.exists():
            sys.exit(f'ABORT: a new archive needs {plain} (publish_gbk_index.sh builds the public index from it)')
        subprocess.run(['bash', str(REPO / 'scripts/export/publish_gbk_index.sh'), str(plain)], check=True,
                       cwd=REPO, env={**os.environ, 'DEST': str(staging), 'CHECK_URLS': '0',
                                      'DATABASE_URL': os.environ.get('DATABASE_URL', f'postgresql:///{args.db}')})
        replaced += ['all_regions_gbk.index.tsv.gz', 'bgc_id_redirects.tsv.gz', 'extract_gbk.py']
    print(f'replaced: {", ".join(replaced) or "nothing"}; everything else hard-linked from {prev_id}')
    cut_at = now()
    records = json.loads(Path(args.counts).read_text()) if args.counts else {}
    manifest = describe(staging, rid, prev_id, prev, Path(args.notes).read_text(), counts, records, cut_at)
    acl_meta(staging)
    gates(staging, manifest, counts['bgcs'], ['regions_nuc.fasta', 'all_regions_gbk.index.tsv.gz'])
    os.rename(staging, final)
    finish_cut(args, index, ids, rid, prev_id, prev, final, manifest, counts, cut_at)


def finish_cut(args, index, ids, rid, prev_id, prev, final, manifest, counts, cut_at) -> None:
    root = args.root
    lock(final)
    prev_manifest = json.loads((prev / 'manifest.json').read_text()) if prev else None
    if prev_manifest:
        # Counts added to the index after a release was cut (clustered_bgcs) are not in its immutable manifest.
        prev_entry = next((r for r in index['releases'] if r['id'] == prev_id), {})
        prev_manifest['counts'] = {**prev_manifest['counts'], **prev_entry.get('counts', {})}
    index['releases'].append({'id': rid, 'cut_at': cut_at, 'date': cut_at[:10], 'counts': counts,
                              'previous': prev_id, 'retired_at': None,
                              'changelog': changelog_entry(manifest, prev_manifest, Path(args.notes).read_text())})
    new_latest = choose_latest(ids + [rid])
    if new_latest != index['latest']:
        queues_idle(args)
        flip_latest(root, new_latest)
        index['latest'] = new_latest
        index['latest_history'].append({'id': new_latest, 'from': now()})
        print(f'latest -> {new_latest}')
    entry = index['releases'][-1]
    if index['latest'] == rid:
        entry['diamond'] = diamond_to(rid, args, Path(args.diamond) if args.diamond else None)
    elif args.diamond and not args.no_diamond:
        entry['diamond'] = f'regions_prot.{rid}.dmnd'
        os.rename(args.diamond, args.diamond_dir / entry['diamond'])
    else:
        prev_entry = next((r for r in index['releases'] if r['id'] == prev_id), {})
        entry['diamond'] = prev_entry.get('diamond')
    save_index(root, index)
    if index['latest'] == rid:
        http_check(root, args, manifest)
        if args.after_flip:
            subprocess.run(['bash', args.after_flip], check=True, env={**os.environ, 'RELEASE_DIR': str(final)})
    print(f'RELEASED {rid}')
    print_retention(index)


def cmd_flip(args) -> None:
    root, rid = args.root, args.id
    index = load_index(root)
    if rid not in [r['id'] for r in index['releases']]:
        sys.exit(f'ABORT: no release {rid}')
    if any(r['id'] == rid and r.get('retired_at') for r in index['releases']):
        sys.exit(f'ABORT: {rid} is retired (its data files are gone)')
    queues_idle(args)
    flip_latest(root, rid)
    index['latest'] = rid
    index['latest_history'].append({'id': rid, 'from': now()})
    save_index(root, index)
    used = next(r.get('diamond') for r in index['releases'] if r['id'] == rid)
    if used and not args.no_diamond:
        point_diamond(args, used)
    print(f'latest -> {rid}')


def cmd_changelog(args) -> None:
    """Rewrite one release's changelog entry from its manifest, its previous release's and the notes file
    (a release cut before changelogs existed, or notes corrected afterwards). The release itself is untouched."""
    root, rid = args.root, args.id
    index = load_index(root)
    entry = next((r for r in index['releases'] if r['id'] == rid), None)
    if entry is None:
        sys.exit(f'ABORT: no release {rid}')
    manifest = json.loads((root / 'releases' / rid / 'manifest.json').read_text())
    # Counts added to the index after the cut (e.g. clustered_bgcs) are not in the immutable manifest.
    manifest['counts'] = {**manifest['counts'], **entry['counts']}
    prev = manifest.get('previous')
    prev_manifest = json.loads((root / 'releases' / prev / 'manifest.json').read_text()) if prev else None
    if prev_manifest:
        prev_entry = next((r for r in index['releases'] if r['id'] == prev), {})
        prev_manifest['counts'] = {**prev_manifest['counts'], **prev_entry.get('counts', {})}
    entry['changelog'] = changelog_entry(manifest, prev_manifest, Path(args.notes).read_text())
    save_index(root, index)
    print(f'changelog entry for {rid} written; releases/CHANGELOG.md regenerated')


def print_retention(index: dict) -> list[dict]:
    refresh_status(index)
    due = [r for r in index['releases'] if r['retention'] == 'retire']
    print('retention: ' + (', '.join(r['id'] for r in due) + ' can be retired (retire --yes)' if due
                           else 'nothing to retire'))
    return due


def cmd_status(args) -> None:
    index = load_index(args.root)
    refresh_status(index)
    print(f'latest: {index["latest"]}')
    for r in index['releases']:
        print(f'  {r["id"]:<16} {r["date"]}  {r["stage"]:<5}  {r["status"]:<8}  '
              f'{"permanent " if r["kept_permanently"] else ""}{r["retention"]}')
    print_retention(index)


def cmd_retire(args) -> None:
    root = args.root
    index = load_index(root)
    for r in print_retention(index):
        d = root / 'releases' / r['id']
        doomed = [p for p in d.rglob('*')
                  if p.is_file() and not (p.parent == d and p.name in KEEP_ON_RETIRE)]
        size = sum(p.stat().st_size for p in doomed if p.stat().st_nlink == 1)
        print(f'{r["id"]}: {len(doomed)} files; {human(size)} freed (the rest is shared with other releases)')
        if not args.yes:
            continue
        unlock_dirs(d)
        for p in doomed:
            p.unlink()
        for sub in sorted((p for p in d.rglob('*') if p.is_dir()), key=lambda p: -len(p.parts)):
            sub.rmdir()
        lock(d)
        r['retired_at'] = now()
    in_use = {r.get('diamond') for r in index['releases'] if not r.get('retired_at') and r['retention'] != 'retire'}
    live = args.diamond_dir / 'regions_prot.dmnd'
    if live.is_symlink():
        in_use.add(os.readlink(live))
    for r in index['releases']:
        dm = r.get('diamond')
        if r['retention'] == 'retire' and dm and dm not in in_use and (args.diamond_dir / dm).exists():
            print(f'{r["id"]}: DIAMOND index {dm} ({human((args.diamond_dir / dm).stat().st_size)})')
            if args.yes:
                (args.diamond_dir / dm).unlink()
            in_use.add(dm)
    if args.yes:
        save_index(root, index)
    else:
        print('dry run: nothing deleted (retire --yes)')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--root', type=Path, default=ROOT)
    ap.add_argument('--diamond-dir', type=Path, default=DIAMOND_DIR)
    ap.add_argument('--backup-dir', type=Path, default=ROOT.parent / 'downloads-pre-release-backup')
    ap.add_argument('--build-log-dir', type=Path, default=ROOT.parent / 'downloads-build-logs')
    ap.add_argument('--url-base', default=f'{SITE}/downloads', help='where --root is served')
    ap.add_argument('--stats-url', default=STATS_URL)
    ap.add_argument('--db', default='bgc_atlas_v2')
    ap.add_argument('--no-db', action='store_true', help='skip the exact bgcs count (dry runs)')
    ap.add_argument('--no-http', action='store_true')
    ap.add_argument('--no-diamond', action='store_true')
    ap.add_argument('--no-queue-check', action='store_true')
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('init'); p.add_argument('id'); p.add_argument('--notes', required=True); p.add_argument('--counts')
    p = sub.add_parser('uninit'); p.add_argument('id')
    p = sub.add_parser('cut'); p.add_argument('id'); p.add_argument('--build', required=True)
    p.add_argument('--notes', required=True); p.add_argument('--counts'); p.add_argument('--diamond')
    p.add_argument('--after-flip'); p.add_argument('--allow-older', action='store_true')
    p.add_argument('--resume', action='store_true', help='finish a cut that failed after its release dir was in place')
    p = sub.add_parser('flip'); p.add_argument('id')
    p = sub.add_parser('changelog'); p.add_argument('id'); p.add_argument('--notes', required=True)
    sub.add_parser('status')
    p = sub.add_parser('retire'); p.add_argument('--yes', action='store_true')
    args = ap.parse_args()
    # Derived defaults follow --root (dry runs must never touch the real neighbours).
    if args.root != ROOT:
        if args.backup_dir == ROOT.parent / 'downloads-pre-release-backup':
            args.backup_dir = args.root.parent / 'downloads-pre-release-backup'
        if args.build_log_dir == ROOT.parent / 'downloads-build-logs':
            args.build_log_dir = args.root.parent / 'downloads-build-logs'
    {'init': cmd_init, 'uninit': cmd_uninit, 'cut': cmd_cut, 'flip': cmd_flip, 'status': cmd_status,
     'retire': cmd_retire, 'changelog': cmd_changelog}[args.cmd](args)


if __name__ == '__main__':
    main()
