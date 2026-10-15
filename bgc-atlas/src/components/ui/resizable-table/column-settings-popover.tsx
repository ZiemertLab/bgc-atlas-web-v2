'use client';

import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import type { TableColumn } from './types';

interface ColumnSettingsPopoverProps {
  columns: TableColumn<unknown>[];
  onVisibilityChange?: (columnId: string, visible: boolean) => void;
}

export function ColumnSettingsPopover({
  columns,
  onVisibilityChange,
}: ColumnSettingsPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4 mr-2" />
          Columns
        </Button>
      </PopoverTrigger>
      {/* Capped to the space Radix measures, and scrollable, so a long column list stays reachable. */}
      <PopoverContent className="w-80 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Column Visibility</h4>
            <p className="text-sm text-muted-foreground">
              Show or hide table columns
            </p>
          </div>
          <div className="grid gap-2">
            {columns.map((column) => (
              <div key={column.id} className="flex items-center space-x-2">
                <Switch
                  id={column.id}
                  checked={column.visible !== false}
                  onCheckedChange={(checked) => onVisibilityChange?.(column.id, checked)}
                />
                <Label htmlFor={column.id} className="text-sm">
                  {column.label}
                </Label>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
