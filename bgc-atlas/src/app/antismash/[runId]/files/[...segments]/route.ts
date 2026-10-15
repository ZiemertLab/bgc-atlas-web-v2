import { createReadStream } from 'fs';
import { access, constants, readFile } from 'fs/promises';
import { Readable } from 'stream';
import path from 'path';
import { NextResponse } from 'next/server';

import {
  ensureAntismashRunExtraction,
  getAntismashRun,
  getAntismashRunExtractionDir,
  touchAntismashRunExtraction,
} from '@/lib/api/antismash';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
};

const getMimeType = (filePath: string) => MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

const buildEnhancementScript = (
  runId: string,
  mapping: Array<{
    anchor: string | null;
    id: string;
    filename: string | null;
    contig: string | null;
    start_pos: number | null;
    end_pos: number | null;
  }>
) => {
  if (mapping.length === 0) {
    return '';
  }

  const serializedMapping = JSON.stringify(mapping).replace(/</g, '\\u003c');

  const scriptContent = `
(function(){
  const mapping = ${serializedMapping};
  if (!Array.isArray(mapping) || mapping.length === 0) {
    return;
  }

  const anchorToBgc = new Map();
  const filenameToBgc = new Map();
  const posToBgc = new Map(); // contig -> Array<{start, end, entry}>

  mapping.forEach(function(item) {
    if (item.anchor) anchorToBgc.set(item.anchor, item);
    
    if (item.filename) {
      const fn = item.filename.toLowerCase();
      filenameToBgc.set(fn, item);
      const dotIndex = fn.lastIndexOf('.');
      if (dotIndex !== -1) filenameToBgc.set(fn.substring(0, dotIndex), item);
    }

    if (item.contig && item.start_pos !== null && item.end_pos !== null) {
      const c = item.contig.toLowerCase();
      if (!posToBgc.has(c)) posToBgc.set(c, []);
      posToBgc.get(c).push({
        start: item.start_pos,
        end: item.end_pos,
        entry: item
      });
    }
  });

  const BADGE_CLASS = 'bgc-atlas-bgc-id';
  const BADGE_SELECTOR = '[data-bgc-atlas-badge]';

  const ensureStyles = function() {
    if (document.head.querySelector('style[data-bgc-atlas-style]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-bgc-atlas-style', 'true');
    style.textContent = [
      '.' + BADGE_CLASS + ' {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 0.2rem;',
      '  margin-left: 0.4rem;',
      '  padding: 0.1rem 0.4rem;',
      '  border-radius: 4px;',
      '  background: #0f172a;',
      '  color: #f8fafc;',
      '  font-size: 0.65rem;',
      '  line-height: 1.1;',
      '  font-weight: 700;',
      '  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
      '  text-decoration: none;',
      '  white-space: nowrap;',
      '  cursor: help;',
      '  vertical-align: middle;',
      '  opacity: 0.9;',
      '}',
      '.' + BADGE_CLASS + ':hover { opacity: 1; background: #1e293b; }',
      '.' + BADGE_CLASS + '::before {',
      "  content: 'BGC';",
      '  font-size: 0.55rem;',
      '  font-weight: 500;',
      '  margin-right: 0.2rem;',
      '  color: rgba(226, 232, 240, 0.6);',
      '}'
    ].join('\\n');
    document.head.appendChild(style);
  };

  const getBgcForLink = (link) => {
    const href = link.getAttribute('href') || '';
    const text = link.textContent.trim();

    const hashMatch = href.match(/#(r\\d+c\\d+)/);
    if (hashMatch && anchorToBgc.has(hashMatch[1])) return anchorToBgc.get(hashMatch[1]);

    const urlParts = href.split('#')[0].split('?')[0].split('/');
    const filename = decodeURIComponent(urlParts[urlParts.length - 1]).toLowerCase();
    if (filename) {
      if (filenameToBgc.has(filename)) return filenameToBgc.get(filename);
      const dotIndex = filename.lastIndexOf('.');
      if (dotIndex !== -1 && filenameToBgc.has(filename.substring(0, dotIndex))) {
        return filenameToBgc.get(filename.substring(0, dotIndex));
      }
    }

    return null;
  };

  const getBgcForRow = (row) => {
    const rowAnchorRaw = row.getAttribute('data-anchor') || row.id || '';
    const rowAnchor = rowAnchorRaw.replace(/^#/, '');
    if (rowAnchor && anchorToBgc.has(rowAnchor)) return anchorToBgc.get(rowAnchor);

    const links = row.querySelectorAll('a');
    for (const link of links) {
      const bgc = getBgcForLink(link);
      if (bgc) return bgc;
    }

    let contig = null;
    let prev = row.closest('div.page')?.querySelector('h3, h4, strong') || 
               row.closest('.record-overview-details')?.previousElementSibling?.querySelector('strong') ||
               row.closest('.record-overview-header')?.querySelector('strong');
    
    if (prev) contig = prev.textContent.trim().toLowerCase();

    if (contig && posToBgc.has(contig)) {
      const fromTd = row.querySelector('.digits, td:nth-child(3)');
      const toTd = row.querySelector('.digits.table-split-left, td:nth-child(4)');
      
      if (fromTd && toTd) {
        const fromPos = parseInt(fromTd.textContent.replace(/[,\\s]/g, ''));
        const toPos = parseInt(toTd.textContent.replace(/[,\\s]/g, ''));
        
        if (!isNaN(fromPos) && !isNaN(toPos)) {
          const candidates = posToBgc.get(contig);
          // allow small positional jitter between coordinate conventions
          for (const cand of candidates) {
            if (Math.abs(cand.start - fromPos) < 5 && Math.abs(cand.end - toPos) < 5) {
              return cand.entry;
            }
          }
        }
      }
    }

    return null;
  };

  const reconcileRow = (row) => {
    const bgc = getBgcForRow(row);
    
    const target = row.querySelector('a') || row.querySelector('td');
    if (!target) return;

    const parent = target.parentElement;
    let badge = parent.querySelector(BADGE_SELECTOR);

    if (!bgc) {
      if (badge) badge.remove();
      return;
    }

    const shortId = bgc.id.substring(0, 8);
    if (badge) {
      if (badge.getAttribute('data-id') === bgc.id) return;
      badge.setAttribute('data-id', bgc.id);
      badge.textContent = shortId;
      badge.title = bgc.id;
    } else {
      const newBadge = document.createElement('span');
      newBadge.className = BADGE_CLASS;
      newBadge.textContent = shortId;
      newBadge.setAttribute('data-bgc-atlas-badge', 'true');
      newBadge.setAttribute('data-id', bgc.id);
      newBadge.title = bgc.id;
      target.insertAdjacentElement('afterend', newBadge);
    }
  };

  const reconcileAll = () => {
    const rows = document.querySelectorAll('tr');
    for (const row of rows) reconcileRow(row);
    // Overview region-selector buttons stay un-badged: too dense for per-button ids.
  };

  const init = () => {
    ensureStyles();
    reconcileAll();

    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      originalSetAttribute.apply(this, arguments);
      if (this.tagName === 'TR' || this.tagName === 'A') reconcileAll();
    };

    const observer = new MutationObserver(() => reconcileAll());
    observer.observe(document.body, { 
      childList: true, 
      subtree: true, 
      characterData: true,
      attributes: true,
      attributeFilter: ['href', 'id', 'class']
    });

    setInterval(reconcileAll, 2000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

  return `<script data-bgc-atlas-enhancement="${runId}">${scriptContent}</script>`;
};

const injectEnhancementScript = (html: string, scriptTag: string) => {
  if (!scriptTag) {
    return html;
  }

  const closingBodyIndex = html.lastIndexOf('</body>');

  if (closingBodyIndex === -1) {
    return `${html}\n${scriptTag}`;
  }

  return `${html.slice(0, closingBodyIndex)}${scriptTag}\n${html.slice(closingBodyIndex)}`;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId?: string; segments?: string[] }> }
) {
  const { runId, segments } = await params;

  if (!runId) {
    return NextResponse.json(
      { success: false, error: 'Invalid run id', message: 'Run id must be provided.' },
      { status: 400 }
    );
  }

  const run = await getAntismashRun(runId);

  if (!run) {
    return NextResponse.json(
      { success: false, error: 'Run not found', message: 'No antiSMASH run exists with the provided id.' },
      { status: 404 }
    );
  }

  const extractionResult = await ensureAntismashRunExtraction(run);

  if (extractionResult.status !== 'ready' || !extractionResult.extractedPath) {
    const statusCode = extractionResult.status === 'missing-file' ? 404 : 500;
    return NextResponse.json(
      {
        success: false,
        error: extractionResult.status === 'missing-file' ? 'Missing archive' : 'Extraction error',
        message: extractionResult.message ?? 'The antiSMASH archive is not available yet.',
      },
      { status: statusCode }
    );
  }

  // Eviction ages runs from last use, not from extraction.
  touchAntismashRunExtraction(runId);

  const baseDir = getAntismashRunExtractionDir(runId);
  const relativePathSegments = Array.isArray(segments) && segments.length > 0 ? segments : ['index.html'];
  const candidatePath = path.join(baseDir, ...relativePathSegments);
  const normalized = path.normalize(candidatePath);
  const baseDirNormalized = path.normalize(baseDir);
  const isInsideBase =
    normalized === baseDirNormalized || normalized.startsWith(`${baseDirNormalized}${path.sep}`);

  if (!isInsideBase) {
    return NextResponse.json(
      { success: false, error: 'Invalid path', message: 'Requested file is outside the run directory.' },
      { status: 403 }
    );
  }

  const shouldInject = getMimeType(normalized).startsWith('text/html');

  try {
    await access(normalized, constants.R_OK);
  } catch {
    return NextResponse.json(
      { success: false, error: 'Not found', message: 'Requested file was not found.' },
      { status: 404 }
    );
  }

  if (shouldInject) {
    try {
      const htmlContent = await readFile(normalized, 'utf8');
      const mapping = run.bgcs.map((bgc) => ({
        anchor: bgc.anchor,
        id: bgc.id,
        filename: bgc.filename,
        contig: bgc.contig,
        start_pos: bgc.start_pos,
        end_pos: bgc.end_pos,
      }));

      const scriptTag = buildEnhancementScript(run.id, mapping);
      const enhancedHtml = injectEnhancementScript(htmlContent, scriptTag);

      return new NextResponse(enhancedHtml, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      console.error('Failed to enhance antiSMASH index HTML', error);
    }
  }

  const nodeStream = createReadStream(normalized);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  const response = new NextResponse(webStream, {
    headers: {
      'Content-Type': getMimeType(normalized),
      'Cache-Control': 'no-store',
    },
  });

  return response;
}
