import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEther,
  type Address,
  type Hex
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { circleAbi } from "@/lib/botchain/abi";
import {
  MIN_MEMBERS,
  MAX_MEMBERS,
  MIN_INTERVAL,
  MAX_INTERVAL,
  MIN_JOIN_WINDOW,
  MAX_JOIN_WINDOW,
  MAX_NAME_BYTES,
  MAX_PAGE
} from "@/lib/limits";

const PORT = 8615;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968 as const;

const MNEMONIC = "test test test test test test test test test test test junk";
const accounts = Array.from({ length: 6 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } }
});

let node: ChildProcess;
let publicClient: any;
let wallets: any[];
let circleAddress: Address;

function revertDetails(err: unknown): { errorName?: string; args?: readonly unknown[] } | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const found = err.walk(
    (e) =>
      typeof e === "object" &&
      e !== null &&
      "data" in e &&
      Boolean((e as { data?: { errorName?: string } }).data?.errorName)
  ) as { data?: { errorName?: string; args?: readonly unknown[] } } | null;
  return found?.data;
}

beforeAll(async () => {
  node = spawn(
    "anvil",
    ["--port", String(PORT), "--chain-id", String(CHAIN_ID), "--silent"],
    {
      stdio: ["ignore", "ignore", "inherit"]
    }
  );

  publicClient = createPublicClient({
    chain: local,
    transport: http(RPC)
  });

  wallets = accounts.map((acc) =>
    createWalletClient({
      account: acc,
      chain: local,
      transport: http(RPC)
    })
  );

  // Wait for node to be ready
  for (let i = 0; i < 40; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Deploy Circle contract
  const circleArtifact = JSON.parse(
    readFileSync("contracts/out/Circle.sol/Circle.json", "utf8")
  );
  const hash = await wallets[0].deployContract({
    abi: circleAbi,
    bytecode: circleArtifact.bytecode.object as Hex
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  circleAddress = receipt.contractAddress!;
});

afterAll(() => {
  if (node) {
    node.kill();
  }
});

describe("Circle Integration Tests", () => {
  const CONTRIBUTION = parseEther("0.1");
  const INTERVAL = 86400n; // 1 day
  const JOIN_WINDOW = 3600n; // 1 hour

  it("exposes contract constants matching limits.ts", async () => {
    const minM = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "MIN_MEMBERS"
    });
    const maxM = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "MAX_MEMBERS"
    });
    const minI = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "MIN_INTERVAL"
    });
    const maxI = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "MAX_INTERVAL"
    });
    const minW = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "MIN_JOIN_WINDOW"
    });
    const maxW = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "MAX_JOIN_WINDOW"
    });
    const maxN = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "MAX_NAME_BYTES"
    });
    const maxP = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "MAX_PAGE"
    });

    expect(Number(minM)).toBe(MIN_MEMBERS);
    expect(Number(maxM)).toBe(MAX_MEMBERS);
    expect(minI).toBe(MIN_INTERVAL);
    expect(maxI).toBe(MAX_INTERVAL);
    expect(minW).toBe(MIN_JOIN_WINDOW);
    expect(maxW).toBe(MAX_JOIN_WINDOW);
    expect(Number(maxN)).toBe(MAX_NAME_BYTES);
    expect(Number(maxP)).toBe(MAX_PAGE);
  });

  it("creates a circle and verifies initial state", async () => {
    const members = [
      accounts[0].address,
      accounts[1].address,
      accounts[2].address,
      accounts[3].address
    ];

    const hash = await wallets[0].writeContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "create",
      args: [members, CONTRIBUTION, INTERVAL, JOIN_WINDOW, "Savings Circle 1"]
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe("success");

    const circle = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "circleOf",
      args: [1n]
    });

    expect(circle.id).toBe(1n);
    expect(circle.creator.toLowerCase()).toBe(accounts[0].address.toLowerCase());
    expect(circle.memberCount).toBe(4);
    expect(circle.joinedCount).toBe(0);
    expect(circle.state).toBe(0); // Forming
    expect(circle.contribution).toBe(CONTRIBUTION);
    expect(circle.pot).toBe(parseEther("0.4"));
  });

  it("creator can cancel a forming circle anytime", async () => {
    const members = [
      accounts[0].address,
      accounts[1].address,
      accounts[2].address
    ];

    const createHash = await wallets[0].writeContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "create",
      args: [members, CONTRIBUTION, INTERVAL, JOIN_WINDOW, "To Cancel"]
    });
    await publicClient.waitForTransactionReceipt({ hash: createHash });

    // Stranger cannot cancel before window
    await expect(
      wallets[5].writeContract({
        address: circleAddress,
        abi: circleAbi,
        functionName: "cancel",
        args: [2n]
      })
    ).rejects.toThrow();

    // Creator cancels
    const cancelHash = await wallets[0].writeContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "cancel",
      args: [2n]
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: cancelHash });
    expect(receipt.status).toBe("success");

    const view = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "circleOf",
      args: [2n]
    });
    expect(view.state).toBe(4); // Cancelled
  });

  it("stranger can cancel a forming circle after join window lapses", async () => {
    const members = [
      accounts[0].address,
      accounts[1].address,
      accounts[2].address
    ];

    const createHash = await wallets[0].writeContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "create",
      args: [members, CONTRIBUTION, INTERVAL, JOIN_WINDOW, "Lapsed Window"]
    });
    await publicClient.waitForTransactionReceipt({ hash: createHash });

    // Advance time past join window
    await publicClient.request({
      method: "evm_increaseTime",
      params: [Number(JOIN_WINDOW) + 10]
    });
    await publicClient.request({ method: "evm_mine", params: [] });

    // Stranger cancels
    const cancelHash = await wallets[5].writeContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "cancel",
      args: [3n]
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: cancelHash });
    expect(receipt.status).toBe("success");

    const view = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "circleOf",
      args: [3n]
    });
    expect(view.state).toBe(4); // Cancelled
  });

  it("runs a full 4-member lifecycle from join to completion and withdrawal", async () => {
    const members = [
      accounts[0].address,
      accounts[1].address,
      accounts[2].address,
      accounts[3].address
    ];

    const createHash = await wallets[0].writeContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "create",
      args: [members, CONTRIBUTION, INTERVAL, JOIN_WINDOW, "Full ROSCA"]
    });
    await publicClient.waitForTransactionReceipt({ hash: createHash });
    const circleId = 4n;

    // All 4 members join
    for (let i = 0; i < 4; i++) {
      const joinHash = await wallets[i].writeContract({
        address: circleAddress,
        abi: circleAbi,
        functionName: "join",
        args: [circleId]
      });
      await publicClient.waitForTransactionReceipt({ hash: joinHash });
    }

    // Now state should be Active (1)
    let view = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "circleOf",
      args: [circleId]
    });
    expect(view.state).toBe(1);
    expect(view.joinedCount).toBe(4);
    expect(view.round).toBe(0);

    // Run all 4 rounds
    for (let r = 0; r < 4; r++) {
      for (let m = 0; m < 4; m++) {
        const payHash = await wallets[m].writeContract({
          address: circleAddress,
          abi: circleAbi,
          functionName: "contribute",
          args: [circleId],
          value: CONTRIBUTION
        });
        await publicClient.waitForTransactionReceipt({ hash: payHash });
      }

      // Pot should be credited to recipient of round r
      const recipientAddress = members[r];
      const pendingBal = await publicClient.readContract({
        address: circleAddress,
        abi: circleAbi,
        functionName: "pending",
        args: [recipientAddress]
      });
      expect(pendingBal).toBe(parseEther("0.4"));
    }

    // Now state should be Complete (2)
    view = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "circleOf",
      args: [circleId]
    });
    expect(view.state).toBe(2);
    expect(view.round).toBe(4);

    // Each recipient withdraws their pot
    for (let i = 0; i < 4; i++) {
      const preBal = await publicClient.getBalance({ address: accounts[i].address });
      const wHash = await wallets[i].writeContract({
        address: circleAddress,
        abi: circleAbi,
        functionName: "withdraw",
        args: []
      });
      const wReceipt = await publicClient.waitForTransactionReceipt({ hash: wHash });
      const gasSpent = wReceipt.gasUsed * wReceipt.effectiveGasPrice;
      const postBal = await publicClient.getBalance({ address: accounts[i].address });

      expect(postBal + gasSpent - preBal).toBe(parseEther("0.4"));

      const pendingAfter = await publicClient.readContract({
        address: circleAddress,
        abi: circleAbi,
        functionName: "pending",
        args: [accounts[i].address]
      });
      expect(pendingAfter).toBe(0n);
    }
  });

  it("handles failed round, defaulter tracking, and contribution reclaim", async () => {
    const members = [
      accounts[0].address,
      accounts[1].address,
      accounts[2].address,
      accounts[3].address
    ];

    const createHash = await wallets[0].writeContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "create",
      args: [members, CONTRIBUTION, INTERVAL, JOIN_WINDOW, "Failed ROSCA"]
    });
    await publicClient.waitForTransactionReceipt({ hash: createHash });
    const circleId = 5n;

    // All join
    for (let i = 0; i < 4; i++) {
      await publicClient.waitForTransactionReceipt({
        hash: await wallets[i].writeContract({
          address: circleAddress,
          abi: circleAbi,
          functionName: "join",
          args: [circleId]
        })
      });
    }

    // Accounts 0 and 1 pay. Accounts 2 and 3 do not.
    await publicClient.waitForTransactionReceipt({
      hash: await wallets[0].writeContract({
        address: circleAddress,
        abi: circleAbi,
        functionName: "contribute",
        args: [circleId],
        value: CONTRIBUTION
      })
    });
    await publicClient.waitForTransactionReceipt({
      hash: await wallets[1].writeContract({
        address: circleAddress,
        abi: circleAbi,
        functionName: "contribute",
        args: [circleId],
        value: CONTRIBUTION
      })
    });

    // Advance time past round deadline
    await publicClient.request({
      method: "evm_increaseTime",
      params: [Number(INTERVAL) + 10]
    });
    await publicClient.request({ method: "evm_mine", params: [] });

    // Mark as failed
    const failHash = await wallets[5].writeContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "fail",
      args: [circleId]
    });
    await publicClient.waitForTransactionReceipt({ hash: failHash });

    const view = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "circleOf",
      args: [circleId]
    });
    expect(view.state).toBe(3); // Failed
    // Defaulters: bits 2 and 3 set = (1<<2) | (1<<3) = 12
    expect(view.defaulters).toBe(12);

    // Defaulter (Account 2) trying to reclaim reverts
    await expect(
      wallets[2].writeContract({
        address: circleAddress,
        abi: circleAbi,
        functionName: "reclaim",
        args: [circleId]
      })
    ).rejects.toThrow();

    // Account 0 reclaims
    const recHash0 = await wallets[0].writeContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "reclaim",
      args: [circleId]
    });
    await publicClient.waitForTransactionReceipt({ hash: recHash0 });

    const pend0 = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "pending",
      args: [accounts[0].address]
    });
    expect(pend0).toBe(CONTRIBUTION);

    // Account 0 withdraws reclaimed funds
    await publicClient.waitForTransactionReceipt({
      hash: await wallets[0].writeContract({
        address: circleAddress,
        abi: circleAbi,
        functionName: "withdraw",
        args: []
      })
    });

    const pend0After = await publicClient.readContract({
      address: circleAddress,
      abi: circleAbi,
      functionName: "pending",
      args: [accounts[0].address]
    });
    expect(pend0After).toBe(0n);
  });

  it("checks solvency after all operations", async () => {
    const bal = await publicClient.getBalance({ address: circleAddress });
    // In circle 5, account 1 paid but has not yet reclaimed, so contract holds 0.1 BOT
    expect(bal).toBe(CONTRIBUTION);
  });
});
