import Link from "next/link";
import PageShell from "@/components/layout/PageShell";

export default function NotFound() {
  return (
    <PageShell
      title="404 - Orbit Not Found"
      description="The savings circle or route you requested could not be found in this orbital plane."
    >
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center space-y-4">
        <div className="text-4xl font-serif text-[var(--accent)]">404</div>
        <p className="text-sm text-[var(--text-muted)]">
          The requested circle or page does not exist. Check the circle ID or return to the active circles.
        </p>
        <div>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] px-5 py-2 text-sm font-medium text-[var(--accent-ink)] hover:opacity-90 transition"
          >
            Back to Circles
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
