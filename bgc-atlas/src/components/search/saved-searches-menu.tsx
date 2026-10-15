'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cloneGroup, type SavedFilter } from '@/components/ui/filter-builder/helpers';
import type { FilterGroup } from '@/lib/filters/types';

interface SavedSearchesMenuProps {
  /** Same key as the old builder, so previously saved filters still load. */
  storageKey: string;
  current: FilterGroup | null;
  onLoad: (group: FilterGroup) => void;
}

export function SavedSearchesMenu({ storageKey, current, onLoad }: SavedSearchesMenuProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      setSaved(raw ? JSON.parse(raw) : []);
    } catch {
      setSaved([]);
    }
  }, [storageKey, open]);

  const persist = (next: SavedFilter[]) => {
    setSaved(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage full or off */ }
  };

  const save = () => {
    if (!name.trim() || !current) return;
    persist([...saved, {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      name: name.trim(),
      createdAt: new Date().toISOString(),
      group: cloneGroup(current),
    }]);
    setName('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Saved{saved.length ? ` (${saved.length.toLocaleString()})` : ''}
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {saved.length > 0 ? (
          <ul className="max-h-64 overflow-y-auto py-1">
            {saved.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 px-1">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => { onLoad(cloneGroup(entry.group)); setOpen(false); }}
                >
                  {entry.name}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${entry.name}`}
                  onClick={() => persist(saved.filter((s) => s.id !== entry.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">No saved filters yet.</p>
        )}
        <form
          className="flex gap-2 border-t p-2"
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this filter"
            className="h-8 text-xs"
            aria-label="Name for the saved filter"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!name.trim() || !current}>Save</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
