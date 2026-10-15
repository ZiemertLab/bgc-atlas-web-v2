'use client';

import { apiFetch } from "@/lib/basePath";
import { Button } from '@/components/ui/button';
import { Download, FileSpreadsheet } from 'lucide-react';
import { toast } from '@/lib/hooks/use-toast';

interface TemplateDownloadProps {
  format?: 'csv' | 'tsv' | 'long';
}

export function TemplateDownload({ format = 'csv' }: TemplateDownloadProps) {
  const handleDownload = async () => {
    try {
      const response = await apiFetch(`/api/contribute/template?format=${format}`);

      if (!response.ok) {
        throw new Error('Failed to download template');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bgc-atlas-metadata-template.${format === 'tsv' ? 'tsv' : 'csv'}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download template. Please try again.';
      toast({
        variant: 'destructive',
        title: 'Download failed',
        description: message,
      });
    }
  };

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleDownload}
        className="w-full sm:w-auto"
      >
        <Download className="mr-2 h-4 w-4" />
        Download TSV Template
      </Button>

      <div className="text-xs text-muted-foreground space-y-1">
        <p className="flex items-start gap-2">
          <FileSpreadsheet className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>
            Download a <strong>tab-separated template</strong> with all available metadata fields in long format
            (sample_alias [TAB] metadata_key [TAB] value). Shows all possible metadata keys you can use.
          </span>
        </p>
        <p className="ml-6">
          <strong>Required:</strong> sample_alias | <strong>Recommended:</strong> latitude, longitude, environment_biome, collection_date
        </p>
      </div>
    </div>
  );
}
