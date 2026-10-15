import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Rendered by Satori: no CSS variables, Tailwind or oklch. Values are literal and
// every multi-child container needs `display: flex`.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

// The site's --brand.
const BRAND = '#A51E37';
const INK = '#18181b';
const MUTED = '#71717a';
const PAPER = '#fdfcfb';

// The horizontal lockup. Satori draws an <img> of an SVG data URI; the file is all
// outlines, so no font has to load.
const LOCKUP = `data:image/svg+xml;base64,${readFileSync(
  path.join(process.cwd(), 'src/assets/brand/bgc-atlas-horizontal.svg'),
).toString('base64')}`;
/** The lockup's viewBox is 1074.797 x 296.788. */
const LOCKUP_HEIGHT = 64;
const LOCKUP_WIDTH = Math.round((LOCKUP_HEIGHT * 1074.797) / 296.788);

// Satori does not accept woff2 (what next/font/google ships), so woff files are committed.
export async function loadFonts() {
  const dir = path.join(process.cwd(), 'src/assets/fonts');
  const [regular, semibold] = await Promise.all([
    readFile(path.join(dir, 'IBMPlexSans-400.woff')),
    readFile(path.join(dir, 'IBMPlexSans-600.woff')),
  ]);
  return [
    { name: 'IBM Plex Sans', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'IBM Plex Sans', data: semibold, weight: 600 as const, style: 'normal' as const },
  ];
}

export interface OgCardProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
}

function trim(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function OgCard({ title, subtitle, eyebrow }: OgCardProps) {
  const titleText = trim(title, 120);
  const titleSize = titleText.length > 80 ? 46 : titleText.length > 44 ? 58 : 72;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: PAPER,
        padding: '64px 72px',
        fontFamily: 'IBM Plex Sans',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori, not the DOM */}
        <img src={LOCKUP} alt="BGC Atlas" width={LOCKUP_WIDTH} height={LOCKUP_HEIGHT} />
        <div
          style={{
            display: 'flex',
            width: 120,
            height: 3,
            marginTop: 18,
            backgroundColor: BRAND,
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {eyebrow && (
          <div
            style={{
              display: 'flex',
              fontSize: 22,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: MUTED,
              marginBottom: 16,
            }}
          >
            {eyebrow}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            fontSize: titleSize,
            fontWeight: 600,
            lineHeight: 1.15,
            color: INK,
          }}
        >
          {titleText}
        </div>
        {subtitle && (
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              color: MUTED,
              marginTop: 20,
              lineHeight: 1.3,
            }}
          >
            {trim(subtitle, 110)}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          fontSize: 22,
          color: MUTED,
        }}
      >
        <div style={{ display: 'flex' }}>bgc-atlas.cs.uni-tuebingen.de</div>
        <div style={{ display: 'flex', width: 220, height: 3, backgroundColor: BRAND }} />
      </div>
    </div>
  );
}
