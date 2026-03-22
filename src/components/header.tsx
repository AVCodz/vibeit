"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { HiBars3, HiXMark, HiFolderOpen } from "react-icons/hi2";
import { signOut, useSession } from "@/lib/auth-client";

const navLinks = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faqs", label: "FAQs" },
];

export function Header() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { data: session, isPending } = useSession();

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
          {isPending ? null : session ? (
            <details className="relative">
              <summary className="list-none cursor-pointer rounded-md border border-border/60 bg-secondary px-2 py-1 text-sm text-foreground">
                <span className="flex items-center gap-2">
                  {session.user.image ? (
                    <Image
                      src={session.user.image}
                      alt={session.user.name ?? "User avatar"}
                      width={24}
                      height={24}
                      className="size-6 rounded-md border border-border/60 bg-secondary object-cover"
                    />
                  ) : (
                    <span className="flex size-6 items-center justify-center rounded-md border border-border/60 bg-secondary bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
                      {(session.user.name ?? session.user.email ?? "U").charAt(0)}
                    </span>
                  )}
                  <span className="max-w-32 truncate">{session.user.name ?? session.user.email}</span>
                </span>
              </summary>
              <div className="absolute right-0 mt-2 w-52 rounded-md border border-border/60 bg-secondary bg-card p-2 shadow-xl">
                <div className="mb-1 flex items-center gap-2 px-2 py-1">
                  {session.user.image ? (
                    <Image
                      src={session.user.image}
                      alt={session.user.name ?? "User avatar"}
                      width={28}
                      height={28}
                      className="size-7 rounded-md border border-border/60 bg-secondary object-cover"
                    />
                  ) : (
                    <span className="flex size-7 items-center justify-center rounded-md border border-border/60 bg-secondary bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
                      {(session.user.name ?? session.user.email ?? "U").charAt(0)}
                    </span>
                  )}
                  <p className="max-w-[140px] truncate text-xs text-muted-foreground">
                    {session.user.name ?? "VibeIt user"}
                  </p>
                </div>
                <p className="truncate px-2 py-1 text-xs text-muted-foreground">
                  {session.user.email}
                </p>
                <Link
                  href="/projects"
                  className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <HiFolderOpen className="size-4 text-muted-foreground" />
                  Projects
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full justify-start"
                  onClick={() => signOut()}
                >
                  Sign out
                </Button>
              </div>
            </details>
          ) : (
            <Button size="sm" asChild>
              <Link href="/auth">Get started</Link>
            </Button>
          )}
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
              {isPending ? null : session ? (
                <>
                  <div className="flex items-center gap-2 rounded-md border border-border/60 bg-secondary px-3 py-2">
                    {session.user.image ? (
                      <Image
                        src={session.user.image}
                        alt={session.user.name ?? "User avatar"}
                        width={24}
                        height={24}
                        className="size-6 rounded-md border border-border/60 bg-secondary object-cover"
                      />
                    ) : (
                      <span className="flex size-6 items-center justify-center rounded-md border border-border/60 bg-secondary bg-muted text-[10px] font-semibold uppercase text-muted-foreground">
                        {(session.user.name ?? session.user.email ?? "U").charAt(0)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs text-foreground">{session.user.name ?? "VibeIt user"}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{session.user.email}</p>
                    </div>
                  </div>
                  <Link
                    href="/projects"
                    onClick={closeMobileMenu}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <HiFolderOpen className="size-4 text-muted-foreground" />
                    Projects
                  </Link>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      signOut();
                      closeMobileMenu();
                    }}
                  >
                    Sign out
                  </Button>
                </>
              ) : (
                <Button className="w-full" asChild>
                  <Link href="/auth" onClick={closeMobileMenu}>
                    Get started
                  </Link>
                </Button>
              )}
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}
