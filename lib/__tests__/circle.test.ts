import { describe, expect, it } from "vitest";
import { type Address, parseEther } from "viem";
import {
  ringLayout,
  arcPath,
  deriveNodeStates,
  defaultersFromBitmap,
  tookPotThenStopped,
  describeRound,
  validateCreate,
  schedule,
  type CircleView
} from "../circle";
import {
  MIN_INTERVAL,
  MAX_INTERVAL,
  MIN_JOIN_WINDOW,
  MAX_JOIN_WINDOW
} from "../limits";

const ALICE: Address = "0x1111111111111111111111111111111111111111";
const BOB: Address = "0x2222222222222222222222222222222222222222";
const CAROL: Address = "0x3333333333333333333333333333333333333333";
const DAVE: Address = "0x4444444444444444444444444444444444444444";
const EVE: Address = "0x5555555555555555555555555555555555555555";

describe("ringLayout", () => {
  it("handles empty or zero nodes", () => {
    expect(ringLayout(0, 100)).toEqual([]);
  });

  it("places first node at 12 o'clock for 3, 5, and 12 members", () => {
    for (const n of [3, 5, 12]) {
      const layout = ringLayout(n, 100, { x: 100, y: 100 });
      expect(layout.length).toBe(n);

      // Node 0 should be at 12 o'clock: x = 100, y = 0 (top center)
      expect(layout[0].x).toBeCloseTo(100, 3);
      expect(layout[0].y).toBeCloseTo(0, 3);
      expect(layout[0].angle).toBeCloseTo(-Math.PI / 2, 3);
    }
  });

  it("lays out nodes clockwise in order", () => {
    const layout = ringLayout(4, 100, { x: 100, y: 100 });
    // 4 nodes at 12, 3, 6, 9 o'clock
    // Node 0: top (100, 0)
    expect(layout[0].x).toBeCloseTo(100, 3);
    expect(layout[0].y).toBeCloseTo(0, 3);
    // Node 1: right (200, 100)
    expect(layout[1].x).toBeCloseTo(200, 3);
    expect(layout[1].y).toBeCloseTo(100, 3);
    // Node 2: bottom (100, 200)
    expect(layout[2].x).toBeCloseTo(100, 3);
    expect(layout[2].y).toBeCloseTo(200, 3);
    // Node 3: left (0, 100)
    expect(layout[3].x).toBeCloseTo(0, 3);
    expect(layout[3].y).toBeCloseTo(100, 3);
  });
});

describe("arcPath", () => {
  it("returns empty string when round is 0", () => {
    expect(arcPath(0, 4, 100)).toBe("");
  });

  it("returns an arc path for partial progress", () => {
    const path = arcPath(1, 4, 100, { x: 100, y: 100 });
    expect(path).toContain("M 100 0");
    expect(path).toContain("A 100 100 0 0 1");
  });

  it("returns full circle when round equals or exceeds n", () => {
    const path = arcPath(4, 4, 100, { x: 100, y: 100 });
    expect(path).toContain("M 100 0 A 100 100 0 1 1 100 200");
  });
});

describe("deriveNodeStates", () => {
  const members = [ALICE, BOB, CAROL, DAVE];

  it("correctly identifies forming states", () => {
    const states = deriveNodeStates(
      members,
      [true, true, false, false],
      [false, false, false, false],
      [false, false, false, false],
      0,
      0,
      0 // Forming
    );
    expect(states[0].status).toBe("joined");
    expect(states[1].status).toBe("joined");
    expect(states[2].status).toBe("not_joined");
    expect(states[3].status).toBe("not_joined");
  });

  it("correctly identifies active round states and recipient", () => {
    const states = deriveNodeStates(
      members,
      [true, true, true, true],
      [true, false, false, false],
      [false, false, false, false],
      0, // Round 0, Alice is recipient
      0,
      1 // Active
    );
    expect(states[0].status).toBe("paid_this_round");
    expect(states[0].isRecipient).toBe(true);
    expect(states[1].status).toBe("joined");
    expect(states[1].isRecipient).toBe(false);
  });

  it("correctly identifies received states in later rounds", () => {
    const states = deriveNodeStates(
      members,
      [true, true, true, true],
      [false, false, false, false],
      [true, false, false, false], // Alice received in round 0
      1, // Round 1
      0,
      1 // Active
    );
    expect(states[0].status).toBe("received");
    expect(states[1].isRecipient).toBe(true);
  });

  it("correctly identifies defaulted nodes in failed circle", () => {
    // Carol and Dave defaulted: bits 2 and 3 = (1<<2) | (1<<3) = 12
    const states = deriveNodeStates(
      members,
      [true, true, true, true],
      [true, true, false, false],
      [false, false, false, false],
      0,
      12, // Defaulters bitmap
      3 // Failed
    );
    expect(states[0].defaulted).toBe(false);
    expect(states[1].defaulted).toBe(false);
    expect(states[2].defaulted).toBe(true);
    expect(states[2].status).toBe("defaulted");
    expect(states[3].defaulted).toBe(true);
    expect(states[3].status).toBe("defaulted");
  });
});

describe("defaultersFromBitmap", () => {
  it("extracts defaulter addresses accurately", () => {
    const members = [ALICE, BOB, CAROL, DAVE];
    // Bits 1 and 3 = Bob and Dave
    const bitmap = (1 << 1) | (1 << 3);
    const result = defaultersFromBitmap(bitmap, members);
    expect(result).toEqual([BOB, DAVE]);
  });
});

describe("tookPotThenStopped", () => {
  const members = [ALICE, BOB, CAROL, DAVE];

  it("detects when a defaulter received pot in an earlier round", () => {
    // Failing in round 1 (0-indexed). Alice received in round 0 (1-indexed = round 1).
    // If Alice defaults in round 1:
    const result = tookPotThenStopped(ALICE, members, 1, [true, false, false, false]);
    expect(result.tookPot).toBe(true);
    expect(result.receivedRound).toBe(1);
    expect(result.failedRound).toBe(2);
  });

  it("detects when a defaulter had not received earlier pot", () => {
    // Carol defaults in round 1
    const result = tookPotThenStopped(CAROL, members, 1, [true, false, false, false]);
    expect(result.tookPot).toBe(false);
  });
});

describe("describeRound", () => {
  const mockCircle: CircleView = {
    id: 1n,
    creator: ALICE,
    contribution: parseEther("0.1"),
    interval: 86400n * 7n,
    memberCount: 4,
    joinedCount: 2,
    round: 0,
    state: 0, // Forming
    roundDeadline: 0n,
    joinBy: 1760000000n,
    createdBlock: 100,
    pot: parseEther("0.4"),
    recipient: ALICE,
    paidCount: 0,
    defaulters: 0
  };

  it("describes forming state", () => {
    const desc = describeRound(mockCircle, 1759000000);
    expect(desc.headline).toBe("Forming (2/4 joined)");
    expect(desc.isLapsed).toBe(false);

    const expired = describeRound(mockCircle, 1761000000);
    expect(expired.subline).toBe("Join window expired");
    expect(expired.isLapsed).toBe(true);
  });

  it("describes active state", () => {
    const active: CircleView = {
      ...mockCircle,
      state: 1,
      round: 1,
      roundDeadline: 1760500000n
    };
    const desc = describeRound(active, 1760000000);
    expect(desc.headline).toBe("Round 2 of 4");
    expect(desc.isLapsed).toBe(false);

    const lapsed = describeRound(active, 1760600000);
    expect(lapsed.isLapsed).toBe(true);
    expect(lapsed.subline).toContain("ready to mark as failed");
  });

  it("describes complete state", () => {
    const complete: CircleView = { ...mockCircle, state: 2, round: 4 };
    const desc = describeRound(complete);
    expect(desc.headline).toBe("Complete");
    expect(desc.subline).toBe("All 4 rounds successfully completed");
  });

  it("describes failed state", () => {
    const failed: CircleView = { ...mockCircle, state: 3, round: 1 };
    const desc = describeRound(failed);
    expect(desc.headline).toBe("Failed in round 2");
    expect(desc.isLapsed).toBe(true);
  });

  it("describes cancelled state", () => {
    const cancelled: CircleView = { ...mockCircle, state: 4 };
    const desc = describeRound(cancelled);
    expect(desc.headline).toBe("Cancelled");
  });
});

describe("schedule", () => {
  it("creates schedule entries for all rounds", () => {
    const circle: CircleView = {
      id: 1n,
      creator: ALICE,
      contribution: parseEther("0.1"),
      interval: 86400n * 7n,
      memberCount: 3,
      joinedCount: 3,
      round: 0,
      state: 1,
      roundDeadline: 1760000000n,
      joinBy: 1750000000n,
      createdBlock: 1,
      pot: parseEther("0.3"),
      recipient: ALICE,
      paidCount: 0,
      defaulters: 0
    };

    const sched = schedule(circle, 1760000000);
    expect(sched.length).toBe(3);
    expect(sched[0].round).toBe(1);
    expect(sched[1].round).toBe(2);
    expect(sched[2].round).toBe(3);
  });
});

describe("validateCreate", () => {
  const validBase = {
    members: [ALICE, BOB, CAROL],
    contribution: "0.1",
    interval: MIN_INTERVAL,
    joinWindow: MIN_JOIN_WINDOW,
    name: "Valid Circle",
    userAddress: ALICE
  };

  it("accepts valid input", () => {
    expect(validateCreate(validBase)).toEqual({ valid: true });
  });

  it("rejects fewer than 3 members", () => {
    const res = validateCreate({ ...validBase, members: [ALICE, BOB] });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("between 3 and 12 members");
  });

  it("rejects more than 12 members", () => {
    const thirteen = Array.from({ length: 13 }, (_, i) =>
      `0x${(i + 1).toString().padStart(40, "0")}`
    );
    const res = validateCreate({ ...validBase, members: thirteen, userAddress: undefined });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("between 3 and 12 members");
  });

  it("rejects invalid addresses", () => {
    const res = validateCreate({ ...validBase, members: [ALICE, BOB, "not-an-address"] });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("not a valid address");
  });

  it("rejects zero address", () => {
    const res = validateCreate({
      ...validBase,
      members: [ALICE, BOB, "0x0000000000000000000000000000000000000000"]
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("cannot be the zero address");
  });

  it("rejects duplicate members with 1-based positions", () => {
    const res = validateCreate({ ...validBase, members: [ALICE, BOB, ALICE] });
    expect(res.valid).toBe(false);
    expect(res.error).toBe("Members 1 and 3 are the same wallet.");
  });

  it("rejects when creator is not in members", () => {
    const res = validateCreate({ ...validBase, userAddress: DAVE });
    expect(res.valid).toBe(false);
    expect(res.error).toBe("You have to be in your own circle.");
  });

  it("rejects zero or invalid contribution", () => {
    expect(validateCreate({ ...validBase, contribution: "0" }).valid).toBe(false);
    expect(validateCreate({ ...validBase, contribution: "abc" }).valid).toBe(false);
  });

  it("rejects out-of-range interval", () => {
    expect(validateCreate({ ...validBase, interval: MIN_INTERVAL - 1n }).valid).toBe(false);
    expect(validateCreate({ ...validBase, interval: MAX_INTERVAL + 1n }).valid).toBe(false);
  });

  it("rejects out-of-range join window", () => {
    expect(validateCreate({ ...validBase, joinWindow: MIN_JOIN_WINDOW - 1n }).valid).toBe(false);
    expect(validateCreate({ ...validBase, joinWindow: MAX_JOIN_WINDOW + 1n }).valid).toBe(false);
  });

  it("rejects name longer than 40 bytes", () => {
    const longName = "A".repeat(41);
    const res = validateCreate({ ...validBase, name: longName });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("at most 40 bytes");
  });
});
