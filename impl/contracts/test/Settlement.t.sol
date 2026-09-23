// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./support/EscrowFixture.sol";
import {AgentTrustEscrow} from "../src/AgentTrustEscrow.sol";

/// @notice CONTRACT-007 — `bindValidation`, `confirmValidation` and `release`.
///         Every test here corresponds to a way the blueprint's version lost someone's
///         money, so the names say which.
contract SettlementTest is EscrowFixture {
    bytes32 internal constant SALT = keccak256("seller salt");

    // ------------------------------------------------------------------- binding

    function test_BindingTiesOneRequestHashToTheJob() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        assertEq(escrow.jobs(jobId).requestHash, requestHash);
        assertEq(requestHash, escrow.previewRequestHash(jobId, SALT));
    }

    function test_OnlyThePayeeMayBind() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = escrow.previewRequestHash(jobId, SALT);
        vm.prank(seller);
        validation.validationRequest(validator, sellerAgentId, "", requestHash);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotPayee.selector, buyer, seller));
        escrow.bindValidation(jobId, SALT);
    }

    /// @dev Acceptance (d). One job, one validation request: otherwise a payee could
    ///      shop for a validator until one of them passed it.
    function test_BindingTwiceReverts() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        bytes32 salt2 = keccak256("second salt");
        bytes32 hash2 = escrow.previewRequestHash(jobId, salt2);
        vm.prank(seller);
        validation.validationRequest(validator, sellerAgentId, "", hash2);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.AlreadyBound.selector, jobId, requestHash));
        escrow.bindValidation(jobId, salt2);
    }

    function test_BindingWithoutFilingTheRequestReverts() public {
        bytes32 jobId = _fund(NONCE);
        // Derive the hash before the prank: a call here would consume it.
        bytes32 requestHash = escrow.previewRequestHash(jobId, SALT);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.RequestMismatch.selector, requestHash));
        escrow.bindValidation(jobId, SALT);
    }

    /// @dev A request filed for the right job but naming a validator the buyer never
    ///      agreed to must not bind.
    function test_BindingARequestWithTheWrongValidatorReverts() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = escrow.previewRequestHash(jobId, SALT);
        vm.prank(seller);
        validation.validationRequest(stranger, sellerAgentId, "", requestHash);

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.RequestMismatch.selector, requestHash));
        escrow.bindValidation(jobId, SALT);
    }

    /// @dev Acceptance (e). ERC-8004 request hashes are unique registry-wide and
    ///      first-come, so anyone can burn a predictable one — here for a different
    ///      agent entirely. The salt is the answer: the payee files again under a new
    ///      one and nothing has been lost (DF-06).
    function test_ASquattedHashForcesANewSaltAndStillBinds() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 squatted = escrow.previewRequestHash(jobId, SALT);

        vm.prank(stranger);
        uint256 squatterAgent = identity.register("https://squatter.example/agent.json");
        vm.prank(stranger);
        validation.validationRequest(stranger, squatterAgent, "", squatted);

        // The entry exists but belongs to another agent and another validator.
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.RequestMismatch.selector, squatted));
        escrow.bindValidation(jobId, SALT);

        bytes32 fresh = _bind(jobId, keccak256("a salt they could not guess"));
        assertEq(escrow.jobs(jobId).requestHash, fresh);
        assertTrue(fresh != squatted);
    }

    // ---------------------------------------------------------------- confirming

    function test_ConfirmingSnapshotsAPassingAttestation() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);
        _attest(requestHash, 100);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgentTrustEscrow.ValidationRecorded(jobId, requestHash, 100, vm.getBlockTimestamp());
        escrow.confirmValidation(jobId);

        assertTrue(escrow.jobs(jobId).validationRecorded);
    }

    function test_ConfirmingWithoutAPassReverts() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotValidated.selector, jobId));
        escrow.confirmValidation(jobId);

        _attest(requestHash, 99); // below the threshold
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotValidated.selector, jobId));
        escrow.confirmValidation(jobId);
    }

    function test_ConfirmingBeforeBindingReverts() public {
        bytes32 jobId = _fund(NONCE);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotBound.selector, jobId));
        escrow.confirmValidation(jobId);
    }

    // ------------------------------------------------------------------ releasing

    function test_ReleasePaysTheSnapshottedPayee() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);
        _attest(requestHash, 100);

        uint256 before = usdc.balanceOf(seller);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgentTrustEscrow.JobReleased(jobId, seller, address(usdc), PRICE);
        escrow.release(jobId);

        assertEq(usdc.balanceOf(seller), before + PRICE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.jobs(jobId).state), uint8(AgentTrustEscrow.State.Released));
    }

    /// @dev Anyone may settle a job that has earned its money — which is what lets the
    ///      validator release immediately after attesting (DF-15).
    function test_ReleaseIsPermissionlessAndStillPaysThePayee() public {
        bytes32 jobId = _fund(NONCE);
        _attest(_bind(jobId, SALT), 100);

        vm.prank(stranger);
        escrow.release(jobId);
        assertEq(usdc.balanceOf(seller), PRICE);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    /// @dev **Acceptance (a) — the defect that started DF-05.** The blueprint reverted
    ///      release after the deadline, so a validator attesting at `deadline - 1` and a
    ///      transaction mined a minute later cost the seller the whole payment. What has
    ///      to be timely is the attestation, not the settlement.
    function test_APassAtTheDeadlineStillReleasesAnHourLater() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        uint64 deadline = escrow.jobs(jobId).deadline;
        vm.warp(deadline - 1);
        _attest(requestHash, 100);

        vm.warp(deadline + 1 hours);
        escrow.release(jobId);
        assertEq(usdc.balanceOf(seller), PRICE);
    }

    /// @dev Acceptance (b). Late work is not paid, however good it is.
    function test_AnAttestationAfterTheDeadlineNeverReleases() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        vm.warp(escrow.jobs(jobId).deadline + 1);
        _attest(requestHash, 100);

        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotValidated.selector, jobId));
        escrow.release(jobId);
        assertFalse(escrow.isReleasable(jobId));
    }

    /// @dev Acceptance (c). ERC-8004 responses are repeatable (V-94), so a validator
    ///      that changes its mind must not be able to claw back a confirmed job.
    function test_AnOverwriteAfterTheSnapshotCannotUnRelease() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);
        _attest(requestHash, 100);
        escrow.confirmValidation(jobId);

        _attest(requestHash, 0); // the validator flips its verdict
        escrow.release(jobId);
        assertEq(usdc.balanceOf(seller), PRICE);
    }

    /// @dev And the residual risk, stated as a test rather than only in prose: if the
    ///      flip lands *before* anyone snapshots it, the pass is simply gone. DF-15's
    ///      "the validator releases immediately" is what closes this in practice.
    function test_AnOverwriteBeforeTheSnapshotDoesLoseThePass() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);
        _attest(requestHash, 100);
        _attest(requestHash, 0);

        assertFalse(escrow.isReleasable(jobId));
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotValidated.selector, jobId));
        escrow.release(jobId);
    }

    /// @dev Acceptance (f).
    function test_ReleaseIsImpossibleWithoutABoundHash() public {
        bytes32 jobId = _fund(NONCE);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.NotBound.selector, jobId));
        escrow.release(jobId);
    }

    /// @dev A pass on some other job's request hash must do nothing for this one.
    function test_AnAttestationOnAnotherJobDoesNotRelease() public {
        bytes32 jobA = _fund(NONCE);
        bytes32 jobB = _fund(bytes32(uint256(2)));
        _attest(_bind(jobA, SALT), 100);
        _bind(jobB, keccak256("other salt"));

        assertTrue(escrow.isReleasable(jobA));
        assertFalse(escrow.isReleasable(jobB));
    }

    function test_AJobLeavesFundedExactlyOnce() public {
        bytes32 jobId = _fund(NONCE);
        _attest(_bind(jobId, SALT), 100);
        escrow.release(jobId);

        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.BadState.selector, jobId, AgentTrustEscrow.State.Released)
        );
        escrow.release(jobId);

        vm.warp(vm.getBlockTimestamp() + MAX_TTL + GRACE + 1);
        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.BadState.selector, jobId, AgentTrustEscrow.State.Released)
        );
        escrow.refund(jobId);
    }

    function test_SettlementCallsOnAnUnknownJobRevert() public {
        bytes32 missing = keccak256("nope");
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.UnknownJob.selector, missing));
        escrow.release(missing);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.UnknownJob.selector, missing));
        escrow.refund(missing);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.UnknownJob.selector, missing));
        escrow.bindValidation(missing, SALT);
        assertFalse(escrow.isReleasable(missing));
        assertFalse(escrow.isRefundable(missing));
    }
}
