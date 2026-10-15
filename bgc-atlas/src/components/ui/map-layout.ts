// Leaflet repeats the world every 256·2^zoom px, so the card stops at one copy.
// A page that labels the map must sit in MAP_BLOCK_CLASS too, or the label misaligns.
export const MAP_WORLD_WIDTH = 1024;
/** 1024px map + gap-8 + a 380px rail; the rail gives way in a narrow panel. */
export const MAP_BLOCK_CLASS =
  "mx-auto w-full max-w-[1024px] 2xl:max-w-[1436px]";
