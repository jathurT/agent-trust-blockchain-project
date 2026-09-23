// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./support/EscrowFixture.sol";
import {AgentTrustEscrow} from "../src/AgentTrustEscrow.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice CONTRACT-008 — `refund()` after deadline plus grace.
///         The refund is the buyer's safety valve, and the whole difficulty is that it
///         must not double as a way to take a delivered job for free.
contract RefundTest is EscrowFixture {
    bytes32 internal constant SALT = keccak256("seller salt");

    function _warpPastGrace(bytes32 jobId) internal {
        vm.warp(uint256(escrow.jobs(jobId).deadline) + GRACE + 1);
    }

    // ------------------------------------------------------------------ the valve

    function test_RefundReturnsTheMoneyToThePayerAfterGrace() public {
        bytes32 jobId = _fund(NONCE);
        uint256 before = usdc.balanceOf(buyer);
        _warpPastGrace(jobId);

        assertTrue(escrow.isRefundable(jobId));
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgentTrustEscrow.JobRefunded(jobId, buyer, address(usdc), PRICE);
        escrow.refund(jobId);

        assertEq(usdc.balanceOf(buyer), before + PRICE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.jobs(jobId).state), uint8(AgentTrustEscrow.State.Refunded));
    }

    /// @dev Acceptance (a). The grace period exists so an attestation that was timely
    ///      but mined late still lands before the money leaves (DF-05).
    function test_RefundBeforeDeadlinePlusGraceReverts() public {
        bytes32 jobId = _fund(NONCE);
        uint64 deadline = escrow.jobs(jobId).deadline;

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.DeadlineNotReached.selector, uint64(vm.getBlockTimestamp()), deadline + GRACE
            )
        );
        escrow.refund(jobId);

        // Right on the boundary is still too early.
        vm.warp(uint256(deadline) + GRACE);
        assertFalse(escrow.isRefundable(jobId));
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.DeadlineNotReached.selector, uint64(vm.getBlockTimestamp()), deadline + GRACE
            )
        );
        escrow.refund(jobId);

        vm.warp(uint256(deadline) + GRACE + 1);
        escrow.refund(jobId);
    }

    /// @dev Acceptance (e). Permissionless, but the destination is fixed: a stranger
    ///      who refunds a job pays the gas and gets nothing.
    function test_RefundIsPermissionlessAndAlwaysPaysThePayer() public {
        bytes32 jobId = _fund(NONCE);
        _warpPastGrace(jobId);

        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.prank(stranger);
        escrow.refund(jobId);

        assertEq(usdc.balanceOf(buyer), buyerBefore + PRICE);
        assertEq(usdc.balanceOf(stranger), 0);
        assertEq(usdc.balanceOf(seller), 0);
    }

    // ------------------------------------------------ what a refund must not take

    /// @dev Acceptance (b). The blueprint's `refund()` never looked at the attestation
    ///      at all, so a buyer could take back the money for work that was delivered
    ///      and approved (DF-05).
    function test_RefundWithARecordedPassReverts() public {
        bytes32 jobId = _fund(NONCE);
        _attest(_bind(jobId, SALT), 100);
        escrow.confirmValidation(jobId);
        _warpPastGrace(jobId);

        assertFalse(escrow.isRefundable(jobId));
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.ValidationExists.selector, jobId));
        escrow.refund(jobId);

        escrow.release(jobId);
        assertEq(usdc.balanceOf(seller), PRICE);
    }

    /// @dev And a pass that was timely but that nobody bothered to snapshot counts too,
    ///      otherwise the buyer could win simply by being the first to call.
    function test_RefundWithAnUnrecordedButTimelyPassReverts() public {
        bytes32 jobId = _fund(NONCE);
        _attest(_bind(jobId, SALT), 100);
        _warpPastGrace(jobId);

        assertFalse(escrow.jobs(jobId).validationRecorded);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.ValidationExists.selector, jobId));
        escrow.refund(jobId);
    }

    // ----------------------------------------------------- what a refund must take

    /// @dev Acceptance (c). A request that was filed and never answered reads exactly
    ///      like a response of 0 (V-99), which is why there is no early refund — but
    ///      after the deadline and grace the buyer must still get its money back.
    ///      The free-service case cannot arise, because a pass needs
    ///      `response >= PASS_THRESHOLD` and a pending request has response 0.
    function test_RefundAfterAPendingOnlyRequestSucceeds() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        // Filed, never answered. lastUpdate is already set, response is still 0.
        (,, uint8 response,,, uint256 lastUpdate) = validation.getValidationStatus(requestHash);
        assertEq(response, 0);
        assertGt(lastUpdate, 0);

        _warpPastGrace(jobId);
        escrow.refund(jobId);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    /// @dev Acceptance (d).
    function test_RefundAfterAFailingResponseSucceeds() public {
        bytes32 jobId = _fund(NONCE);
        _attest(_bind(jobId, SALT), 0);
        _warpPastGrace(jobId);

        escrow.refund(jobId);
        assertEq(usdc.balanceOf(buyer), 1000 * PRICE);
    }

    function test_RefundAfterAnUnderThresholdResponseSucceeds() public {
        bytes32 jobId = _fund(NONCE);
        _attest(_bind(jobId, SALT), escrow.PASS_THRESHOLD() - 1);
        _warpPastGrace(jobId);
        escrow.refund(jobId);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    /// @dev A late pass does not block the refund: the attestation has to be timely,
    ///      not merely to exist.
    function test_RefundAfterALatePassSucceeds() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        vm.warp(uint256(escrow.jobs(jobId).deadline) + 1);
        _attest(requestHash, 100);

        _warpPastGrace(jobId);
        assertTrue(escrow.isRefundable(jobId));
        escrow.refund(jobId);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    /// @dev Never bound at all: the seller simply did not turn up.
    function test_RefundWithNoValidationAtAllSucceeds() public {
        bytes32 jobId = _fund(NONCE);
        _warpPastGrace(jobId);
        escrow.refund(jobId);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_RefundingTwiceReverts() public {
        bytes32 jobId = _fund(NONCE);
        _warpPastGrace(jobId);
        escrow.refund(jobId);

        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.BadState.selector, jobId, AgentTrustEscrow.State.Refunded)
        );
        escrow.refund(jobId);
    }

    // ---------------------------------------------------------------------- grace

    /// @dev Grace is owner-configurable, but each job freezes it at funding time.
    ///      Before that snapshot existed, `setGrace` was the one administrative call
    ///      that could reach an already-funded job: shortening it opened the refund
    ///      valve under a seller whose validator was about to attest. The security
    ///      review found it; this test now pins the opposite.
    function test_ShorteningGraceDoesNotOpenTheValveOnAFundedJob() public {
        bytes32 jobId = _fund(NONCE);
        assertEq(escrow.jobs(jobId).grace, GRACE);

        vm.warp(uint256(escrow.jobs(jobId).deadline) + 1 minutes);
        assertFalse(escrow.isRefundable(jobId));

        vm.prank(owner);
        escrow.setGrace(30 seconds);

        assertFalse(escrow.isRefundable(jobId));
        vm.expectRevert();
        escrow.refund(jobId);

        // The new value applies to the next job, not to this one.
        bytes32 later = _fund(bytes32(uint256(2)));
        assertEq(escrow.jobs(later).grace, 30 seconds);
    }

    /// @dev And the dangerous direction: a huge grace used to overflow
    ///      `job.deadline + grace`, so `refund()` reverted for every funded job — and
    ///      with `renounceOwnership` being a single step, permanently.
    function test_ALargeGraceCannotFreezeAnExistingJob() public {
        bytes32 jobId = _fund(NONCE);

        // Read the bound before pranking: a call inside the expectRevert argument
        // would consume the prank and the setter would run as the test contract.
        uint64 maxGrace = escrow.MAX_GRACE();

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.GraceOutOfBounds.selector, type(uint64).max, maxGrace)
        );
        escrow.setGrace(type(uint64).max);

        // Even at the largest permitted value, this job is unaffected.
        vm.prank(owner);
        escrow.setGrace(maxGrace);
        _warpPastGrace(jobId);
        escrow.refund(jobId);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    /// @dev The gap my own mutation testing found: a pass that was snapshotted and then
    ///      overwritten in the registry must still block the refund. Only the
    ///      `validationRecorded` flag stands in the way at that point.
    function test_RefundBlockedByASnapshotEvenAfterTheRegistryFlips() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);
        _attest(requestHash, 100);
        escrow.confirmValidation(jobId);

        _attest(requestHash, 0); // the validator changes its mind
        _warpPastGrace(jobId);

        assertFalse(escrow.isRefundable(jobId));
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.ValidationExists.selector, jobId));
        escrow.refund(jobId);

        escrow.release(jobId);
        assertEq(usdc.balanceOf(seller), PRICE);
    }

    function test_OnlyTheOwnerSetsGrace() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        escrow.setGrace(1);
    }

    // ----------------------------------------------------------- the whole balance

    /// @dev Whatever the path, the escrow keeps nothing and pays exactly one party.
    function testFuzz_EveryJobPaysExactlyOnePartyInFull(bool validated, uint64 ttl) public {
        ttl = uint64(bound(ttl, MIN_TTL, MAX_TTL));
        bytes32 jobId = _fund(NONCE, ttl);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        if (validated) {
            _attest(_bind(jobId, SALT), 100);
            escrow.release(jobId);
            assertEq(usdc.balanceOf(seller), PRICE);
            assertEq(usdc.balanceOf(buyer), buyerBefore);
        } else {
            _warpPastGrace(jobId);
            escrow.refund(jobId);
            assertEq(usdc.balanceOf(seller), 0);
            assertEq(usdc.balanceOf(buyer), buyerBefore + PRICE);
        }
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }
}
