import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://bgc-atlas.cs.uni-tuebingen.de";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // `/*?_rsc=`: App Router RSC payloads, duplicates of the HTML pages.
        // /downloads and /*/opengraph-image are left crawlable on purpose.
        disallow: ["/api", "/*?_rsc="],
        // Spreads a crawl of the sitemap's detail pages over weeks. Google ignores
        // Crawl-delay; pace Googlebot in Search Console instead.
        crawlDelay: 5,
      },
      {
        // Fetchers acting for a person in a chat (one request per question), not
        // crawlers. A named group replaces `*`, so its rules are restated.
        userAgent: ["ChatGPT-User", "Claude-User", "Perplexity-User"],
        allow: ["/", "/api/"],
        disallow: ["/*?_rsc="],
      },
    ],
    sitemap: `${SITE_URL}${BASE_PATH}/sitemap.xml`,
  };
}
