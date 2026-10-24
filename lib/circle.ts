import {
  type Address,
  type PublicClient,
  isAddress,
  getAddress,
  parseEther,
  formatEther
} from "viem";
import { circleAbi } from "./botchain/abi";
import {
  MIN_MEMBERS,
  MAX_MEMBERS,
  MIN_INTERVAL,
  MAX_INTERVAL,
  MIN_JOIN_WINDOW,
  MAX_JOIN_WINDOW,
  MAX_NAME_BYTES
} from "./limits";

export interface CircleView {
  id: bigint;
  creator: Address;
  contribution: bigint;
  interval: bigint;
  memberCount: number;
  joinedCount: number;
  round: number;
  state: number; // 0 Forming, 1 Active, 2 Complete, 3 Failed, 4 Cancelled
  roundDeadline: bigint;
  joinBy: bigint;
  createdBlock: number;
  pot: bigint;
  recipient: Address;
  paidCount: number;
  defaulters: number;
}

export interface NodePoint {
  x: number;
  y: number;
  angle: number;
}

export interface NodeState {
  index: number;
  address: Address;
  joined: boolean;
  paid: boolean;
  received: boolean;
  defaulted: boolean;
  isRecipient: boolean;
  status: "not_joined" | "joined" | "paid_this_round" | "received" | "defaulted";
}

export interface CircleDetails {
  view: CircleView;
  name: string;
  members: Address[];
  joined: boolean[];
  paid: boolean[];
  received: boolean[];
  nodeStates: NodeState[];
}

/**
 * Calculates coordinates for n nodes arranged in a circle clockwise starting at 12 o'clock.
 */
export function ringLayout(
  n: number,
  radius: number,
  center: { x: number; y: number } = { x: radius, y: radius }
): NodePoint[] {
  if (n <= 0) return [];
  const points: NodePoint[] = [];

  for (let i = 0; i < n; i++) {
    // 12 o'clock is -PI / 2 (-90 degrees)
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x = center.x + radius * Math.cos(angle);
    const y = center.y + radius * Math.sin(angle);
    points.push({ x, y, angle });
  }

  return points;
}

/**
 * Returns an SVG path string for the progress arc starting at 12 o'clock clockwise.
 */
export function arcPath(
  round: number,
  n: number,
  radius: number,
  center: { x: number; y: number } = { x: radius, y: radius }
): string {
  if (n <= 0 || round <= 0) return "";
  const fraction = Math.min(round, n) / n;
  if (fraction >= 1) {
    // Full ring (draw two halves to prevent zero-length SVG arc bug)
    const topX = center.x;
    const topY = center.y - radius;
    const botX = center.x;
    const botY = center.y + radius;
    return `M ${topX} ${topY} A ${radius} ${radius} 0 1 1 ${botX} ${botY} A ${radius} ${radius} 0 1 1 ${topX} ${topY}`;
  }

  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + fraction * 2 * Math.PI;

  const startX = center.x + radius * Math.cos(startAngle);
  const startY = center.y + radius * Math.sin(startAngle);
  const endX = center.x + radius * Math.cos(endAngle);
  const endY = center.y + radius * Math.sin(endAngle);

  const largeArcFlag = fraction > 0.5 ? 1 : 0;
  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
}

/**
 * Derives comprehensive node states for all members.
 */
export function deriveNodeStates(
  members: Address[],
  joined: boolean[],
  paid: boolean[],
  received: boolean[],
  round: number,
  defaultersBitmap: number,
  state: number
): NodeState[] {
  return members.map((address, i) => {
    const isJoined = Boolean(joined[i]);
    const isPaid = Boolean(paid[i]);
    const isReceived = Boolean(received[i]);
    const isDefaulted = state === 3 && ((defaultersBitmap & (1 << i)) !== 0);
    const isRecipient = state === 1 && round === i;

    let status: NodeState["status"] = "not_joined";
    if (isDefaulted) {
      status = "defaulted";
    } else if (isReceived) {
      status = "received";
    } else if (state === 1 && isPaid) {
      status = "paid_this_round";
    } else if (isJoined) {
      status = "joined";
    }

    return {
      index: i,
      address,
      joined: isJoined,
      paid: isPaid,
      received: isReceived,
      defaulted: isDefaulted,
      isRecipient,
      status
    };
  });
}

/**
 * Returns the list of defaulter addresses from the defaulters bitmap.
 */
export function defaultersFromBitmap(bitmap: number, members: Address[]): Address[] {
  const result: Address[] = [];
  for (let i = 0; i < members.length; i++) {
    if ((bitmap & (1 << i)) !== 0) {
      result.push(members[i]);
    }
  }
  return result;
}

/**
 * Identifies if a defaulter took a pot in an earlier round before defaulting.
 */
export function tookPotThenStopped(
  defaulter: Address,
  members: Address[],
  failingRound: number,
  received: boolean[]
): { tookPot: boolean; receivedRound?: number; failedRound?: number } {
  const idx = members.findIndex(
    (m) => m.toLowerCase() === defaulter.toLowerCase()
  );
  if (idx !== -1 && (idx < failingRound || received[idx])) {
    return {
      tookPot: true,
      receivedRound: idx + 1, // 1-indexed for human display
      failedRound: failingRound + 1
    };
  }
  return { tookPot: false };
}

/**
 * Human-readable description of current round status.
 */
export function describeRound(circle: CircleView, now?: number): {
  headline: string;
  subline: string;
  isLapsed: boolean;
} {
  const currentTime = BigInt(now ?? Math.floor(Date.now() / 1000));

  if (circle.state === 0) {
    const expired = currentTime > circle.joinBy;
    return {
      headline: `Forming (${circle.joinedCount}/${circle.memberCount} joined)`,
      subline: expired
        ? "Join window expired"
        : `Closes in ${formatDuration(circle.joinBy - currentTime)}`,
      isLapsed: expired
    };
  }

  if (circle.state === 1) {
    const lapsed = currentTime > circle.roundDeadline;
    return {
      headline: `Round ${circle.round + 1} of ${circle.memberCount}`,
      subline: lapsed
        ? "Round deadline passed — ready to mark as failed"
        : `${formatDuration(circle.roundDeadline - currentTime)} remaining`,
      isLapsed: lapsed
    };
  }

  if (circle.state === 2) {
    return {
      headline: "Complete",
      subline: `All ${circle.memberCount} rounds successfully completed`,
      isLapsed: false
    };
  }

  if (circle.state === 3) {
    return {
      headline: `Failed in round ${circle.round + 1}`,
      subline: "Circle stopped due to missing contributions",
      isLapsed: true
    };
  }

  return {
    headline: "Cancelled",
    subline: "Circle was cancelled before starting",
    isLapsed: false
  };
}

/**
 * Generates an estimated payout schedule for each round.
 */
export function schedule(
  circle: CircleView,
  startAt?: number
): Array<{ round: number; recipient: Address; estimatedDate: Date }> {
  const baseTime = startAt ?? (circle.state >= 1 ? Number(circle.roundDeadline - circle.interval) : Math.floor(Date.now() / 1000));
  const items: Array<{ round: number; recipient: Address; estimatedDate: Date }> = [];

  for (let r = 0; r < circle.memberCount; r++) {
    const roundEndTime = baseTime + Number(circle.interval) * (r + 1);
    items.push({
      round: r + 1,
      recipient: circle.recipient, // Note: membersOf provides exact address per index
      estimatedDate: new Date(roundEndTime * 1000)
    });
  }

  return items;
}

/**
 * Formats a duration in seconds to a human-readable string.
 */
export function formatDuration(seconds: bigint): string {
  if (seconds <= 0n) return "0s";
  const s = Number(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${s % 60}s`;
}

export interface CreateCircleInput {
  members: string[];
  contribution: string;
  interval: bigint;
  joinWindow: bigint;
  name: string;
  userAddress?: Address;
}

/**
 * Validates create circle form input against all contract rules.
 */
export function validateCreate(input: CreateCircleInput): { valid: boolean; error?: string } {
  const { members, contribution, interval, joinWindow, name, userAddress } = input;

  if (members.length < MIN_MEMBERS || members.length > MAX_MEMBERS) {
    return {
      valid: false,
      error: `Circle requires between ${MIN_MEMBERS} and ${MAX_MEMBERS} members.`
    };
  }

  const normalized: Address[] = [];
  for (let i = 0; i < members.length; i++) {
    const raw = members[i].trim();
    if (!isAddress(raw)) {
      return { valid: false, error: `Member ${i + 1} is not a valid address.` };
    }
    const clean = getAddress(raw);
    if (clean === "0x0000000000000000000000000000000000000000") {
      return { valid: false, error: `Member ${i + 1} cannot be the zero address.` };
    }
    if (normalized.includes(clean)) {
      const firstIdx = normalized.indexOf(clean) + 1;
      return {
        valid: false,
        error: `Members ${firstIdx} and ${i + 1} are the same wallet.`
      };
    }
    normalized.push(clean);
  }

  if (userAddress) {
    const cleanUser = getAddress(userAddress);
    if (!normalized.includes(cleanUser)) {
      return { valid: false, error: "You have to be in your own circle." };
    }
  }

  try {
    const amount = parseEther(contribution);
    if (amount <= 0n) {
      return { valid: false, error: "Contribution amount must be greater than zero." };
    }
  } catch {
    return { valid: false, error: "Invalid contribution amount." };
  }

  if (interval < MIN_INTERVAL || interval > MAX_INTERVAL) {
    return { valid: false, error: "Round interval must be between 1 and 60 days." };
  }

  if (joinWindow < MIN_JOIN_WINDOW || joinWindow > MAX_JOIN_WINDOW) {
    return { valid: false, error: "Join window must be between 1 hour and 14 days." };
  }

  const nameBytes = new TextEncoder().encode(name.trim()).length;
  if (nameBytes > MAX_NAME_BYTES) {
    return { valid: false, error: `Circle name must be at most ${MAX_NAME_BYTES} bytes.` };
  }

  return { valid: true };
}

/**
 * Loads circle view and members, resolving the circle name from the creation log.
 */
export async function loadCircle(
  client: PublicClient,
  contractAddress: Address,
  id: bigint
): Promise<CircleDetails | null> {
  try {
    const viewRaw = await client.readContract({
      address: contractAddress,
      abi: circleAbi,
      functionName: "circleOf",
      args: [id]
    });

    const membersRaw = await client.readContract({
      address: contractAddress,
      abi: circleAbi,
      functionName: "membersOf",
      args: [id]
    });

    const view: CircleView = {
      id: viewRaw.id,
      creator: viewRaw.creator,
      contribution: viewRaw.contribution,
      interval: viewRaw.interval,
      memberCount: Number(viewRaw.memberCount),
      joinedCount: Number(viewRaw.joinedCount),
      round: Number(viewRaw.round),
      state: Number(viewRaw.state),
      roundDeadline: viewRaw.roundDeadline,
      joinBy: viewRaw.joinBy,
      createdBlock: Number(viewRaw.createdBlock),
      pot: viewRaw.pot,
      recipient: viewRaw.recipient,
      paidCount: Number(viewRaw.paidCount),
      defaulters: Number(viewRaw.defaulters)
    };

    const members = [...membersRaw[0]] as Address[];
    const joined = [...membersRaw[1]] as boolean[];
    const paid = [...membersRaw[2]] as boolean[];
    const received = [...membersRaw[3]] as boolean[];

    let name = `Circle #${id.toString()}`;
    try {
      const fromBlock = BigInt(Math.max(1, view.createdBlock > 0 ? view.createdBlock - 1 : 1));
      const logs = await client.getContractEvents({
        address: contractAddress,
        abi: circleAbi,
        eventName: "Created",
        args: { id },
        fromBlock,
        toBlock: fromBlock + 100n
      });

      if (logs.length > 0 && logs[0].args?.name) {
        name = logs[0].args.name;
      }
    } catch {
      // Fall back to default name if log scan fails
    }

    const nodeStates = deriveNodeStates(
      members,
      joined,
      paid,
      received,
      view.round,
      view.defaulters,
      view.state
    );

    return {
      view,
      name,
      members,
      joined,
      paid,
      received,
      nodeStates
    };
  } catch {
    return null;
  }
}
