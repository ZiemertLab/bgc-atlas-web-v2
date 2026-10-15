// GOLD ecosystem paths: up to 5 colon-separated levels, e.g. "Environmental:Aquatic:Marine:Coastal".

import type { Sample } from './index';

export interface GOLDMetadata {
  source: 'mgnify_biome' | 'envo_id' | 'envo_text' | 'mixs_package' | 'combined_3field' | 'combined_2field' | 'environment_feature' | 'environment_material';

  confidence: 'high' | 'medium-high' | 'medium' | 'low';

  mapped_at: string;

  original_biome?: string;

  [key: string]: unknown;
}

export interface GOLDLevel {
  /** 0 = top level */
  index: number;

  name: string;
}

export interface GOLDParsed {
  raw: string;

  levels: GOLDLevel[];

  /** 1-5 */
  depth: number;

  topLevel: string;

  fullPath: string[];

  metadata?: GOLDMetadata;
}

export interface SampleWithGOLD extends Sample {
  goldEcosystemPath?: string | null;

  goldEcosystemMetadata?: GOLDMetadata | null;
}
