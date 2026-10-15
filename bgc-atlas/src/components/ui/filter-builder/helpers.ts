import type {
  FilterCondition,
  FilterFieldDefinition,
  FilterGroup,
  FilterOperator,
  FilterValue,
} from '@/lib/filters/types';

export type SavedFilter = {
  id: string;
  name: string;
  createdAt: string;
  group: FilterGroup;
};

// Lowercase on purpose: a row reads as a phrase, "Category · is any of · RiPP".
export const OPERATOR_LABELS: Partial<Record<FilterOperator, string>> = {
  contains: 'contains',
  not_contains: 'does not contain',
  equals: 'is',
  not_equals: 'is not',
  starts_with: 'starts with',
  ends_with: 'ends with',
  gt: 'greater than',
  gte: 'greater than or equal',
  lt: 'less than',
  lte: 'less than or equal',
  between: 'between',
  in: 'is any of',
  not_in: 'is none of',
};

export const formatOperatorLabel = (operator: FilterOperator) => {
  return OPERATOR_LABELS[operator] ?? operator.replace(/_/g, ' ');
};

// Only while the stored operator is `equals`: a stored `not_equals`, or an operator the
// field does not offer, keeps the full row so the stored value stays visible.
export const isTwoChoiceToggle = (
  field: FilterFieldDefinition | undefined,
  storedOperator: FilterOperator | undefined,
): boolean => Boolean(
  field
  && field.type === 'select'
  && field.options?.length === 2
  && field.defaultOperator === 'equals'
  && storedOperator === 'equals',
);

export const operatorChoices = (
  field: FilterFieldDefinition | undefined,
  storedOperator: FilterOperator | undefined,
): { value: FilterOperator; options: FilterOperator[]; outOfList: boolean } => {
  const allowed = field?.allowedOperators ?? [];
  const outOfList = Boolean(storedOperator) && !allowed.includes(storedOperator as FilterOperator);
  return {
    // The 'equals' tail only satisfies the type; catalog fields declare both defaults.
    value: storedOperator || field?.defaultOperator || allowed[0] || 'equals',
    options: outOfList ? [...allowed, storedOperator as FilterOperator] : allowed,
    outOfList,
  };
};

export const normalizeValue = (value: FilterValue, operator: FilterOperator): FilterValue => {
  if (operator === 'between') {
    if (Array.isArray(value)) {
      if (value.length >= 2) {
        return [value[0], value[1]];
      }
      return [value[0] ?? '', ''];
    }
    return ['', ''];
  }

  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
};

export const validateCondition = (
  condition: FilterCondition,
  field?: FilterFieldDefinition
): { fieldError?: string; valueError?: string } => {
  if (!field || !condition.field) {
    return { fieldError: 'Select a field to filter on.' };
  }

  const value = condition.value;
  const requireValue = () => ({ valueError: `Enter a value for ${field.label}.` });

  if (field.type === 'number') {
    if (condition.operator === 'between') {
      const [min, max] = Array.isArray(value) ? value : ['', ''];
      if (min === '' || max === '') {
        return { valueError: 'Provide both minimum and maximum values.' };
      }
      if (Number.isNaN(Number(min)) || Number.isNaN(Number(max))) {
        return { valueError: 'Enter valid numbers for this range.' };
      }
      return {};
    }
    if (value === '' || value === null || value === undefined) {
      return requireValue();
    }
    if (Number.isNaN(Number(value))) {
      return { valueError: 'Enter a valid number.' };
    }
    return {};
  }

  if (field.type === 'select') {
    if (condition.operator === 'in' || condition.operator === 'not_in') {
      if (!Array.isArray(value) || value.length === 0) {
        return { valueError: 'Add at least one value.' };
      }
      return {};
    }
    if (!value || (typeof value === 'string' && !value.trim())) {
      return requireValue();
    }
    return {};
  }

  if (!value || (typeof value === 'string' && !value.trim())) {
    return requireValue();
  }

  return {};
};

export const cloneGroup = (group: FilterGroup): FilterGroup => JSON.parse(JSON.stringify(group));
