'use client';

import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { useBgcTable } from './bgc-table-context';
import { ExportMenu } from '@/components/ui/export-menu';
import { handleDownload } from './bgc-table-utils';
import type { BgcListItem } from './bgc-table-types';

interface BgcTableFiltersProps {
  bgcs: BgcListItem[];
  total: number;
  /** The streamed export of the table's query (bgcExportPath). */
  exportPath: string;
}

export function BgcTableFilters({ bgcs, total, exportPath }: BgcTableFiltersProps) {
  const {
    filters,
    setFilters,
    currentPage,
    config,
    setCurrentPage,
  } = useBgcTable();

  const handleSearchChange = (value: string) => {
    setFilters({ searchTerm: value });
  };

  const handleClassFilterChange = (value: string) => {
    setFilters({ typeFilter: value === 'all' ? '' : value });
    setCurrentPage(0);
  };

  const handleClearFilters = () => {
    setFilters({
      searchTerm: '',
      typeFilter: '',
    });
    setCurrentPage(0);
  };

  return (
    <Card className="mb-8">
      <CardContent className="p-6">
        <div className="space-y-4">
          {config.showGlobalSearch && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search BGCs by contig, sample, category or product..."
                className="pl-9"
                value={filters.searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
          )}

          {config.showProductClassFilter && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="classFilter" className="text-xs">
                  Category
                </Label>
                <Select
                  value={filters.typeFilter || 'all'}
                  onValueChange={handleClassFilterChange}
                >
                  <SelectTrigger id="classFilter">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    <SelectItem value="NRPS">NRPS</SelectItem>
                    <SelectItem value="PKS">PKS</SelectItem>
                    <SelectItem value="RiPP">RiPP</SelectItem>
                    <SelectItem value="terpene">Terpene</SelectItem>
                    <SelectItem value="saccharide">Saccharide</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearFilters}
            >
              Clear Filters
            </Button>
            {config.showExportButtons && (
              // Embedded on family and sample pages, "All matching" is every member BGC.
              <ExportMenu
                pageRows={bgcs.length}
                onPageExport={(format) => handleDownload(format, bgcs, currentPage)}
                total={total}
                exportPath={exportPath}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
