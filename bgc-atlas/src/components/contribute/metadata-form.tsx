'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, ChevronDown, ChevronRight, X } from 'lucide-react';
import { validateSample } from '@/lib/metadata/validation';
import { FIELD_METADATA, RECOMMENDED_FIELDS, ALL_FIELD_NAMES } from '@/lib/metadata/constants';
import type { SampleMetadata, BatchValidationResult } from '@/lib/metadata/types';

interface MetadataFormProps {
  onSamplesChange?: (samples: SampleMetadata[]) => void;
  onValidationChange?: (result: BatchValidationResult) => void;
}

export function MetadataForm({ onSamplesChange, onValidationChange }: MetadataFormProps) {
  const [samples, setSamples] = useState<SampleMetadata[]>([
    { sample_alias: '' }
  ]);
  const [expandedSamples, setExpandedSamples] = useState<Set<number>>(new Set([0]));
  const [additionalFields, setAdditionalFields] = useState<Map<number, Set<string>>>(new Map([[0, new Set<string>()]]));

  const addSample = () => {
    const newSamples = [...samples, { sample_alias: '' }];
    setSamples(newSamples);
    setExpandedSamples(new Set([...expandedSamples, samples.length]));
    const newAdditionalFields = new Map(additionalFields);
    newAdditionalFields.set(samples.length, new Set());
    setAdditionalFields(newAdditionalFields);
    if (onSamplesChange) onSamplesChange(newSamples);
  };

  const addFieldToSample = (sampleIndex: number, fieldName: string) => {
    const newAdditionalFields = new Map(additionalFields);
    const sampleFields = new Set<string>(newAdditionalFields.get(sampleIndex) || new Set<string>());
    sampleFields.add(fieldName);
    newAdditionalFields.set(sampleIndex, sampleFields);
    setAdditionalFields(newAdditionalFields);
  };

  const removeFieldFromSample = (sampleIndex: number, fieldName: string) => {
    const newAdditionalFields = new Map(additionalFields);
    const sampleFields = new Set<string>(newAdditionalFields.get(sampleIndex) || new Set<string>());
    sampleFields.delete(fieldName);
    newAdditionalFields.set(sampleIndex, sampleFields);
    setAdditionalFields(newAdditionalFields);

    updateSample(sampleIndex, fieldName as keyof SampleMetadata, undefined);
  };

  const removeSample = (index: number) => {
    if (samples.length === 1) return;
    const newSamples = samples.filter((_, i) => i !== index);
    setSamples(newSamples);
    const newExpanded = new Set(expandedSamples);
    newExpanded.delete(index);
    setExpandedSamples(newExpanded);
    if (onSamplesChange) onSamplesChange(newSamples);
    validateAllSamples(newSamples);
  };

  const toggleExpand = (index: number) => {
    const newExpanded = new Set(expandedSamples);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSamples(newExpanded);
  };

  const updateSample = (index: number, field: keyof SampleMetadata, value: unknown) => {
    const newSamples = [...samples];
    newSamples[index] = {
      ...newSamples[index],
      [field]: value === '' ? undefined : value,
    };
    setSamples(newSamples);
    if (onSamplesChange) onSamplesChange(newSamples);
    validateAllSamples(newSamples);
  };

  const validateAllSamples = (samplesToValidate: SampleMetadata[]) => {
    const results = samplesToValidate.map((sample) => validateSample(sample));
    const validSamples = results.filter((r) => r.valid).length;

    const validationResult: BatchValidationResult = {
      valid: results.every((r) => r.valid),
      totalSamples: results.length,
      validSamples,
      invalidSamples: results.length - validSamples,
      samples: results,
    };

    if (onValidationChange) {
      onValidationChange(validationResult);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Samples ({samples.length})</h3>
        <Button type="button" size="sm" variant="outline" onClick={addSample}>
          <Plus className="h-4 w-4 mr-1" />
          Add Sample
        </Button>
      </div>

      <div className="space-y-3">
        {samples.map((sample, index) => {
          const isExpanded = expandedSamples.has(index);
          const validation = validateSample(sample);
          const hasErrors = !validation.valid;
          const hasWarnings = validation.warnings.length > 0;

          return (
            <div
              key={index}
              className={`border rounded-lg ${hasErrors ? 'border-destructive/50' : hasWarnings ? 'border-amber-500/50' : 'border-border'}`}
            >
              <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
                onClick={() => toggleExpand(index)}
              >
                <div className="flex items-center gap-2 flex-1">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">
                    {sample.sample_alias || `Sample ${index + 1}`}
                  </span>
                  {hasErrors && (
                    <span className="text-xs text-destructive">
                      {validation.errors.length} error(s)
                    </span>
                  )}
                  {!hasErrors && hasWarnings && (
                    <span className="text-xs text-amber-600">
                      {validation.warnings.length} warning(s)
                    </span>
                  )}
                </div>
                {samples.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSample(index);
                    }}
                    className="h-8 w-8 p-0"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                )}
              </div>

              {isExpanded && (
                <div className="p-4 pt-0 space-y-4 border-t">
                  <div className="space-y-3">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase">
                      Required
                    </h4>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Sample Alias *
                      </label>
                      <Input
                        value={sample.sample_alias || ''}
                        onChange={(e) => updateSample(index, 'sample_alias', e.target.value)}
                        placeholder="e.g., sample_001"
                        className={validation.errors.some((e) => e.field === 'sample_alias') ? 'border-destructive' : ''}
                      />
                      {validation.errors.some((e) => e.field === 'sample_alias') && (
                        <p className="text-xs text-destructive mt-1">
                          {validation.errors.find((e) => e.field === 'sample_alias')?.message}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-xs font-medium text-muted-foreground uppercase">
                      Recommended
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">Latitude</label>
                        <Input
                          type="number"
                          step="any"
                          value={sample.latitude ?? ''}
                          onChange={(e) => updateSample(index, 'latitude', e.target.value ? parseFloat(e.target.value) : undefined)}
                          placeholder="-90 to 90"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Longitude</label>
                        <Input
                          type="number"
                          step="any"
                          value={sample.longitude ?? ''}
                          onChange={(e) => updateSample(index, 'longitude', e.target.value ? parseFloat(e.target.value) : undefined)}
                          placeholder="-180 to 180"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Environment Biome</label>
                      <Input
                        value={sample.environment_biome || ''}
                        onChange={(e) => updateSample(index, 'environment_biome', e.target.value)}
                        placeholder="e.g., forest soil [ENVO:00002261]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Collection Date</label>
                      <Input
                        type="date"
                        value={sample.collection_date ? String(sample.collection_date) : ''}
                        onChange={(e) => updateSample(index, 'collection_date', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-medium text-muted-foreground uppercase">
                        Additional Fields
                      </h4>
                      <select
                        className="text-xs border rounded px-2 py-1"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            addFieldToSample(index, e.target.value);
                            e.target.value = '';
                          }
                        }}
                      >
                        <option value="">+ Add Field</option>
                        {ALL_FIELD_NAMES.filter(
                          (field) =>
                            field !== 'sample_alias' &&
                            !(RECOMMENDED_FIELDS as readonly string[]).includes(field) &&
                            !(additionalFields.get(index) || new Set()).has(field)
                        ).map((field) => {
                          const metadata = FIELD_METADATA[field as keyof typeof FIELD_METADATA];
                          return (
                            <option key={field} value={field}>
                              {metadata.label}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {Array.from(additionalFields.get(index) || new Set<string>()).map((fieldName) => {
                      const metadata = FIELD_METADATA[fieldName as keyof typeof FIELD_METADATA] as { label: string; description: string; example?: string };
                      const fieldValue = sample[fieldName as keyof SampleMetadata];

                      return (
                        <div key={fieldName} className="relative">
                          <label className="block text-sm font-medium mb-1">
                            {metadata.label}
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 ml-2"
                              onClick={() => removeFieldFromSample(index, fieldName)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </label>

                          {fieldName === 'description' ? (
                            <Textarea
                              value={(fieldValue as string) || ''}
                              onChange={(e) => updateSample(index, fieldName as keyof SampleMetadata, e.target.value)}
                              placeholder={metadata.example || metadata.description}
                              rows={2}
                            />
                          ) : fieldName.includes('date') ? (
                            <Input
                              type="date"
                              value={fieldValue ? String(fieldValue) : ''}
                              onChange={(e) => updateSample(index, fieldName as keyof SampleMetadata, e.target.value)}
                            />
                          ) : typeof fieldValue === 'number' || fieldName.includes('latitude') || fieldName.includes('longitude') || fieldName.includes('temperature') || fieldName.includes('ph') || fieldName.includes('meters') || fieldName.includes('precipitation') || fieldName.includes('salinity') || fieldName.includes('taxid') ? (
                            <Input
                              type="number"
                              step="any"
                              value={typeof fieldValue === 'number' || typeof fieldValue === 'string' ? fieldValue : ''}
                              onChange={(e) => updateSample(index, fieldName as keyof SampleMetadata, e.target.value ? parseFloat(e.target.value) : undefined)}
                              placeholder={metadata.example || metadata.description}
                            />
                          ) : (
                            <Input
                              value={(fieldValue as string) || ''}
                              onChange={(e) => updateSample(index, fieldName as keyof SampleMetadata, e.target.value)}
                              placeholder={metadata.example || metadata.description}
                            />
                          )}

                          {metadata.description && (
                            <p className="text-xs text-muted-foreground mt-1">{metadata.description}</p>
                          )}
                        </div>
                      );
                    })}

                    {(additionalFields.get(index) || new Set()).size === 0 && (
                      <p className="text-xs text-muted-foreground italic">
                        Use the dropdown above to add more metadata fields to this sample.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Add multiple samples and fill in their metadata. Required fields are marked with *.
        Recommended fields improve discoverability.
      </p>
    </div>
  );
}
