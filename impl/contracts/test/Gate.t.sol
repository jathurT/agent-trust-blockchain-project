// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {AgentTrustEscrow} from "../src/AgentTrustEscrow.sol";
import {MockIdentityRegistry} from "../src/mocks/MockIdentityRegistry.sol";
import {MockReputationRegistry} from "../src/mocks/MockReputationRegistry.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice CONTRACT-005 — the trust-anchored reputation gate (DF-09).
contract GateTest is Test {
    AgentTrustEscrow internal escrow;
    MockIdentityRegistry internal identity;
    MockReputationRegistry internal reputation;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal validator = makeAddr("validator");

    address internal alice = makeAddr("alice"); // trusted by the buyer
    address internal bob = makeAddr("bob"); // trusted by the buyer
    address internal mallory = makeAddr("mallory"); // not trusted

    uint256 internal sellerAgentId;

    uint64 internal constant MIN_TTL = 10 minutes;
    uint64 internal constant MAX_TTL = 24 hours;
    uint16 internal constant MAX_TRUSTED = 10;
    uint64 internal constant READ_GAS = 250_000;
    uint256 internal constant PRICE = 250_000;

    function setUp() public {
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry(address(identity));
        usdc = new MockUSDC();

        vm.prank(seller);
        sellerAgentId = identity.register("https://seller.example/agent.json");

        escrow = new AgentTrustEscrow(
            owner, address(identity), address(reputation), MIN_TTL, MAX_TTL, MAX_TRUSTED, READ_GAS
        );
        vm.prank(owner);
        escrow.setTokenAllowed(address(usdc), true);

        usdc.mint(buyer, 1000 * PRICE);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _rate(address client, int128 value) internal {
        _rate(client, value, 2, escrow.FEEDBACK_TAG());
    }

    function _rate(address client, int128 value, uint8 decimals, string memory tag) internal {
        vm.prank(client);
        reputation.giveFeedback(sellerAgentId, value, decimals, tag, "", "", "", bytes32(0));
    }

    function _policy(address[] memory clients, uint16 minDistinct, uint64 minCount, int128 minAvg)
        internal
        pure
        returns (AgentTrustEscrow.GatePolicy memory)
    {
        return AgentTrustEscrow.GatePolicy({
            trustedClients: clients,
            minDistinct: minDistinct,
            minCount: minCount,
            minAvgValue: minAvg
        });
    }

    function _two() internal view returns (address[] memory clients) {
        clients = new address[](2);
        clients[0] = alice;
        clients[1] = bob;
    }

    function _fund(AgentTrustEscrow.GatePolicy memory gate, bytes32 nonce) internal returns (bytes32) {
        vm.prank(buyer);
        return escrow.fund(
            sellerAgentId,
            address(usdc),
            PRICE,
            AgentTrustEscrow.ResourceRef({
                methodHash: keccak256("POST"),
                uriHash: keccak256("https://seller.example/v1/summarise"),
                bodyHash: keccak256("{}")
            }),
            nonce,
            MIN_TTL,
            validator,
            gate
        );
    }

    // ------------------------------------------------------------- the two halves

    /// @dev Acceptance (a).
    function test_AgentWithTrustedFeedbackPasses() public {
        _rate(alice, 9500);
        _rate(bob, 9000);

        bytes32 jobId = _fund(_policy(_two(), 2, 2, 9000), bytes32(uint256(1)));
        assertEq(escrow.jobs(jobId).amount, PRICE);
    }

    /// @dev Acceptance (b): the same agent, the same amount of praise, from addresses
    ///      the buyer has no reason to believe.
    function test_TheSameAgentFailsWhenTheFeedbackIsFromStrangers() public {
        _rate(mallory, 10000);
        _rate(makeAddr("mallory2"), 10000);
        _rate(makeAddr("mallory3"), 10000);

        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Distinct, int256(0), int256(2)
            )
        );
        escrow.fund(
            sellerAgentId,
            address(usdc),
            PRICE,
            AgentTrustEscrow.ResourceRef({
                methodHash: keccak256("POST"),
                uriHash: keccak256("https://seller.example/v1/summarise"),
                bodyHash: keccak256("{}")
            }),
            bytes32(uint256(1)),
            MIN_TTL,
            validator,
            _policy(_two(), 2, 2, 9000)
        );
    }

    /// @dev DF-09 end to end: the blueprint's gate counts cheap addresses, this one
    ///      counts relationships. Five mutually-endorsing Sybils buy nothing here.
    function test_CrossEndorsingSybilsDoNotHelp() public {
        for (uint256 i; i < 5; i++) {
            _rate(makeAddr(string.concat("sybil", vm.toString(i))), 10000);
        }
        assertEq(reputation.distinctClientsUnfiltered(sellerAgentId), 5);

        vm.expectRevert();
        _fund(_policy(_two(), 1, 1, 0), bytes32(uint256(1)));

        // One genuine relationship is worth more than all five.
        _rate(alice, 8000);
        _fund(_policy(_two(), 1, 1, 0), bytes32(uint256(1)));
    }

    // ------------------------------------------------------------ each dimension

    function test_CountDimensionIsReported() public {
        _rate(alice, 9500);
        _rate(bob, 9500);

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Count, int256(2), int256(5)
            )
        );
        _fund(_policy(_two(), 2, 5, 0), bytes32(uint256(1)));
    }

    function test_AverageDimensionIsReported() public {
        _rate(alice, 4000);
        _rate(bob, 6000);

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector,
                AgentTrustEscrow.GateDimension.Average,
                int256(5000),
                int256(9000)
            )
        );
        _fund(_policy(_two(), 2, 2, 9000), bytes32(uint256(1)));
    }

    /// @dev The average is weighted by entries, not by client: ten mediocre reviews
    ///      from Alice must not be outvoted by one glowing review from Bob.
    function test_AverageIsWeightedByEntryCount() public {
        for (uint256 i; i < 9; i++) {
            _rate(alice, 5000);
        }
        _rate(bob, 10000);

        // (9 * 50.00 + 1 * 100.00) / 10 = 55.00, not (50.00 + 100.00) / 2 = 75.00
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector,
                AgentTrustEscrow.GateDimension.Average,
                int256(5500),
                int256(7500)
            )
        );
        _fund(_policy(_two(), 2, 10, 7500), bytes32(uint256(1)));
    }

    /// @dev Clients are free to use different `valueDecimals`; the gate normalises.
    function test_DifferentValueDecimalsAreNormalised() public {
        _rate(alice, 90, 0, escrow.FEEDBACK_TAG()); // 90, zero decimals
        _rate(bob, 9000, 2, escrow.FEEDBACK_TAG()); // 90.00, two decimals

        bytes32 jobId = _fund(_policy(_two(), 2, 2, 9000), bytes32(uint256(1)));
        assertEq(escrow.jobs(jobId).amount, PRICE);
    }

    function test_NegativeFeedbackCanFailTheGate() public {
        _rate(alice, -5000);
        _rate(bob, 9000);

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector,
                AgentTrustEscrow.GateDimension.Average,
                int256(2000),
                int256(5000)
            )
        );
        _fund(_policy(_two(), 2, 2, 5000), bytes32(uint256(1)));
    }

    function test_FeedbackUnderAnotherTagDoesNotCount() public {
        _rate(alice, 10000, 2, "some-other-protocol");
        _rate(bob, 10000);

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Distinct, int256(1), int256(2)
            )
        );
        _fund(_policy(_two(), 2, 2, 0), bytes32(uint256(1)));
    }

    function test_RevokedFeedbackDoesNotCount() public {
        _rate(alice, 10000);
        _rate(bob, 10000);
        vm.prank(bob);
        reputation.revokeFeedback(sellerAgentId, 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Distinct, int256(1), int256(2)
            )
        );
        _fund(_policy(_two(), 2, 2, 0), bytes32(uint256(1)));
    }

    // ------------------------------------------------------------- list integrity

    /// @dev Without this, one trusted address listed twice would satisfy a
    ///      `minDistinct` floor the owner set.
    function test_DuplicateTrustedClientReverts() public {
        _rate(alice, 10000);
        address[] memory clients = new address[](2);
        clients[0] = alice;
        clients[1] = alice;

        vm.expectRevert(abi.encodeWithSelector(AgentTrustEscrow.DuplicateTrustedClient.selector, alice));
        _fund(_policy(clients, 2, 1, 0), bytes32(uint256(1)));
    }

    function test_ZeroTrustedClientReverts() public {
        address[] memory clients = new address[](1);
        vm.expectRevert(AgentTrustEscrow.ZeroTrustedClient.selector);
        _fund(_policy(clients, 0, 0, 0), bytes32(uint256(1)));
    }

    /// @dev Acceptance (c).
    function test_OverLongClientListReverts() public {
        address[] memory clients = new address[](MAX_TRUSTED + 1);
        for (uint256 i; i < clients.length; i++) {
            clients[i] = address(uint160(i + 1));
        }
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.TooManyTrustedClients.selector, uint256(MAX_TRUSTED + 1), MAX_TRUSTED
            )
        );
        _fund(_policy(clients, 0, 0, 0), bytes32(uint256(1)));
    }

    // -------------------------------------------------------------- owner floors

    function test_ABuyerCannotAskForLessThanTheOwnerFloor() public {
        vm.prank(owner);
        escrow.setGateFloors(2, 3, 9000);

        _rate(alice, 9500);
        _rate(bob, 9500);

        // The buyer's own policy asks for nothing, but the floor still applies.
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Count, int256(2), int256(3)
            )
        );
        _fund(_policy(_two(), 0, 0, 0), bytes32(uint256(1)));

        _rate(alice, 9500);
        _fund(_policy(_two(), 0, 0, 0), bytes32(uint256(1)));
    }

    function test_ABuyerMayBeStricterThanTheFloor() public {
        vm.prank(owner);
        escrow.setGateFloors(1, 1, 0);

        _rate(alice, 9500);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Distinct, int256(1), int256(2)
            )
        );
        _fund(_policy(_two(), 2, 1, 0), bytes32(uint256(1)));
    }

    function test_OnlyTheOwnerSetsFloorsAndTheReadCeiling() public {
        vm.startPrank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        escrow.setGateFloors(0, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        escrow.setReputationReadGas(1);
        vm.stopPrank();
    }

    // ------------------------------------------------- bounded reads and gas games

    /// @dev Acceptance (e). `getSummary` walks a client's whole history, and the seller
    ///      influences how long that is (V-99). A client whose read exceeds the ceiling
    ///      must contribute nothing rather than make the agent unfundable forever.
    function test_AHugeHistoryDoesNotPreventFunding() public {
        for (uint256 i; i < 400; i++) {
            _rate(alice, 10000);
        }
        _rate(bob, 9000);

        // Alice's read blows the ceiling and is dropped; Bob still decides the outcome.
        bytes32 jobId = _fund(_policy(_two(), 1, 1, 9000), bytes32(uint256(1)));
        assertEq(escrow.jobs(jobId).amount, PRICE);

        // And with Alice alone there is nothing left to satisfy the policy.
        address[] memory onlyAlice = new address[](1);
        onlyAlice[0] = alice;
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentTrustEscrow.ReputationTooLow.selector, AgentTrustEscrow.GateDimension.Distinct, int256(0), int256(1)
            )
        );
        _fund(_policy(onlyAlice, 1, 1, 0), bytes32(uint256(2)));
    }

    /// @dev The attack the bounded read would otherwise open: starve every registry
    ///      read of gas so each one is caught and skipped, and the gate waves you
    ///      through. `fund()` must refuse rather than decide on no data.
    function test_StarvingTheReadsOfGasRevertsInsteadOfSkippingTheGate() public {
        _rate(alice, 9500);
        _rate(bob, 9500);

        AgentTrustEscrow.GatePolicy memory gate = _policy(_two(), 2, 2, 9000);
        vm.prank(buyer);
        (bool ok, bytes memory err) = address(escrow).call{gas: 300_000}(
            abi.encodeCall(
                escrow.fund,
                (
                    sellerAgentId,
                    address(usdc),
                    PRICE,
                    AgentTrustEscrow.ResourceRef({
                        methodHash: keccak256("POST"),
                        uriHash: keccak256("https://seller.example/v1/summarise"),
                        bodyHash: keccak256("{}")
                    }),
                    bytes32(uint256(1)),
                    MIN_TTL,
                    validator,
                    gate
                )
            )
        );
        assertFalse(ok);
        assertEq(bytes4(err), AgentTrustEscrow.InsufficientGasForReputationRead.selector);
        assertEq(uint8(escrow.jobState(bytes32(0))), uint8(AgentTrustEscrow.State.None));
    }

    /// @dev The same bypass from the other side: an owner who sets the ceiling so low
    ///      that every read runs out of gas would switch the gate off while leaving it
    ///      looking applied.
    function test_TheOwnerCannotSetTheReadCeilingBelowTheFloor() public {
        uint64 floor_ = escrow.MIN_REPUTATION_READ_GAS();
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.ReputationReadGasTooLow.selector, floor_ - 1, floor_)
        );
        escrow.setReputationReadGas(floor_ - 1);

        vm.prank(owner);
        escrow.setReputationReadGas(floor_);
        assertEq(escrow.reputationReadGas(), floor_);
    }

    function test_DeployingWithTooSmallAReadCeilingReverts() public {
        uint64 floor_ = escrow.MIN_REPUTATION_READ_GAS();
        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustEscrow.ReputationReadGasTooLow.selector, uint64(1), floor_)
        );
        new AgentTrustEscrow(owner, address(identity), address(reputation), MIN_TTL, MAX_TTL, MAX_TRUSTED, 1);
    }

    /// @dev Acceptance (d): gas against history length, for EVAL-002 and DOC-004. The
    ///      numbers are printed rather than asserted — they are a measurement, and
    ///      asserting them would only pin the mock.
    function test_GasAgainstHistoryLength() public {
        address[] memory one = new address[](1);
        one[0] = alice;
        uint256[5] memory sizes = [uint256(1), 5, 20, 50, 100];
        uint256 written;

        for (uint256 s; s < sizes.length; s++) {
            while (written < sizes[s]) {
                _rate(alice, 9000);
                written++;
            }
            uint256 before = gasleft();
            reputation.getSummary(sellerAgentId, one, escrow.FEEDBACK_TAG(), "");
            console.log("getSummary entries=%s gas=%s", written, before - gasleft());
        }
    }
}
