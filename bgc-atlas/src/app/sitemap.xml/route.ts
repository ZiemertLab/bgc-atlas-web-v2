import { generateSitemaps } from "../sitemap";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://bgc-atlas.cs.uni-tuebingen.de";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Self-hosted, Next serves no sitemap index at /sitemap.xml (only on Vercel), though robots.txt
// advertises it; this serves it from the same shard list.
export const dynamic = "force-dynamic";

export async function GET() {
  const shards = await generateSitemaps();
  const lastModified = new Date().toISOString();

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...shards.map(({ id }) =>
      [
        "<sitemap>",
        `<loc>${SITE_URL}${BASE_PATH}/sitemap/${id}.xml</loc>`,
        `<lastmod>${lastModified}</lastmod>`,
        "</sitemap>",
      ].join(""),
    ),
    "</sitemapindex>",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
