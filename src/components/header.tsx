"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { HiBars3, HiXMark } from "react-icons/hi2";

const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faqs", label: "FAQs" },
];

export function Header() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="text-lg flex items-center font-bold tracking-tight"
          onClick={closeMobileMenu}
        >
          <Image src="/logo.png" alt="VibeIt" width={30} height={30} />
          VibeIt
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm font-medium transition-colors hover:text-foreground",
                pathname === link.href
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button size="sm" asChild>
            <Link href="/auth">Register</Link>
          </Button>
        </div>

        <div className="md:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label="Open sidebar menu"
            onClick={() => setIsMobileMenuOpen(true)}
          >
            <HiBars3 className="size-5" />
          </Button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden">
          <button
            type="button"
            aria-label="Close sidebar menu"
            className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
            onClick={closeMobileMenu}
          />
          <aside className="fixed right-0 top-0 z-50 flex h-dvh w-72 flex-col border-l border-border bg-background p-5 shadow-2xl">
            <div className="mb-8 flex items-center justify-between">
              <span className="text-sm font-semibold text-muted-foreground">
                Menu
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label="Close sidebar menu"
                onClick={closeMobileMenu}
              >
                <HiXMark className="size-5" />
              </Button>
            </div>

            <nav className="flex flex-col gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMobileMenu}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
                    pathname === link.href
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="mt-auto space-y-2">
              <Button className="w-full" asChild>
                <Link href="/auth" onClick={closeMobileMenu}>
                  Register
                </Link>
              </Button>
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}
