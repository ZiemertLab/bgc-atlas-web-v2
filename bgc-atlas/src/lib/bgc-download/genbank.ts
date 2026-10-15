// All three per-BGC formats derive from the same region .gbk so they cannot disagree.

const FASTA_LINE = 80;

function wrap(seq: string): string {
  const lines: string[] = [];
  for (let i = 0; i < seq.length; i += FASTA_LINE) lines.push(seq.slice(i, i + FASTA_LINE));
  return lines.join('\n');
}

/** The ORIGIN block of every record, residues only, upper-cased. */
export function genbankSequences(gbk: string): string[] {
  const out: string[] = [];
  for (const record of gbk.split(/^\/\/\s*$/m)) {
    const origin = record.search(/^ORIGIN/m);
    if (origin === -1) continue;
    const body = record.slice(origin).split('\n').slice(1).join('');
    const seq = body.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (seq) out.push(seq);
  }
  return out;
}

export function genbankToNucleotideFasta(gbk: string, header: string): string {
  const seqs = genbankSequences(gbk);
  return seqs
    .map((seq, i) => `>${seqs.length > 1 ? `${header}_${i + 1}` : header}\n${wrap(seq)}\n`)
    .join('');
}

export interface CdsTranslation {
  name: string;
  location: string;
  translation: string;
}

// Named by locus_tag, else protein_id, else gene, else position: converted records may lack a locus_tag.
export function genbankCdsTranslations(gbk: string): CdsTranslation[] {
  const features = gbk.search(/^FEATURES/m);
  if (features === -1) return [];
  const originAt = gbk.slice(features).search(/^ORIGIN/m);
  const table = originAt === -1 ? gbk.slice(features) : gbk.slice(features, features + originAt);

  // A feature starts at column 5 with its key; qualifiers are indented to 21.
  const blocks = table.split(/\n(?= {5}\S)/);
  const out: CdsTranslation[] = [];
  let n = 0;
  for (const block of blocks) {
    const head = block.match(/^ {5}CDS {2,}(.*)/);
    if (!head) continue;
    n += 1;
    // The location can continue onto indented lines before the first qualifier.
    const lines = block.split('\n');
    let location = head[1].trim();
    let i = 1;
    while (i < lines.length && !lines[i].trimStart().startsWith('/')) {
      location += lines[i].trim();
      i += 1;
    }
    const qualifiers = lines.slice(i).map((l) => l.trim()).join('\n');
    const qual = (key: string) => {
      const m = qualifiers.match(new RegExp(`^/${key}="([^"]*)"`, 'm'));
      return m ? m[1].replace(/\s+/g, ' ').trim() : null;
    };
    const tr = qualifiers.match(/^\/translation="([^"]*)"/m);
    if (!tr) continue;
    const translation = tr[1].replace(/\s+/g, '');
    if (!translation) continue;
    out.push({
      name: qual('locus_tag') ?? qual('protein_id') ?? qual('gene') ?? `cds${n}`,
      location,
      translation,
    });
  }
  return out;
}

/** Protein FASTA of the region's CDS translations: `>{prefix}|{name} {location}`. */
export function genbankToProteinFasta(gbk: string, prefix: string): string {
  return genbankCdsTranslations(gbk)
    .map((cds) => `>${prefix}|${cds.name} ${cds.location}\n${wrap(cds.translation)}\n`)
    .join('');
}
