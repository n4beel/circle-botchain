import { BaseError, ContractFunctionRevertedError, formatEther, type Address } from "viem";

export interface RevertDetails {
  errorName?: string;
  args?: readonly unknown[];
}

export function shortAddress(addr?: string): string {
  if (!addr) return "0x…";
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatCircleDate(timestamp: number | bigint): string {
  const ts = Number(timestamp);
  if (isNaN(ts) || ts <= 0) return "the scheduled date";
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

export function stateName(state: number | bigint): string {
  const s = Number(state);
  switch (s) {
    case 0:
      return "forming";
    case 1:
      return "active";
    case 2:
      return "complete";
    case 3:
      return "failed";
    case 4:
      return "cancelled";
    default:
      return "unknown";
  }
}

export function extractRevert(err: unknown): RevertDetails | undefined {
  if (typeof err !== "object" || err === null) return undefined;

  // Direct property check (e.g. test payloads or mocked errors)
  if (
    "data" in err &&
    (err as any).data &&
    typeof (err as any).data === "object" &&
    (err as any).data.errorName
  ) {
    return {
      errorName: (err as any).data.errorName,
      args: (err as any).data.args,
    };
  }
  if ("errorName" in err && typeof (err as any).errorName === "string") {
    return {
      errorName: (err as any).errorName,
      args: (err as any).args,
    };
  }

  // Viem BaseError walk
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => {
      if (e instanceof ContractFunctionRevertedError) return true;
      if (
        typeof e === "object" &&
        e !== null &&
        "data" in e &&
        Boolean((e as { data?: { errorName?: string } }).data?.errorName)
      ) {
        return true;
      }
      return false;
    });

    if (reverted) {
      if (reverted instanceof ContractFunctionRevertedError) {
        return {
          errorName: reverted.data?.errorName,
          args: reverted.data?.args,
        };
      }
      const errorObj = reverted as any;
      if (errorObj.data?.errorName) {
        return {
          errorName: errorObj.data.errorName,
          args: errorObj.data.args,
        };
      }
    }
  }

  return undefined;
}

/**
 * Maps custom contract errors and wallet issues to clear sentences (§4.4).
 */
export function describeError(err: unknown): string {
  if (!err) return "Transaction failed.";

  // User rejection
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("user rejected") || msg.includes("user denied") || msg.includes("cancelled")) {
      return "Transaction was cancelled in wallet.";
    }
  }

  const revert = extractRevert(err);
  if (revert?.errorName) {
    const args = revert.args ?? [];
    switch (revert.errorName) {
      case "WrongAmount": {
        const expected = args[0] !== undefined ? formatEther(BigInt(args[0] as string | number | bigint)) : "0";
        const sent = args[1] !== undefined ? formatEther(BigInt(args[1] as string | number | bigint)) : "0";
        return `Each round is exactly ${expected} BOT; you sent ${sent}.`;
      }
      case "AlreadyPaid": {
        return "You've already paid this round.";
      }
      case "RoundLapsed": {
        const deadline = args[1] !== undefined ? formatCircleDate(args[1] as number | bigint) : "recently";
        return `This round closed on ${deadline}. Mark the circle as failed to recover payments.`;
      }
      case "NotLapsed": {
        const deadline = args[1] !== undefined ? formatCircleDate(args[1] as number | bigint) : "later";
        return `The round isn't late yet — it closes ${deadline}.`;
      }
      case "JoinClosed": {
        const joinBy = args[1] !== undefined ? formatCircleDate(args[1] as number | bigint) : "recently";
        return `The window to join closed on ${joinBy}.`;
      }
      case "NotMember": {
        const caller = args[1] !== undefined ? shortAddress(String(args[1])) : "Address";
        return `${caller} isn't a member of this circle.`;
      }
      case "WrongState": {
        const s = args[1] !== undefined ? stateName(args[1] as number | bigint) : "in an unexpected state";
        return `This circle is ${s}, so that isn't possible.`;
      }
      case "NothingToReclaim": {
        return "You didn't pay in the failing round, so there's nothing to take back.";
      }
      case "CreatorNotMember": {
        return "You have to be in your own circle.";
      }
      case "DuplicateMember": {
        const i = args[0] !== undefined ? Number(args[0]) + 1 : 1;
        const j = args[1] !== undefined ? Number(args[1]) + 1 : 2;
        return `Members ${i} and ${j} are the same wallet.`;
      }
      case "BadMemberCount": {
        return "A circle requires between 3 and 12 members.";
      }
      case "BadMember": {
        const idx = args[0] !== undefined ? Number(args[0]) + 1 : 1;
        return `Member address at position ${idx} is invalid.`;
      }
      case "ZeroAmount": {
        return "Contribution amount must be greater than zero.";
      }
      case "BadInterval": {
        return "Round interval must be between 1 and 60 days.";
      }
      case "BadJoinWindow": {
        return "Join window must be between 1 hour and 14 days.";
      }
      case "NameTooLong": {
        return "Circle name must be at most 40 bytes.";
      }
      case "NoSuchCircle": {
        const id = args[0] !== undefined ? String(args[0]) : "";
        return `Circle #${id} does not exist.`;
      }
      case "AlreadyJoined": {
        return "You have already joined this circle.";
      }
      case "NotCreator": {
        return "Only the creator can cancel this circle during the join window.";
      }
      case "NothingToWithdraw": {
        return "You have no pending balance to withdraw.";
      }
      case "TransferFailed": {
        return "BOT transfer failed or reentrancy was rejected.";
      }
      default:
        return `Contract error: ${revert.errorName}`;
    }
  }

  if (err instanceof BaseError) {
    return err.shortMessage || err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }

  return "Transaction failed.";
}
