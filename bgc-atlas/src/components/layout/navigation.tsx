'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { withBase } from '@/lib/basePath';
import { Button } from '@/components/ui/button';
import { Menu, X } from 'lucide-react';

type NavItem = { title: string; href: string };

const navigationItems: NavItem[] = [
  { title: 'Metagenomes', href: '/samples' },
  { title: 'Genome Collections', href: '/genome-collections' },
  { title: 'BGCs', href: '/bgcs' },
  { title: 'GCFs', href: '/gcfs' },
  { title: 'Studies', href: '/studies' },
  { title: 'Search', href: '/search' },
  { title: 'Downloads', href: '/downloads' },
  { title: 'Contribute', href: '/contribute' },
  { title: 'About', href: '/about' },
];

function isItemActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function Navigation() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-[1100] w-full border-b border-zinc-900 bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[2100px] flex h-14 items-center px-4 lg:px-8 xl:px-12 2xl:px-16">
        <Link
          href="/"
          className="group mr-6 flex shrink-0 items-center"
        >
          {/* The dark-background horizontal lockup: mark, name and the v2
              badge in one file (docs/brand/v2/family). */}
          <Image
            src={withBase("/bgc-atlas-horizontal-dark.svg")}
            alt="BGC Atlas"
            width={145}
            height={40}
            className="h-10 w-auto"
            priority
            unoptimized
          />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-0 overflow-x-auto md:flex">
          {mounted &&
            navigationItems.map((item) => {
              const active = isItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'relative inline-flex h-14 items-center whitespace-nowrap px-2.5 text-[13px] transition-colors',
                    active
                      ? 'font-medium text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-100'
                  )}
                >
                  {item.title}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-2.5 bottom-0 h-0.5 bg-brand"
                    />
                  )}
                </Link>
              );
            })}
        </nav>

        <div className="ml-auto flex items-center md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            className="text-zinc-100 hover:bg-white/10 hover:text-zinc-100"
          >
            {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-zinc-900 bg-zinc-950 md:hidden">
          <div className="mx-auto w-full max-w-[2100px] px-4 py-3">
            <nav className="grid">
              {mounted &&
                navigationItems.map((item) => {
                  const active = isItemActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        'flex items-center border-b border-zinc-900 px-1 py-2.5 text-sm transition-colors last:border-b-0',
                        active
                          ? 'font-medium text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-100'
                      )}
                    >
                      {item.title}
                    </Link>
                  );
                })}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
