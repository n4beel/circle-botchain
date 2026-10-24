"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatEther, type Address } from "viem";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { circleAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import { shortAddress } from "@/lib/errors";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";

export default function CircleList() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const deployment = isBotChainId(chainId) ? getDeployment(chainId) : undefined;
  const [lookupId, setLookupId] = useState("");

  const { data: circlesRaw, isLoading } = useReadContract({
    address: deployment?.address as Address,
    abi: circleAbi,
    functionName: "circlesFor",
    args: address ? [address, 0n, 50n] : undefined,
    query: { enabled: Boolean(deployment?.address && address) }
  });

  const circles = (circlesRaw ?? []) as any[];

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const id = lookupId.trim();
    if (id && /^\d+$/.test(id)) {
      router.push(`/c/${id}`);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Top Action & Lookup Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
        <div>
          <h2 className="text-xl font-serif text-[var(--text-primary)]">
            Rotating Savings Circles
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Build wealth with people you trust. Each round pays one member in turn.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={handleLookup} className="flex items-center gap-1.5">
            <input
              type="text"
              value={lookupId}
              onChange={(e) => setLookupId(e.target.value)}
              placeholder="Find Circle ID…"
              className="w-32 sm:w-40 px-3 py-1.5 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)]"
            />
            <Button variant="secondary" size="compact" type="submit">
              Go
            </Button>
          </form>

          <Link href="/new">
            <Button variant="primary" size="compact">
              + Start a Circle
            </Button>
          </Link>
        </div>
      </div>

      {/* Your Circles Section */}
      <div>
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 mb-4">
          <h3 className="text-sm font-serif uppercase tracking-wider text-[var(--text-primary)]">
            Your Circles ({circles.length})
          </h3>
          <span className="text-xs text-[var(--text-muted)]">
            {isConnected ? `Connected: ${shortAddress(address)}` : "Connect wallet to view your circles"}
          </span>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            <div className="inline-block w-6 h-6 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin mb-2" />
            <p>Scanning ledger for your circles…</p>
          </div>
        ) : !isConnected ? (
          <Panel variant="plate" className="text-center py-12 px-6 space-y-3">
            <div className="w-10 h-10 mx-auto rounded-full bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex items-center justify-center text-sm font-serif text-[var(--accent)]">
              ◎
            </div>
            <h4 className="text-base font-serif text-[var(--text-primary)]">
              Connect Wallet
            </h4>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
              Connect your wallet to inspect your savings circles, payment turns, and pending pot withdrawals. Or enter an ID above to view any circle.
            </p>
          </Panel>
        ) : circles.length === 0 ? (
          <Panel variant="plate" className="text-center py-12 px-6 space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex items-center justify-center text-xl text-[var(--accent)]">
              ◎
            </div>
            <h4 className="text-lg font-serif text-[var(--text-primary)]">
              No Active Circles Found
            </h4>
            <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
              You haven&apos;t joined any savings circles yet. Form a new circle with 3 to 12 trusted friends, or search for a circle ID shared with you.
            </p>
            <div className="pt-2">
              <Link href="/new">
                <Button variant="primary" size="regular">
                  Start Your First Circle
                </Button>
              </Link>
            </div>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {circles.map((c) => {
              const stateNum = Number(c.state);
              const potEth = formatEther(c.pot);
              const contribEth = formatEther(c.contribution);

              return (
                <Link
                  key={c.id.toString()}
                  href={`/c/${c.id.toString()}`}
                  className="block group"
                >
                  <Panel
                    variant="ringCard"
                    className="p-5 h-full space-y-4 transition-transform group-hover:-translate-y-1"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-mono text-[var(--text-muted)] block">
                          CIRCLE #{c.id.toString()}
                        </span>
                        <h4 className="text-base font-serif text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                          {c.memberCount} Members
                        </h4>
                      </div>

                      {/* State Chip */}
                      <div>
                        {stateNum === 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--warn)]/20 text-[var(--warn)] text-[10px] font-semibold">
                            Forming ({c.joinedCount}/{c.memberCount})
                          </span>
                        )}
                        {stateNum === 1 && (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-semibold">
                            Round {c.round + 1}
                          </span>
                        )}
                        {stateNum === 2 && (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] text-[10px] font-bold">
                            Completed
                          </span>
                        )}
                        {stateNum === 3 && (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--fail)]/20 text-[var(--fail)] text-[10px] font-semibold">
                            Failed
                          </span>
                        )}
                        {stateNum === 4 && (
                          <span className="px-2 py-0.5 rounded-full bg-stone-800 text-[var(--text-muted)] text-[10px] font-semibold">
                            Cancelled
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Figure line */}
                    <div className="p-3 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex items-center justify-between text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-[var(--text-tertiary)] block">POT</span>
                        <span className="text-[var(--accent)] font-bold">{potEth} BOT</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-[var(--text-tertiary)] block">PER ROUND</span>
                        <span className="text-[var(--text-primary)]">{contribEth} BOT</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] pt-1">
                      <span>Creator: {shortAddress(c.creator)}</span>
                      <span className="text-[var(--accent)] group-hover:translate-x-1 transition-transform">
                        View Track →
                      </span>
                    </div>
                  </Panel>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Trust Reminder Footnote */}
      <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-muted)] flex items-start gap-2.5">
        <span className="text-[var(--warn)] font-bold text-sm">⚠</span>
        <p className="leading-relaxed">
          <strong>No-collateral mechanism:</strong> Rotating savings rely on trust between participants. Once a pot is disbursed, earlier rounds cannot be clawed back if someone stops contributing. Always verify participants before joining.
        </p>
      </div>
    </div>
  );
}
