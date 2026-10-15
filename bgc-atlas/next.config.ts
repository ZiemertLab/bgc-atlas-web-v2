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
