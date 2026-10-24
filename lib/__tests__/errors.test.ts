import { describe, expect, it } from "vitest";
import { describeError } from "../errors";

describe("describeError", () => {
  it("handles undefined or null error", () => {
    expect(describeError(null)).toBe("Transaction failed.");
    expect(describeError(undefined)).toBe("Transaction failed.");
  });

  it("handles wallet rejection / cancellation", () => {
    expect(describeError(new Error("User rejected the request."))).toBe(
      "Transaction was cancelled in wallet."
    );
    expect(describeError(new Error("Transaction was cancelled"))).toBe(
      "Transaction was cancelled in wallet."
    );
  });

  it("formats WrongAmount correctly (§4.4)", () => {
    const err = {
      data: {
        errorName: "WrongAmount",
        args: [100000000000000000n, 50000000000000000n] // 0.1 BOT, 0.05 BOT
      }
    };
    expect(describeError(err)).toBe("Each round is exactly 0.1 BOT; you sent 0.05.");
  });

  it("formats AlreadyPaid correctly (§4.4)", () => {
    const err = { data: { errorName: "AlreadyPaid", args: [1n, 0] } };
    expect(describeError(err)).toBe("You've already paid this round.");
  });

  it("formats RoundLapsed correctly (§4.4)", () => {
    const err = {
      data: {
        errorName: "RoundLapsed",
        args: [1n, 1760000000]
      }
    };
    const desc = describeError(err);
    expect(desc).toContain("This round closed on");
    expect(desc).toContain("Mark the circle as failed to recover payments.");
  });

  it("formats NotLapsed correctly (§4.4)", () => {
    const err = {
      data: {
        errorName: "NotLapsed",
        args: [1n, 1760000000]
      }
    };
    const desc = describeError(err);
    expect(desc).toContain("The round isn't late yet — it closes");
  });

  it("formats JoinClosed correctly (§4.4)", () => {
    const err = {
      data: {
        errorName: "JoinClosed",
        args: [1n, 1760000000]
      }
    };
    const desc = describeError(err);
    expect(desc).toContain("The window to join closed on");
  });

  it("formats NotMember correctly (§4.4)", () => {
    const err = {
      data: {
        errorName: "NotMember",
        args: [1n, "0xA11CE00000000000000000000000000000000001"]
      }
    };
    expect(describeError(err)).toBe("0xA11C…0001 isn't a member of this circle.");
  });

  it("formats WrongState correctly (§4.4)", () => {
    expect(describeError({ data: { errorName: "WrongState", args: [1n, 0] } })).toBe(
      "This circle is forming, so that isn't possible."
    );
    expect(describeError({ data: { errorName: "WrongState", args: [1n, 1] } })).toBe(
      "This circle is active, so that isn't possible."
    );
    expect(describeError({ data: { errorName: "WrongState", args: [1n, 2] } })).toBe(
      "This circle is complete, so that isn't possible."
    );
    expect(describeError({ data: { errorName: "WrongState", args: [1n, 3] } })).toBe(
      "This circle is failed, so that isn't possible."
    );
    expect(describeError({ data: { errorName: "WrongState", args: [1n, 4] } })).toBe(
      "This circle is cancelled, so that isn't possible."
    );
  });

  it("formats NothingToReclaim correctly (§4.4)", () => {
    const err = { data: { errorName: "NothingToReclaim", args: [1n] } };
    expect(describeError(err)).toBe(
      "You didn't pay in the failing round, so there's nothing to take back."
    );
  });

  it("formats CreatorNotMember correctly (§4.4)", () => {
    const err = { data: { errorName: "CreatorNotMember", args: [] } };
    expect(describeError(err)).toBe("You have to be in your own circle.");
  });

  it("formats DuplicateMember correctly (§4.4)", () => {
    const err = { data: { errorName: "DuplicateMember", args: [0, 2] } };
    expect(describeError(err)).toBe("Members 1 and 3 are the same wallet.");
  });

  it("formats other custom errors", () => {
    expect(describeError({ data: { errorName: "BadMemberCount", args: [2] } })).toBe(
      "A circle requires between 3 and 12 members."
    );
    expect(describeError({ data: { errorName: "BadMember", args: [1] } })).toBe(
      "Member address at position 2 is invalid."
    );
    expect(describeError({ data: { errorName: "ZeroAmount", args: [] } })).toBe(
      "Contribution amount must be greater than zero."
    );
    expect(describeError({ data: { errorName: "BadInterval", args: [100] } })).toBe(
      "Round interval must be between 1 and 60 days."
    );
    expect(describeError({ data: { errorName: "BadJoinWindow", args: [100] } })).toBe(
      "Join window must be between 1 hour and 14 days."
    );
    expect(describeError({ data: { errorName: "NameTooLong", args: [45, 40] } })).toBe(
      "Circle name must be at most 40 bytes."
    );
    expect(describeError({ data: { errorName: "NoSuchCircle", args: [99] } })).toBe(
      "Circle #99 does not exist."
    );
    expect(describeError({ data: { errorName: "AlreadyJoined", args: [1] } })).toBe(
      "You have already joined this circle."
    );
    expect(describeError({ data: { errorName: "NotCreator", args: [1] } })).toBe(
      "Only the creator can cancel this circle during the join window."
    );
    expect(describeError({ data: { errorName: "NothingToWithdraw", args: [] } })).toBe(
      "You have no pending balance to withdraw."
    );
    expect(describeError({ data: { errorName: "TransferFailed", args: [] } })).toBe(
      "BOT transfer failed or reentrancy was rejected."
    );
  });
});
