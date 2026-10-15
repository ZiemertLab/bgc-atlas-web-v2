'use client';

import { Info, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FieldPicker } from '@/components/search/field-picker';
import { FacetValueCombobox } from '@/components/search/facet-value-combobox';
import { OptionMultiSelect } from './option-multi-select';
import { cn } from '@/lib/utils';
import type {
  FilterCondition,
  FilterFieldDefinition,
  FilterOperator,
  FilterValue,
} from '@/lib/filters/types';
import { formatOperatorLabel, isTwoChoiceToggle, normalizeValue, operatorChoices, validateCondition } from './helpers';

interface ConditionRowProps {
  condition: FilterCondition;
  fields: FilterFieldDefinition[];
  fieldMap: Map<string, FilterFieldDefinition>;
  onChange: (partial: Partial<FilterCondition>) => void;
  onRemove: () => void;
  /** No card around the row; the Property Search builder lays rows out as plain lines. */
  plain?: boolean;
}

export function ConditionRow({
  condition,
  fields,
  fieldMap,
  onChange,
  onRemove,
  plain = false,
}: ConditionRowProps) {
  const selectedField = fieldMap.get(condition.field) ?? fields[0];
  // Shows the stored operator, never a substitute; see operatorChoices.
  const { value: operatorValue, options: operatorOptions, outOfList: operatorOutOfList } =
    operatorChoices(selectedField, condition.operator);
  const validation = validateCondition(condition, selectedField);
  const asToggle = isTwoChoiceToggle(selectedField, condition.operator);
  // Hierarchical fields (e.g. GOLD ecosystem) treat "in list" as subtree-inclusive.
  const showSubtreeHint = Boolean(selectedField?.hierarchical)
    && (operatorValue === 'in' || operatorValue === 'not_in');

  const handleFieldChange = (fieldId: string) => {
    const nextField = fieldMap.get(fieldId);
    onChange({
      field: fieldId,
      operator: nextField?.defaultOperator ?? operatorValue,
      value: '',
    });
  };

  const handleOperatorChange = (operator: FilterOperator) => {
    onChange({
      operator,
      value: normalizeValue(condition.value, operator),
    });
  };

  const handleValueChange = (value: FilterValue) => {
    onChange({ value });
  };

  return (
    <div className={plain
      ? 'flex flex-wrap items-center gap-2'
      : 'flex flex-wrap items-center gap-2 rounded border border-border/60 bg-background/80 p-3 shadow-sm'}
    >
      <FieldPicker
        fields={fields}
        value={selectedField?.id}
        onChange={handleFieldChange}
        invalid={Boolean(validation.fieldError)}
        wrap={plain}
      />

      {asToggle ? (
        <div className="inline-flex" role="group" aria-label={selectedField.label}>
          {(selectedField.options ?? []).map((option, index) => {
            const pressed = condition.value === option.value;
            return (
              <Button
                key={option.value}
                type="button"
                variant={pressed ? 'default' : 'outline'}
                size="sm"
                aria-pressed={pressed}
                onClick={() => handleValueChange(option.value)}
                className={cn(
                  'h-8 text-xs',
                  index === 0 ? 'rounded-r-none' : '-ml-px rounded-l-none',
                  validation.valueError && !pressed && 'border-destructive',
                )}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
      ) : (
        <>
          <Select value={operatorValue} onValueChange={(val: FilterOperator) => handleOperatorChange(val)}>
            <SelectTrigger
              className={cn(
                'h-8 min-w-[140px] text-xs',
                // Marks an operator the field does not offer, e.g. one a 400 pointed at.
                operatorOutOfList && 'border-warning text-warning',
              )}
              title={operatorOutOfList
                ? `This field does not offer "${formatOperatorLabel(operatorValue)}". `
                  + 'It came from a saved filter or a shared link; pick one of the listed operators to repair it.'
                : undefined}
            >
              <SelectValue placeholder="Operator" />
            </SelectTrigger>
            <SelectContent>
              {operatorOptions.map((operator) => (
                <SelectItem key={`${condition.id}-${operator}`} value={operator}>
                  {formatOperatorLabel(operator)}
                  {operatorOutOfList && operator === operatorValue ? ' — not offered for this field' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ConditionValueInput
            operator={operatorValue}
            field={selectedField}
            value={condition.value}
            onChange={handleValueChange}
            isInvalid={Boolean(validation.valueError)}
          />
        </>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        aria-label="Remove condition"
        title="Remove condition"
        className={plain ? 'ml-auto h-8 w-8 p-0 text-muted-foreground hover:text-destructive' : 'text-destructive'}
      >
        <Trash2 className="h-4 w-4" />
      </Button>

      {(validation.fieldError || validation.valueError) && (
        <p className="w-full text-xs text-destructive">
          {validation.fieldError ?? validation.valueError}
        </p>
      )}

      {showSubtreeHint && (
        <p className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Includes descendants — matches the selected node and everything below it. Use “is” for an exact match.
        </p>
      )}
    </div>
  );
}

interface ConditionValueInputProps {
  field: FilterFieldDefinition;
  operator: FilterOperator;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  isInvalid?: boolean;
}

function ConditionValueInput({
  field,
  operator,
  value,
  onChange,
  isInvalid,
}: ConditionValueInputProps) {
  if (field.dynamic) {
    if (operator === 'contains' || operator === 'not_contains'
        || operator === 'starts_with' || operator === 'ends_with') {
      return (
        <Input
          className={cn(
            'h-8 w-64 text-xs',
            isInvalid && 'border-destructive text-destructive focus-visible:ring-destructive/30'
          )}
          placeholder="Substring…"
          value={typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    const multiple = operator === 'in' || operator === 'not_in';
    const values = Array.isArray(value)
      ? value.map(String)
      : value === undefined || value === null || value === ''
        ? []
        : [String(value)];
    return (
      <FacetValueCombobox
        field={field.id}
        multiple={multiple}
        value={values}
        onChange={(vals) => onChange(multiple ? vals : (vals[0] ?? ''))}
        invalid={isInvalid}
      />
    );
  }

  if (field.type === 'number') {
    if (operator === 'between') {
      const [min, max] = Array.isArray(value) ? value : ['', ''];
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            className={cn(
              'h-8 w-28 text-xs',
              isInvalid && 'border-destructive text-destructive focus-visible:ring-destructive/30'
            )}
            placeholder="Min"
            value={min ?? ''}
            onChange={(e) => onChange([e.target.value, max ?? ''])}
            aria-invalid={isInvalid ? true : undefined}
          />
          <span className="text-xs text-muted-foreground">and</span>
          <Input
            type="number"
            className={cn(
              'h-8 w-28 text-xs',
              isInvalid && 'border-destructive text-destructive focus-visible:ring-destructive/30'
            )}
            placeholder="Max"
            value={max ?? ''}
            onChange={(e) => onChange([min ?? '', e.target.value])}
            aria-invalid={isInvalid ? true : undefined}
          />
        </div>
      );
    }

    return (
      <Input
        type="number"
        className={cn(
          'h-8 w-32 text-xs',
          isInvalid && 'border-destructive text-destructive focus-visible:ring-destructive/30'
        )}
        placeholder={field.placeholder ?? 'Value'}
        value={typeof value === 'number' || typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={isInvalid ? true : undefined}
      />
    );
  }

  if (field.type === 'select' && field.options) {
    if (operator === 'in' || operator === 'not_in') {
      const vals = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []);
      return (
        <OptionMultiSelect
          options={field.options}
          value={vals}
          onChange={onChange}
          invalid={isInvalid}
        />
      );
    }

    const selectedValue = typeof value === 'string' ? value : '';
    return (
      <Select value={selectedValue} onValueChange={(val) => onChange(val)}>
        <SelectTrigger
          className={cn(
            'h-8 w-40 text-xs',
            isInvalid && 'border-destructive text-destructive focus-visible:ring-destructive/30'
          )}
          aria-invalid={isInvalid ? true : undefined}
        >
          <SelectValue placeholder="Value" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      className={cn(
        'h-8 w-64 text-xs',
        isInvalid && 'border-destructive text-destructive focus-visible:ring-destructive/30'
      )}
      placeholder={field.placeholder ?? 'Value'}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={isInvalid ? true : undefined}
    />
  );
}
