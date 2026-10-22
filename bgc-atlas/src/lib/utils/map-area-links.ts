import type { AreaLinks } from '@/components/ui/sample-map-dots.client';

/**
 * Area-select links for a map of metagenome samples (home, /samples). Its readout
 * counts only those samples' BGCs, so "View BGCs" keeps the source type and /bgcs
 * lists the same number rather than adding the MAG, isolate and SAG BGCs in the box.
 * "View samples" is the default link: /samples already lists only metagenomes.
 */
export const METAGENOME_AREA_LINKS: AreaLinks = {
  samples: (box) => `/samples?${box}`,
  bgcs: (box) => {
    box.set('sourceType', 'metagenome');
    return `/bgcs?${box}`;
  },
};
