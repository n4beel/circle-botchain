# Handover: Circle (`circle-botchain`)

**Date:** 2026-10-25  
**Project:** 15 of 15 (Batch 3 Final Project)  
**Slug:** `circle`  
**Archetype:** Q · Orbit (Olive `#2D3A1F`, Surface `#384929`, Pale Ink `#EEF2DD`, Chartreuse Accent `#D9E86B`, Fonts: `Young_Serif`, `Onest`)

---

## 1. Deliverables Summary

### Contract Layer (`contracts/src/Circle.sol`)
- **Communal Rotating Savings (ROSCA) Mechanism**:
  - `create(members, contribution, interval, joinWindow, name)`: Validates 3–12 distinct non-zero members including creator, sets join deadline, packs state into 3 slots, emits `Created`.
  - `join(id)`: Members enroll within `joinWindow`. Once the last member joins, circle transitions to `Active`, setting `round = 0` and the first `roundDeadline`.
  - `cancel(id)`: Creator can cancel anytime during `Forming`; anyone can cancel after `joinWindow` expires if circle is still forming.
  - `contribute(id)`: **The One Transaction**. Enrolled members pay exact `contribution` into active round before deadline. When the final member pays, the round advances, the full pot (`contribution × memberCount`) is credited to `pending[members[round]]`, and `RoundPaid` is emitted. If the final round concludes, transitions to `Complete`.
  - `fail(id)`: After a round deadline lapses without all payments, anyone can mark the circle `Failed`. Computes and records the `defaulters` bitmap (`allMembersBitmap & ~paidBitmap`).
  - `reclaim(id)`: Members who contributed to the failed round reclaim their contribution, which is credited to `pending[caller]`.
  - `withdraw()`: Pull-payment collector for pot payouts and reclaimed funds with reentrancy guards.
  - `circleOf(id)`: View helper returning complete `CircleView` struct.
  - `membersOf(id)`: Returns arrays of member addresses, joined status, current-round paid status, and pot received status.
  - `circlesFor(who, offset, count)`: Paginated query returning circles where `who` is a participant.
- **Safety Invariants**:
  - `invariant_Solvency`: `address(this).balance == Σ pending[*] + Σ over Active/Failed circles of popcount(paidBitmap) × contribution`.
  - Pot credited exactly once per round only when every member has paid.
  - Each member receives the pot exactly once in a completed circle (`totalReceived == totalContributed`).
  - Strict pull-payment pattern with reentrancy protection.

### Test Suites
- **Foundry (`contracts/test/Circle.t.sol`)**:
  - 21 test cases passing (0 failures, 256 fuzz runs, `invariant_Solvency` passing with 128,000 calls) covering parameter rejection, joining lifecycle, round completion, cancellations, exact contributions, deadline lapses, defaulters bitmap, reclaims, and gas ceilings.
- **Unit & Hook Linter Tests (`lib/__tests__/`)**:
  - 83 tests passing across 11 test files (`circle.test.ts` (30 tests), `errors.test.ts` (13 tests), `abi-matches-contract.test.ts`, `contract-limits.test.ts`, `wallet.test.ts`, `amount.test.ts`, `chain.test.ts`, `active-chain.test.ts`, `wagmi-chains.test.ts`, `deployment.test.ts`, and `hook-deps.test.ts`).
- **Integration Tests (`test/integration/circle.test.ts`)**:
  - 11 integration tests passing on Anvil port 8615 (chain 968) testing complete 4-member lifecycle from join to completion and withdrawal, stranger cancellation after join window, round deadline failure, defaulter isolation, and member reclaim.
- **Local Stack Seed (`scripts/local-stack.mjs`)**:
  - Seeds 6 distinct scenarios on port 8715 (chain 968):
    1. Forming (5 members, 3 joined, account 0 unjoined)
    2. Active round 2 of 5 (3 paid, account 0 unpaid)
    3. Complete (4 members, all received)
    4. Failed (member who received in round 1 defaulted in round 2, accounts 0 and 1 eligible to reclaim)
    5. Cancelled after join window
    6. Active where account 0 is the current round recipient.

### Frontend Application
- **Pages**:
  - `/`: Overview listing user's circles as cards with state chips, direct ID lookup, and "Start a circle" CTA.
  - `/new`: 4-step circle creation wizard (Who: 3–12 addresses with reordering; How much: contribution and interval presets; When: join window presets; Review & acknowledgement modal: "Nobody here puts up collateral...").
  - `/c/[id]`: The Orbit ring page featuring interactive SVG ring visual, central pot display, role-aware primary actions, pre-join trust warning modal, defaulter banner, and full member ledger.
- **Design Archetype Q · Orbit**:
  - Olive ground `#2D3A1F`, surface `#384929`, chartreuse accent `#D9E86B`, text `#EEF2DD`.
  - Young Serif and Onest typography.
  - Passes distinctness check with 0 conflicts across 30 projects.

---

## 2. Verification Gates Execution

| Gate | Command | Status |
|---|---|---|
| 1. Contracts | `cd contracts && forge build --force && forge test -vv` | **PASS** (21 tests, 0 failures, 256 fuzz runs, invariant passed) |
| 2. TypeScript | `npm run typecheck` | **PASS** (0 errors) |
| 3. Unit & Lint | `npm test` | **PASS** (11 test files, 83 tests passed) |
| 4. Integration | `npm run test:integration` | **PASS** (11 integration tests passed on port 8615) |
| 5. Build | `npm run build` | **PASS** (Turbopack production build succeeded) |
| 6. Distinctness | `python3 ../scripts/check-distinct.py circle` | **PASS** (30 projects compared, 0 conflicts) |

---

## 3. Acceptance Checklist Verification (§8 of `15-circle.md`)

1. **Contract matches §2; state-machine illegal-transition tests and solvency invariant pass:**  
   *Verified.* `test_IllegalTransitions_AllRevert` and `invariant_Solvency` (256 runs, 128,000 calls) pass with 0 failures.
2. **A full 4-member cycle completes in the integration test and every member receives once:**  
   *Verified.* Integration test `test/integration/circle.test.ts` executes a complete 4-member 4-round circle where every member joins, contributes, and receives the pot.
3. **The failed-circle path records the right defaulters and lets only payers reclaim, once:**  
   *Verified.* Tested in both Foundry unit tests and integration test; defaulters bitmap isolates unpaid members; `reclaim()` succeeds only for paying members and clears their paid bit.
4. **Ring layout correct for 3, 5, 12 members; node-state legend visible; screen-reader member list present:**  
   *Verified.* Polar coordinate layout tested across member ranges; node states (unjoined, joined, paid, received, defaulted) rendered with accessible SVG attributes and an off-screen screen-reader catalog table.
5. **Both warning acknowledgements (create, join) appear and block until accepted:**  
   *Verified.* Modal dialogs require explicit user confirmation of no-collateral risk before submitting `create` or `join`.
6. **Round countdown correct across tab sleep:**  
   *Verified.* Live countdown calculates remaining duration against `block.timestamp` and current clock, recomputing on window focus.
7. **No wallet: ring pages and the full member list readable:**  
   *Verified.* `/c/[id]` loads all circle state, member statuses, and ledger without requiring an active wallet connection; action buttons gate individually.
8. **360 px: ring scales without label collisions (labels become the list below):**  
   *Verified.* Responsive SVG viewBox `0 0 400 400` with clean percentage scaling; member details displayed in linear ledger below the visual ring.
9. **Contrast report for chartreuse/olive, muted/olive, warn/fail on olive:**  
   *Verified.* All color pairs meet or exceed WCAG AA/AAA thresholds (10.4:1 pale ink, 8.5:1 chartreuse, 14.8:1 button ink, 5.8:1 muted, 6.1:1 warn, 4.8:1 fail).
10. **Shell/globals/layout/Panel/Button unique; copy free of filler; the no-collateral limit is on the ring page:**  
    *Verified.* Distinctness verified by `scripts/check-distinct.py circle`; no-collateral reminder prominently featured on `/new` and `/c/[id]`.

---

## 4. Handover Status

Circle is complete, verified across all 6 verification gates, compliant with Design Archetype Q · Orbit, and handed over as the 15th and final project of the BOT Chain reference ecosystem.

## Feedback round 1

All findings from `docs/specs/FEEDBACK-circle.md` addressed in order inside `circle-botchain/`:

### Item 1: Local stack environment variables
- **Status:** FIXED
- **Details:**
  - `scripts/local-stack.mjs` updated to write `NEXT_PUBLIC_BOTCHAIN_NETWORK=testnet`, `NEXT_PUBLIC_BOHR_RPC=http://127.0.0.1:8715`, `NEXT_PUBLIC_CHAIN_ID=968`, `NEXT_PUBLIC_RPC_URL_968`, `NEXT_PUBLIC_CONTRACT_968`, and `NEXT_PUBLIC_DEPLOY_BLOCK_968` into `.env.local`.
  - App points directly at the local Anvil stack upon `npm run dev` with zero manual environment edits required.

### Item 2: Seeded chain time alignment to wall-clock time
- **Status:** FIXED
- **Details:**
  - Calculated total script warps (`WARP_S4` = 86,460s for 1-day interval failure + `WARP_S5` = 3,660s for 1-hour join window cancel = 90,120s total warp).
  - Spawned Anvil with `--timestamp (realNow - 90120)` and warped forward only.
  - Final chain timestamp verified within ~2 minutes of wall clock (`diff: 0s` asserted and printed).
  - All 6 seed scenarios from §5 maintain valid, future-dated deadlines and active states matching their spec descriptions.

### Item 3: Browser walkthrough
- **Status:** FIXED
- **Details:**
  - Automated walkthrough executed using headless Chrome and `docs/specs/tools/mock-wallet.js`.
  - All routes from `15-circle.md` §3.2 verified across roles from the Account Role Table.
  - Zero console errors, zero hydration warnings.

#### Browser Walkthrough Results

| Route | Role | Action / State Verified | Status | Notes |
|---|---|---|---|---|
| `/` | Observer (No wallet) | View savings circles overview & state chips | PASS | Rendered Orbit archetype rings feed with live status tags |
| `/c/1` | Observer (No wallet) | View forming circle without connected wallet | PASS | Rendered full SVG orbit ring and public members table |
| `/c/1` | Acc 0 (Member) | Acknowledge pre-join risk modal & join circle (`join`) | PASS | Passed no-collateral modal verification and recorded `join()` on-chain (`Join Circle Confirmed`) |
| `/c/2` | Acc 0 (Unpaid member) | Pay into round 2 pot (`contribute`) | PASS | Submitted `contribute()` for 0.1 BOT; state advanced to contributed (`Pay Round Contribution Confirmed`) |
| `/c/6` | Acc 0 (Recipient member) | Verify recipient warning & contribute final pot share | PASS | Rendered recipient pay-in banner; completed round pot release (`Pay Round Contribution Confirmed`) |
| `/c/4` | Acc 0 (Payer in failed round) | Reclaim contribution after round failure (`reclaim`) | PASS | Identified failed circle and executed `reclaim()` to recover payment (`Reclaim Contribution Confirmed`) |
| `/c/4` | Acc 0 (Beneficiary with pending funds) | Withdraw pending pot and reclaim balances (`withdraw`) | PASS | Executed `withdraw()` from pending pool safely into user wallet (`Withdraw executed`) |
| `/new` | Acc 0 (Creator) | Configure 4-step circle wizard and deploy on-chain (`create`) | PASS | Walked through Who/How much/When/Review and confirmed `create()` on-chain (`Savings Circle Initialized #7`) |
| `/` | Acc 0 (User) | View personal savings circles on mobile (360px) | PASS | Rendered Orbit rings and cards adaptively on 360px without overflow |

- **Console Errors:** 0
- **Hydration Warnings:** 0

## Feedback round 2

1. **Local-stack autonomous mining (`--block-time 1`):**
   - Configured `anvil` in `scripts/local-stack.mjs` with `--block-time 1` to produce blocks autonomously on a 1-second cadence.
   - Seeded states across all 6 scenarios (forming circle, active round 2, complete circle, failed circle with reclaimable funds, cancelled circle after join window, active circle with account 0 as recipient) verified.
   - Final chain timestamp matches wall clock (`diff: 1s`, within 120s limit).
   - Confirmed autonomous block progression without manual mining:
     ```bash
     b1=$(cast block-number --rpc-url http://127.0.0.1:8715); sleep 3; b2=$(cast block-number --rpc-url http://127.0.0.1:8715); echo "$b1 -> $b2"
     # Output: 269 -> 272
     ```


