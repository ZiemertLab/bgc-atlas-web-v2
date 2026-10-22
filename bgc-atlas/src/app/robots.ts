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
        // Googlebot renders detail pages with JavaScript, and those pages draw their
        // content from /api: with `Disallow: /api` it indexed nav and footer only
        // (651 characters of a GCF page). It may fetch the calls each page's main
        // content comes from -- cheap, 13-120 ms -- and not the heavy or
        // side-effecting ones, which get longer rules (Google applies the most
        // specific, longest matching rule, so they override the allows). A page
        // renders without them; those panels are just empty for the crawler.
        // A named group replaces `*` entirely, so `*`'s rules are restated.
        // Googlebot ignores Crawl-delay; it paces itself on response times.
        userAgent: "Googlebot",
        allow: [
          "/",
          "/api/gcfs/",              // GCF summary
          "/api/studies/",           // study detail, gcf-counts
          "/api/bgcs/",              // BGC detail
          "/api/gcfs?study=",        // a study page's families table
          "/api/samples?studyKey=",  // a study page's samples table
        ],
        disallow: [
          "/admin",
          "/api",
          "/*?_rsc=",
          "/api/gcfs/*/environment",              // 4 s, up to 39 s cold on a large family
          "/api/gcfs/*/samples/map",
          "/api/gcfs/*/taxonomy-distribution",
          "/api/gcfs/*/gold-ecosystem-distribution",
          "/api/gcfs/*/export-gbk",
          "/api/bgcs/*/antismash-json",           // can start an archive unpack
          "/api/bgcs/*/download",
          "/api/bgcs/export",
          "/api/studies/export",
        ],
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
