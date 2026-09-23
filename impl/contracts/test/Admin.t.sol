// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./support/EscrowFixture.sol";
import {AgentTrustEscrow} from "../src/AgentTrustEscrow.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice CONTRACT-010 — configuration without power over user funds.
///
/// The property is stated in CLAUDE.md: **no administrative function can move escrowed
/// funds.** Two things make that true rather than nearly true. Every setting is read
/// only inside `fund()`, so it cannot reach a job that already exists; and `grace`, the
/// one value settlement also reads, is snapshotted into each job at funding time. The
/// security review found `setGrace` before that snapshot existed, and it could both
/// open the refund valve early and — at `type(uint64).max` — freeze every job forever.
contract AdminTest is EscrowFixture {
    bytes32 internal constant SALT = keccak256("seller salt");

    // ------------------------------------------------- nothing reaches a funded job

    /// @dev The entry-point inventory, executed rather than written down: fire every
    ///      owner-reachable setter at its extremes against a funded job, then settle it
    ///      and check the seller was paid in full.
    function test_NoSetterCanTouchAFundedJob() public {
        bytes32 jobId = _fund(NONCE);
        AgentTrustEscrow.Job memory before = escrow.jobs(jobId);

        vm.startPrank(owner);
        escrow.setTokenAllowed(address(usdc), false);
        escrow.setTtlBounds(1 seconds, escrow.MAX_TTL_LIMIT());
        escrow.setGrace(escrow.MAX_GRACE());
        escrow.setGateFloors(escrow.MAX_DISTINCT_FLOOR(), escrow.MAX_COUNT_FLOOR(), type(int128).max);
        escrow.setMaxTrustedClients(0);
        escrow.setReputationReadGas(escrow.MAX_REPUTATION_READ_GAS());
        vm.stopPrank();

        AgentTrustEscrow.Job memory after_ = escrow.jobs(jobId);
        assertEq(after_.amount, before.amount);
        assertEq(after_.payee, before.payee);
        assertEq(after_.deadline, before.deadline);
        assertEq(after_.grace, before.grace);
        assertEq(usdc.balanceOf(address(escrow)), PRICE);

        // And the job still settles normally, to the right party.
        _attest(_bind(jobId, SALT), 100);
        escrow.release(jobId);
        assertEq(usdc.balanceOf(seller), PRICE);
        assertEq(usdc.balanceOf(owner), 0);
    }

    /// @dev De-allowlisting a token must not lock funded jobs in, either.
    function test_RevokingATokenStillLetsExistingJobsRefund() public {
        bytes32 jobId = _fund(NONCE);
        vm.prank(owner);
        escrow.setTokenAllowed(address(usdc), false);

        _warpPast(jobId);
        escrow.refund(jobId);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    /// @dev There is no sweep, no pause and no upgrade path. This is the closest thing
    ///      to a proof the test suite can give: the owner's only reachable functions are
    ///      the six setters plus Ownable2Step's.
    function test_TheOwnerHasNoWayToWithdraw() public {
        bytes32 jobId = _fund(NONCE);
        assertEq(usdc.balanceOf(address(escrow)), PRICE);

        // release pays the snapshotted payee, refund pays the payer; the owner is
        // neither, and calling them from the owner changes nothing about that.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotBound.selector, jobId));
        escrow.release(jobId);

        _warpPast(jobId);
        vm.prank(owner);
        escrow.refund(jobId);
        assertEq(usdc.balanceOf(owner), 0);
        assertEq(usdc.balanceOf(buyer), 1000 * PRICE);
    }

    // --------------------------------------------------------------- every bound

    function test_TtlBoundsAreClamped() public {
        uint64 limit = escrow.MAX_TTL_LIMIT();
        vm.startPrank(owner);
        vm.expectRevert(AgentTrustEscrow.InvalidTtlBounds.selector);
        escrow.setTtlBounds(0, MAX_TTL);
        vm.expectRevert(AgentTrustEscrow.InvalidTtlBounds.selector);
        escrow.setTtlBounds(MAX_TTL, MIN_TTL);
        vm.expectRevert(AgentTrustEscrow.InvalidTtlBounds.selector);
        escrow.setTtlBounds(MIN_TTL, limit + 1);
        escrow.setTtlBounds(MIN_TTL, limit);
        vm.stopPrank();
        assertEq(escrow.maxTtl(), limit);
    }

    function test_GraceIsClamped() public {
        uint64 max = escrow.MAX_GRACE();
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.GraceOutOfBounds.selector, max + 1, max));
        escrow.setGrace(max + 1);
        escrow.setGrace(max);
        vm.stopPrank();
        assertEq(escrow.grace(), max);
    }

    function test_MaxTrustedClientsIsClamped() public {
        uint16 limit = escrow.MAX_TRUSTED_CLIENTS_LIMIT();
        vm.startPrank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.OutOfBounds.selector, "maxTrustedClients", uint256(limit) + 1, uint256(limit)
            )
        );
        escrow.setMaxTrustedClients(limit + 1);
        escrow.setMaxTrustedClients(limit);
        vm.stopPrank();
        assertEq(escrow.maxTrustedClients(), limit);
    }

    /// @dev Both ends. Too low would switch the gate off while leaving it looking
    ///      applied; too high would make `fund()` unaffordable.
    function test_ReputationReadGasIsClampedAtBothEnds() public {
        uint64 lo = escrow.MIN_REPUTATION_READ_GAS();
        uint64 hi = escrow.MAX_REPUTATION_READ_GAS();
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.ReputationReadGasTooLow.selector, lo - 1, lo));
        escrow.setReputationReadGas(lo - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.OutOfBounds.selector, "reputationReadGas", uint256(hi) + 1, uint256(hi)
            )
        );
        escrow.setReputationReadGas(hi + 1);
        escrow.setReputationReadGas(hi);
        vm.stopPrank();
        assertEq(escrow.reputationReadGas(), hi);
    }

    function test_GateFloorsAreClamped() public {
        uint16 maxDistinct = escrow.MAX_DISTINCT_FLOOR();
        uint64 maxCount = escrow.MAX_COUNT_FLOOR();
        vm.startPrank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.OutOfBounds.selector, "minDistinctFloor", uint256(maxDistinct) + 1, uint256(maxDistinct)
            )
        );
        escrow.setGateFloors(maxDistinct + 1, 0, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.OutOfBounds.selector, "minCountFloor", uint256(maxCount) + 1, uint256(maxCount)
            )
        );
        escrow.setGateFloors(0, maxCount + 1, 0);
        escrow.setGateFloors(maxDistinct, maxCount, 0);
        vm.stopPrank();
        assertEq(escrow.minDistinctFloor(), maxDistinct);
    }

    /// @dev The constructor takes the same values and must reject the same extremes,
    ///      or a bad deployment would sidestep every bound above.
    function test_TheConstructorRejectsWhatTheSettersReject() public {
        uint64 maxTtl = escrow.MAX_TTL_LIMIT();

        vm.expectRevert(AgentTrustEscrow.InvalidTtlBounds.selector);
        new AgentTrustEscrow(owner, address(identity), address(reputation), address(validation), MIN_TTL, maxTtl + 1, GRACE, MAX_TRUSTED, READ_GAS);

        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.GraceOutOfBounds.selector, escrow.MAX_GRACE() + 1, escrow.MAX_GRACE())
        );
        new AgentTrustEscrow(owner, address(identity), address(reputation), address(validation), MIN_TTL, MAX_TTL, escrow.MAX_GRACE() + 1, MAX_TRUSTED, READ_GAS);

        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.InvalidValidator.selector, address(0)));
        new AgentTrustEscrow(owner, address(identity), address(reputation), address(0), MIN_TTL, MAX_TTL, GRACE, MAX_TRUSTED, READ_GAS);
    }

    // -------------------------------------------------------------- authorisation

    function test_EverySetterIsOwnerOnly() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setTokenAllowed(address(usdc), false);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setTtlBounds(MIN_TTL, MAX_TTL);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setGrace(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setGateFloors(0, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setMaxTrustedClients(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setReputationReadGas(READ_GAS);
        vm.stopPrank();
    }

    function test_OwnershipTransferNeedsAcceptance() public {
        vm.prank(owner);
        escrow.transferOwnership(stranger);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), stranger);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        escrow.acceptOwnership();

        vm.prank(stranger);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), stranger);
    }

    /// @dev `renounceOwnership` is inherited and lands in one step. It cannot strand
    ///      funds — settlement reads no setting but the snapshotted grace — but it does
    ///      freeze configuration permanently, so it is recorded rather than removed.
    function test_RenouncingOwnershipDoesNotStrandFunds() public {
        bytes32 jobId = _fund(NONCE);
        vm.prank(owner);
        escrow.renounceOwnership();
        assertEq(escrow.owner(), address(0));

        _attest(_bind(jobId, SALT), 100);
        escrow.release(jobId);
        assertEq(usdc.balanceOf(seller), PRICE);
    }

    function _warpPast(bytes32 jobId) internal {
        vm.warp(uint256(escrow.jobs(jobId).deadline) + escrow.jobs(jobId).grace + 1);
    }
}
