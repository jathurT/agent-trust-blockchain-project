// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockIdentityRegistry} from "../src/mocks/MockIdentityRegistry.sol";
import {MockReputationRegistry} from "../src/mocks/MockReputationRegistry.sol";
import {MockValidationRegistry} from "../src/mocks/MockValidationRegistry.sol";
import {IIdentityRegistry, IReputationRegistry, IValidationRegistry} from "../src/interfaces/erc8004/IERC8004.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

/// @notice REG-002/003/004. These tests pin the upstream behaviours the escrow is
///         designed around — especially the awkward ones. If a mock ever stops
///         reverting where the real registry reverts, a test here fails rather than the
///         escrow silently becoming easier to satisfy than reality.
contract MockRegistriesTest is Test {
    MockIdentityRegistry internal identity;
    MockReputationRegistry internal reputation;
    MockValidationRegistry internal validation;

    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal validator = makeAddr("validator");
    address internal stranger = makeAddr("stranger");

    string internal constant TAG = "agenttrust/v1";

    function setUp() public {
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry(address(identity));
        validation = new MockValidationRegistry(address(identity));
    }

    function _registerSeller() internal returns (uint256 agentId) {
        vm.prank(seller);
        agentId = identity.register("https://seller.example/agent.json");
    }

    // ------------------------------------------------------------------ identity

    /// @dev `_lastId++` on a zero-initialised counter, so the first agent is id 0.
    ///      Anything that treats agentId 0 as "unset" is wrong.
    function test_firstRegisteredAgentHasIdZero() public {
        assertEq(_registerSeller(), 0);
        vm.prank(buyer);
        assertEq(identity.register("https://buyer.example/agent.json"), 1);
    }

    function test_agentWalletIsRegistrantThenClearedOnTransfer() public {
        uint256 agentId = _registerSeller();
        assertEq(identity.getAgentWallet(agentId), seller);

        vm.prank(seller);
        identity.transferFrom(seller, stranger, agentId);

        // DF-12: the wallet is gone, the owner is not. Callers must fall back to ownerOf.
        assertEq(identity.getAgentWallet(agentId), address(0));
        assertEq(identity.ownerOf(agentId), stranger);
    }

    function test_agentWalletKeyIsReserved() public {
        uint256 agentId = _registerSeller();
        vm.prank(seller);
        vm.expectRevert("reserved key");
        identity.setMetadata(agentId, "agentWallet", abi.encodePacked(stranger));
    }

    function test_setAgentWalletRequiresSignatureFromTheNewWallet() public {
        uint256 agentId = _registerSeller();
        (address wallet, uint256 walletKey) = makeAddrAndKey("agentWallet");
        uint256 deadline = vm.getBlockTimestamp() + 60;

        bytes32 digest = _walletDigest(agentId, wallet, seller, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletKey, digest);

        vm.prank(seller);
        identity.setAgentWallet(agentId, wallet, deadline, abi.encodePacked(r, s, v));
        assertEq(identity.getAgentWallet(agentId), wallet);
    }

    function test_setAgentWalletRejectsSignatureFromSomeoneElse() public {
        uint256 agentId = _registerSeller();
        (address wallet,) = makeAddrAndKey("agentWallet");
        (, uint256 imposterKey) = makeAddrAndKey("imposter");
        uint256 deadline = vm.getBlockTimestamp() + 60;

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(imposterKey, _walletDigest(agentId, wallet, seller, deadline));

        vm.prank(seller);
        vm.expectRevert("invalid wallet sig");
        identity.setAgentWallet(agentId, wallet, deadline, abi.encodePacked(r, s, v));
    }

    function test_setAgentWalletRejectsFarFutureDeadline() public {
        uint256 agentId = _registerSeller();
        (address wallet, uint256 walletKey) = makeAddrAndKey("agentWallet");
        uint256 deadline = vm.getBlockTimestamp() + 6 minutes; // MAX_DEADLINE_DELAY is 5

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(walletKey, _walletDigest(agentId, wallet, seller, deadline));

        vm.prank(seller);
        vm.expectRevert("deadline too far");
        identity.setAgentWallet(agentId, wallet, deadline, abi.encodePacked(r, s, v));
    }

    /// @dev It reads `ownerOf`, so an unknown agent reverts instead of returning false.
    ///      Anything gating on reputation inherits that revert.
    function test_isAuthorizedOrOwnerRevertsForUnknownAgent() public {
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(7)));
        identity.isAuthorizedOrOwner(seller, 7);
    }

    /// @dev The mock does not inherit IIdentityRegistry (ERC721 clashes), so bind to it
    ///      explicitly: every call below would revert if a selector had drifted.
    function test_bindsToTheErc8004Interface() public {
        uint256 agentId = _registerSeller();
        IIdentityRegistry id = IIdentityRegistry(address(identity));

        assertEq(id.ownerOf(agentId), seller);
        assertEq(id.tokenURI(agentId), "https://seller.example/agent.json");
        assertEq(id.getAgentWallet(agentId), seller);
        assertTrue(id.isAuthorizedOrOwner(seller, agentId));
        assertFalse(id.isApprovedForAll(seller, stranger));
        assertEq(id.getApproved(agentId), address(0));
        assertEq(id.getMetadata(agentId, "agentWallet"), abi.encodePacked(seller));
        assertEq(id.getVersion(), "2.0.0-mock");
    }

    function _walletDigest(uint256 agentId, address newWallet, address owner, uint256 deadline)
        internal
        view
        returns (bytes32)
    {
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
                agentId,
                newWallet,
                owner,
                deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    // ---------------------------------------------------------------- reputation

    function _feedback(address client, uint256 agentId, int128 value) internal {
        vm.prank(client);
        reputation.giveFeedback(agentId, value, 2, TAG, "", "", "", bytes32(0));
    }

    /// @dev There is no "all clients" mode. This revert is the protocol's own Sybil
    ///      mitigation (V-96) and the reason the gate needs a trusted set (DF-09).
    function test_getSummaryRefusesAnEmptyClientList() public {
        uint256 agentId = _registerSeller();
        address[] memory none = new address[](0);
        vm.expectRevert("clientAddresses required");
        reputation.getSummary(agentId, none, TAG, "");
    }

    function test_ownerCannotRateItsOwnAgent() public {
        uint256 agentId = _registerSeller();
        vm.prank(seller);
        vm.expectRevert("Self-feedback not allowed");
        reputation.giveFeedback(agentId, 10000, 2, TAG, "", "", "", bytes32(0));
    }

    function test_operatorCannotRateTheAgentItOperates() public {
        uint256 agentId = _registerSeller();
        vm.prank(seller);
        identity.setApprovalForAll(stranger, true);

        vm.prank(stranger);
        vm.expectRevert("Self-feedback not allowed");
        reputation.giveFeedback(agentId, 10000, 2, TAG, "", "", "", bytes32(0));
    }

    /// @dev `count` is feedback entries, not distinct clients. One client leaving three
    ///      reviews returns 3 — which is why the gate counts attesters itself.
    function test_countIsEntriesNotDistinctClients() public {
        uint256 agentId = _registerSeller();
        _feedback(buyer, agentId, 10000);
        _feedback(buyer, agentId, 8000);
        _feedback(buyer, agentId, 9000);

        address[] memory clients = new address[](1);
        clients[0] = buyer;
        (uint64 count, int128 value, uint8 decimals) = reputation.getSummary(agentId, clients, TAG, "");
        assertEq(count, 3);
        assertEq(value, 9000);
        assertEq(decimals, 2);
    }

    function test_revokedAndMistaggedFeedbackIsExcluded() public {
        uint256 agentId = _registerSeller();
        _feedback(buyer, agentId, 10000);
        _feedback(buyer, agentId, 0);

        vm.prank(buyer);
        reputation.giveFeedback(agentId, 100, 2, "other/tag", "", "", "", bytes32(0));

        vm.prank(buyer);
        reputation.revokeFeedback(agentId, 2);

        address[] memory clients = new address[](1);
        clients[0] = buyer;
        (uint64 count, int128 value,) = reputation.getSummary(agentId, clients, TAG, "");
        assertEq(count, 1);
        assertEq(value, 10000);
    }

    function test_summaryScalesToTheMostCommonDecimals() public {
        uint256 agentId = _registerSeller();
        // Two entries at 2 dp and one at 0 dp: the mode is 2 dp.
        _feedback(buyer, agentId, 10000);
        _feedback(buyer, agentId, 10000);
        vm.prank(buyer);
        reputation.giveFeedback(agentId, 50, 0, TAG, "", "", "", bytes32(0));

        address[] memory clients = new address[](1);
        clients[0] = buyer;
        (uint64 count, int128 value, uint8 decimals) = reputation.getSummary(agentId, clients, TAG, "");
        assertEq(count, 3);
        assertEq(decimals, 2);
        // (100.00 + 100.00 + 50) / 3 = 83.33
        assertEq(value, 8333);
    }

    /// @dev DF-09, at registry level: five addresses that endorse each other satisfy the
    ///      blueprint's "distinct attesters >= 3, count >= 5" gate, and contribute
    ///      nothing at all to a gate anchored on the buyer's own trusted clients.
    function test_crossEndorsingSybilsPassGateV1AndFailTheTrustAnchoredGate() public {
        uint256 agentId = _registerSeller();
        for (uint256 i; i < 5; i++) {
            _feedback(makeAddr(string.concat("sybil", vm.toString(i))), agentId, 10000);
        }

        assertEq(reputation.distinctClientsUnfiltered(agentId), 5); // gate v1: distinct >= 3 ✓

        address[] memory trusted = new address[](1);
        trusted[0] = buyer; // the buyer has never dealt with this seller
        (uint64 count,,) = reputation.getSummary(agentId, trusted, TAG, "");
        assertEq(count, 0); // gate v2: no trusted attester ✗
    }

    function test_reputationBindsToTheErc8004Interface() public {
        uint256 agentId = _registerSeller();
        _feedback(buyer, agentId, 7500);
        IReputationRegistry rep = IReputationRegistry(address(reputation));

        address[] memory clients = new address[](1);
        clients[0] = buyer;
        (uint64 count, int128 value,) = rep.getSummary(agentId, clients, TAG, "");
        assertEq(count, 1);
        assertEq(value, 7500);
        assertEq(rep.getLastIndex(agentId, buyer), 1);
        assertEq(rep.getClients(agentId)[0], buyer);
        assertEq(rep.getIdentityRegistry(), address(identity));
        assertEq(rep.getVersion(), "2.0.0-mock");

        (int128 v, uint8 d,,, bool revoked) = rep.readFeedback(agentId, buyer, 1);
        assertEq(v, 7500);
        assertEq(d, 2);
        assertFalse(revoked);
    }

    // ---------------------------------------------------------------- validation

    function _request(bytes32 requestHash, uint256 agentId) internal {
        vm.prank(seller);
        validation.validationRequest(validator, agentId, "https://seller.example/evidence", requestHash);
    }

    /// @dev DF-06. The hash is globally unique and first-come, so anyone can burn a
    ///      predictable one before the real payee gets to it — for a different agent,
    ///      with a validator of their choosing.
    function test_requestHashCanBeSquattedByAnyone() public {
        uint256 sellerAgent = _registerSeller();
        vm.prank(stranger);
        uint256 squatterAgent = identity.register("https://squatter.example/agent.json");

        bytes32 predictable = keccak256("guessable request hash");
        vm.prank(stranger);
        validation.validationRequest(stranger, squatterAgent, "", predictable);

        vm.prank(seller);
        vm.expectRevert("exists");
        validation.validationRequest(validator, sellerAgent, "", predictable);
    }

    function test_onlyTheAgentOwnerOrOperatorMayFileARequest() public {
        uint256 agentId = _registerSeller();
        vm.prank(stranger);
        vm.expectRevert("Not authorized");
        validation.validationRequest(validator, agentId, "", keccak256("h"));
    }

    function test_unknownRequestHashReverts() public {
        vm.expectRevert("unknown");
        validation.getValidationStatus(keccak256("never filed"));
    }

    /// @dev DF-05 / V-99. `lastUpdate` is set at request time and `hasResponse` is not
    ///      exposed, so these two states are byte-identical to a per-request reader.
    function test_pendingIsIndistinguishableFromAFailingResponse() public {
        uint256 agentId = _registerSeller();
        bytes32 pending = keccak256("pending");
        bytes32 failed = keccak256("failed");

        _request(pending, agentId);
        _request(failed, agentId);

        vm.prank(validator);
        validation.validationResponse(failed, 0, "", bytes32(0), TAG);

        (, uint256 a1, uint8 r1,,, uint256 t1) = validation.getValidationStatus(pending);
        (, uint256 a2, uint8 r2,,, uint256 t2) = validation.getValidationStatus(failed);
        assertEq(a1, a2);
        assertEq(r1, r2); // both 0
        assertEq(t1, t2); // both "now"
    }

    /// @dev V-99a, the refinement: `getSummary` DOES filter on `hasResponse`, so the
    ///      two states are distinguishable in aggregate. It loops over every validation
    ///      the agent has ever had, so it is unusable from a settlement path — the
    ///      no-early-refund rule stands on gas, not on impossibility.
    function test_summaryDistinguishesPendingFromAFailingResponse() public {
        uint256 agentId = _registerSeller();
        address[] memory validators = new address[](1);
        validators[0] = validator;

        _request(keccak256("pending"), agentId);
        (uint64 countBefore,) = validation.getSummary(agentId, validators, TAG);
        assertEq(countBefore, 0);

        bytes32 failed = keccak256("failed");
        _request(failed, agentId);
        vm.prank(validator);
        validation.validationResponse(failed, 0, "", bytes32(0), TAG);

        (uint64 countAfter, uint8 avg) = validation.getSummary(agentId, validators, TAG);
        assertEq(countAfter, 1);
        assertEq(avg, 0);
    }

    /// @dev DF-15. Release snapshots the first passing attestation because of this.
    function test_validatorCanOverwriteAnEarlierVerdict() public {
        uint256 agentId = _registerSeller();
        bytes32 h = keccak256("job");
        _request(h, agentId);

        vm.prank(validator);
        validation.validationResponse(h, 100, "", bytes32(0), TAG);
        (,, uint8 pass,,,) = validation.getValidationStatus(h);
        assertEq(pass, 100);

        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.prank(validator);
        validation.validationResponse(h, 0, "", bytes32(0), TAG);
        (,, uint8 revoked,,, uint256 lastUpdate) = validation.getValidationStatus(h);
        assertEq(revoked, 0);
        assertEq(lastUpdate, vm.getBlockTimestamp());
    }

    function test_onlyTheNamedValidatorMayRespond() public {
        uint256 agentId = _registerSeller();
        bytes32 h = keccak256("job");
        _request(h, agentId);

        vm.prank(stranger);
        vm.expectRevert("not validator");
        validation.validationResponse(h, 100, "", bytes32(0), TAG);
    }

    function test_responseIsCappedAt100() public {
        uint256 agentId = _registerSeller();
        bytes32 h = keccak256("job");
        _request(h, agentId);

        vm.prank(validator);
        vm.expectRevert("resp>100");
        validation.validationResponse(h, 101, "", bytes32(0), TAG);
    }

    function test_validationBindsToTheErc8004Interface() public {
        uint256 agentId = _registerSeller();
        IValidationRegistry val = IValidationRegistry(address(validation));
        bytes32 h = keccak256("job");
        _request(h, agentId);

        vm.prank(validator);
        val.validationResponse(h, 100, "https://validator.example/r", keccak256("body"), TAG);

        (address v, uint256 a, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate) =
            val.getValidationStatus(h);
        assertEq(v, validator);
        assertEq(a, agentId);
        assertEq(response, 100);
        assertEq(responseHash, keccak256("body"));
        assertEq(tag, TAG);
        assertEq(lastUpdate, vm.getBlockTimestamp());
        assertEq(val.getAgentValidations(agentId)[0], h);
        assertEq(val.getValidatorRequests(validator)[0], h);
        assertEq(val.getIdentityRegistry(), address(identity));
        assertEq(val.getVersion(), "2.0.0-mock");
    }
}
