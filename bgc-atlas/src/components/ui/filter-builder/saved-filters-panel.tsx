'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bookmark, Copy, Share2, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { FilterFieldDefinition, FilterGroup } from '@/lib/filters/types';
import type { FilterRecipe } from '@/lib/filters/recipes';
import { cloneGroup, type SavedFilter } from './helpers';

interface SavedFiltersPanelProps {
  fields: FilterFieldDefinition[];
  value: FilterGroup;
  hasRules: boolean;
  serializedFilters: string | null;
  recipes?: FilterRecipe[];
  storageKey: string;
  onChange: (group: FilterGroup) => void;
  /** Off where the page owns the link (Property Search reads ?props, not ?advancedFilters). */
  showShare?: boolean;
}

export function SavedFiltersPanel({
  fields,
  value,
  hasRules,
  serializedFilters,
  recipes,
  storageKey,
  onChange,
  showShare = true,
}: SavedFiltersPanelProps) {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [saveName, setSaveName] = useState('');
  const [shareCopied, setShareCopied] = useState(false);

  const hydrateSavedFilters = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setSavedFilters([]);
        return;
      }
      setSavedFilters(JSON.parse(raw));
    } catch {
      setSavedFilters([]);
    }
  }, [storageKey]);

  useEffect(() => {
    hydrateSavedFilters();
  }, [hydrateSavedFilters]);

  const persistSavedFilters = (next: SavedFilter[]) => {
    setSavedFilters(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    }
  };

  const handleSaveCurrent = () => {
    if (!saveName.trim() || !hasRules) return;
    const entry: SavedFilter = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
      name: saveName.trim(),
      createdAt: new Date().toISOString(),
      group: cloneGroup(value),
    };
    persistSavedFilters([...savedFilters, entry]);
    setSaveName('');
  };

  const handleShare = async () => {
    if (!serializedFilters) return;
    const shareTarget = (() => {
      if (typeof window === 'undefined') {
        return `advancedFilters=${serializedFilters}`;
      }
      const url = new URL(window.location.href);
      url.searchParams.set('advancedFilters', serializedFilters);
      return url.toString();
    })();

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareTarget);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      } else {
        throw new Error('Clipboard unavailable');
      }
    } catch {
      if (typeof window !== 'undefined') {
        window.prompt('Copy this filter link', shareTarget);
      }
    }
  };

  const removeSavedFilter = (id: string) => {
    persistSavedFilters(savedFilters.filter((saved) => saved.id !== id));
  };

  const applySavedFilter = (saved: SavedFilter) => {
    onChange(cloneGroup(saved.group));
  };

  const applyRecipe = (recipe: FilterRecipe) => {
    onChange(recipe.build(fields));
  };

  const hasRecipes = Boolean(recipes?.length);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-wrap gap-2">
        {hasRecipes && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Sparkles className="mr-2 h-4 w-4" />
                Load recipe
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72">
              <DropdownMenuLabel>Suggested recipes</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {recipes!.map((recipe) => (
                <DropdownMenuItem
                  key={recipe.id}
                  className="flex flex-col items-start gap-1"
                  onSelect={(event) => {
                    event.preventDefault();
                    applyRecipe(recipe);
                  }}
                >
                  <span className="text-sm font-medium">{recipe.name}</span>
                  <span className="text-xs text-muted-foreground">{recipe.description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Bookmark className="mr-2 h-4 w-4" />
              Saved filters ({savedFilters.length})
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72">
            <DropdownMenuLabel>Saved filters</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {savedFilters.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No saved filters yet. Create one with the form on the right.
              </div>
            ) : (
              savedFilters.map((saved) => (
                <DropdownMenuItem
                  key={saved.id}
                  className="flex items-center justify-between gap-2"
                  onSelect={(event) => {
                    event.preventDefault();
                    applySavedFilter(saved);
                  }}
                >
                  <div>
                    <div className="text-sm font-medium">{saved.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(saved.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-destructive transition hover:text-destructive/80"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      removeSavedFilter(saved.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-2">
        <Input
          className="h-8 w-full flex-1 min-w-[180px] text-xs"
          placeholder="Name this filter preset"
          value={saveName}
          onChange={(event) => setSaveName(event.target.value)}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSaveCurrent}
          disabled={!saveName.trim() || !hasRules}
        >
          Save
        </Button>
        {showShare && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            disabled={!serializedFilters}
          >
            {shareCopied ? (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Share2 className="mr-2 h-4 w-4" />
                Share link
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
