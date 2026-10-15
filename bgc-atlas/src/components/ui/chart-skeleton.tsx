import { cn } from '@/lib/utils';

interface ChartSkeletonProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function ChartSkeleton({
  width = '100%',
  height = 400,
  className
}: ChartSkeletonProps) {
  const widthStyle = typeof width === 'number' ? `${width}px` : width;
  const heightStyle = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg bg-muted/30',
        className
      )}
      style={{ width: widthStyle, height: heightStyle }}
      role="status"
      aria-label="Loading chart"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-muted/50 to-transparent animate-shimmer" />

      <div className="absolute inset-0 flex flex-col justify-end p-6 space-y-2">
        {[65, 85, 45, 75, 55, 90, 70].map((height, i) => (
          <div
            key={i}
            className="bg-muted/40 rounded-sm"
            style={{ height: `${height}%`, width: '100%' }}
          />
        ))}
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-background/80 backdrop-blur-sm rounded-lg px-4 py-2 text-sm text-muted-foreground">
          Loading chart...
        </div>
      </div>
    </div>
  );
}
