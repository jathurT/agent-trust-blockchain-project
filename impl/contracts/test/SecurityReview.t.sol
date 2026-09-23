// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EscrowFixture} from "./support/EscrowFixture.sol";
import {AgentTrustEscrow} from "../src/AgentTrustEscrow.sol";
import {IReputationRegistry} from "../src/interfaces/erc8004/IERC8004.sol";

/// @dev A reputation registry that answers with an impossible `valueDecimals`. The real
///      one caps it at 18 on write, but it is upgradeable by a single EOA (V-97), so
///      "the registry answers, and the answer is nonsense" is a case the escrow has to
///      survive rather than assume away.
contract MalformedReputationRegistry is IReputationRegistry {
    function getSummary(uint256, address[] calldata, string calldata, string calldata)
        external
        pure
        returns (uint64, int128, uint8)
    {
        return (1, 1, 200); // 200 decimals
    }

    function giveFeedback(uint256, int128, uint8, string calldata, string calldata, string calldata, string calldata, bytes32) external {}
    function revokeFeedback(uint256, uint64) external {}
    function readFeedback(uint256, address, uint64) external pure returns (int128, uint8, string memory, string memory, bool) {
        return (0, 0, "", "", false);
    }
    function getClients(uint256) external pure returns (address[] memory) { return new address[](0); }
    function getLastIndex(uint256, address) external pure returns (uint64) { return 0; }
    function getIdentityRegistry() external pure returns (address) { return address(0); }
    function getVersion() external pure returns (string memory) { return "malformed"; }
}

/// @notice Findings from the CLAUDE.md §6 security review of CONTRACT-004/005/007/008.
///         Each test is named for the thing that went wrong, so a regression says so.
contract SecurityReviewTest is EscrowFixture {
    bytes32 internal constant SALT = keccak256("seller salt");

    // ------------------------------------------------------ HIGH: starved read

    /// @dev **The one path found where escrowed funds reached the wrong party.**
    ///      `getValidationStatus` returns the validator-supplied `tag`, and the
    ///      registry copies the whole struct to memory to do it, so the read costs
    ///      whatever the tag's author decided: ~30k for this project's tag, ~14M at
    ///      200 KB. The wrapper caught *every* failure as "no validation", which is
    ///      fail-closed for `release()` but fail-**open** for `refund()`. A caller
    ///      simply capping gas made the read run out, and refunded a job that held a
    ///      genuine passing attestation — taking delivered, attested work for free.
    ///
    ///      Reproduced before the fix: `refund{gas: 5_000_000}` paid the buyer and set
    ///      the job to Refunded. Now the empty returndata of an out-of-gas sub-call is
    ///      told apart from the registry's 100-byte `Error("unknown")`, and the
    ///      ambiguous case reverts.
    function test_StarvingTheValidationReadCannotRefundAnAttestedJob() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        vm.prank(validator);
        validation.validationResponse(requestHash, 100, "", keccak256("body"), string(new bytes(200_000)));

        vm.warp(uint256(escrow.jobs(jobId).deadline) + GRACE + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);
        (bool ok, bytes memory err) = address(escrow).call{gas: 5_000_000}(abi.encodeCall(escrow.refund, (jobId)));

        assertFalse(ok, "a starved read must not refund an attested job");
        assertEq(bytes4(err), AgentTrustEscrow.ValidationReadFailed.selector);
        assertEq(usdc.balanceOf(buyer), buyerBefore);
        assertEq(uint8(escrow.jobState(jobId)), uint8(AgentTrustEscrow.State.Funded));
    }

    /// @dev And with enough gas the truth still comes out, so the fix refuses the theft
    ///      without stranding the money. Reading is always cheaper than the write that
    ///      created it, so a tag that fit in a block can be read back within one.
    function test_TheSameJobStillReadsCorrectlyWithEnoughGas() public {
        bytes32 jobId = _fund(NONCE);
        bytes32 requestHash = _bind(jobId, SALT);

        vm.prank(validator);
        validation.validationResponse(requestHash, 100, "", keccak256("body"), string(new bytes(200_000)));
        vm.warp(uint256(escrow.jobs(jobId).deadline) + GRACE + 1);

        (bool refundOk, bytes memory err) = address(escrow).call{gas: 60_000_000}(abi.encodeCall(escrow.refund, (jobId)));
        assertFalse(refundOk);
        assertEq(bytes4(err), AgentTrustEscrow.ValidationExists.selector);

        (bool releaseOk,) = address(escrow).call{gas: 60_000_000}(abi.encodeCall(escrow.release, (jobId)));
        assertTrue(releaseOk, "the seller must still be payable");
        assertEq(usdc.balanceOf(seller), PRICE);
    }

    /// @dev A hash that was genuinely never filed still reads as "no validation" —
    ///      the fix must not turn every absent record into a revert.
    function test_AGenuinelyUnknownRequestStillReadsAsNoValidation() public {
        bytes32 jobId = _fund(NONCE);
        assertFalse(escrow.isReleasable(jobId));

        vm.warp(uint256(escrow.jobs(jobId).deadline) + GRACE + 1);
        assertTrue(escrow.isRefundable(jobId));
        escrow.refund(jobId);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // --------------------------------------------- MEDIUM: self-attesting payee

    /// @dev `isAuthorizedOrOwner` does not catch this. Once the seller sets
    ///      `agentWallet` — the case DF-12 exists for — that wallet is neither the
    ///      NFT's owner nor an operator, so it could be named as its own validator:
    ///      bind, attest 100, release, with no independent party in the flow.
    function test_TheAgentsPayoutWalletCannotBeItsOwnValidator() public {
        (address wallet, uint256 walletKey) = makeAddrAndKey("agentWallet");
        _setSellerAgentWallet(wallet, walletKey);
        assertFalse(identity.isAuthorizedOrOwner(wallet, sellerAgentId), "the wallet is not an operator");

        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.InvalidValidator.selector, wallet));
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, wallet, _openGate());
    }

    /// @dev The plain case still holds: the NFT owner is refused too.
    function test_TheAgentOwnerStillCannotBeItsOwnValidator() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.InvalidValidator.selector, seller));
        escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, seller, _openGate());
    }

    // ------------------------------------------------ LOW: malformed registry

    /// @dev A *successful* read carrying an impossible `valueDecimals` used to underflow
    ///      `18 - decimals` in the caller — a panic outside the try/catch, making the
    ///      agent unfundable by anyone. The guard exists precisely for a registry that
    ///      misbehaves, so it has to cover this too.
    function test_AMalformedReputationAnswerDoesNotBrickFunding() public {
        AgentTrustEscrow odd = new AgentTrustEscrow(
            owner,
            address(identity),
            address(new MalformedReputationRegistry()),
            address(validation),
            MIN_TTL,
            MAX_TTL,
            GRACE,
            MAX_TRUSTED,
            READ_GAS
        );
        vm.prank(owner);
        odd.setTokenAllowed(address(usdc), true);
        vm.prank(buyer);
        usdc.approve(address(odd), type(uint256).max);

        address[] memory trusted = new address[](1);
        trusted[0] = makeAddr("alice");

        // The nonsense answer contributes nothing, so a policy needing an attester
        // fails cleanly rather than panicking...
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Distinct, int256(0), int256(1)
            )
        );
        odd.fund(
            sellerAgentId,
            address(usdc),
            PRICE,
            _resource(),
            NONCE,
            MIN_TTL,
            validator,
            AgentTrustEscrow.GatePolicy({trustedClients: trusted, minDistinct: 1, minCount: 1, minAvgValue: 0})
        );

        // ...and a policy that asks for nothing still funds.
        vm.prank(buyer);
        odd.fund(sellerAgentId, address(usdc), PRICE, _resource(), NONCE, MIN_TTL, validator, _openGate());
        assertEq(usdc.balanceOf(address(odd)), PRICE);
    }

    // -------------------------------------------------- gap found by mutation

    /// @dev My own mutation testing found this hole: no test made the owner's
    ///      *distinct* floor the binding constraint, so deleting it from `_enforceGate`
    ///      changed nothing that any test noticed.
    function test_TheOwnerDistinctFloorIsEnforcedWhenItIsTheBindingConstraint() public {
        address alice = makeAddr("alice");
        address[] memory trusted = new address[](2);
        trusted[0] = alice;
        trusted[1] = makeAddr("bob");

        vm.prank(alice);
        reputation.giveFeedback(sellerAgentId, 9500, 2, FEEDBACK_TAG, "", "", "", bytes32(0));

        vm.prank(owner);
        escrow.setGateFloors(2, 0, 0); // two distinct attesters, nothing else

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Distinct, int256(1), int256(2)
            )
        );
        escrow.fund(
            sellerAgentId,
            address(usdc),
            PRICE,
            _resource(),
            NONCE,
            MIN_TTL,
            validator,
            AgentTrustEscrow.GatePolicy({trustedClients: trusted, minDistinct: 0, minCount: 0, minAvgValue: 0})
        );
    }

    function _setSellerAgentWallet(address wallet, uint256 walletKey) internal {
        uint256 deadline = vm.getBlockTimestamp() + 60;
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
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(walletKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        vm.prank(seller);
        identity.setAgentWallet(sellerAgentId, wallet, deadline, abi.encodePacked(r, s, v));
    }
}
