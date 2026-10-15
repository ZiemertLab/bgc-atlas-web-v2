import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/lib/providers/query-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { withBase } from "@/lib/basePath";
import { SITE_DATASET_ID } from "@/lib/structured-data";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bgc-atlas.cs.uni-tuebingen.de";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default:
      "BGC Atlas — Biosynthetic Gene Clusters (BGCs) & Gene Cluster Families with Taxonomic and Environmental Context",
    template: "%s | BGC Atlas",
  },
  description:
    "BGC Atlas is an open resource for biosynthetic gene clusters (BGCs) and gene cluster families (GCFs) from environmental metagenomes, metagenome-assembled genomes, single-amplified genomes and isolate genomes — the genomic basis of natural products and secondary metabolites. Browse, search and download more than 16 million BGCs with taxonomy, biome and ecological context.",
  applicationName: "BGC Atlas",
  keywords: [
    "biosynthetic gene clusters",
    "BGC",
    "BGCs",
    "gene cluster families",
    "GCF",
    "GCFs",
    "natural products",
    "secondary metabolites",
    "specialized metabolites",
    "metagenomics",
    "metagenomes",
    "metagenome-assembled genomes",
    "MAG",
    "MAGs",
    "single-amplified genomes",
    "SAG",
    "isolate genomes",
    "microbiome",
    "antiSMASH",
    "BiG-SLiCE",
    "biosynthesis",
    "microbial natural products",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "BGC Atlas",
    title:
      "BGC Atlas — Biosynthetic Gene Clusters & Gene Cluster Families with Taxonomic and Environmental Context",
    description:
      "Explore more than 16 million biosynthetic gene clusters (BGCs), the gene cluster families (GCFs) they form, and the natural products and secondary metabolites they encode — across environmental metagenomes, MAGs, single-amplified genomes and isolate genomes.",
  },
  twitter: {
    card: "summary_large_image",
    title:
      "BGC Atlas — Biosynthetic Gene Clusters & Gene Cluster Families",
    description:
      "More than 16 million biosynthetic gene clusters (BGCs) and the gene cluster families they form, from environmental metagenomes, MAGs, single-amplified genomes and isolate genomes, with taxonomy and environmental context.",
  },
  // Next does not apply basePath to metadata icon URLs.
  icons: {
    icon: [
      { url: withBase("/favicon/icon.svg"), type: "image/svg+xml" },
      { url: withBase("/favicon/favicon.ico"), sizes: "any" },
    ],
    apple: withBase("/favicon/apple-touch-icon.png"),
  },
};

// A hex literal, not the --brand token: browser chrome does not resolve CSS variables.
export const viewport: Viewport = {
  themeColor: "#A51E37",
};

const GROUP_URL =
  "https://uni-tuebingen.de/fakultaeten/mathematisch-naturwissenschaftliche-fakultaet/fachbereiche/interfakultaere-einrichtungen/imit/arbeitsgruppen/translational-genome-mining-for-natural-products/";

const datasetJsonLd = {
  "@context": "https://schema.org",
  "@type": "Dataset",
  // Must match the entity pages' `isPartOf` @id (lib/structured-data.ts).
  "@id": SITE_DATASET_ID,
  name: "BGC Atlas",
  description:
    "More than 16 million biosynthetic gene clusters (BGCs) from environmental metagenomes, metagenome-assembled genomes, single-amplified genomes and isolate genomes, grouped into gene cluster families (GCFs) and annotated with the taxonomy and the environment each one came from, for studying the ecological and functional drivers of natural product and secondary metabolite biosynthesis.",
  url: SITE_URL,
  identifier: SITE_URL,
  keywords: [
    "biosynthetic gene clusters",
    "BGC",
    "BGCs",
    "gene cluster families",
    "GCF",
    "GCFs",
    "natural products",
    "secondary metabolites",
    "specialized metabolites",
    "metagenomics",
    "metagenome-assembled genomes",
    "MAG",
    "MAGs",
    "single-amplified genomes",
    "SAG",
    "isolate genomes",
    "antiSMASH",
    "BiG-SLiCE",
  ],
  isAccessibleForFree: true,
  version: "2",
  creator: {
    "@type": "Organization",
    name: "Translational Genome Mining for Natural Products, University of Tübingen",
    url: GROUP_URL,
  },
  publisher: {
    "@type": "Organization",
    name: "University of Tübingen",
    url: "https://uni-tuebingen.de/en/",
  },
  // Organization, not FundingAgency: Google refuses subtypes here.
  funder: [
    {
      "@type": "Organization",
      name: "German Center for Infection Research (DZIF)",
      url: "https://www.dzif.de/en",
    },
    {
      "@type": "Organization",
      name: "Volkswagen Foundation",
      url: "https://www.volkswagenstiftung.de/en",
    },
  ],
  license: "https://creativecommons.org/licenses/by/4.0/",
  // Plain text: Google rejects ScholarlyArticle here ("Invalid object type").
  citation: [
    "Bağcı C, Talamas-Tanner A, Ziemert N. BGC Atlas v2: biosynthetic gene clusters with taxonomic and environmental context at scale. bioRxiv (2026). https://doi.org/10.64898/2026.09.14.751540",
    "Bağcı C, Nuhamunada M, Goyat H, Ladanyi C, Sehnal L, Blin K, Kautsar SA, Tagirdzhanov A, Gurevich A, Mantri S, von Mering C, Udwary D, Medema MH, Weber T, Ziemert N. BGC Atlas: a web resource for exploring the global chemical diversity encoded in bacterial genomes. Nucleic Acids Research 53(D1):D618–D624 (2025). https://doi.org/10.1093/nar/gkae953",
  ],
  distribution: [
    {
      "@type": "DataDownload",
      name: "Database tables (TSV)",
      encodingFormat: "application/gzip",
      contentUrl: `${SITE_URL}/downloads/db/bgc_atlas_v2_tables_tsv.tar.gz`,
    },
    {
      "@type": "DataDownload",
      name: "Database tables (Parquet)",
      encodingFormat: "application/gzip",
      contentUrl: `${SITE_URL}/downloads/db/bgc_atlas_v2_tables_parquet.tar.gz`,
    },
  ],
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "BGC Atlas",
  alternateName: [
    "Biosynthetic Gene Cluster Atlas",
    "BGC Atlas — biosynthetic gene clusters",
  ],
  url: SITE_URL,
  description:
    "An atlas of more than 16 million biosynthetic gene clusters (BGCs) and the gene cluster families (GCFs) they form, from environmental metagenomes, metagenome-assembled genomes, single-amplified genomes and isolate genomes, encoding natural products and secondary metabolites.",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "ResearchOrganization",
  name: "BGC Atlas",
  url: SITE_URL,
  description:
    "BGC Atlas — a research resource for exploring biosynthetic gene clusters (BGCs), gene cluster families (GCFs), natural products and secondary metabolites from environmental metagenomes and genome catalogs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // Font variables go on <html>, where Tailwind sets the default font-family.
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <QueryProvider>
          <TooltipProvider>
            <Suspense fallback={null}>
            </Suspense>
            {children}
            <Toaster />
          </TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
