// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Test} from "forge-std/Test.sol";
import {Circle} from "../src/Circle.sol";

contract MaliciousMember {
  Circle public circle;
  bool public attackWithdraw;

  constructor(Circle _circle) {
    circle = _circle;
  }

  function setAttack(bool _withdraw) external {
    attackWithdraw = _withdraw;
  }

  receive() external payable {
    if (attackWithdraw) {
      attackWithdraw = false;
      circle.withdraw();
    }
  }
}

contract CircleTest is Test {
  Circle public circle;

  address public alice = address(0xA11CE);
  address public bob   = address(0xB0B);
  address public carol = address(0xCA201);
  address public dave  = address(0xDA7E);
  address public eve   = address(0xE7E);
  address public stranger = address(0xF00);

  uint96 public constant CONTRIBUTION = 0.1 ether;
  uint64 public constant INTERVAL = 7 days;
  uint64 public constant JOIN_WINDOW = 3 days;
  string public constant NAME = "Pioneer ROSCA";

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

  function setUp() public {
    circle = new Circle();
    vm.deal(alice, 100 ether);
    vm.deal(bob, 100 ether);
    vm.deal(carol, 100 ether);
    vm.deal(dave, 100 ether);
    vm.deal(eve, 100 ether);
    vm.deal(stranger, 100 ether);
  }

  function _createFourMemberCircle() internal returns (uint256 id) {
    address[] memory members = new address[](4);
    members[0] = alice;
    members[1] = bob;
    members[2] = carol;
    members[3] = dave;

    vm.prank(alice);
    id = circle.create(members, CONTRIBUTION, INTERVAL, JOIN_WINDOW, NAME);
  }

  function test_Create_StoresAndIndexes() public {
    address[] memory members = new address[](4);
    members[0] = alice;
    members[1] = bob;
    members[2] = carol;
    members[3] = dave;

    vm.prank(alice);
    vm.expectEmit(true, true, false, true);
    emit Created(1, alice, CONTRIBUTION, INTERVAL, 4, uint64(block.timestamp + JOIN_WINDOW), NAME, members);
    uint256 id = circle.create(members, CONTRIBUTION, INTERVAL, JOIN_WINDOW, NAME);

    assertEq(id, 1);
    assertEq(circle.circleCount(), 1);

    Circle.CircleView memory v = circle.circleOf(id);
    assertEq(v.id, 1);
    assertEq(v.creator, alice);
    assertEq(v.contribution, CONTRIBUTION);
    assertEq(v.interval, INTERVAL);
    assertEq(v.memberCount, 4);
    assertEq(v.joinedCount, 0);
    assertEq(v.round, 0);
    assertEq(v.state, 0); // Forming
    assertEq(v.pot, 0.4 ether);
    assertEq(v.recipient, alice);

    // Indexed for all members
    Circle.CircleView[] memory aliceList = circle.circlesFor(alice, 0, 10);
    assertEq(aliceList.length, 1);
    assertEq(aliceList[0].id, 1);

    Circle.CircleView[] memory bobList = circle.circlesFor(bob, 0, 10);
    assertEq(bobList.length, 1);
    assertEq(bobList[0].id, 1);
  }

  function test_Create_Rejects_2Members_13Members_Zero_Duplicate_CreatorMissing_ZeroContribution_BadInterval_BadWindow_LongName() public {
    // 2 members (too few)
    address[] memory two = new address[](2);
    two[0] = alice; two[1] = bob;
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.BadMemberCount.selector, 2));
    circle.create(two, CONTRIBUTION, INTERVAL, JOIN_WINDOW, NAME);

    // 13 members (too many)
    address[] memory thirteen = new address[](13);
    for (uint160 i = 0; i < 13; i++) thirteen[i] = address(i + 1);
    thirteen[0] = alice;
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.BadMemberCount.selector, 13));
    circle.create(thirteen, CONTRIBUTION, INTERVAL, JOIN_WINDOW, NAME);

    // Zero member address
    address[] memory zeroMem = new address[](3);
    zeroMem[0] = alice; zeroMem[1] = address(0); zeroMem[2] = carol;
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.BadMember.selector, 1));
    circle.create(zeroMem, CONTRIBUTION, INTERVAL, JOIN_WINDOW, NAME);

    // Duplicate members
    address[] memory dupMem = new address[](3);
    dupMem[0] = alice; dupMem[1] = bob; dupMem[2] = bob;
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.DuplicateMember.selector, 1, 2));
    circle.create(dupMem, CONTRIBUTION, INTERVAL, JOIN_WINDOW, NAME);

    // Creator not a member
    address[] memory noCreator = new address[](3);
    noCreator[0] = bob; noCreator[1] = carol; noCreator[2] = dave;
    vm.prank(alice);
    vm.expectRevert(Circle.CreatorNotMember.selector);
    circle.create(noCreator, CONTRIBUTION, INTERVAL, JOIN_WINDOW, NAME);

    // Zero contribution
    address[] memory four = new address[](4);
    four[0] = alice; four[1] = bob; four[2] = carol; four[3] = dave;
    vm.prank(alice);
    vm.expectRevert(Circle.ZeroAmount.selector);
    circle.create(four, 0, INTERVAL, JOIN_WINDOW, NAME);

    // Bad interval (< 1 day)
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.BadInterval.selector, uint64(1 days - 1)));
    circle.create(four, CONTRIBUTION, uint64(1 days - 1), JOIN_WINDOW, NAME);

    // Bad join window (< 1 hour)
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.BadJoinWindow.selector, uint64(1 hours - 1)));
    circle.create(four, CONTRIBUTION, INTERVAL, uint64(1 hours - 1), NAME);

    // Long name (> 40 bytes)
    bytes memory longName = new bytes(41);
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.NameTooLong.selector, 41, 40));
    circle.create(four, CONTRIBUTION, INTERVAL, JOIN_WINDOW, string(longName));
  }

  function test_Join_AllJoined_StartsAndSetsDeadline() public {
    uint256 id = _createFourMemberCircle();

    vm.prank(alice);
    vm.expectEmit(true, true, false, true);
    emit Joined(id, alice, 1);
    circle.join(id);

    vm.prank(bob);
    circle.join(id);

    vm.prank(carol);
    circle.join(id);

    // Fourth member joins: triggers Started
    uint64 expectedDeadline = uint64(block.timestamp + INTERVAL);
    vm.prank(dave);
    vm.expectEmit(true, false, false, true);
    emit Started(id, expectedDeadline);
    circle.join(id);

    Circle.CircleView memory v = circle.circleOf(id);
    assertEq(v.joinedCount, 4);
    assertEq(v.state, 1); // Active
    assertEq(v.round, 0);
    assertEq(v.roundDeadline, expectedDeadline);
  }

  function test_Join_NotMember_Twice_AfterWindow() public {
    uint256 id = _createFourMemberCircle();

    // Stranger cannot join
    vm.prank(stranger);
    vm.expectRevert(abi.encodeWithSelector(Circle.NotMember.selector, id, stranger));
    circle.join(id);

    // Join once
    vm.prank(alice);
    circle.join(id);

    // Join twice reverts
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.AlreadyJoined.selector, id));
    circle.join(id);

    // Advance past joinBy
    vm.warp(block.timestamp + JOIN_WINDOW + 1);

    // Bob tries to join after window
    uint64 joinBy = circle.circleOf(id).joinBy;
    vm.prank(bob);
    vm.expectRevert(abi.encodeWithSelector(Circle.JoinClosed.selector, id, joinBy));
    circle.join(id);
  }

  function test_Cancel_CreatorAnyTime_AnyoneAfterWindow() public {
    uint256 id1 = _createFourMemberCircle();

    // Stranger cannot cancel before window
    vm.prank(stranger);
    vm.expectRevert(abi.encodeWithSelector(Circle.NotCreator.selector, id1, stranger));
    circle.cancel(id1);

    // Creator can cancel any time while Forming
    vm.prank(alice);
    vm.expectEmit(true, true, false, false);
    emit Cancelled(id1, alice);
    circle.cancel(id1);

    assertEq(circle.circleOf(id1).state, 4); // Cancelled

    // Anyone after window
    uint256 id2 = _createFourMemberCircle();
    vm.warp(block.timestamp + JOIN_WINDOW + 1);

    vm.prank(stranger);
    vm.expectEmit(true, true, false, false);
    emit Cancelled(id2, stranger);
    circle.cancel(id2);

    assertEq(circle.circleOf(id2).state, 4); // Cancelled
  }

  function test_Contribute_ExactAmountOnly() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    // Underpay
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.WrongAmount.selector, CONTRIBUTION, CONTRIBUTION - 1));
    circle.contribute{value: CONTRIBUTION - 1}(id);

    // Overpay
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.WrongAmount.selector, CONTRIBUTION, CONTRIBUTION + 1));
    circle.contribute{value: CONTRIBUTION + 1}(id);
  }

  function test_Contribute_Twice_AlreadyPaid() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    vm.prank(alice);
    circle.contribute{value: CONTRIBUTION}(id);

    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.AlreadyPaid.selector, id, 0));
    circle.contribute{value: CONTRIBUTION}(id);
  }

  function test_Contribute_AfterDeadline_Lapsed() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    uint64 deadline = circle.circleOf(id).roundDeadline;
    vm.warp(deadline + 1);

    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.RoundLapsed.selector, id, deadline));
    circle.contribute{value: CONTRIBUTION}(id);
  }

  function test_LastContribution_PaysPot_AdvancesRound_ResetsBitmap() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    // Alice, Bob, Carol contribute
    vm.prank(alice); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(bob); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(carol); circle.contribute{value: CONTRIBUTION}(id);

    assertEq(circle.circleOf(id).paidCount, 3);
    assertEq(circle.pending(alice), 0);

    // Dave contributes (last of round 0): pot 0.4 ether credited to Alice (recipient 0)
    vm.prank(dave);
    vm.expectEmit(true, false, true, true);
    emit RoundPaid(id, 0, alice, 0.4 ether);
    circle.contribute{value: CONTRIBUTION}(id);

    assertEq(circle.pending(alice), 0.4 ether);

    Circle.CircleView memory v = circle.circleOf(id);
    assertEq(v.round, 1);
    assertEq(v.paidCount, 0); // Reset for round 1
    assertEq(v.recipient, bob); // Next recipient is Bob
    assertEq(v.state, 1); // Still Active
  }

  function test_FullCircle_EveryoneReceivesOnce_Completes() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    address[4] memory memberArr = [alice, bob, carol, dave];

    // Run 4 complete rounds
    for (uint8 r = 0; r < 4; r++) {
      for (uint8 m = 0; m < 4; m++) {
        vm.prank(memberArr[m]);
        circle.contribute{value: CONTRIBUTION}(id);
      }
      assertEq(circle.pending(memberArr[r]), 0.4 ether, "Recipient got pot");
      if (r < 3) {
        assertEq(circle.circleOf(id).round, r + 1);
        assertEq(circle.circleOf(id).state, 1);
      }
    }

    Circle.CircleView memory finalV = circle.circleOf(id);
    assertEq(finalV.state, 2); // Complete
    assertEq(finalV.round, 4);

    // Check membersOf received flags
    (, , , bool[] memory received) = circle.membersOf(id);
    for (uint256 i = 0; i < 4; i++) {
      assertTrue(received[i], "All received");
    }
  }

  function test_Fail_AfterDeadline_RecordsDefaulters() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    // Alice and Bob contribute in round 0; Carol and Dave do not
    vm.prank(alice); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(bob); circle.contribute{value: CONTRIBUTION}(id);

    uint64 deadline = circle.circleOf(id).roundDeadline;

    // Cannot fail before deadline
    vm.prank(stranger);
    vm.expectRevert(abi.encodeWithSelector(Circle.NotLapsed.selector, id, deadline));
    circle.fail(id);

    // Warp past deadline
    vm.warp(deadline + 1);

    // Defaulters bitmap: bits 2 (Carol) and 3 (Dave) = (1<<2) | (1<<3) = 4 | 8 = 12
    uint16 expectedDefaulters = (1 << 2) | (1 << 3);

    vm.prank(stranger);
    vm.expectEmit(true, false, false, true);
    emit Failed(id, 0, expectedDefaulters);
    circle.fail(id);

    Circle.CircleView memory v = circle.circleOf(id);
    assertEq(v.state, 3); // Failed
    assertEq(v.defaulters, expectedDefaulters);
  }

  function test_Reclaim_OnlyPaidMembers_Once() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    // Alice and Bob pay; Carol and Dave default
    vm.prank(alice); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(bob); circle.contribute{value: CONTRIBUTION}(id);

    vm.warp(circle.circleOf(id).roundDeadline + 1);
    circle.fail(id);

    // Alice reclaims
    vm.prank(alice);
    vm.expectEmit(true, true, false, true);
    emit Reclaimed(id, alice, CONTRIBUTION);
    circle.reclaim(id);

    assertEq(circle.pending(alice), CONTRIBUTION);

    // Alice reclaims twice: NothingToReclaim
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.NothingToReclaim.selector, id));
    circle.reclaim(id);

    // Carol defaulted: NothingToReclaim
    vm.prank(carol);
    vm.expectRevert(abi.encodeWithSelector(Circle.NothingToReclaim.selector, id));
    circle.reclaim(id);

    // Stranger: NotMember
    vm.prank(stranger);
    vm.expectRevert(abi.encodeWithSelector(Circle.NotMember.selector, id, stranger));
    circle.reclaim(id);
  }

  function test_Fail_BeforeDeadline_Reverts() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    uint64 deadline = circle.circleOf(id).roundDeadline;
    vm.prank(stranger);
    vm.expectRevert(abi.encodeWithSelector(Circle.NotLapsed.selector, id, deadline));
    circle.fail(id);
  }

  function test_Reclaim_Defaulter_NothingToReclaim() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    vm.prank(alice); circle.contribute{value: CONTRIBUTION}(id);
    // Carol defaults
    vm.warp(circle.circleOf(id).roundDeadline + 1);
    circle.fail(id);

    vm.prank(carol);
    vm.expectRevert(abi.encodeWithSelector(Circle.NothingToReclaim.selector, id));
    circle.reclaim(id);
  }

  function test_Withdraw_PotAndReclaim() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    // Round 0 complete: pot goes to Alice
    vm.prank(alice); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(bob); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(carol); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(dave); circle.contribute{value: CONTRIBUTION}(id);

    assertEq(circle.pending(alice), 0.4 ether);

    uint256 preBal = alice.balance;
    vm.prank(alice);
    vm.expectEmit(true, false, false, true);
    emit Withdrawn(alice, 0.4 ether);
    circle.withdraw();

    assertEq(alice.balance - preBal, 0.4 ether);
    assertEq(circle.pending(alice), 0);

    // Second withdraw reverts
    vm.prank(alice);
    vm.expectRevert(Circle.NothingToWithdraw.selector);
    circle.withdraw();
  }

  function test_IllegalTransitions_AllRevert() public {
    uint256 id = _createFourMemberCircle();

    // Cannot contribute while Forming
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.WrongState.selector, id, 0));
    circle.contribute{value: CONTRIBUTION}(id);

    // Cannot fail while Forming
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.WrongState.selector, id, 0));
    circle.fail(id);

    // Cannot reclaim while Forming
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.WrongState.selector, id, 0));
    circle.reclaim(id);

    // Cancel the circle
    vm.prank(alice);
    circle.cancel(id);

    // Cannot join, contribute, or fail once Cancelled
    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.WrongState.selector, id, 4));
    circle.join(id);

    vm.prank(alice);
    vm.expectRevert(abi.encodeWithSelector(Circle.WrongState.selector, id, 4));
    circle.contribute{value: CONTRIBUTION}(id);
  }

  function test_MembersOf_ReceivedFlags() public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    // In round 0, received is false for all
    (, , , bool[] memory rec0) = circle.membersOf(id);
    assertFalse(rec0[0]);
    assertFalse(rec0[1]);

    // Complete round 0
    vm.prank(alice); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(bob); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(carol); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(dave); circle.contribute{value: CONTRIBUTION}(id);

    // Now round is 1, so received[0] (Alice) is true
    (, , , bool[] memory rec1) = circle.membersOf(id);
    assertTrue(rec1[0], "Alice received");
    assertFalse(rec1[1], "Bob hasn't received yet");
  }

  function test_RevertingRecipient_DoesNotBlockRound() public {
    // Malicious contract that refuses ETH or reenters
    MaliciousMember mal = new MaliciousMember(circle);
    vm.deal(address(mal), 10 ether);

    address[] memory members = new address[](3);
    members[0] = address(mal);
    members[1] = alice;
    members[2] = bob;

    vm.prank(address(mal));
    uint256 id = circle.create(members, CONTRIBUTION, INTERVAL, JOIN_WINDOW, "Attack Circle");

    vm.prank(address(mal)); circle.join(id);
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);

    // Round 0: Malicious member is recipient.
    // Contributing completes the round without calling mal.receive()!
    vm.prank(address(mal)); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(alice); circle.contribute{value: CONTRIBUTION}(id);
    vm.prank(bob); circle.contribute{value: CONTRIBUTION}(id);

    // Round completed, credited to pending
    assertEq(circle.pending(address(mal)), 0.3 ether);
    assertEq(circle.circleOf(id).round, 1);

    // When mal attacks withdraw, reentrancy is blocked
    mal.setAttack(true);
    vm.prank(address(mal));
    vm.expectRevert(Circle.TransferFailed.selector);
    circle.withdraw();
  }

  function test_GasCeilings() public {
    address[] memory five = new address[](5);
    five[0] = alice; five[1] = bob; five[2] = carol; five[3] = dave; five[4] = eve;

    vm.prank(alice);
    uint256 g1 = gasleft();
    uint256 id = circle.create(five, CONTRIBUTION, INTERVAL, JOIN_WINDOW, "Gas Check");
    uint256 createGas = g1 - gasleft();
    assertLt(createGas, 650_000, "create 5 members gas < 650k");

    vm.prank(alice);
    uint256 g2 = gasleft();
    circle.join(id);
    uint256 joinGas = g2 - gasleft();
    assertLt(joinGas, 45_000, "join gas < 45k");

    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);
    vm.prank(eve); circle.join(id);

    vm.prank(alice);
    uint256 g3 = gasleft();
    circle.contribute{value: CONTRIBUTION}(id);
    uint256 contribGas = g3 - gasleft();
    assertLt(contribGas, 90_000, "contribute gas < 90k");
  }

  function invariant_Solvency() public view {
    uint256 count = circle.circleCount();
    uint256 expectedBalance = circle.pending(alice) + circle.pending(bob) + circle.pending(carol) + circle.pending(dave) + circle.pending(eve) + circle.pending(stranger);

    for (uint256 i = 1; i <= count; i++) {
      Circle.CircleView memory v = circle.circleOf(i);
      if (v.state == 1 || v.state == 3) { // Active or Failed
        expectedBalance += uint256(v.paidCount) * v.contribution;
      }
    }

    assertEq(address(circle).balance, expectedBalance, "Solvency invariant holds");
  }

  function testFuzz_RandomPaymentOrders_ConserveFunds(uint8 p0, uint8 p1, uint8 p2, uint8 p3) public {
    uint256 id = _createFourMemberCircle();
    vm.prank(alice); circle.join(id);
    vm.prank(bob); circle.join(id);
    vm.prank(carol); circle.join(id);
    vm.prank(dave); circle.join(id);

    address[4] memory members = [alice, bob, carol, dave];
    bool[4] memory paid;

    uint8[4] memory picks = [p0 % 4, p1 % 4, p2 % 4, p3 % 4];

    for (uint256 i = 0; i < 4; i++) {
      uint8 idx = picks[i];
      if (!paid[idx]) {
        paid[idx] = true;
        vm.prank(members[idx]);
        circle.contribute{value: CONTRIBUTION}(id);
      }
    }

    // Solvency check
    uint256 numPaid = 0;
    for (uint256 i = 0; i < 4; i++) {
      if (paid[i]) numPaid++;
    }

    if (numPaid == 4) {
      assertEq(circle.pending(alice), 0.4 ether);
      assertEq(circle.circleOf(id).round, 1);
    } else {
      assertEq(address(circle).balance, numPaid * CONTRIBUTION);
    }
  }
}
