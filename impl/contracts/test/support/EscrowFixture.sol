// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentTrustEscrow} from "../../src/AgentTrustEscrow.sol";
import {MockIdentityRegistry} from "../../src/mocks/MockIdentityRegistry.sol";
import {MockReputationRegistry} from "../../src/mocks/MockReputationRegistry.sol";
import {MockValidationRegistry} from "../../src/mocks/MockValidationRegistry.sol";
import {MockUSDC} from "../../src/mocks/MockUSDC.sol";

/// @notice Shared world for the escrow tests: the three ERC-8004 mocks, a USDC stand-in,
///         one registered seller agent and a funded buyer. Kept in one place so a change
///         to the escrow's constructor does not ripple through every test file.
abstract contract EscrowFixture is Test {
    AgentTrustEscrow internal escrow;
    MockIdentityRegistry internal identity;
    MockReputationRegistry internal reputation;
    MockValidationRegistry internal validation;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal buyer = makeAddr("buyer");
    address internal seller = makeAddr("seller");
    address internal validator = makeAddr("validator");
    address internal stranger = makeAddr("stranger");

    uint256 internal sellerAgentId;

    uint64 internal constant MIN_TTL = 10 minutes;
    uint64 internal constant MAX_TTL = 24 hours;
    uint64 internal constant GRACE = 15 minutes;
    uint16 internal constant MAX_TRUSTED = 10;
    uint64 internal constant READ_GAS = 250_000;
    uint256 internal constant PRICE = 250_000; // 0.25 USDC, 6 decimals

    bytes32 internal constant METHOD_HASH = keccak256("POST");
    bytes32 internal constant URI_HASH = keccak256("https://seller.example/v1/summarise");
    bytes32 internal constant BODY_HASH = keccak256('{"text":"hello"}');
    bytes32 internal constant NONCE = bytes32(uint256(1));

    function setUp() public virtual {
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry(address(identity));
        validation = new MockValidationRegistry(address(identity));
        usdc = new MockUSDC();

        vm.prank(seller);
        sellerAgentId = identity.register("https://seller.example/agent.json");

        escrow = _deployEscrow();
        vm.prank(owner);
        escrow.setTokenAllowed(address(usdc), true);

        usdc.mint(buyer, 1000 * PRICE);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _deployEscrow() internal returns (AgentTrustEscrow) {
        return new AgentTrustEscrow(
            owner,
            address(identity),
            address(reputation),
            address(validation),
            MIN_TTL,
            MAX_TTL,
            GRACE,
            MAX_TRUSTED,
            READ_GAS
        );
    }

    function _constructorArgs() internal view returns (bytes memory) {
        return abi.encode(
            owner,
            address(identity),
            address(reputation),
            address(validation),
            MIN_TTL,
            MAX_TTL,
            GRACE,
            MAX_TRUSTED,
            READ_GAS
        );
    }

    function _resource() internal pure returns (AgentTrustEscrow.ResourceRef memory) {
        return AgentTrustEscrow.ResourceRef({methodHash: METHOD_HASH, uriHash: URI_HASH, bodyHash: BODY_HASH});
    }

    /// @dev A policy that demands nothing, for tests about something other than the gate.
    function _openGate() internal pure returns (AgentTrustEscrow.GatePolicy memory) {
        return AgentTrustEscrow.GatePolicy({
            trustedClients: new address[](0),
            minDistinct: 0,
            minCount: 0,
            minAvgValue: 0
        });
    }

    function _fund(bytes32 nonce) internal returns (bytes32) {
        return _fund(nonce, MIN_TTL);
    }

    function _fund(bytes32 nonce, uint64 ttl) internal returns (bytes32) {
        vm.prank(buyer);
        return escrow.fund(sellerAgentId, address(usdc), PRICE, _resource(), nonce, ttl, validator, _openGate());
    }

    /// @dev What the seller does between delivering and being paid: file the validation
    ///      request under a salted hash, then bind it to the job.
    function _bind(bytes32 jobId, bytes32 salt) internal returns (bytes32 requestHash) {
        requestHash = escrow.previewRequestHash(jobId, salt);
        vm.prank(seller);
        validation.validationRequest(validator, sellerAgentId, "https://seller.example/evidence", requestHash);
        vm.prank(seller);
        escrow.bindValidation(jobId, salt);
    }

    function _attest(bytes32 requestHash, uint8 response) internal {
        vm.prank(validator);
        validation.validationResponse(requestHash, response, "https://validator.example/r", keccak256("body"), "agenttrust");
    }
}
