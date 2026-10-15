// Narrow-screen fixes injected into the viewer's shadow root after the library stylesheet. Rules are qualified
// with `.region-viewer-wrapper` to match the Vue-scoped selectors' specificity and win by coming last.
export const VIEWER_MOBILE_CSS = `
/* The shadow root lacks the page's border-box default, so the container is 2px wider than its wrapper,
   making the wrapper a horizontal scroller that cancels the chart's touch pan. */
.region-viewer-wrapper .viewer-container { box-sizing: border-box; }

@media (max-width: 640px) {
  /* Labels are measured with getBBox() to size the left margin, so a smaller font buys plot width. */
  .region-viewer-wrapper .track-label { font-size: 10px; }
  .region-viewer-wrapper .x-axis,
  .region-viewer-wrapper .axis-label,
  .region-viewer-wrapper .annotation-label { font-size: 11px; }

  /* The two 200px controls on one line overflow a 340px box. */
  .region-viewer-wrapper .controls { display: flex; flex-direction: column; gap: 8px; }
  .region-viewer-wrapper .region-select { width: 100%; min-width: 0; margin: 0; }
  .region-viewer-wrapper .feature-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-left: 0; }
  .region-viewer-wrapper .multi-select-container { display: block; width: 100%; }
  .region-viewer-wrapper .multi-select-dropdown { min-width: 0; width: 100%; }

  /* The Pfam and MiBIG tables overflow an overflow:hidden panel; scroll instead of clipping. */
  .region-viewer-wrapper .feature-content,
  .region-viewer-wrapper .details-content { overflow-x: auto; }

  /* A fixed 180px label column wrapped short values over several lines. */
  .region-viewer-wrapper .info-row { flex-direction: column; gap: 0; }
  .region-viewer-wrapper .info-label { min-width: 0; }
}
`;
