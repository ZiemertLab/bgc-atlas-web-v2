import { describe, expect, it } from 'vitest';

import { jsonLdHtml } from './json-ld';

describe('jsonLdHtml', () => {
  const data = {
    name: 'Soil </script><script>alert(1)</script> study',
    description: '<!-- a & b -->\u2028next',
  };

  it('never emits a raw < or >, so the value cannot close the script element', () => {
    const html = jsonLdHtml(data);
    expect(html).not.toMatch(/[<>]/);
    expect(html).not.toContain('</script');
  });

  it('round-trips to the same data through a JSON parser', () => {
    expect(JSON.parse(jsonLdHtml(data))).toEqual(data);
  });
});
