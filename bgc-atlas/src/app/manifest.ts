import type { MetadataRoute } from 'next';

import { withBase } from '@/lib/basePath';

// `display: "browser"` so the address bar stays: every page is a citable URL.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BGC Atlas',
    short_name: 'BGC Atlas',
    description:
      'Biosynthetic gene clusters and the gene cluster families they form, with taxonomic and environmental context.',
    start_url: '/',
    display: 'browser',
    background_color: '#ffffff',
    theme_color: '#A51E37',
    icons: [
      {
        src: withBase('/favicon/android-chrome-192x192.png'),
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: withBase('/favicon/android-chrome-512x512.png'),
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
