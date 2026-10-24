"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  formatEther,
  type Address,
  type Hex,
  decodeEventLog
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract
} from "wagmi";
import { circleAbi } from "@/lib/botchain/abi";
import { getDeployment } from "@/lib/botchain/deployment";
import { isBotChainId } from "@/lib/botchain/chain";
import {
  loadCircle,
  describeRound,
  tookPotThenStopped,
  defaultersFromBitmap,
  type CircleDetails,
  type NodeState
} from "@/lib/circle";
import { describeError, shortAddress } from "@/lib/errors";
import CircleRingVisual from "./CircleRingVisual";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

type TxStage = "idle" | "signing" | "confirming" | "confirmed" | "error";

interface CircleDetailViewProps {
  id: bigint;
}

export default function CircleDetailView({ id }: CircleDetailViewProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const deployment = isBotChainId(chainId) ? getDeployment(chainId) : undefined;
  const { toast } = useToast();

  const [details, setDetails] = useState<CircleDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeState | null>(null);

  // Time state for live countdowns
  const [nowTime, setNowTime] = useState<number>(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Pre-join warning modal state
  const [showPreJoinModal, setShowPreJoinModal] = useState(false);
  const [preJoinAgreed, setPreJoinAgreed] = useState(false);

  // Tx flow state
  const [actionName, setActionName] = useState<string>("");
  const [stage, setStage] = useState<TxStage>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const {
    data: receipt,
    isSuccess: isReceiptSuccess,
    isError: isReceiptError,
    error: receiptError
  } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
  });

  // Pending balance for connected wallet
  const { data: userPendingRaw, refetch: refetchPending } = useReadContract({
    address: deployment?.address as Address,
    abi: circleAbi,
    functionName: "pending",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(deployment?.address && address) }
  });
  const userPending = userPendingRaw ?? 0n;

  const clientRef = useRef(publicClient);
  clientRef.current = publicClient;

  // Refresh circle data
  const refreshCircle = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !deployment?.address) return;
    try {
      const data = await loadCircle(client, deployment.address as Address, id);
      if (data) {
        setDetails(data);
        setLoadError(null);
      } else {
        setLoadError("Circle not found or invalid.");
      }
    } catch {
      setLoadError("Failed to load circle details.");
    } finally {
      setLoading(false);
    }
  }, [deployment?.address, id]);

  useEffect(() => {
    refreshCircle();
  }, [refreshCircle]);

  // Settled-ref pattern keyed by txHash
  const settledHashRef = useRef<Hex | null>(null);

  useEffect(() => {
    if (!txHash) return;
    if (settledHashRef.current === txHash) return;

    if (isReceiptSuccess && receipt) {
      settledHashRef.current = txHash;
      setStage("confirmed");
      refreshCircle();
      refetchPending();

      toast(
        "success",
        "Transaction Successful",
        `${actionName} confirmed on-chain.`
      );
    } else if (isReceiptError) {
      settledHashRef.current = txHash;
      setStage("error");
      setErrorMessage(describeError(receiptError));
    }
  }, [txHash, isReceiptSuccess, isReceiptError, receipt, receiptError, actionName, refreshCircle, refetchPending, toast]);

  // Execute a contract action
  const handleAction = async (fn: "join" | "contribute" | "fail" | "reclaim" | "cancel" | "withdraw", value = 0n) => {
    if (!deployment?.address) return;
    try {
      setStage("signing");
      setErrorMessage(null);
      setActionName(
        fn === "join"
          ? "Join Circle"
          : fn === "contribute"
          ? "Pay Round Contribution"
          : fn === "fail"
          ? "Mark Circle as Failed"
          : fn === "reclaim"
          ? "Reclaim Contribution"
          : fn === "withdraw"
          ? "Collect Pending Balance"
          : "Cancel Circle"
      );

      const args = fn === "withdraw" ? [] : [id];
      const txParams: any = {
        address: deployment.address as Address,
        abi: circleAbi,
        functionName: fn,
        args: args as any,
      };
      if (value > 0n) {
        txParams.value = value;
      }
      const hash = await writeContractAsync(txParams);

      setTxHash(hash);
      setStage("confirming");
    } catch (err) {
      setStage("error");
      setErrorMessage(describeError(err));
    }
  };

  // Membership & role derivation
  const memberIndex = useMemo(() => {
    if (!details || !address) return -1;
    return details.members.findIndex((m) => m.toLowerCase() === address.toLowerCase());
  }, [details, address]);

  const isMember = memberIndex !== -1;
  const hasJoined = isMember && details ? details.joined[memberIndex] : false;
  const hasPaid = isMember && details ? details.paid[memberIndex] : false;
  const isCreator = details && address ? details.view.creator.toLowerCase() === address.toLowerCase() : false;
  const isCurrentRecipient = details && details.view.state === 1 && details.view.round === memberIndex;

  const roundDesc = useMemo(() => {
    if (!details) return null;
    return describeRound(details.view, nowTime);
  }, [details, nowTime]);

  const defaultersList = useMemo(() => {
    if (!details || details.view.state !== 3) return [];
    return defaultersFromBitmap(details.view.defaulters, details.members);
  }, [details]);

  // STAGE === "CONFIRMED" FIRST IN RENDER!
  if (stage === "confirmed") {
    return (
      <Panel variant="plate" className="max-w-xl mx-auto text-center py-10 px-6 sm:px-8 space-y-5">
        <div className="w-14 h-14 mx-auto rounded-full bg-[var(--accent)] text-[var(--accent-ink)] flex items-center justify-center text-2xl font-bold">
          ✓
        </div>
        <h2 className="text-2xl font-serif text-[var(--text-primary)]">
          {actionName} Confirmed
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Your transaction has been written to the ledger and updated the circle state.
        </p>
        <div className="pt-2">
          <Button
            variant="primary"
            size="regular"
            onClick={() => {
              setStage("idle");
              setTxHash(null);
              settledHashRef.current = null;
            }}
          >
            Return to Circle Orbit Track →
          </Button>
        </div>
      </Panel>
    );
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="inline-block w-8 h-8 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin mb-3" />
        <p className="text-sm text-[var(--text-muted)]">Loading orbit track #{id.toString()}…</p>
      </div>
    );
  }

  if (loadError || !details) {
    return (
      <Panel variant="plate" className="max-w-md mx-auto text-center py-12 px-6">
        <h2 className="text-xl font-serif text-[var(--fail)]">Circle Unavailable</h2>
        <p className="mt-2 text-xs text-[var(--text-muted)]">{loadError || "Circle could not be loaded."}</p>
        <div className="mt-6">
          <Link href="/">
            <Button variant="secondary" size="compact">
              ← Return Home
            </Button>
          </Link>
        </div>
      </Panel>
    );
  }

  const { view } = details;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Circle Letterhead */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-serif text-[var(--text-primary)]">
              {details.name}
            </h1>
            <span className="text-xs font-mono text-[var(--text-tertiary)]">
              #{id.toString()}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Created by {shortAddress(view.creator)} • {view.memberCount} members • {formatEther(view.contribution)} BOT per round
          </p>
        </div>

        {/* State Badge */}
        <div className="flex items-center gap-2">
          {view.state === 0 && (
            <span className="px-3 py-1 rounded-full bg-[var(--warn)]/20 text-[var(--warn)] border border-[var(--warn)]/40 text-xs font-semibold">
              Forming ({view.joinedCount}/{view.memberCount})
            </span>
          )}
          {view.state === 1 && (
            <span className="px-3 py-1 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/40 text-xs font-semibold">
              Active • Round {view.round + 1}
            </span>
          )}
          {view.state === 2 && (
            <span className="px-3 py-1 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold">
              Completed
            </span>
          )}
          {view.state === 3 && (
            <span className="px-3 py-1 rounded-full bg-[var(--fail)]/20 text-[var(--fail)] border border-[var(--fail)]/40 text-xs font-semibold">
              Failed
            </span>
          )}
          {view.state === 4 && (
            <span className="px-3 py-1 rounded-full bg-stone-800 text-[var(--text-muted)] text-xs font-semibold">
              Cancelled
            </span>
          )}
        </div>
      </div>

      {/* Error alert if any */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800 text-red-200 text-xs">
          {errorMessage}
        </div>
      )}

      {/* Failed Defaulter Banner */}
      {view.state === 3 && defaultersList.length > 0 && (
        <div className="p-4 rounded-2xl bg-red-950/30 border border-[var(--fail)] text-xs space-y-2">
          <div className="flex items-center gap-2 font-semibold text-[var(--fail)]">
            <span>✗</span>
            <span>Circle Terminated: Missing Contribution</span>
          </div>
          <div className="space-y-1 text-[var(--text-primary)]">
            {defaultersList.map((defaulter) => {
              const info = tookPotThenStopped(defaulter, details.members, view.round, details.received);
              if (info.tookPot) {
                return (
                  <p key={defaulter} className="font-medium text-[var(--warn)]">
                    {shortAddress(defaulter)} took the pot in round {info.receivedRound} and then stopped paying.
                  </p>
                );
              }
              return (
                <p key={defaulter}>
                  {shortAddress(defaulter)} failed to contribute for round {view.round + 1}.
                </p>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending Balance Collection Banner */}
      {userPending > 0n && (
        <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--accent)] flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-xs uppercase tracking-wider text-[var(--text-muted)] block">
              You Have Unclaimed Funds
            </span>
            <span className="text-xl font-serif text-[var(--accent)] font-bold">
              {formatEther(userPending)} BOT Available
            </span>
          </div>
          <Button
            variant="primary"
            size="compact"
            loading={stage === "signing" || stage === "confirming"}
            onClick={() => handleAction("withdraw")}
          >
            Collect {formatEther(userPending)} BOT
          </Button>
        </div>
      )}

      {/* Primary Orbit Ring Visualization */}
      <div className="py-2">
        <CircleRingVisual
          details={details}
          connectedAddress={address}
          onSelectNode={(node) => setSelectedNode(node)}
        />
      </div>

      {/* Status & Countdown Line */}
      {roundDesc && (
        <div className="text-center">
          <h2 className="text-lg font-serif text-[var(--text-primary)]">
            {roundDesc.headline}
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {roundDesc.subline}
          </p>
        </div>
      )}

      {/* Role-Aware Primary Action Panel */}
      <Panel variant="plate" className="max-w-xl mx-auto text-center space-y-4">
        {/* Scenario 1: Forming */}
        {view.state === 0 && (
          <div className="space-y-3">
            {isMember && !hasJoined ? (
              <div className="space-y-2">
                <Button
                  variant="primary"
                  size="spacious"
                  loading={stage === "signing" || stage === "confirming"}
                  onClick={() => setShowPreJoinModal(true)}
                >
                  Join Savings Circle
                </Button>
                <p className="text-xs text-[var(--text-muted)]">
                  You are designated as turn #{memberIndex + 1} in the payout order.
                </p>
              </div>
            ) : isMember && hasJoined ? (
              <div className="space-y-1">
                <Button variant="secondary" size="regular" disabled>
                  Joined • Waiting for {view.memberCount - view.joinedCount} members
                </Button>
                <p className="text-xs text-[var(--text-muted)]">
                  The circle will activate automatically once all {view.memberCount} members confirm.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                You are viewing this forming circle as an observer.
              </p>
            )}

            {/* Cancel option */}
            {(isCreator || (nowTime > Number(view.joinBy))) && (
              <div className="pt-2">
                <Button
                  variant="caution"
                  size="compact"
                  loading={stage === "signing" || stage === "confirming"}
                  onClick={() => handleAction("cancel")}
                >
                  Cancel Circle
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Scenario 2: Active */}
        {view.state === 1 && (
          <div className="space-y-3">
            {/* If round has lapsed */}
            {roundDesc?.isLapsed ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--warn)]">
                  Round deadline passed without full contributions. Anyone may mark the circle as failed so payers can recover funds.
                </p>
                <Button
                  variant="caution"
                  size="spacious"
                  loading={stage === "signing" || stage === "confirming"}
                  onClick={() => handleAction("fail")}
                >
                  Mark as Failed
                </Button>
              </div>
            ) : isMember && !hasPaid ? (
              <div className="space-y-2">
                {isCurrentRecipient && (
                  <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--accent)] text-xs text-[var(--accent)] font-medium">
                    You receive the pot this round — you still pay in.
                  </div>
                )}
                <Button
                  variant="primary"
                  size="spacious"
                  loading={stage === "signing" || stage === "confirming"}
                  onClick={() => handleAction("contribute", view.contribution)}
                >
                  Pay {formatEther(view.contribution)} BOT
                </Button>
                <p className="text-xs text-[var(--text-muted)]">
                  Pay into this round to keep the circle active.
                </p>
              </div>
            ) : isMember && hasPaid ? (
              <div className="space-y-1">
                <Button variant="secondary" size="regular" disabled>
                  Waiting for {view.memberCount - view.paidCount} members to pay
                </Button>
                <p className="text-xs text-[var(--text-muted)]">
                  You have contributed for round {view.round + 1}.
                </p>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                Round {view.round + 1} is in progress with {view.paidCount}/{view.memberCount} contributions received.
              </p>
            )}
          </div>
        )}

        {/* Scenario 3: Failed */}
        {view.state === 3 && (
          <div className="space-y-3">
            {isMember && hasPaid ? (
              <div className="space-y-2">
                <p className="text-xs text-[var(--text-primary)]">
                  You contributed {formatEther(view.contribution)} BOT to this failing round. You can reclaim it now.
                </p>
                <Button
                  variant="primary"
                  size="spacious"
                  loading={stage === "signing" || stage === "confirming"}
                  onClick={() => handleAction("reclaim")}
                >
                  Take Back My Payment
                </Button>
              </div>
            ) : isMember ? (
              <p className="text-xs text-[var(--text-muted)]">
                You did not pay in this failing round.
              </p>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                This circle has failed.
              </p>
            )}
          </div>
        )}

        {/* Scenario 4: Complete */}
        {view.state === 2 && (
          <div className="space-y-2 py-2">
            <h3 className="text-lg font-serif text-[var(--accent)]">
              Circle Successfully Completed
            </h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
              All {view.memberCount} members paid and received their scheduled pots.
            </p>
          </div>
        )}

        {/* Scenario 5: Cancelled */}
        {view.state === 4 && (
          <p className="text-xs text-[var(--text-muted)] py-2">
            This circle was cancelled during formation.
          </p>
        )}
      </Panel>

      {/* Accessible Members Table & Payout Order */}
      <Panel variant="plate" className="space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2">
          <h3 className="text-sm font-serif uppercase tracking-wider text-[var(--text-primary)]">
            Payout Sequence & Member Ledger
          </h3>
          <span className="text-xs font-mono text-[var(--text-muted)]">
            {view.memberCount} Total Members
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                <th className="py-2.5 px-3 font-medium">Turn</th>
                <th className="py-2.5 px-3 font-medium">Member</th>
                <th className="py-2.5 px-3 font-medium">Joined</th>
                <th className="py-2.5 px-3 font-medium">This Round</th>
                <th className="py-2.5 px-3 font-medium">Pot Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] font-mono">
              {details.nodeStates.map((node, i) => {
                const isSelf = address && node.address.toLowerCase() === address.toLowerCase();
                return (
                  <tr
                    key={node.address}
                    className={`hover:bg-[var(--bg-overlay)] transition-colors ${
                      isSelf ? "bg-[var(--bg-overlay)] font-semibold" : ""
                    }`}
                  >
                    <td className="py-3 px-3 text-[var(--accent)] font-bold">
                      #{i + 1}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <span>{shortAddress(node.address)}</span>
                        {isSelf && (
                          <span className="px-1.5 py-0.2 rounded bg-[var(--accent)] text-[var(--accent-ink)] text-[10px] font-bold">
                            YOU
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {node.joined ? (
                        <span className="text-[var(--accent)]">✓ Yes</span>
                      ) : (
                        <span className="text-[var(--text-tertiary)]">Pending</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {node.paid ? (
                        <span className="text-[var(--accent)]">✓ Paid</span>
                      ) : node.defaulted ? (
                        <span className="text-[var(--fail)]">✗ Defaulted</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {node.received ? (
                        <span className="text-[var(--text-muted)]">Received</span>
                      ) : node.isRecipient ? (
                        <span className="text-[var(--accent)] font-bold">★ Turn Now</span>
                      ) : (
                        <span className="text-[var(--text-tertiary)]">Scheduled</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Honest Limits Notice Card */}
      <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs space-y-2">
        <h4 className="font-semibold text-[var(--text-primary)]">
          Honest Limits of This Contract
        </h4>
        <ul className="list-disc list-inside space-y-1 text-[var(--text-muted)] leading-relaxed">
          <li><strong>There is no collateral.</strong> A member who has already received the pot can simply stop paying; the contract publicly records the default, but earlier rounds are not clawed back.</li>
          <li><strong>Payout order is permanent.</strong> Payout turns cannot be changed, swapped, or bought.</li>
          <li><strong>Fixed membership.</strong> Nobody can be added, replaced, or removed after creation.</li>
        </ul>
      </div>

      {/* Pre-Join Warning Modal */}
      {showPreJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Panel variant="plate" className="max-w-md w-full p-6 space-y-4 border border-[var(--warn)]">
            <h3 className="text-lg font-serif text-[var(--warn)]">
              Before You Join This Circle
            </h3>
            <p className="text-xs text-[var(--text-primary)] leading-relaxed">
              Only join a circle with people you would lend to. Nobody puts up collateral. If someone stops paying, the contract records the default — it cannot get money back from earlier rounds.
            </p>
            <label className="flex items-start gap-2 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={preJoinAgreed}
                onChange={(e) => setPreJoinAgreed(e.target.checked)}
                className="mt-0.5 rounded border-[var(--border-default)] accent-[var(--accent)]"
              />
              <span className="text-xs text-[var(--text-muted)]">
                I know these members and accept the trust risk.
              </span>
            </label>
            <div className="flex items-center justify-end gap-2 pt-3">
              <Button
                variant="secondary"
                size="compact"
                onClick={() => {
                  setShowPreJoinModal(false);
                  setPreJoinAgreed(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="compact"
                disabled={!preJoinAgreed}
                onClick={() => {
                  setShowPreJoinModal(false);
                  handleAction("join");
                }}
              >
                Confirm & Join
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
