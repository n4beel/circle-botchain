"use client";

import React, { useState } from "react";
import { formatEther, type Address } from "viem";
import { ringLayout, arcPath, type CircleDetails, type NodeState } from "@/lib/circle";
import { shortAddress } from "@/lib/errors";

interface CircleRingVisualProps {
  details: CircleDetails;
  connectedAddress?: Address;
  onSelectNode?: (node: NodeState) => void;
}

/**
 * Interactive SVG Planetary Orbit Ring.
 *
 * Renders members as nodes positioned evenly around a central circular track.
 * Features:
 * - Current round recipient halo
 * - Progress arc tracking round completion
 * - Distinct visual glyphs for node states (not-joined, joined, paid, received, defaulted)
 * - Pot display in Young Serif with live round indicator
 * - Touch-friendly and accessible with screen-reader member catalog
 */
export default function CircleRingVisual({
  details,
  connectedAddress,
  onSelectNode,
}: CircleRingVisualProps) {
  const { view, nodeStates } = details;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const size = 360;
  const center = size / 2;
  const radius = 130;

  const points = ringLayout(view.memberCount, radius, { x: center, y: center });
  const progressPath = arcPath(view.round, view.memberCount, radius, { x: center, y: center });

  const activeNode = hoveredIndex !== null ? nodeStates[hoveredIndex] : null;

  return (
    <div className="flex flex-col items-center w-full max-w-[420px] mx-auto select-none">
      {/* Central SVG Orbit Canvas */}
      <div className="relative w-full aspect-square max-w-[380px] flex items-center justify-center">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full h-full overflow-visible"
          aria-label={`Circle with ${view.memberCount} members, pot of ${formatEther(view.pot)} BOT`}
        >
          {/* Background orbit track ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--border-subtle, #4B5E36)"
            strokeWidth="2"
            strokeDasharray={view.state === 0 ? "4 4" : undefined}
          />

          {/* Active round progress arc */}
          {progressPath && (
            <path
              d={progressPath}
              fill="none"
              stroke="var(--accent, #D9E86B)"
              strokeWidth="4"
              strokeLinecap="round"
              className="orbit-glow transition-all duration-500"
            />
          )}

          {/* Member Nodes */}
          {nodeStates.map((node, i) => {
            const pt = points[i];
            if (!pt) return null;

            const isRecipient = node.isRecipient;
            const isHovered = hoveredIndex === i;
            const isSelf = connectedAddress && node.address.toLowerCase() === connectedAddress.toLowerCase();

            let nodeFill = "var(--bg-surface, #384929)";
            let nodeStroke = "var(--border-default, #5A7042)";
            let strokeWidth = 2;
            let strokeDash: string | undefined = undefined;

            if (node.status === "not_joined") {
              nodeFill = "var(--bg-base, #2D3A1F)";
              nodeStroke = "var(--text-tertiary, #8A9670)";
              strokeDash = "3 3";
            } else if (node.status === "joined") {
              nodeFill = "var(--bg-surface, #384929)";
              nodeStroke = "var(--border-strong, #728A55)";
            } else if (node.status === "paid_this_round") {
              nodeFill = "var(--accent, #D9E86B)";
              nodeStroke = "var(--accent-ink, #1B2511)";
            } else if (node.status === "received") {
              nodeFill = "var(--bg-elevated, #425631)";
              nodeStroke = "var(--accent, #D9E86B)";
            } else if (node.status === "defaulted") {
              nodeFill = "color-mix(in srgb, var(--fail, #E57373) 25%, var(--bg-surface))";
              nodeStroke = "var(--fail, #E57373)";
            }

            const nodeRadius = isRecipient ? 14 : 11;

            return (
              <g
                key={node.address + i}
                className="cursor-pointer transition-transform duration-150"
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => onSelectNode?.(node)}
                tabIndex={0}
                role="button"
                aria-label={`Member ${i + 1}: ${shortAddress(node.address)}, ${node.status}`}
              >
                {/* Halo for current round recipient */}
                {isRecipient && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={22}
                    fill="none"
                    stroke="var(--accent, #D9E86B)"
                    strokeWidth="1.5"
                    strokeOpacity="0.6"
                    className="orbit-halo-active"
                  />
                )}

                {/* Focus or hover ring */}
                {isHovered && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={nodeRadius + 6}
                    fill="none"
                    stroke="var(--text-primary)"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                  />
                )}

                {/* Base Node Circle */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={nodeRadius}
                  fill={nodeFill}
                  stroke={nodeStroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={strokeDash}
                  className="transition-all duration-200"
                />

                {/* Inner dot for paid this round or self */}
                {node.paid && view.state === 1 && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={4}
                    fill="var(--accent-ink, #1B2511)"
                  />
                )}

                {/* Received check indicator glyph */}
                {node.received && (
                  <path
                    d={`M ${pt.x - 3} ${pt.y} L ${pt.x - 1} ${pt.y + 3} L ${pt.x + 4} ${pt.y - 2}`}
                    fill="none"
                    stroke="var(--accent, #D9E86B)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}

                {/* Struck bar for defaulters */}
                {node.defaulted && (
                  <line
                    x1={pt.x - 6}
                    y1={pt.y - 6}
                    x2={pt.x + 6}
                    y2={pt.y + 6}
                    stroke="var(--fail, #E57373)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                )}

                {/* Member sequence number label outside node */}
                <text
                  x={pt.x}
                  y={pt.y + (pt.y > center ? 24 : -18)}
                  textAnchor="middle"
                  className="text-[10px] font-mono select-none"
                  fill={isSelf ? "var(--accent)" : "var(--text-muted)"}
                  fontWeight={isSelf ? "bold" : "normal"}
                >
                  {isSelf ? "YOU" : `#${i + 1}`}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Center Pot & Round Display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-6">
          <span className="text-xs uppercase tracking-widest text-[var(--text-muted)] font-medium">
            Total Pot
          </span>
          <span className="text-3xl sm:text-4xl font-serif tracking-tight text-[var(--accent)] mt-0.5">
            {formatEther(view.pot)} <span className="text-xl sm:text-2xl font-serif text-[var(--text-primary)]">BOT</span>
          </span>
          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)]">
            {view.state === 0 && (
              <span className="text-[var(--warn)]">Forming • {view.joinedCount}/{view.memberCount} joined</span>
            )}
            {view.state === 1 && (
              <span>Round {view.round + 1} of {view.memberCount}</span>
            )}
            {view.state === 2 && (
              <span className="text-[var(--accent)]">Completed</span>
            )}
            {view.state === 3 && (
              <span className="text-[var(--fail)]">Failed</span>
            )}
            {view.state === 4 && (
              <span className="text-[var(--text-muted)]">Cancelled</span>
            )}
          </div>
        </div>
      </div>

      {/* Node Detail Callout (appears on hover or selection) */}
      <div className="w-full mt-3 min-h-[50px] text-center px-4 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
        {activeNode ? (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-[var(--text-primary)]">
              Turn #{activeNode.index + 1}:
            </span>
            <span className="font-mono text-[var(--text-muted)]">
              {shortAddress(activeNode.address)}
            </span>
            <span className="text-[var(--accent)]">
              {activeNode.status === "paid_this_round" && "✓ Paid this round"}
              {activeNode.status === "not_joined" && "○ Not yet joined"}
              {activeNode.status === "joined" && "Waiting for turn"}
              {activeNode.status === "received" && "★ Received pot"}
              {activeNode.status === "defaulted" && "✗ Defaulted"}
            </span>
            {activeNode.isRecipient && (
              <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-[10px]">
                Current Recipient
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            Hover or tap any member node on the orbit track to inspect payout turns
          </p>
        )}
      </div>

      {/* Screen Reader Member List */}
      <section className="sr-only" aria-label="Member payout sequence">
        <ol>
          {nodeStates.map((node, i) => (
            <li key={node.address}>
              Turn {i + 1}: {node.address}. Status: {node.status}.
              {node.isRecipient && " Current recipient."}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
