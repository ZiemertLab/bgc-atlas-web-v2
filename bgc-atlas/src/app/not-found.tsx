import { MainLayout } from '@/components/layout/main-layout';
import { DestinationsStrip } from '@/components/layout/destinations-strip';

// Site-wide 404, also reached by notFound() calls with no nearer boundary. A server
// component so the page prerenders; only the counts need the client.
export default function NotFound() {
  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[600px] py-16 text-center md:py-24">
        <div className="font-mono text-7xl font-semibold tracking-tight tabular-nums md:text-8xl">
          404
        </div>
        <h1 className="mt-3 text-xl font-semibold tracking-tight md:text-2xl">
          Page not found
        </h1>
        <DestinationsStrip />
      </div>
    </MainLayout>
  );
}
