"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  parseEther,
  formatEther,
  type Address,
  type Hex,
  isAddress,
  getAddress,
  decodeEventLog
} from "viem";
import {
  useAccount,
  useChainId,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient
} from "wagmi";
import { circleAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import { validateCreate } from "@/lib/circle";
import { describeError } from "@/lib/errors";
import {
  MIN_MEMBERS,
  MAX_MEMBERS,
  MIN_INTERVAL,
  MAX_INTERVAL,
  MIN_JOIN_WINDOW,
  MAX_JOIN_WINDOW,
  MAX_NAME_BYTES
} from "@/lib/limits";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

type TxStage = "idle" | "simulating" | "signing" | "broadcasting" | "confirming" | "confirmed" | "error";

export default function CreateCircleForm() {
  const router = useRouter();
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const deployment = isBotChainId(chainId) ? getDeployment(chainId) : undefined;
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Form State
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>(["", "", ""]);
  const [contribution, setContribution] = useState("0.1");
  const [intervalDays, setIntervalDays] = useState("7");
  const [joinWindowSeconds, setJoinWindowSeconds] = useState("259200"); // 3 days
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);

  // Auto-populate connected address into first position if empty
  useEffect(() => {
    if (address && members.length > 0 && members[0] === "") {
      setMembers((prev) => [address, ...prev.slice(1)]);
    }
  }, [address]);

  // Tx flow state
  const [stage, setStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdCircleId, setCreatedCircleId] = useState<bigint | null>(null);

  // Wagmi hooks
  const { writeContractAsync } = useWriteContract();
  const {
    data: receipt,
    isLoading: isWaitingReceipt,
    isSuccess: isReceiptSuccess,
    isError: isReceiptError,
    error: receiptError
  } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  // Settled-ref pattern keyed by txHash
  const settledHashRef = useRef<Hex | null>(null);

  useEffect(() => {
    if (!txHash) return;
    if (settledHashRef.current === txHash) return;

    if (isReceiptSuccess && receipt) {
      settledHashRef.current = txHash;
      setStage("confirmed");

      // Extract created Circle ID from logs
      let parsedId: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const event = decodeEventLog({
            abi: circleAbi,
            data: log.data,
            topics: log.topics
          });
          if (event.eventName === "Created" && event.args?.id) {
            parsedId = event.args.id;
            break;
          }
        } catch {
          // Ignore logs from other contracts
        }
      }

      if (parsedId) {
        setCreatedCircleId(parsedId);
      }
      toast(
        "success",
        "Circle Created",
        `Your savings circle #${parsedId ? parsedId.toString() : ""} is ready.`
      );
    } else if (isReceiptError) {
      settledHashRef.current = txHash;
      setStage("error");
      setErrorMessage(describeError(receiptError));
    }
  }, [txHash, isReceiptSuccess, isReceiptError, receipt, receiptError, toast]);

  // Member manipulation helpers
  const handleAddMember = () => {
    if (members.length < MAX_MEMBERS) {
      setMembers([...members, ""]);
    }
  };

  const handleRemoveMember = (index: number) => {
    if (members.length > MIN_MEMBERS) {
      setMembers(members.filter((_, i) => i !== index));
    }
  };

  const handleMoveMember = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= members.length) return;
    const next = [...members];
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    setMembers(next);
  };

  const handleAddMe = () => {
    if (!address) return;
    if (!members.some((m) => m.toLowerCase() === address.toLowerCase())) {
      if (members.length < MAX_MEMBERS) {
        setMembers([address, ...members]);
      } else {
        const next = [...members];
        next[0] = address;
        setMembers(next);
      }
    }
  };

  // Validation
  const intervalSeconds = BigInt(Math.max(1, Number(intervalDays) || 1)) * 86400n;
  const joinWinSecs = BigInt(joinWindowSeconds);

  const validation = useMemo(() => {
    return validateCreate({
      members,
      contribution,
      interval: intervalSeconds,
      joinWindow: joinWinSecs,
      name,
      userAddress: address
    });
  }, [members, contribution, intervalSeconds, joinWinSecs, name, address]);

  // Payout pot estimate
  const potEstimate = useMemo(() => {
    try {
      const c = parseEther(contribution);
      return c * BigInt(members.length);
    } catch {
      return 0n;
    }
  }, [contribution, members.length]);

  const handleSubmit = useCallback(async () => {
    if (!deployment?.address) {
      setErrorMessage("Circle contract not deployed on this network.");
      setStage("error");
      return;
    }

    if (!validation.valid) {
      setErrorMessage(validation.error || "Please review form inputs.");
      setStage("error");
      return;
    }

    if (!warningAccepted) {
      setShowWarningModal(true);
      return;
    }

    try {
      setStage("signing");
      setErrorMessage(null);

      const parsedMembers = members.map((m) => getAddress(m.trim()));
      const parsedContribution = parseEther(contribution);

      const hash = await writeContractAsync({
        address: deployment.address as Address,
        abi: circleAbi,
        functionName: "create",
        args: [
          parsedMembers,
          parsedContribution,
          intervalSeconds,
          joinWinSecs,
          name.trim() || `Circle of ${members.length}`
        ]
      });

      setTxHash(hash);
      setStage("confirming");
    } catch (err) {
      setStage("error");
      setErrorMessage(describeError(err));
    }
  }, [
    deployment?.address,
    validation,
    warningAccepted,
    members,
    contribution,
    intervalSeconds,
    joinWinSecs,
    name,
    writeContractAsync
  ]);

  // STAGE === "CONFIRMED" FIRST IN RENDER!
  if (stage === "confirmed") {
    return (
      <Panel variant="plate" className="max-w-xl mx-auto text-center py-10 px-6 sm:px-10">
        <div className="w-14 h-14 mx-auto rounded-full bg-[var(--accent)] text-[var(--accent-ink)] flex items-center justify-center text-2xl font-bold mb-4">
          ✓
        </div>
        <h2 className="text-2xl font-serif text-[var(--text-primary)]">
          Savings Circle Initialized
        </h2>
        <p className="mt-2 text-sm text-[var(--text-muted)] leading-relaxed">
          The circle has been registered on-chain. Each designated member must now confirm and join within the join window to activate the first round.
        </p>

        <div className="mt-6 p-4 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-xs font-mono space-y-1">
          <div>Circle ID: #{createdCircleId ? createdCircleId.toString() : "…"}</div>
          {txHash && (
            <div className="text-[var(--text-tertiary)] truncate">
              Tx: {txHash}
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {createdCircleId ? (
            <Button
              variant="primary"
              size="spacious"
              onClick={() => router.push(`/c/${createdCircleId.toString()}`)}
            >
              Open Circle Orbit Track →
            </Button>
          ) : (
            <Button variant="primary" size="regular" onClick={() => router.push("/")}>
              View Your Circles
            </Button>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Wizard Step Tabs */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3 text-xs">
        <div className="flex items-center gap-2">
          {[
            { num: 1, label: "Who" },
            { num: 2, label: "How Much" },
            { num: 3, label: "When" },
            { num: 4, label: "Review" }
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep(s.num as any)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors cursor-pointer ${
                step === s.num
                  ? "bg-[var(--accent)] text-[var(--accent-ink)] font-semibold"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)]"
              }`}
            >
              <span>{s.num}.</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        <span className="text-[var(--text-tertiary)] hidden sm:inline">
          Step {step} of 4
        </span>
      </div>

      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800 text-red-200 text-xs">
          {errorMessage}
        </div>
      )}

      {/* Step 1: Who */}
      {step === 1 && (
        <Panel variant="plate" className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-serif text-[var(--text-primary)]">
                Member Payout Sequence
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Add 3 to 12 trusted wallet addresses. The order in this list is the permanent payout order.
              </p>
            </div>
            {address && (
              <Button variant="pill" size="compact" onClick={handleAddMe}>
                + Add Me
              </Button>
            )}
          </div>

          <div className="space-y-2.5">
            {members.map((member, index) => (
              <div
                key={index}
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]"
              >
                <span className="w-7 text-center font-mono text-xs text-[var(--accent)] font-semibold">
                  #{index + 1}
                </span>
                <input
                  type="text"
                  value={member}
                  onChange={(e) => {
                    const next = [...members];
                    next[index] = e.target.value;
                    setMembers(next);
                  }}
                  placeholder="0x…"
                  className="flex-1 bg-transparent border-0 font-mono text-xs text-[var(--text-primary)] focus:outline-none placeholder:text-[var(--text-tertiary)]"
                />
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveMember(index, "up")}
                    disabled={index === 0}
                    className="p-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-20 cursor-pointer"
                    aria-label={`Move member ${index + 1} up`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveMember(index, "down")}
                    disabled={index === members.length - 1}
                    className="p-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-20 cursor-pointer"
                    aria-label={`Move member ${index + 1} down`}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(index)}
                    disabled={members.length <= MIN_MEMBERS}
                    className="p-1 text-xs text-[var(--fail)] hover:opacity-80 disabled:opacity-20 cursor-pointer"
                    aria-label={`Remove member ${index + 1}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button
              variant="secondary"
              size="compact"
              onClick={handleAddMember}
              disabled={members.length >= MAX_MEMBERS}
            >
              + Add Member ({members.length}/{MAX_MEMBERS})
            </Button>
            <Button variant="primary" size="regular" onClick={() => setStep(2)}>
              Next: Round Amount →
            </Button>
          </div>
        </Panel>
      )}

      {/* Step 2: How Much */}
      {step === 2 && (
        <Panel variant="plate" className="space-y-6">
          <div>
            <h2 className="text-xl font-serif text-[var(--text-primary)]">
              Contribution & Cadence
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Every round, each member contributes this exact amount.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Contribution per round (BOT)
            </label>
            <div className="relative">
              <input
                type="text"
                value={contribution}
                onChange={(e) => setContribution(e.target.value)}
                placeholder="0.1"
                className="w-full px-4 py-3 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] font-mono text-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              />
              <span className="absolute right-4 top-3.5 text-sm font-semibold text-[var(--text-muted)]">
                BOT
              </span>
            </div>
            <div className="flex gap-2 pt-1">
              {["0.01", "0.05", "0.1", "0.5", "1.0"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setContribution(preset)}
                  className="px-2.5 py-1 rounded-lg bg-[var(--bg-overlay)] text-xs font-mono text-[var(--text-muted)] hover:text-[var(--accent)] border border-[var(--border-subtle)] cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Round Interval (Days between rounds)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Weekly (7d)", days: "7" },
                { label: "Fortnightly (14d)", days: "14" },
                { label: "Monthly (30d)", days: "30" },
                { label: "Custom", days: intervalDays }
              ].map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIntervalDays(opt.days)}
                  className={`p-3 rounded-xl border text-center text-xs font-medium cursor-pointer transition-colors ${
                    intervalDays === opt.days
                      ? "bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)] font-semibold"
                      : "bg-[var(--bg-overlay)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-2">
              <span className="text-xs text-[var(--text-muted)]">Days:</span>
              <input
                type="number"
                min="1"
                max="60"
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                className="w-24 px-3 py-1.5 rounded-lg bg-[var(--bg-overlay)] border border-[var(--border-subtle)] font-mono text-xs text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button variant="secondary" size="compact" onClick={() => setStep(1)}>
              ← Back
            </Button>
            <Button variant="primary" size="regular" onClick={() => setStep(3)}>
              Next: Join Window →
            </Button>
          </div>
        </Panel>
      )}

      {/* Step 3: When */}
      {step === 3 && (
        <Panel variant="plate" className="space-y-6">
          <div>
            <h2 className="text-xl font-serif text-[var(--text-primary)]">
              Join Window & Details
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              All members must confirm and join before this window lapses for the circle to start.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Circle Name (Optional)
            </label>
            <input
              type="text"
              maxLength={MAX_NAME_BYTES}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pioneer ROSCA"
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-tertiary)]"
            />
            <span className="text-[10px] text-[var(--text-tertiary)] block text-right">
              {new TextEncoder().encode(name).length} / {MAX_NAME_BYTES} bytes
            </span>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Join Window
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "1 Hour", secs: "3600" },
                { label: "1 Day", secs: "86400" },
                { label: "3 Days", secs: "259200" },
                { label: "7 Days", secs: "604800" }
              ].map((win) => (
                <button
                  key={win.secs}
                  type="button"
                  onClick={() => setJoinWindowSeconds(win.secs)}
                  className={`p-3 rounded-xl border text-center text-xs font-medium cursor-pointer transition-colors ${
                    joinWindowSeconds === win.secs
                      ? "bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)] font-semibold"
                      : "bg-[var(--bg-overlay)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {win.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button variant="secondary" size="compact" onClick={() => setStep(2)}>
              ← Back
            </Button>
            <Button variant="primary" size="regular" onClick={() => setStep(4)}>
              Review Summary →
            </Button>
          </div>
        </Panel>
      )}

      {/* Step 4: Review & Acknowledgement */}
      {step === 4 && (
        <Panel variant="plate" className="space-y-6">
          <div>
            <h2 className="text-xl font-serif text-[var(--text-primary)]">
              Review Circle Terms
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Verify members, payout sequence, and round parameters.
            </p>
          </div>

          {/* Figure Strip */}
          <div className="grid grid-cols-3 gap-3 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-center">
            <div>
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] block">
                Total Pot
              </span>
              <span className="text-xl font-serif text-[var(--accent)] font-bold">
                {formatEther(potEstimate)} BOT
              </span>
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] block">
                Rounds
              </span>
              <span className="text-xl font-serif text-[var(--text-primary)] font-bold">
                {members.length}
              </span>
            </div>
            <div>
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] block">
                Per Round
              </span>
              <span className="text-xl font-serif text-[var(--text-primary)] font-bold">
                {contribution} BOT
              </span>
            </div>
          </div>

          {/* Sequence Preview */}
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Payout Sequence ({members.length} members)
            </span>
            <div className="max-h-40 overflow-y-auto space-y-1.5 p-3 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
              {members.map((m, i) => (
                <div key={i} className="flex items-center justify-between text-xs font-mono">
                  <span className="text-[var(--accent)]">Turn #{i + 1}</span>
                  <span className="text-[var(--text-muted)]">{m ? m : "Empty"}</span>
                  {address && m.toLowerCase() === address.toLowerCase() && (
                    <span className="px-1.5 py-0.5 rounded bg-[var(--accent)] text-[var(--accent-ink)] text-[10px] font-bold">
                      YOU
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Honest Limits Notice & Acknowledgement */}
          <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--warn)] text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold text-[var(--warn)]">
              <span>⚠</span>
              <span>No-Collateral Trust Boundary</span>
            </div>
            <p className="text-[var(--text-primary)] leading-relaxed">
              Nobody here puts up collateral. If someone stops paying, the contract can show who — it can&apos;t get the money back from earlier rounds. Only join a circle with people you would lend to.
            </p>
            <label className="flex items-start gap-2 pt-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={warningAccepted}
                onChange={(e) => setWarningAccepted(e.target.checked)}
                className="mt-0.5 rounded border-[var(--border-default)] accent-[var(--accent)]"
              />
              <span className="text-[var(--text-muted)]">
                I understand that this circle relies entirely on personal trust and that earlier pots cannot be clawed back if a member defaults.
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button variant="secondary" size="compact" onClick={() => setStep(3)}>
              ← Back
            </Button>
            <Button
              variant="primary"
              size="spacious"
              disabled={!validation.valid || !warningAccepted || stage === "signing" || stage === "confirming"}
              loading={stage === "signing" || stage === "confirming"}
              onClick={handleSubmit}
            >
              {stage === "signing" ? "Confirm in Wallet…" : stage === "confirming" ? "Broadcasting…" : "Create Circle"}
            </Button>
          </div>
        </Panel>
      )}

      {/* Warning acknowledgement modal if user tries to submit without checking */}
      {showWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Panel variant="plate" className="max-w-md w-full p-6 space-y-4 border border-[var(--warn)]">
            <h3 className="text-lg font-serif text-[var(--warn)]">
              Acknowledgement Required
            </h3>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">
              Nobody here puts up collateral. If someone stops paying, the contract can show who — it can&apos;t get the money back from earlier rounds.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="secondary" size="compact" onClick={() => setShowWarningModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="compact"
                onClick={() => {
                  setWarningAccepted(true);
                  setShowWarningModal(false);
                }}
              >
                I Understand & Accept
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
