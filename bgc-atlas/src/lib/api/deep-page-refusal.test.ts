import { describe, it, expect } from 'vitest';

import { BROWSE_RESULT_WINDOW } from '@/lib/opensearch/deep-paging';
import { deepPageRefusal } from './deep-page-refusal';

describe('deepPageRefusal', () => {
  it('passes a page inside the window', () => {
    expect(deepPageRefusal(0, 50)).toBeNull();
  });

  it('refuses a page past the window with the deep_page code, not filter_refused', async () => {
    const res = deepPageRefusal(BROWSE_RESULT_WINDOW, 50);
    expect(res?.status).toBe(400);
    const body = await res!.json() as Record<string, unknown>;
    // The list keeps its pager for this refusal; it does not say to remove a filter.
    expect(body.code).toBe('deep_page');
    expect(body.error).toBe(body.message);
    expect(body.rejected).toEqual([]);
  });
});
