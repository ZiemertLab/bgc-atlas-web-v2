import pytest

from scripts.export.cut_release import (
    changelog_entry, changelog_markdown, choose_latest, keep_set, parse, parse_notes, refresh_status, stage,
)


def test_order():
    ids = ['R3.0', 'R2.0', 'R2.0-beta.2', 'R2.1', 'R2.0.1', 'R2.0-beta.10', 'R2.0-alpha.1', 'R3.0-beta.1']
    assert sorted(ids, key=parse) == [
        'R2.0-alpha.1', 'R2.0-beta.2', 'R2.0-beta.10', 'R2.0', 'R2.0.1', 'R2.1', 'R3.0-beta.1', 'R3.0']


@pytest.mark.parametrize('bad', ['R2', 'R2.0.0', 'r2.0', 'R2.0-rc.1', 'R2.0-beta', 'R2.0-beta.0', 'v2.0'])
def test_rejects_non_canonical(bad):
    with pytest.raises(ValueError):
        parse(bad)


def test_stage():
    assert [stage(r) for r in ('R2.0-alpha.3', 'R2.0-beta.1', 'R2.0.1')] == ['alpha', 'beta', 'final']


def test_latest_is_newest_beta_until_a_final_exists():
    assert choose_latest(['R2.0-beta.1', 'R2.0-beta.2', 'R2.0-alpha.9']) == 'R2.0-beta.2'
    assert choose_latest(['R2.0-alpha.1']) is None
    # once R2.0 is out, a beta of what comes next is a preview, not latest
    assert choose_latest(['R2.0-beta.2', 'R2.0', 'R2.1-beta.1']) == 'R2.0'
    assert choose_latest(['R2.0', 'R2.3', 'R3.0-beta.1']) == 'R2.3'


def test_keep_current_previous_and_previews():
    ids = ['R2.0-beta.1', 'R2.0-beta.2', 'R2.0-beta.3']
    assert keep_set(ids, 'R2.0-beta.3', 'R2.0-beta.2') == {'R2.0-beta.3', 'R2.0-beta.2'}
    # a preview of a later release is not retired while it is newer than current
    assert 'R2.1-alpha.1' in keep_set(ids + ['R2.1-alpha.1'], 'R2.0-beta.3', 'R2.0-beta.2')


def test_permanent_first_and_last_final_of_a_major():
    ids = ['R2.0-beta.1', 'R2.0', 'R2.1', 'R2.2', 'R3.0-beta.1', 'R3.0', 'R3.1']
    keep = keep_set(ids, 'R3.1', 'R3.0')
    assert keep == {'R2.0', 'R2.2', 'R3.0', 'R3.1'}
    # R2's last release is only permanent once a later major is final
    assert keep_set(['R2.0', 'R2.1', 'R2.2', 'R3.0-beta.1'], 'R2.2', 'R2.1') == {'R2.0', 'R2.1', 'R2.2', 'R3.0-beta.1'}
    assert keep_set(['R2.0', 'R2.1', 'R2.2', 'R2.3'], 'R2.3', 'R2.2') == {'R2.0', 'R2.2', 'R2.3'}


def test_refresh_status():
    index = {
        'latest': 'R2.0-beta.3',
        'latest_history': [{'id': r, 'from': ''} for r in ('R2.0-beta.1', 'R2.0-beta.2', 'R2.0-beta.3')],
        'releases': [{'id': r, 'retired_at': None} for r in ('R2.0-beta.1', 'R2.0-beta.2', 'R2.0-beta.3')],
    }
    refresh_status(index)
    by = {r['id']: r for r in index['releases']}
    assert [r['id'] for r in index['releases']] == ['R2.0-beta.3', 'R2.0-beta.2', 'R2.0-beta.1']
    assert (by['R2.0-beta.3']['status'], by['R2.0-beta.2']['status'], by['R2.0-beta.1']['status']) == (
        'current', 'previous', 'older')
    assert by['R2.0-beta.1']['retention'] == 'retire'
    assert not any(r['kept_permanently'] for r in index['releases'])


def test_previous_is_what_was_latest_before_a_rollback():
    index = {
        'latest': 'R2.0-beta.1',
        'latest_history': [{'id': 'R2.0-beta.1', 'from': ''}, {'id': 'R2.0-beta.2', 'from': ''},
                           {'id': 'R2.0-beta.1', 'from': ''}],
        'releases': [{'id': 'R2.0-beta.1', 'retired_at': None}, {'id': 'R2.0-beta.2', 'retired_at': None}],
    }
    refresh_status(index)
    by = {r['id']: r for r in index['releases']}
    assert by['R2.0-beta.1']['status'] == 'current'
    # rolled back from beta.2: it is newer than current, so it is kept as a preview, not retired
    assert by['R2.0-beta.2']['retention'] == 'keep'


NOTES = """## Changes

The first versioned release. It is the corpus as of
2026-10-09:

- 46,098 assemblies removed (166,457 BGCs): duplicate copies,
  and genomes below MIMAG medium quality.
- 8,490 BGCs added.

## Known issues

- GCFs not yet recomputed.
"""


def test_parse_notes():
    assert parse_notes(NOTES) == [
        {'heading': 'Changes', 'blocks': [
            {'type': 'p', 'text': 'The first versioned release. It is the corpus as of 2026-10-09:'},
            {'type': 'ul', 'items': ['46,098 assemblies removed (166,457 BGCs): duplicate copies, and genomes below '
                                     'MIMAG medium quality.', '8,490 BGCs added.']}]},
        {'heading': 'Known issues', 'blocks': [{'type': 'ul', 'items': ['GCFs not yet recomputed.']}]},
    ]


def _manifest(prev, counts, files, added=0, removed=0):
    return {'previous': prev, 'counts': counts, 'bgc_ids_added': added, 'bgc_ids_removed': removed,
            'files': [{'path': p, 'bytes': b, 'sha256': h, 'records': r} for p, b, h, r in files]}


def test_changelog_entry_diffs_counts_and_files():
    old = _manifest(None, {'bgcs': 100, 'gcfs': 10, 'genomes': None},
                    [('regions_nuc.fasta', 1000, 'a', 100), ('db/gcfs.tsv.gz', 50, 'b', None), ('db/old.tsv.gz', 5, 'c', None)])
    new = _manifest('R2.0-beta.1', {'bgcs': 103, 'gcfs': 9, 'genomes': 7},
                    [('regions_nuc.fasta', 1030, 'a2', 103), ('db/gcfs.tsv.gz', 50, 'b', None), ('db/new.tsv.gz', 9, 'd', None)],
                    added=5, removed=2)
    c = changelog_entry(new, old, NOTES)
    assert c['deltas'] == {'bgcs': 3, 'gcfs': -1, 'genomes': None}
    assert (c['bgc_ids_added'], c['bgc_ids_removed']) == (5, 2)
    assert c['files']['changed'] == [{'path': 'regions_nuc.fasta', 'bytes': 1030, 'prev_bytes': 1000,
                                      'records': 103, 'prev_records': 100}]
    assert [f['path'] for f in c['files']['added']] == ['db/new.tsv.gz']
    assert [f['path'] for f in c['files']['removed']] == ['db/old.tsv.gz']
    assert c['files']['unchanged'] == 1
    md = changelog_markdown({'releases': [{'id': 'R2.0-beta.2', 'date': '2026-10-20', 'stage': 'beta', 'changelog': c}]})
    assert '| BGCs | 103 | +3 |' in md and '| GCFs | 9 | -1 |' in md and '### Known issues' in md


def test_first_release_has_no_diff():
    c = changelog_entry(_manifest(None, {'bgcs': 1}, [('x', 1, 'a', None)]), None, NOTES)
    assert c['deltas'] == {'bgcs': None} and c['files'] == {'changed': [], 'added': [], 'removed': [], 'unchanged': 0}
    md = changelog_markdown({'releases': [{'id': 'R2.0-beta.1', 'date': '2026-10-09', 'stage': 'beta', 'changelog': c}]})
    assert 'The first release.' in md and '### Files' not in md


def test_parse_notes_drops_comments():
    notes = "## Changes\n\n<!-- DRAFT: fill in -->\n\n- One.\n"
    assert parse_notes(notes) == [{'heading': 'Changes', 'blocks': [{'type': 'ul', 'items': ['One.']}]}]
