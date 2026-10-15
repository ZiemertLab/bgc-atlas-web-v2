// CARTO requires an API key on raster tiles (since Aug 2026); unkeyed requests return 200 with a
// watermarked tile. The key is a public, domain-scoped client credential, so NEXT_PUBLIC_ is correct.
// Without a key the unkeyed endpoint is used so local checkouts still render.

const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY;

// `{r}` expands to `@2x` on high-DPI displays, so the key goes in the query string, not the path.
export const BASEMAP_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' +
  (CARTO_KEY ? `?key=${encodeURIComponent(CARTO_KEY)}` : '');

export const BASEMAP_SUBDOMAINS: string[] = ['a', 'b', 'c', 'd'];

// CARTO's terms require both OpenStreetMap and CARTO credits on every map.
export const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';
