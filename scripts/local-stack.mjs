/**
 * Local stack runner and seeder for Circle.
 *
 * Spawns anvil on port 8715 with chain id 968, deploys Circle,
 * and seeds the 6 scenarios from 15-circle.md §5:
 * (1) Forming — 5 members, 3 joined, account 0 hasn't
 * (2) Active round 2 of 5, three paid, account 0 unpaid
 * (3) Complete (4 members)
 * (4) Failed — member received in round 1 defaulted in round 2, accounts 0 and 1 can reclaim
 * (5) Cancelled after the join window
 * (6) Active where account 0 is current recipient.
 *
 * Usage:
 *   node scripts/local-stack.mjs
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseEther,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const PORT = 8715;
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 968;

const MNEMONIC = "test test test test test test test test test test test junk";

const local = defineChain({
  id: CHAIN_ID,
  name: "anvil",
  nativeCurrency: { name: "Test BOT", symbol: "tBOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

try {
  execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`);
} catch {}

const WARP_S4 = 86400 + 60; // 86460s for 1-day interval round deadline
const WARP_S5 = 3600 + 60;  // 3660s for 1-hour join window
const TOTAL_WARP = WARP_S4 + WARP_S5; // 90120s (~25 hours)

const realNow = Math.floor(Date.now() / 1000);
const startTimestamp = realNow - TOTAL_WARP;

console.log(`Starting anvil on port ${PORT} with start timestamp ${startTimestamp}...`);
spawn(
  "anvil",
  [
    "--port", String(PORT),
    "--chain-id", String(CHAIN_ID),
    "--accounts", "10",
    "--timestamp", String(startTimestamp),
    "--silent"
  ],
  {
    detached: true,
    stdio: "ignore",
  }
).unref();

const pub = createPublicClient({ chain: local, transport: http(RPC) });

const accounts = Array.from({ length: 10 }, (_, i) =>
  mnemonicToAccount(MNEMONIC, { addressIndex: i })
);

const wallets = accounts.map((account) =>
  createWalletClient({ account, chain: local, transport: http(RPC) })
);

async function waitNode() {
  for (let i = 0; i < 40; i++) {
    try {
      await pub.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("Local anvil node failed to respond.");
}

async function main() {
  await waitNode();
  console.log("Anvil running.");

  const circleArtifact = JSON.parse(
    readFileSync("contracts/out/Circle.sol/Circle.json", "utf8")
  );
  const abi = circleArtifact.abi;
  const bytecode = circleArtifact.bytecode.object;

  console.log("Deploying Circle...");
  const deployHash = await wallets[0].deployContract({ abi, bytecode });
  const deployReceipt = await pub.waitForTransactionReceipt({ hash: deployHash });
  const circleAddress = getAddress(deployReceipt.contractAddress);
  const deployBlock = deployReceipt.blockNumber;
  console.log(`Circle deployed at ${circleAddress} (block ${deployBlock})`);

  async function exec(wallet, fnName, args, value = 0n) {
    const hash = await wallet.writeContract({
      address: circleAddress,
      abi,
      functionName: fnName,
      args,
      value,
    });
    return pub.waitForTransactionReceipt({ hash });
  }

  const C = parseEther("0.1"); // 0.1 BOT contribution
  const INTERVAL_LONG = 86400n * 7n; // 7 days
  const JOIN_WINDOW_LONG = 86400n * 7n; // 7 days

  console.log("Seeding Scenario 1: Forming (5 members, 3 joined, account 0 hasn't)...");
  const mem5 = [accounts[0].address, accounts[1].address, accounts[2].address, accounts[3].address, accounts[4].address];
  await exec(wallets[0], "create", [mem5, C, INTERVAL_LONG, JOIN_WINDOW_LONG, "Atlas Circle"]);
  // accounts 1, 2, 3 join; account 0 and 4 have not joined
  await exec(wallets[1], "join", [1n]);
  await exec(wallets[2], "join", [1n]);
  await exec(wallets[3], "join", [1n]);

  console.log("Seeding Scenario 2: Active round 2 of 5, three paid, account 0 unpaid...");
  await exec(wallets[0], "create", [mem5, C, INTERVAL_LONG, JOIN_WINDOW_LONG, "Oasis Savings"]);
  // All 5 join
  for (let i = 0; i < 5; i++) {
    await exec(wallets[i], "join", [2n]);
  }
  // Round 1 (0-indexed round 0): all 5 pay (pot to account 0)
  for (let i = 0; i < 5; i++) {
    await exec(wallets[i], "contribute", [2n], C);
  }
  // Round 2 (0-indexed round 1): three paid (accounts 1, 2, 3), account 0 and 4 unpaid
  await exec(wallets[1], "contribute", [2n], C);
  await exec(wallets[2], "contribute", [2n], C);
  await exec(wallets[3], "contribute", [2n], C);

  console.log("Seeding Scenario 3: Complete (4 members)...");
  const mem4 = [accounts[0].address, accounts[1].address, accounts[2].address, accounts[3].address];
  await exec(wallets[0], "create", [mem4, C, INTERVAL_LONG, JOIN_WINDOW_LONG, "Founding Circle"]);
  for (let i = 0; i < 4; i++) {
    await exec(wallets[i], "join", [3n]);
  }
  for (let r = 0; r < 4; r++) {
    for (let m = 0; m < 4; m++) {
      await exec(wallets[m], "contribute", [3n], C);
    }
  }

  console.log("Seeding Scenario 4: Failed — member received in round 1 defaulted in round 2, accounts 0 and 1 can reclaim...");
  const INTERVAL_S4 = 86400n; // 1 day
  await exec(wallets[0], "create", [mem4, C, INTERVAL_S4, JOIN_WINDOW_LONG, "Tontine Beta"]);
  for (let i = 0; i < 4; i++) {
    await exec(wallets[i], "join", [4n]);
  }
  // Round 1: all pay, pot goes to account 0
  for (let i = 0; i < 4; i++) {
    await exec(wallets[i], "contribute", [4n], C);
  }
  // Round 2: accounts 0 and 1 pay, accounts 2 and 3 default
  await exec(wallets[0], "contribute", [4n], C);
  await exec(wallets[1], "contribute", [4n], C);
  // Advance time past round deadline (warp 1 day + 60s)
  await pub.request({ method: "evm_increaseTime", params: [WARP_S4] });
  await pub.request({ method: "evm_mine", params: [] });
  // Mark as failed
  await exec(wallets[5], "fail", [4n]);

  console.log("Seeding Scenario 5: Cancelled after the join window...");
  const mem3 = [accounts[0].address, accounts[1].address, accounts[2].address];
  const JOIN_WINDOW_S5 = 3600n; // 1 hour
  await exec(wallets[0], "create", [mem3, C, INTERVAL_LONG, JOIN_WINDOW_S5, "Short Window"]);
  await pub.request({ method: "evm_increaseTime", params: [WARP_S5] });
  await pub.request({ method: "evm_mine", params: [] });
  await exec(wallets[5], "cancel", [5n]);

  console.log("Seeding Scenario 6: Active where account 0 is current recipient...");
  // Payout order: account 1 first, account 0 second, account 2 third, account 3 fourth
  const memRecipient0 = [accounts[1].address, accounts[0].address, accounts[2].address, accounts[3].address];
  await exec(wallets[0], "create", [memRecipient0, C, INTERVAL_LONG, JOIN_WINDOW_LONG, "Next in Turn"]);
  for (let i = 0; i < 4; i++) {
    await exec(wallets[i], "join", [6n]);
  }
  // Round 1: all pay, pot goes to account 1
  for (let i = 0; i < 4; i++) {
    await exec(wallets[i], "contribute", [6n], C);
  }
  // In round 2: account 0 is current recipient! (round = 1, recipient = accounts[0])
  // Accounts 1 and 2 pay; account 0 (recipient) has not paid yet
  await exec(wallets[1], "contribute", [6n], C);
  await exec(wallets[2], "contribute", [6n], C);

  // Assert timestamp alignment within ~2 minutes
  const latestBlock = await pub.getBlock();
  const currentNow = Math.floor(Date.now() / 1000);
  const diff = Math.abs(Number(latestBlock.timestamp) - currentNow);
  console.log(`\nFinal chain timestamp: ${latestBlock.timestamp} (real: ${currentNow}, diff: ${diff}s)`);
  if (diff > 120) {
    throw new Error(`Chain timestamp skewed too far from wall clock: ${diff}s`);
  }

  // Write .env.local
  const envContent = [
    `# Auto-generated by scripts/local-stack.mjs`,
    `NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet`,
    `NEXT_PUBLIC_BOHR_RPC=${RPC}`,
    `NEXT_PUBLIC_CHAIN_ID=${CHAIN_ID}`,
    `NEXT_PUBLIC_RPC_URL_${CHAIN_ID}=${RPC}`,
    `NEXT_PUBLIC_CONTRACT_968=${circleAddress}`,
    `NEXT_PUBLIC_DEPLOY_BLOCK_968=${deployBlock > 1n ? deployBlock - 1n : 1n}`,
  ].join("\n");
  writeFileSync(".env.local", envContent + "\n");
  console.log("Updated .env.local");

  console.log(`
=====================================================
Circle local stack ready on ${RPC}
=====================================================
Circle contract: ${circleAddress}

Account Role Table:
-----------------------------------------------------
Acc 0: ${accounts[0].address} (Creator of 1..6; has not joined #1; unpaid in #2; completed #3; paid & can reclaim #4; recipient & unpaid in #6)
Acc 1: ${accounts[1].address} (Joined #1; paid round 2 in #2; completed #3; paid & can reclaim #4; received round 1 pot in #6)
Acc 2: ${accounts[2].address} (Joined #1; paid round 2 in #2; completed #3; defaulted in #4; paid round 2 in #6)
Acc 3: ${accounts[3].address} (Joined #1; paid round 2 in #2; completed #3; defaulted in #4; unpaid round 2 in #6)
Acc 4: ${accounts[4].address} (Has not joined #1; unpaid in #2)
Acc 5: ${accounts[5].address} (Stranger/Observer; marked #4 as failed; cancelled #5 after join window)
-----------------------------------------------------
Seeded Circles:
  - Circle #1: "Atlas Circle" (Forming — 5 members, 3 joined, account 0 hasn't)
  - Circle #2: "Oasis Savings" (Active — round 2 of 5, three paid, account 0 unpaid)
  - Circle #3: "Founding Circle" (Complete — 4 members, all rounds finished)
  - Circle #4: "Tontine Beta" (Failed — member received in round 1 defaulted in round 2, accounts 0 and 1 can reclaim)
  - Circle #5: "Short Window" (Cancelled — cancelled by stranger after join window expired)
  - Circle #6: "Next in Turn" (Active — account 0 is current round 2 recipient and unpaid)
=====================================================
`);
}

main().catch((err) => {
  console.error("Local stack failed:", err);
  process.exit(1);
});
