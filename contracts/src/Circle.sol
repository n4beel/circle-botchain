// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/// @title Circle
/// @notice A rotating savings circle (ROSCA) for 3–12 trusted members.
///         Each round, every member pays an equal contribution. The whole pot
///         goes to one member in fixed order. Rounds release only when all members
///         pay. If a round lapses unpaid, anyone can mark it failed and paying members
///         reclaim their funds.
///
/// What it cannot do:
/// - No collateral: members who already received can stop paying; earlier pots are not clawed back.
/// - Fixed payout order: set at creation, cannot be changed, swapped, or bought.
/// - No interest, leverage, or compounding.
/// - Members are permanently fixed at creation: no additions, removals, or replacements.
contract Circle {
  uint256 public constant MIN_MEMBERS = 3;
  uint256 public constant MAX_MEMBERS = 12;
  uint64  public constant MIN_INTERVAL = 1 days;
  uint64  public constant MAX_INTERVAL = 60 days;
  uint64  public constant MIN_JOIN_WINDOW = 1 hours;
  uint64  public constant MAX_JOIN_WINDOW = 14 days;
  uint256 public constant MAX_NAME_BYTES = 40;
  uint256 public constant MAX_PAGE = 50;

  // States: 0 Forming · 1 Active · 2 Complete · 3 Failed · 4 Cancelled
  struct CircleData {
    address creator;       // 20 bytes ┐ slot 1
    uint64  interval;      //  8 bytes │
    uint32  createdBlock;  //  4 bytes ┘
    uint96  contribution;  // 12 bytes ┐ slot 2
    uint64  roundDeadline; //  8 bytes │ 0 while Forming
    uint16  joinedBitmap;  //  2 bytes │
    uint16  paidBitmap;    //  2 bytes │
    uint8   memberCount;   //  1 byte  │
    uint8   round;         //  1 byte  │
    uint8   state;         //  1 byte  ┘ (27 bytes)
    uint64  joinBy;        //  8 bytes ┐ slot 3
    uint16  defaulters;    //  2 bytes ┘
  }

  struct CircleView {
    uint256 id;
    address creator;
    uint96  contribution;
    uint64  interval;
    uint8   memberCount;
    uint8   joinedCount;
    uint8   round;
    uint8   state;
    uint64  roundDeadline;
    uint64  joinBy;
    uint32  createdBlock;
    uint256 pot;
    address recipient;
    uint8   paidCount;
    uint16  defaulters;
  }

  mapping(uint256 => CircleData) private _circles;
  mapping(uint256 => address[]) private _members;
  mapping(uint256 => mapping(address => uint8)) private _slot; // 1-indexed (0 = not member)
  mapping(address => uint256[]) private _circlesFor;
  mapping(address => uint256) public pending;
  uint256 public circleCount;

  uint256 private _lock = 1;

  modifier nonReentrant() {
    if (_lock != 1) revert TransferFailed();
    _lock = 2;
    _;
    _lock = 1;
  }

  // --- Events ---
  event Created(uint256 indexed id, address indexed creator, uint96 contribution, uint64 interval, uint8 memberCount, uint64 joinBy, string name, address[] members);
  event Joined(uint256 indexed id, address indexed member, uint8 joinedCount);
  event Started(uint256 indexed id, uint64 firstDeadline);
  event Cancelled(uint256 indexed id, address indexed by);
  event Contributed(uint256 indexed id, address indexed member, uint8 round, uint8 paidCount);
  event RoundPaid(uint256 indexed id, uint8 round, address indexed recipient, uint256 pot);
  event Completed(uint256 indexed id);
  event Failed(uint256 indexed id, uint8 round, uint16 defaulters);
  event Reclaimed(uint256 indexed id, address indexed member, uint96 amount);
  event Withdrawn(address indexed who, uint256 amount);

  // --- Errors ---
  error BadMemberCount(uint256 n);
  error BadMember(uint256 index);
  error DuplicateMember(uint256 i, uint256 j);
  error CreatorNotMember();
  error ZeroAmount();
  error BadInterval(uint64 interval);
  error BadJoinWindow(uint64 window);
  error NameTooLong(uint256 length, uint256 max);
  error NoSuchCircle(uint256 id);
  error NotMember(uint256 id, address caller);
  error WrongState(uint256 id, uint8 state);
  error JoinClosed(uint256 id, uint64 joinBy);
  error AlreadyJoined(uint256 id);
  error NotCreator(uint256 id, address caller);
  error RoundLapsed(uint256 id, uint64 deadline);
  error NotLapsed(uint256 id, uint64 deadline);
  error WrongAmount(uint256 expected, uint256 sent);
  error AlreadyPaid(uint256 id, uint8 round);
  error NothingToReclaim(uint256 id);
  error NothingToWithdraw();
  error TransferFailed();

  function _validateMembers(address[] calldata members, address creator) internal pure {
    uint256 len = members.length;
    if (len < MIN_MEMBERS || len > MAX_MEMBERS) revert BadMemberCount(len);
    bool creatorFound = false;
    for (uint256 i = 0; i < len; i++) {
      if (members[i] == address(0)) revert BadMember(i);
      if (members[i] == creator) creatorFound = true;
      for (uint256 j = i + 1; j < len; j++) {
        if (members[i] == members[j]) revert DuplicateMember(i, j);
      }
    }
    if (!creatorFound) revert CreatorNotMember();
  }

  function _emitCreated(
    uint256 id,
    uint96 contribution,
    uint64 interval,
    uint64 joinByTime,
    string calldata name,
    address[] calldata members
  ) private {
    emit Created(id, msg.sender, contribution, interval, uint8(members.length), joinByTime, name, members);
  }

  /// @notice Create a new savings circle with fixed members and payout sequence.
  function create(
    address[] calldata members,
    uint96 contribution,
    uint64 interval,
    uint64 joinWindow,
    string calldata name
  ) external returns (uint256 id) {
    if (contribution == 0) revert ZeroAmount();
    if (interval < MIN_INTERVAL || interval > MAX_INTERVAL) revert BadInterval(interval);
    if (joinWindow < MIN_JOIN_WINDOW || joinWindow > MAX_JOIN_WINDOW) revert BadJoinWindow(joinWindow);
    if (bytes(name).length > MAX_NAME_BYTES) revert NameTooLong(bytes(name).length, MAX_NAME_BYTES);
    _validateMembers(members, msg.sender);

    id = ++circleCount;
    _members[id] = members;

    for (uint256 i = 0; i < members.length; i++) {
      // casting to 'uint8' is safe because members.length <= MAX_MEMBERS (12)
      // forge-lint: disable-next-line(unsafe-typecast)
      _slot[id][members[i]] = uint8(i + 1);
      _circlesFor[members[i]].push(id);
    }

    uint64 joinByTime = uint64(block.timestamp) + joinWindow;

    _circles[id] = CircleData({
      creator: msg.sender,
      interval: interval,
      createdBlock: uint32(block.number),
      contribution: contribution,
      roundDeadline: 0,
      joinedBitmap: 0,
      paidBitmap: 0,
      memberCount: uint8(members.length),
      round: 0,
      state: 0, // Forming
      joinBy: joinByTime,
      defaulters: 0
    });

    _emitCreated(id, contribution, interval, joinByTime, name, members);
  }

  /// @notice Designated member confirms joining the circle.
  function join(uint256 id) external {
    CircleData storage c = _circles[id];
    if (c.memberCount == 0) revert NoSuchCircle(id);
    if (c.state != 0) revert WrongState(id, c.state);
    // forge-lint: disable-next-line(block-timestamp)
    if (block.timestamp > c.joinBy) revert JoinClosed(id, c.joinBy);

    uint8 s = _slot[id][msg.sender];
    if (s == 0) revert NotMember(id, msg.sender);
    uint8 idx = s - 1;

    if ((c.joinedBitmap & (uint16(1) << idx)) != 0) revert AlreadyJoined(id);

    c.joinedBitmap |= (uint16(1) << idx);
    uint8 joinedCount = uint8(_popcount(c.joinedBitmap));

    emit Joined(id, msg.sender, joinedCount);

    if (joinedCount == c.memberCount) {
      c.state = 1; // Active
      c.round = 0;
      c.roundDeadline = uint64(block.timestamp) + c.interval;
      emit Started(id, c.roundDeadline);
    }
  }

  /// @notice Creator cancels while forming, or anyone after join window has passed.
  function cancel(uint256 id) external {
    CircleData storage c = _circles[id];
    if (c.memberCount == 0) revert NoSuchCircle(id);
    if (c.state != 0) revert WrongState(id, c.state);

    // forge-lint: disable-next-line(block-timestamp)
    bool isExpired = block.timestamp > c.joinBy;
    bool isCreator = msg.sender == c.creator;

    if (!isCreator && !isExpired) revert NotCreator(id, msg.sender);

    c.state = 4; // Cancelled
    emit Cancelled(id, msg.sender);
  }

  /// @notice Pay exact contribution for the current active round.
  function contribute(uint256 id) external payable {
    CircleData storage c = _circles[id];
    if (c.memberCount == 0) revert NoSuchCircle(id);
    if (c.state != 1) revert WrongState(id, c.state);
    // forge-lint: disable-next-line(block-timestamp)
    if (block.timestamp > c.roundDeadline) revert RoundLapsed(id, c.roundDeadline);

    uint8 s = _slot[id][msg.sender];
    if (s == 0) revert NotMember(id, msg.sender);
    uint8 idx = s - 1;

    if (msg.value != c.contribution) revert WrongAmount(c.contribution, msg.value);
    if ((c.paidBitmap & (uint16(1) << idx)) != 0) revert AlreadyPaid(id, c.round);

    c.paidBitmap |= (uint16(1) << idx);
    uint8 paidCount = uint8(_popcount(c.paidBitmap));

    emit Contributed(id, msg.sender, c.round, paidCount);

    if (paidCount == c.memberCount) {
      uint256 pot = uint256(c.contribution) * c.memberCount;
      address recipient = _members[id][c.round];

      pending[recipient] += pot;
      emit RoundPaid(id, c.round, recipient, pot);

      c.round++;
      c.paidBitmap = 0;

      if (c.round == c.memberCount) {
        c.state = 2; // Complete
        c.roundDeadline = 0;
        emit Completed(id);
      } else {
        c.roundDeadline = uint64(block.timestamp) + c.interval;
      }
    }
  }

  /// @notice Mark circle failed when a round deadline passes without full contributions.
  function fail(uint256 id) external {
    CircleData storage c = _circles[id];
    if (c.memberCount == 0) revert NoSuchCircle(id);
    if (c.state != 1) revert WrongState(id, c.state);
    // forge-lint: disable-next-line(block-timestamp)
    if (block.timestamp <= c.roundDeadline) revert NotLapsed(id, c.roundDeadline);

    c.state = 3; // Failed
    // forge-lint: disable-next-line(incorrect-shift)
    uint16 allMembers = uint16((uint256(1) << c.memberCount) - 1);
    c.defaulters = allMembers & ~c.paidBitmap;

    emit Failed(id, c.round, c.defaulters);
  }

  /// @notice Reclaim contribution from a failed round if you paid.
  function reclaim(uint256 id) external {
    CircleData storage c = _circles[id];
    if (c.memberCount == 0) revert NoSuchCircle(id);
    if (c.state != 3) revert WrongState(id, c.state);

    uint8 s = _slot[id][msg.sender];
    if (s == 0) revert NotMember(id, msg.sender);
    uint8 idx = s - 1;

    if ((c.paidBitmap & (uint16(1) << idx)) == 0) revert NothingToReclaim(id);

    c.paidBitmap &= ~(uint16(1) << idx);
    pending[msg.sender] += c.contribution;

    emit Reclaimed(id, msg.sender, c.contribution);
  }

  /// @notice Withdraw pending pot payouts or reclaimed funds.
  function withdraw() external nonReentrant {
    uint256 amount = pending[msg.sender];
    if (amount == 0) revert NothingToWithdraw();

    pending[msg.sender] = 0;

    (bool ok, ) = msg.sender.call{value: amount}("");
    if (!ok) revert TransferFailed();

    emit Withdrawn(msg.sender, amount);
  }

  /// @notice View an individual circle summary.
  function circleOf(uint256 id) external view returns (CircleView memory) {
    CircleData storage c = _circles[id];
    if (c.memberCount == 0) revert NoSuchCircle(id);

    uint256 pot = uint256(c.contribution) * c.memberCount;
    address recipient = c.round < c.memberCount ? _members[id][c.round] : address(0);

    return CircleView({
      id: id,
      creator: c.creator,
      contribution: c.contribution,
      interval: c.interval,
      memberCount: c.memberCount,
      joinedCount: uint8(_popcount(c.joinedBitmap)),
      round: c.round,
      state: c.state,
      roundDeadline: c.roundDeadline,
      joinBy: c.joinBy,
      createdBlock: c.createdBlock,
      pot: pot,
      recipient: recipient,
      paidCount: uint8(_popcount(c.paidBitmap)),
      defaulters: c.defaulters
    });
  }

  /// @notice View membership, join status, paid status, and receipt status for all nodes.
  function membersOf(uint256 id) external view returns (
    address[] memory members,
    bool[] memory joined,
    bool[] memory paid,
    bool[] memory received
  ) {
    CircleData storage c = _circles[id];
    if (c.memberCount == 0) revert NoSuchCircle(id);

    members = _members[id];
    uint256 len = members.length;

    joined = new bool[](len);
    paid = new bool[](len);
    received = new bool[](len);

    for (uint256 i = 0; i < len; i++) {
      // casting to 'uint16' is safe because len <= MAX_MEMBERS (12)
      // forge-lint: disable-next-line(unsafe-typecast)
      joined[i] = (c.joinedBitmap & (uint16(1) << uint16(i))) != 0;
      // forge-lint: disable-next-line(unsafe-typecast)
      paid[i] = (c.paidBitmap & (uint16(1) << uint16(i))) != 0;
      received[i] = (c.state == 2) || (i < c.round);
    }
  }

  /// @notice View paginated circles for a given address (newest first).
  function circlesFor(address who, uint256 offset, uint256 count) external view returns (CircleView[] memory) {
    uint256[] storage all = _circlesFor[who];
    uint256 total = all.length;
    if (offset >= total || count == 0) return new CircleView[](0);

    if (count > MAX_PAGE) count = MAX_PAGE;
    if (offset + count > total) count = total - offset;

    CircleView[] memory res = new CircleView[](count);
    for (uint256 i = 0; i < count; i++) {
      uint256 idx = total - 1 - (offset + i);
      uint256 id = all[idx];
      CircleData storage c = _circles[id];
      uint256 pot = uint256(c.contribution) * c.memberCount;
      address recipient = c.round < c.memberCount ? _members[id][c.round] : address(0);

      res[i] = CircleView({
        id: id,
        creator: c.creator,
        contribution: c.contribution,
        interval: c.interval,
        memberCount: c.memberCount,
        joinedCount: uint8(_popcount(c.joinedBitmap)),
        round: c.round,
        state: c.state,
        roundDeadline: c.roundDeadline,
        joinBy: c.joinBy,
        createdBlock: c.createdBlock,
        pot: pot,
        recipient: recipient,
        paidCount: uint8(_popcount(c.paidBitmap)),
        defaulters: c.defaulters
      });
    }

    return res;
  }

  function _popcount(uint16 x) internal pure returns (uint256 count) {
    while (x > 0) {
      count += x & 1;
      x >>= 1;
    }
  }
}
