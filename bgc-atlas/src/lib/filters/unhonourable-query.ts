// Raised when a condition cannot become a clause: skipping it would widen the result
// set and answer a broader question at HTTP 200. Shared by the OpenSearch and SQL
// builders. The message names field and operator so a stale shared link can be repaired.
import type { UnhonouredCondition } from '@/lib/filters/types';
import { describeThresholdRefusal } from '@/lib/filters/share-fields';

const describeCondition = (u: UnhonouredCondition): string => {
  switch (u.reason) {
    case 'unknown_field':
      return `unknown field "${u.field}"`;
    case 'unsupported_operator':
      return `field "${u.field}" does not support operator "${u.operator}"`
        + (u.supportedOperators?.length ? ` (supported: ${u.supportedOperators.join(', ')})` : '');
    case 'not_indexed':
      return `field "${u.field}": any member is not available on this index yet`
        + ' (choose 10, 50 or 90 %, or retry in a minute)';
    case 'unsupported_threshold':
      return describeThresholdRefusal(u.field, u.threshold, u.supportedThresholds ?? []);
    default:
      return `field "${u.field}" cannot use value ${JSON.stringify(u.value ?? null)}`
        + ` with operator "${u.operator}"`;
  }
};

const describeFacetField = (field: string): string =>
  `facet field "${field}" cannot be aggregated`;

export const unhonourableQueryMessage = (
  conditions: UnhonouredCondition[],
  facetFields: string[] = [],
): string => {
  const parts = [...conditions.map(describeCondition), ...facetFields.map(describeFacetField)];
  const sentences = [`Cannot run this query: ${parts.join('; ')}.`];
  if (conditions.length) {
    const [subject, object] = conditions.length === 1
      ? ['that condition', 'it'] : ['those conditions', 'them'];
    sentences.push(
      `Fix or remove ${subject} — running the query without ${object} would answer a broader question.`,
    );
  }
  // A dropped facet field omits counts; it does not widen the result set.
  if (facetFields.length) {
    sentences.push('Only keyword and boolean fields can be aggregated for facet counts.');
  }
  return sentences.join(' ');
};

export class UnhonourableQueryError extends Error {
  readonly conditions: UnhonouredCondition[];
  readonly facetFields: string[];

  constructor(conditions: UnhonouredCondition[], facetFields: string[] = []) {
    super(unhonourableQueryMessage(conditions, facetFields));
    this.name = 'UnhonourableQueryError';
    this.conditions = conditions;
    this.facetFields = facetFields;
  }
}
