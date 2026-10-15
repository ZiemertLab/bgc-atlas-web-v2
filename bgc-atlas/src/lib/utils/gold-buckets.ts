export type GoldBucket =
  | "host-animal"
  | "host-plant"
  | "marine"
  | "freshwater"
  | "soil-terrestrial"
  | "other-environmental"
  | "engineered"
  | "mixed"
  | "unknown";

export const GOLD_BUCKET_ORDER: GoldBucket[] = [
  "host-animal",
  "host-plant",
  "marine",
  "freshwater",
  "soil-terrestrial",
  "other-environmental",
  "engineered",
  "mixed",
  "unknown",
];

export const GOLD_BUCKET_LABEL: Record<GoldBucket, string> = {
  // Defined by exclusion (host-associated, not plant); ~22% of it is not animal.
  "host-animal": "Host (non-plant)",
  "host-plant": "Host (plant)",
  marine: "Marine",
  freshwater: "Freshwater",
  "soil-terrestrial": "Soil / Terrestrial",
  "other-environmental": "Other Environmental",
  engineered: "Engineered",
  mixed: "Mixed",
  unknown: "Unknown",
};

export const GOLD_BUCKET_COLOR: Record<GoldBucket, string> = {
  "host-animal": "#CC79A7",
  "host-plant": "#2E7D32",
  marine: "#0072B2",
  freshwater: "#56B4E9",
  "soil-terrestrial": "#8B5A2B",
  "other-environmental": "#F0E442",
  engineered: "#ea580c",
  mixed: "#7c3aed",
  unknown: "#4b5563",
};

// Low contrast against the pale basemap, so these get a darker, thicker stroke.
const LOW_CONTRAST_BUCKETS = new Set<GoldBucket>(["other-environmental"]);

export function bucketStroke(bucket: GoldBucket): {
  color: string;
  weight: number;
} {
  if (LOW_CONTRAST_BUCKETS.has(bucket)) {
    return { color: "#374151", weight: 0.75 };
  }
  return { color: "#ffffff", weight: 0.5 };
}

export function bucketFromGold(path: string | null | undefined): GoldBucket {
  if (!path) return "unknown";
  const parts = path.split(":").map((p) => p.trim());
  const [lvl1 = "", lvl2 = "", lvl3 = ""] = parts;
  const t1 = lvl1.toLowerCase();
  const t2 = lvl2.toLowerCase();
  const t3 = lvl3.toLowerCase();
  if (t1 === "host-associated") {
    if (t2 === "plants") return "host-plant";
    return "host-animal";
  }
  if (t1 === "engineered") return "engineered";
  if (t1 === "mixed") return "mixed";
  if (t1 === "environmental") {
    if (t2 === "aquatic" && t3 === "marine") return "marine";
    if (t2 === "aquatic" && t3 === "freshwater") return "freshwater";
    if (t2 === "terrestrial") return "soil-terrestrial";
    return "other-environmental";
  }
  return "unknown";
}
