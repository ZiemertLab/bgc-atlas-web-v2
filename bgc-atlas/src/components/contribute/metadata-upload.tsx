'use client';

import { apiFetch } from "@/lib/basePath";
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import type { BatchValidationResult, CsvParsingResult } from '@/lib/metadata/types';

interface MetadataUploadProps {
  onValidationComplete?: (result: BatchValidationResult) => void;
  onFileSelect?: (file: File | null) => void;
}

export function MetadataUpload({ onValidationComplete, onFileSelect }: MetadataUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<BatchValidationResult | null>(null);
  const [parsingResult, setParsingResult] = useState<CsvParsingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);
    setValidationResult(null);
    setParsingResult(null);
    setError(null);

    if (onFileSelect) {
      onFileSelect(selectedFile);
    }

    if (selectedFile) {
      await validateFile(selectedFile);
    }
  };

  const validateFile = async (fileToValidate: File) => {
    setValidating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('metadata', fileToValidate);

      const response = await apiFetch('/api/contribute/validate', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Validation failed');
      }

      const result = await response.json();

      setParsingResult(result.parsing);
      setValidationResult(result.validation);

      if (onValidationComplete) {
        onValidationComplete(result.validation);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to validate file';
      setError(errorMessage);
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.tab"
          onChange={handleFileChange}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={validating}
        >
          <Upload className="mr-2 h-4 w-4" />
          {file ? 'Change File' : 'Upload Metadata File'}
        </Button>
        {file && (
          <span className="text-sm text-muted-foreground">{file.name}</span>
        )}
      </div>

      {validating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Validating metadata...</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      {parsingResult && parsingResult.errors.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>Parsing Errors</span>
          </div>
          <ul className="text-xs text-destructive/90 space-y-1 ml-6">
            {parsingResult.errors.map((err, idx) => (
              <li key={idx}>
                Row {err.row}: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {validationResult && (
        <div className="rounded-md border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Validation Summary</h4>
            {validationResult.valid ? (
              <div className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                <span>All Valid</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{validationResult.invalidSamples} Invalid</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Total Samples</div>
              <div className="text-lg font-semibold">{validationResult.totalSamples}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Valid</div>
              <div className="text-lg font-semibold text-green-600">{validationResult.validSamples}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Invalid</div>
              <div className="text-lg font-semibold text-destructive">{validationResult.invalidSamples}</div>
            </div>
          </div>

          {validationResult.samples.some((s) => s.warnings.length > 0) && (
            <div className="rounded-md border border-amber-500/50 bg-amber-50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                <span>Warnings (non-blocking)</span>
              </div>
              <div className="text-xs text-amber-700/90 space-y-1.5">
                {validationResult.samples
                  .filter((s) => s.warnings.length > 0)
                  .slice(0, 5)
                  .map((sample, idx) => (
                    <div key={idx} className="ml-6">
                      <div className="font-medium">{sample.sampleAlias}:</div>
                      <ul className="list-disc ml-4">
                        {sample.warnings.map((w, wIdx) => (
                          <li key={wIdx}>{w.message}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                {validationResult.samples.filter((s) => s.warnings.length > 0).length > 5 && (
                  <div className="ml-6 text-muted-foreground">
                    ... and {validationResult.samples.filter((s) => s.warnings.length > 0).length - 5} more samples with warnings
                  </div>
                )}
              </div>
            </div>
          )}

          {validationResult.invalidSamples > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>Errors</span>
              </div>
              <div className="text-xs text-destructive/90 space-y-1.5">
                {validationResult.samples
                  .filter((s) => !s.valid)
                  .slice(0, 5)
                  .map((sample, idx) => (
                    <div key={idx} className="ml-6">
                      <div className="font-medium">{sample.sampleAlias}:</div>
                      <ul className="list-disc ml-4">
                        {sample.errors.map((e, eIdx) => (
                          <li key={eIdx}>
                            {e.field}: {e.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                {validationResult.invalidSamples > 5 && (
                  <div className="ml-6 text-muted-foreground">
                    ... and {validationResult.invalidSamples - 5} more samples with errors
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Supported formats: CSV, TSV. The file should include a header row with field names.
      </p>
    </div>
  );
}
