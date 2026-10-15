import Link from 'next/link';

interface StatRowProps {
  label: string;
  value: string;
  id?: string;
  /** Status colour for the figure (e.g. a MIMAG band); plain ink otherwise. */
  valueClassName?: string;
  /** Hover text explaining the figure, e.g. which threshold it meets. */
  title?: string;
}

/** Belongs inside a `<dl>`. */
export function StatRow({ label, value, id, valueClassName, title }: StatRowProps) {
  return (
    <div id={id} className="leader-row">
      <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
      <span className="leader-dots" aria-hidden />
      <dd
        className={`font-mono font-medium tabular-nums ${valueClassName ?? 'text-foreground'}`}
        title={title}
      >
        {value}
        {title ? <span className="sr-only"> ({title})</span> : null}
      </dd>
    </div>
  );
}

interface StatLinkRowProps extends Omit<StatRowProps, 'id' | 'valueClassName' | 'title'> {
  href: string;
}

// Not a StatRow variant: a `<dl>` may not contain an anchor, so these sit in a `<ul>`.
export function StatLinkRow({ label, value, href }: StatLinkRowProps) {
  return (
    <li>
      <Link
        href={href}
        className="leader-row group rounded-sm py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span className="whitespace-nowrap text-muted-foreground underline-offset-4 group-hover:text-foreground group-hover:underline">
          {label}
        </span>
        <span className="leader-dots" aria-hidden />
        <span className="font-mono font-medium tabular-nums text-foreground">
          {value}
        </span>
      </Link>
    </li>
  );
}
