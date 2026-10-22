/**
 * A <span> holding `text` as text, never as markup.
 *
 * For APIs that take "string or element" and treat the string as HTML, as Leaflet's
 * bindTooltip/bindPopup do (they assign it to innerHTML). Browser-only.
 */
export function textElement(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}
