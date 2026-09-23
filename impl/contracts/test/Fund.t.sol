// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./support/EscrowFixture.sol";
import {AgentTrustEscrow} from "../src/AgentTrustEscrow.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {FeeOnTransferToken, ReentrantToken, RevertingToken} from "../src/mocks/AdversarialTokens.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice CONTRACT-004 — the escrow state machine and `fund()`.
contract FundTest is EscrowFixture {
    // ------------------------------------------------------------------ helpers

    // --------------------------------------------------------------- happy path

    function test_FundEscrowsTheAmountAndRecordsTheJob() public {
        uint256 buyerBefore = usdc.balanceOf(buyer);

        bytes32 jobId = _fund(NONCE);
        AgentTrustEscrow.Job memory job = escrow.jobs(jobId);

        assertEq(job.payer, buyer);
        assertEq(job.payee, seller);
        assertEq(job.payeeAgentId, sellerAgentId);
        assertEq(job.validator, validator);
        assertEq(job.token, address(usdc));
        assertEq(job.amount, PRICE);
        assertEq(job.deadline, uint64(block.timestamp) + MIN_TTL);
        assertEq(job.fundedAt, uint64(block.timestamp));
        assertEq(uint8(job.state), uint8(AgentTrustEscrow.State.Funded));
        assertEq(job.requestHash, bytes32(0));
        assertFalse(job.validationRecorded);

        assertEq(usdc.balanceOf(address(escrow)), PRICE);
        assertEq(usdc.balanceOf(buyer), buyerBefore - PRICE);
        assertTrue(escrow.consumedNonce(buyer, NONCE));
    }

    function test_FundEmitsTheJobItStored() public {
        bytes32 resourceHash = escrow.previewResourceHash(_resource(), PRICE, address(usdc));
        bytes32 expectedJobId = escrow.previewJobId(buyer, seller, resourceHash, NONCE);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgentTrustEscrow.JobFunded(
            expectedJobId,
            buyer,
            seller,
            sellerAgentId,
            validator,
            address(usdc),
            PRICE,
            resourceHash,
            uint64(block.timestamp) + MIN_TTL
        );
        assertEq(_fund(NONCE), expectedJobId);
    }

    /// @dev V-141: `_lastId++` starts at zero, so the first agent registered is id 0
    ///      and the escrow must not treat that as "unset".
    function test_AgentIdZeroIsFundable() public {
        assertEq(sellerAgentId, 0);
        bytes32 jobId = _fund(NONCE);
        assertEq(escrow.jobs(jobId).payeeAgentId, 0);
    }

    // ----------------------------------------------------------- nonce and replay

    function test_ReplayingANonceReverts() public {
        _fund(NONCE);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.ReplayedNonce.selector, buyer, NONCE));
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());
    }

    /// @dev Nonces are payer-scoped, so one buyer cannot burn another's.
    function test_TheSameNonceIsUsableByADifferentPayer() public {
        _fund(NONCE);

        usdc.mint(stranger, PRICE);
        vm.startPrank(stranger);
        usdc.approve(address(escrow), PRICE);
        bytes32 other = escrow.fund(
            sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate()
        );
        vm.stopPrank();
        assertEq(escrow.jobs(other).payer, stranger);
    }

    /// @dev Acceptance (b): a transfer that fails must undo everything, nonce included,
    ///      or a buyer could be locked out of a nonce by a token that reverts.
    function test_AFailedTransferLeavesTheNonceUnconsumed() public {
        RevertingToken stop = new RevertingToken();
        stop.mint(buyer, PRICE);
        vm.prank(owner);
        escrow.setTokenAllowed(address(stop), true);
        vm.prank(buyer);
        stop.approve(address(escrow), PRICE);

        vm.prank(buyer);
        vm.expectRevert(RevertingToken.TransferBlocked.selector);
        escrow.fund(sellerAgentId, address(stop), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());

        assertFalse(escrow.consumedNonce(buyer, NONCE));
        vm.prank(buyer);
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());
        assertTrue(escrow.consumedNonce(buyer, NONCE));
    }

    function test_AnUnapprovedTransferLeavesTheNonceUnconsumed() public {
        address poor = makeAddr("poor");
        usdc.mint(poor, PRICE);
        vm.prank(poor);
        vm.expectRevert();
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());
        assertFalse(escrow.consumedNonce(poor, NONCE));
    }

    // ---------------------------------------------------------------- token rules

    /// @dev Acceptance (c). Without the balance-delta check the job would record an
    ///      amount the escrow never received, and release would fail or underpay.
    function test_FeeOnTransferTokenReverts() public {
        FeeOnTransferToken fee = new FeeOnTransferToken(100); // 1%
        fee.mint(buyer, PRICE);
        vm.prank(owner);
        escrow.setTokenAllowed(address(fee), true);
        vm.prank(buyer);
        fee.approve(address(escrow), PRICE);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.TransferAmountMismatch.selector, PRICE, PRICE - PRICE / 100)
        );
        escrow.fund(sellerAgentId, address(fee), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());
    }

    function test_TokenNotOnTheAllowlistReverts() public {
        MockUSDC other = new MockUSDC();
        other.mint(buyer, PRICE);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.TokenNotAllowed.selector, address(other)));
        escrow.fund(sellerAgentId, address(other), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());
    }

    function test_ZeroAmountReverts() public {
        vm.prank(buyer);
        vm.expectRevert(AgentTrustEscrow.ZeroAmount.selector);
        escrow.fund(sellerAgentId, address(usdc), 0, _resource(), NONCE, MIN_TTL, validator, _openGate());
    }

    /// @dev A token that calls back into `fund()` mid-transfer gets the guard, not a
    ///      second job. The inner call is swallowed by the token, so the assertion is
    ///      that exactly one job exists and the escrow holds exactly one payment.
    function test_AReentrantTokenCannotOpenASecondJob() public {
        ReentrantToken rent = new ReentrantToken();
        rent.mint(buyer, 10 * PRICE);
        vm.prank(owner);
        escrow.setTokenAllowed(address(rent), true);
        vm.prank(buyer);
        rent.approve(address(escrow), type(uint256).max);

        bytes memory reentry = abi.encodeCall(
            escrow.fund,
            (sellerAgentId, address(rent), PRICE, _resource(), bytes32(uint256(99)), MIN_TTL, validator, _openGate())
        );
        rent.setReentry(address(escrow), reentry);

        // expectCall is what makes this a real test: without it the assertions below
        // would also pass if the callback never fired at all.
        vm.expectCall(address(escrow), reentry);
        vm.prank(buyer);
        escrow.fund(sellerAgentId, address(rent), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());

        assertEq(rent.balanceOf(address(escrow)), PRICE);
        assertFalse(escrow.consumedNonce(buyer, bytes32(uint256(99))));
    }

    // ------------------------------------------------------------------ TTL bounds

    function test_TtlBelowTheMinimumReverts() public {
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.TtlOutOfBounds.selector, MIN_TTL - 1, MIN_TTL, MAX_TTL)
        );
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL - 1, validator, _openGate());
    }

    /// @dev DF-22: an unbounded TTL lets a buyer set a one-second deadline and refund a
    ///      request the seller has already served.
    function test_TtlAboveTheMaximumReverts() public {
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.TtlOutOfBounds.selector, MAX_TTL + 1, MIN_TTL, MAX_TTL)
        );
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MAX_TTL + 1, validator, _openGate());
    }

    function testFuzz_TtlWithinBoundsIsAccepted(uint64 ttl) public {
        ttl = uint64(bound(ttl, MIN_TTL, MAX_TTL));
        vm.prank(buyer);
        bytes32 jobId =
            escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, ttl, validator, _openGate());
        assertEq(escrow.jobs(jobId).deadline, uint64(block.timestamp) + ttl);
    }

    // ------------------------------------------------------------------ validator

    function test_ValidatorCannotBeThePayer() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.InvalidValidator.selector, buyer));
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, buyer, _openGate());
    }

    function test_ValidatorCannotBeZero() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.InvalidValidator.selector, address(0)));
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, address(0), _openGate());
    }

    function test_ValidatorCannotBeTheAgentOwner() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.InvalidValidator.selector, seller));
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, seller, _openGate());
    }

    /// @dev The self-attestation route the blueprint left open: an operator of the
    ///      agent is the agent for this purpose (V-99).
    function test_ValidatorCannotBeAnOperatorOfTheAgent() public {
        vm.prank(seller);
        identity.setApprovalForAll(stranger, true);

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.InvalidValidator.selector, stranger));
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, stranger, _openGate());
    }

    // ---------------------------------------------------------------------- payee

    function test_PayeeIsTheAgentWalletWhenOneIsSet() public {
        (address wallet, uint256 walletKey) = makeAddrAndKey("agentWallet");
        _setAgentWallet(wallet, walletKey);

        assertEq(escrow.previewPayee(sellerAgentId), wallet);
        assertEq(escrow.jobs(_fund(NONCE)).payee, wallet);
    }

    /// @dev DF-12: the registry clears `agentWallet` on transfer, so without the
    ///      `ownerOf` fallback a freshly transferred agent could not be paid at all.
    function test_PayeeFallsBackToTheOwnerAfterATransfer() public {
        vm.prank(seller);
        identity.transferFrom(seller, stranger, sellerAgentId);

        assertEq(identity.getAgentWallet(sellerAgentId), address(0));
        assertEq(escrow.jobs(_fund(NONCE)).payee, stranger);
    }

    /// @dev And the snapshot is the point: transferring the agent after funding must
    ///      not redirect money that is already escrowed.
    function test_TransferringTheAgentAfterFundingDoesNotMoveThePayee() public {
        bytes32 jobId = _fund(NONCE);
        vm.prank(seller);
        identity.transferFrom(seller, stranger, sellerAgentId);
        assertEq(escrow.jobs(jobId).payee, seller);
    }

    function test_FundingAnUnknownAgentReverts() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(42)));
        escrow.fund(42, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());
    }

    function _setAgentWallet(address wallet, uint256 walletKey) internal {
        uint256 deadline = block.timestamp + 60;
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ERC8004IdentityRegistry"),
                keccak256("1"),
                block.chainid,
                address(identity)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256 deadline)"),
                sellerAgentId,
                wallet,
                seller,
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        vm.prank(seller);
        identity.setAgentWallet(sellerAgentId, wallet, deadline, abi.encodePacked(r, s, v));
    }

    // ----------------------------------------------------------------- gate shape

    function test_AnOverLongTrustedClientListReverts() public {
        address[] memory clients = new address[](MAX_TRUSTED + 1);
        for (uint256 i; i < clients.length; i++) {
            clients[i] = address(uint160(i + 1));
        }
        AgentTrustEscrow.GatePolicy memory gate =
            AgentTrustEscrow.GatePolicy({trustedClients: clients, minDistinct: 1, minCount: 1, minAvgValue: 0});

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.TooManyTrustedClients.selector, uint256(MAX_TRUSTED + 1), MAX_TRUSTED
            )
        );
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, gate);
    }

    // ------------------------------------------------------------------ hashing

    /// @dev Acceptance (e). The escrow is pinned to the shared vectors, not merely to
    ///      its own library: the contract is deployed at the vector's escrow address on
    ///      the vector's chain so both derivations are comparable.
    function test_DerivationsMatchTheSharedVectors() public {
        string memory json = vm.readFile("../vectors/canonical-v1.json");
        uint256 cases = vm.parseJsonUint(json, ".counts.hashing");
        assertGt(cases, 0);
        for (uint256 i; i < cases; i++) {
            _checkVector(json, i);
        }
    }

    /// @dev Split out of the loop above only to stay inside the stack limit; this
    ///      project does not compile with `via_ir`.
    function _checkVector(string memory json, uint256 i) internal {
        string memory base = string.concat(".hashing[", vm.toString(i), "]");

        // The escrow address and chain id are part of the job derivation, so the
        // contract has to sit where the vector says it sits.
        vm.chainId(vm.parseJsonUint(json, string.concat(base, ".input.chainId")));
        address escrowAt = vm.parseJsonAddress(json, string.concat(base, ".input.escrow"));
        deployCodeTo(
            "AgentTrustEscrow.sol:AgentTrustEscrow",
            _constructorArgs(),
            escrowAt
        );

        bytes32 resourceHash = AgentTrustEscrow(escrowAt).previewResourceHash(
            AgentTrustEscrow.ResourceRef({
                methodHash: vm.parseJsonBytes32(json, string.concat(base, ".input.methodHash")),
                uriHash: vm.parseJsonBytes32(json, string.concat(base, ".input.uriHash")),
                bodyHash: vm.parseJsonBytes32(json, string.concat(base, ".input.bodyHash"))
            }),
            vm.parseJsonUint(json, string.concat(base, ".input.amount")),
            vm.parseJsonAddress(json, string.concat(base, ".input.token"))
        );
        assertEq(resourceHash, vm.parseJsonBytes32(json, string.concat(base, ".expected.resourceHash")), base);
        _checkJobId(json, base, escrowAt, resourceHash);
    }

    function _checkJobId(string memory json, string memory base, address escrowAt, bytes32 resourceHash)
        internal
        view
    {
        assertEq(
            AgentTrustEscrow(escrowAt).previewJobId(
                vm.parseJsonAddress(json, string.concat(base, ".input.payer")),
                vm.parseJsonAddress(json, string.concat(base, ".input.payee")),
                resourceHash,
                vm.parseJsonBytes32(json, string.concat(base, ".input.nonce"))
            ),
            vm.parseJsonBytes32(json, string.concat(base, ".expected.jobId")),
            base
        );
    }

    /// @dev The job the chain stores must be the one a client could predict from the
    ///      402 alone, otherwise the buyer cannot check what it is about to pay for.
    function test_PreviewsAgreeWithWhatFundStores() public {
        bytes32 resourceHash = escrow.previewResourceHash(_resource(), PRICE, address(usdc));
        bytes32 jobId = _fund(NONCE);

        assertEq(escrow.jobs(jobId).resourceHash, resourceHash);
        assertEq(escrow.previewJobId(buyer, seller, resourceHash, NONCE), jobId);
    }

    /// @dev The price is inside the resource hash, so two identical requests at
    ///      different prices are different jobs (DF-04).
    function test_PriceIsPartOfTheResourceBinding() public view {
        assertTrue(
            escrow.previewResourceHash(_resource(), PRICE, address(usdc))
                != escrow.previewResourceHash(_resource(), PRICE + 1, address(usdc))
        );
    }

    // ---------------------------------------------------------------------- views

    function test_JobsViewRevertsForAnUnknownJob() public {
        bytes32 missing = keccak256("nope");
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.UnknownJob.selector, missing));
        escrow.jobs(missing);
        assertEq(uint8(escrow.jobState(missing)), uint8(AgentTrustEscrow.State.None));
    }

    // ---------------------------------------------------------------------- admin

    function test_OnlyTheOwnerConfigures() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setTokenAllowed(address(usdc), false);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setTtlBounds(1, 2);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setMaxTrustedClients(1);
        vm.stopPrank();
    }

    function test_TtlBoundsMustBeSane() public {
        vm.startPrank(owner);
        vm.expectRevert(AgentTrustEscrow.InvalidTtlBounds.selector);
        escrow.setTtlBounds(0, MAX_TTL);
        vm.expectRevert(AgentTrustEscrow.InvalidTtlBounds.selector);
        escrow.setTtlBounds(MAX_TTL, MIN_TTL);
        escrow.setTtlBounds(MIN_TTL, MAX_TTL);
        vm.stopPrank();
    }

    /// @dev `Ownable2Step`: ownership only moves when the new owner accepts it, so a
    ///      typo cannot strand configuration.
    function test_OwnershipTransferNeedsAcceptance() public {
        vm.prank(owner);
        escrow.transferOwnership(stranger);
        assertEq(escrow.owner(), owner);

        vm.prank(stranger);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), stranger);
    }

    /// @dev Revoking a token must not touch money already escrowed under it.
    function test_RemovingATokenDoesNotAffectExistingJobs() public {
        bytes32 jobId = _fund(NONCE);
        vm.prank(owner);
        escrow.setTokenAllowed(address(usdc), false);

        assertEq(escrow.jobs(jobId).amount, PRICE);
        assertEq(usdc.balanceOf(address(escrow)), PRICE);
    }
}
