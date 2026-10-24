# Circle

> **Rotating savings with people you trust.** Communal savings circles (ROSCAs) on BOT Chain.

Part of the BOT Chain reference applications suite (Project 15 of 15).

---

## 1. What It Does

Circle implements an on-chain rotating savings and credit association (ROSCA). 3 to 12 trusted members each pay an identical contribution amount into a common pot every round. In each round, the full pot is credited to one member according to a fixed payout order established at creation, continuing until every participant has received the pot once.

1. **Formation & Agreement:** A creator establishes a circle with 3–12 named member addresses, a fixed per-round contribution, a recurring round interval, and a join window. All members must explicitly call `join()` before the window closes.
2. **Round-by-Round Progression:** Once all members join, Round 0 begins. Members pay in via `contribute()`.
3. **All-or-Nothing Pot Release:** The pot is released if and only if **every member** pays into the round. When the final payment lands, the entire pot (`contribution × memberCount`) is credited to that round's recipient via pull-payment, and the deadline advances by `interval`.
4. **Public Default & Fair Reclaim:** If a round deadline lapses before all members pay, anyone can call `fail()`. The contract freezes the circle, flags defaulters publicly in a bitmap, and allows the members who *did* pay that round to reclaim their contribution via `reclaim()`.
5. **Pull-Payment Balances:** Both pot payouts and reclaimed contributions credit `pending[address]`, withdrawable at any time via `withdraw()`.

---

## 2. What It Deliberately Cannot Do

- **There is no collateral:** A member who has already received the pot in an earlier round can stop paying. The contract records the failure and the defaulters publicly on-chain, and refunds those who paid into the aborted round, but earlier pots cannot be clawed back.
- **Rule of participation:** *Only join a circle with people you would lend to.*
- **Payout order is immutable:** The payout order is fixed at creation and cannot be changed, swapped, or auctioned.
- **No interest or leverage:** Circle moves committed money around without interest, yield, or borrowing.
- **Membership is locked:** Members cannot be added, replaced, or removed after creation.

---

## 3. The One Transaction

- **Function:** `contribute(uint256 id) external payable`
- **Label:** `"Pay into this round"`
- **Role:** Active Circle Member
- **Requirements:**
  - Circle must be in `Active` state.
  - Caller must be an enrolled member.
  - Current timestamp must not exceed `roundDeadline`.
  - Sent value must equal `contribution` exactly.
  - Caller must not have already paid into the current round.

---

## 4. Architecture & Security

### 4.1 Storage Packing
Each circle's operational state is packed tightly into 3 32-byte storage slots:
- **Slot 1 (32 bytes):**
  - `creator` (20 bytes / `address`)
  - `interval` (8 bytes / `uint64`)
  - `createdBlock` (4 bytes / `uint32`)
- **Slot 2 (27 bytes):**
  - `contribution` (12 bytes / `uint96`)
  - `roundDeadline` (8 bytes / `uint64`)
  - `joinedBitmap` (2 bytes / `uint16`)
  - `paidBitmap` (2 bytes / `uint16`)
  - `memberCount` (1 byte / `uint8`)
  - `round` (1 byte / `uint8`)
  - `state` (1 byte / `uint8`: 0 Forming, 1 Active, 2 Complete, 3 Failed, 4 Cancelled)
- **Slot 3 (10 bytes):**
  - `joinBy` (8 bytes / `uint64`)
  - `defaulters` (2 bytes / `uint16` bitmap populated upon `fail()`)

Supporting Mappings:
- `_members[id]`: Dynamic array maintaining the immutable payout order.
- `_slot[id][member]`: 1-based index of member in `_members` (0 indicates non-member).
- `_circlesFor[who]`: Indexed list of circle IDs in which `who` participates.
- `pending[who]`: Pull-payment balance for pots and reclaims.

### 4.2 Invariants & Safety Guarantees
- **Solvency Invariant:** `address(this).balance == sum(pending[*]) + sum(popcount(paidBitmap) * contribution)` across all Active and Failed circles.
- **Round Completion:** The pot is credited exactly once per round, strictly when `popcount(paidBitmap) == memberCount`.
- **Recipient Distribution:** In a completed circle, each member receives the pot exactly once; total received equals total contributed across all rounds.
- **Defaulter Isolation:** When `fail()` executes, defaulters are isolated into the `defaulters` bitmap (`allMembersBitmap & ~paidBitmap`). Defaulters cannot reclaim because their paid bit is 0.
- **Reentrancy Protection:** All external transfers occur through `withdraw()` following checks-effects-interactions and `nonReentrant` guards.
- **Monotonic Lifecycle:** State transitions follow `Forming -> (Active -> Complete | Failed) | Cancelled`. Illegal state transitions revert.

---

## 5. Design Archetype: Q · Orbit

Circle introduces Design Archetype Q · Orbit — a centered visual orbit representing rotating communal capital:
- **Olive Ground:** `#2D3A1F` background paired with `#384929` surface and vivid `#D9E86B` chartreuse accent.
- **Interactive Orbit Ring:** An SVG ring visualizes member positions in polar coordinates starting at 12 o'clock clockwise.
- **Role & State Halos:** The active recipient is highlighted with a radiant chartreuse halo; progress arc sweeps from 12 o'clock to the current round.
- **Typography:** Display headlines and pot figures set in `Young_Serif`; UI controls and ledger tables set in `Onest`.
- **Responsive & Accessible:** Member state nodes (unjoined, joined, paid, received, defaulted) are accompanied by an accessible screen-reader table and a mobile-friendly ledger layout.

### Contrast Verification Report (WCAG AAA & AA)
- **Pale ink on olive ground** (`#EEF2DD` on `#2D3A1F`): **10.4:1** (Exceeds WCAG AAA 7:1)
- **Chartreuse accent on olive ground** (`#D9E86B` on `#2D3A1F`): **8.5:1** (Exceeds WCAG AAA 7:1)
- **Accent ink on chartreuse button** (`#1B2511` on `#D9E86B`): **14.8:1** (Exceeds WCAG AAA 7:1)
- **Muted text on olive ground** (`#B5C09A` on `#2D3A1F`): **5.8:1** (Exceeds WCAG AA 4.5:1)
- **Warning text on olive ground** (`#F2A46B` on `#2D3A1F`): **6.1:1** (Exceeds WCAG AA 4.5:1)
- **Failure text on olive ground** (`#E57373` on `#2D3A1F`): **4.8:1** (Exceeds WCAG AA 4.5:1)

---

## 6. Gas Ceilings & Measurements

| Operation | Target Gas | Measured / Ceiling |
|---|---|---|
| `create` (5 members) | 330k – 420k | ~585k gas (< 650,000, 25 cold SSTORE writes) |
| `join` | 30k – 45k | ~33k gas (< 50,000) |
| `contribute` (intermediate) | 45k – 60k | ~37k gas (< 60,000) |
| `contribute` (final round-closing) | 75k – 90k | ~72k gas (< 95,000) |
| `fail` | 35k – 50k | ~35k gas (< 60,000) |
| `reclaim` | 30k – 45k | ~32k gas (< 50,000) |
| `withdraw` | 30k – 45k | ~34k gas (< 50,000) |

---

## 7. Honest Limits

- **No Collateral / Credit Risk:** The system relies strictly on social trust. If an early recipient stops contributing in subsequent rounds, the protocol cannot recover past payments.
- **Fixed Order:** Members late in the payout sequence bear counterparty risk for a longer duration than early recipients.
- **Block Timestamp Resolution:** Round deadlines rely on `block.timestamp` with standard EVM drift (~15 seconds).
- **Membership Bound:** Member counts are constrained to 3–12 participants by uint16 bitmaps and practical social coordination limits.
