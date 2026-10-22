import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// Mount point, e.g. "/atlas", or "" for the site root. Next.js rejects an empty
// basePath, so the keys are omitted entirely. Keep NEXT_PUBLIC_API_URL in sync.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // Pin the file-scan root: a stray package-lock.json in a parent directory makes
  // Next infer it as the workspace root and Tailwind's scanner walks ~1.5 GB and crashes.
  turbopack: {
    root: import.meta.dirname,
  },
  async headers() {
    return [
      {
        // On every response Next serves. Framing is limited to this origin, so other
        // sites (including other hosts under the same parent domain, which count as
        // same-site) cannot frame the app and click through it, while the site's own
        // antiSMASH viewer iframe (/antismash/<run>/files/...) keeps working. Paths
        // nginx serves directly (/downloads, /v1/, /lassopeptides/) are not covered.
        // No HSTS, by choice.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Content-hashed snapshots; :hash is hex-only so unhashed assets don't match.
        source: "/data/:name-:hash([a-f0-9]{8,64}).json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Manifests point at the immutable files above, so keep their cache short.
        source: "/data/:name.manifest.json",
        headers: [
          { key: "Cache-Control", value: "public, max-age=60, stale-while-revalidate=300" },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
