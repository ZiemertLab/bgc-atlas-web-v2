"use client";

import { useCallback, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface FileDropZoneProps {
  /** Should run the same validation the file picker does. */
  onFiles: (files: File[]) => void;
  single?: boolean;
  disabled?: boolean;
  className?: string;
  activeClassName?: string;
  children: React.ReactNode;
}

// Every handler calls preventDefault, or the browser navigates to the dropped file.
// enter/leave also fire for descendants, so a counter tracks depth.
export function FileDropZone({
  onFiles,
  single,
  disabled,
  className,
  activeClassName = 'border-brand bg-brand/5',
  children,
}: FileDropZoneProps) {
  const [isOver, setIsOver] = useState(false);
  const depth = useRef(0);

  const reset = useCallback(() => {
    depth.current = 0;
    setIsOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      reset();
      if (disabled) return;

      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      onFiles(single ? files.slice(0, 1) : files);
    },
    [disabled, onFiles, reset, single]
  );

  return (
    <div
      className={cn(className, isOver && !disabled && activeClassName)}
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        if (!disabled) setIsOver(true);
      }}
      onDragOver={(event) => {
        // dragover must be cancelled on every event, or the drop is refused.
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) reset();
      }}
      onDrop={handleDrop}
      data-drag-over={isOver ? '' : undefined}
    >
      {children}
    </div>
  );
}
