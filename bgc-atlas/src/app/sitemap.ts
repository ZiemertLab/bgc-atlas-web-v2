import type { MetadataRoute } from "next";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://bgc-atlas.cs.uni-tuebingen.de";
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const ROUTE = (path: string) => `${SITE_URL}${BASE_PATH}${path}`;

// Generated per request: the DB may be unavailable at build time.
export const dynamic = "force-dynamic";

// The sitemap protocol caps a file at 50,000 URLs / 50 MB.
const CHUNK_SIZE = 40000;

// /samples/[id] only client-redirects to list views, and BGCs number in the
// millions, so neither detail page is listed.
const STATIC_ROUTES: MetadataRoute.Sitemap = [
  { url: ROUTE("/"), changeFrequency: "weekly", priority: 1.0 },
  { url: ROUTE("/bgcs"), changeFrequency: "weekly", priority: 0.9 },
  { url: ROUTE("/gcfs"), changeFrequency: "weekly", priority: 0.9 },
  { url: ROUTE("/samples"), changeFrequency: "weekly", priority: 0.9 },
  { url: ROUTE("/genome-collections"), changeFrequency: "weekly", priority: 0.7 },
  { url: ROUTE("/search"), changeFrequency: "monthly", priority: 0.6 },
  { url: ROUTE("/downloads"), changeFrequency: "weekly", priority: 0.7 },
  { url: ROUTE("/releases"), changeFrequency: "weekly", priority: 0.5 },
  { url: ROUTE("/contribute"), changeFrequency: "monthly", priority: 0.5 },
  { url: ROUTE("/studies"), changeFrequency: "weekly", priority: 0.9 },
  { url: ROUTE("/about"), changeFrequency: "monthly", priority: 0.5 },
  { url: ROUTE("/changelog"), changeFrequency: "weekly", priority: 0.4 },
  { url: ROUTE("/imprint"), changeFrequency: "yearly", priority: 0.2 },
  { url: ROUTE("/privacy"), changeFrequency: "yearly", priority: 0.2 },
];

async function countGcfs(): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM gcf_summary_mv`,
    );
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

async function gcfShardCount(): Promise<number> {
  const total = await countGcfs();
  return Math.ceil(total / CHUNK_SIZE);
}

async function countStudies(): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM studies`,
    );
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

async function studyShardCount(): Promise<number> {
  const total = await countStudies();
  return Math.ceil(total / CHUNK_SIZE);
}

// Shard 0: static routes; 1..N: /gcfs/[id]; N+1..N+M: /studies/[id].
// Self-hosted Next.js does not synthesise a sitemap index, so
// app/sitemap.xml/route.ts builds one from this list.
export async function generateSitemaps(): Promise<{ id: number }[]> {
  const [gcfShards, studyShards] = await Promise.all([gcfShardCount(), studyShardCount()]);
  const ids = [{ id: 0 }];
  for (let i = 0; i < gcfShards + studyShards; i++) {
    ids.push({ id: i + 1 });
  }
  return ids;
}

export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  // The shard id may arrive as a string.
  const shard = Number(id);

  if (shard === 0) {
    return STATIC_ROUTES.map((entry) => ({ ...entry, lastModified: now }));
  }

  const gcfShards = await gcfShardCount();

  if (shard <= gcfShards) {
    const offset = (shard - 1) * CHUNK_SIZE;
    try {
      const rows = await prisma.$queryRaw<{ gcf_id: string }[]>(Prisma.sql`
        SELECT gcf_id
        FROM gcf_summary_mv
        ORDER BY gcf_id
        LIMIT ${CHUNK_SIZE} OFFSET ${offset}
      `);

      return rows.map((row) => ({
        url: ROUTE(`/gcfs/${row.gcf_id}`),
        lastModified: now,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      }));
    } catch {
      return [];
    }
  }

  const offset = (shard - gcfShards - 1) * CHUNK_SIZE;
  try {
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id::text AS id
      FROM studies
      ORDER BY id
      LIMIT ${CHUNK_SIZE} OFFSET ${offset}
    `);

    return rows.map((row) => ({
      url: ROUTE(`/studies/${row.id}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }));
  } catch {
    return [];
  }
}
