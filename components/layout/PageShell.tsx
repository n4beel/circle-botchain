"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "@/components/ui/ConnectButton";
import NetworkBadge from "@/components/botchain/NetworkBadge";
import BuiltOnBotChain from "@/components/botchain/BuiltOnBotChain";
import { app } from "@/lib/app-config";
import { footerLinks } from "@/lib/botchain/chain";

export interface OrbitNavLink {
  href: string;
  label: string;
}

export interface PageShellProps {
  children: React.ReactNode;
  nav?: OrbitNavLink[];
  title?: string;
  description?: string;
}

/**
 * Archetype Q · Orbit App Shell.
 *
 * Implements a minimal, serene planetary environment:
 * - Wordmark top-left with orbit halo glyph
 * - Clean connect & network status top-right
 * - No heavy full-width banner bars
 * - Centered celestial layout focused on the central ring
 * - Quiet footer attribution anchored beneath the main ring
 */
export default function PageShell({
  children,
  nav = [],
  title,
  description,
}: PageShellProps) {
  const pathname = usePathname();
  const { site, explorer } = footerLinks();

  return (
    <div
      className="flex min-h-[100dvh] flex-col overflow-x-hidden selection:bg-[var(--accent)] selection:text-[var(--accent-ink)]"
      style={{
        backgroundColor: "var(--bg-base, #2D3A1F)",
        color: "var(--text-primary, #EEF2DD)",
        fontFamily: "var(--font-onest), system-ui, sans-serif",
      }}
    >
      {/* Floating minimalist header */}
      <header className="relative z-20 w-full px-5 py-4 sm:px-8 sm:py-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="group flex items-center gap-3 no-underline transition-opacity hover:opacity-90"
            >
              {/* Pulsing orbit halo mark */}
              <div
                className="relative flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-default)]"
                style={{ backgroundColor: "var(--bg-surface)" }}
                aria-hidden="true"
              >
                <div
                  className="h-2.5 w-2.5 rounded-full transition-transform duration-300 group-hover:scale-125"
                  style={{ backgroundColor: "var(--accent)" }}
                />
              </div>
              <span
                className="text-2xl font-serif tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {app.name}
              </span>
            </Link>

            {nav.length > 0 && (
              <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary navigation">
                {nav.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`rounded-full px-3.5 py-1 text-xs font-medium tracking-wide transition-colors ${
                        isActive
                          ? "bg-[var(--bg-surface)] text-[var(--accent)] border border-[var(--border-subtle)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <NetworkBadge />
            <div className="w-[140px] sm:w-[170px] flex-shrink-0">
              <ConnectButton />
            </div>
          </div>
        </div>

        {/* Mobile secondary nav links if present */}
        {nav.length > 0 && (
          <div className="mx-auto mt-3 flex max-w-5xl items-center gap-2 overflow-x-auto pb-1 sm:hidden">
            {nav.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-3 py-1 text-xs whitespace-nowrap ${
                    isActive
                      ? "bg-[var(--bg-surface)] text-[var(--accent)] border border-[var(--border-subtle)]"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </header>

      {/* Main Celestial Body Area */}
      <main className="relative z-10 flex flex-1 flex-col mx-auto w-full max-w-5xl px-4 py-4 sm:px-8 sm:py-6">
        {(title || description) && (
          <div className="mb-6 text-center sm:mb-8">
            {title && (
              <h1
                className="text-3xl font-serif tracking-tight sm:text-4xl"
                style={{ color: "var(--text-primary)" }}
              >
                {title}
              </h1>
            )}
            {description && (
              <p
                className="mt-2 text-sm text-[var(--text-muted)] sm:text-base max-w-xl mx-auto leading-relaxed"
              >
                {description}
              </p>
            )}
          </div>
        )}
        <div className="flex-1 w-full">{children}</div>
      </main>

      {/* Quiet Orbit Footnote */}
      <footer className="relative z-10 w-full px-5 py-6 sm:px-8 text-center text-xs">
        <div className="mx-auto max-w-5xl border-t border-[var(--border-subtle)] pt-6">
          <p className="text-[var(--text-muted)] mb-3">
            {app.tagline} • Rotating savings with people you trust.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[var(--text-tertiary)]">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "var(--accent)" }}
                aria-hidden="true"
              />
              <BuiltOnBotChain className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]" />
            </span>
            <a
              href={site}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors underline underline-offset-2"
            >
              botchain.ai
            </a>
            <a
              href={explorer}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors underline underline-offset-2"
            >
              BOT Chain Explorer
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
