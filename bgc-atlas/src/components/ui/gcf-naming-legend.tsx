import { GCF_NAME_EXAMPLES, TIER_EXPLAINER } from '@/lib/gcf-naming';

// Not components/ui/table.tsx: that is "use client" with row hover, which does not
// suit a static server-rendered legend.
export function GcfNamingLegend() {
  return (
    <div className="overflow-x-auto" tabIndex={0}>
      <table className="w-full text-sm">
        <caption className="sr-only">GCF naming legend</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="p-2 text-left font-medium text-muted-foreground">
              Example name
            </th>
            <th scope="col" className="p-2 text-left font-medium text-muted-foreground">
              Tier
            </th>
            <th scope="col" className="p-2 text-left font-medium text-muted-foreground">
              Alias
            </th>
          </tr>
        </thead>
        <tbody>
          {GCF_NAME_EXAMPLES.map((example) => (
            <tr key={example.name} className="border-b last:border-0">
              <td className="p-2 font-mono whitespace-nowrap">{example.name}</td>
              <td className="p-2 whitespace-nowrap">{example.tier}</td>
              <td className="p-2 font-mono whitespace-nowrap text-muted-foreground">
                {example.alias}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{TIER_EXPLAINER}</p>
    </div>
  );
}
