// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CanonicalHash} from "../src/CanonicalHash.sol";

/// @notice SPEC-001 conformance: the Solidity derivation must reproduce every
///         hashing vector in impl/vectors/canonical-v1.json, which was generated
///         with `cast`, independently of this code.
contract CanonicalHashTest is Test {
    string internal json;

    function setUp() public {
        json = vm.readFile("../vectors/canonical-v1.json");
        assertEq(vm.parseJsonString(json, ".version"), "canonical-v1", "vector file version");
    }

    function test_TypeHashesMatchVectors() public view {
        assertEq(CanonicalHash.RESOURCE_TYPEHASH, vm.parseJsonBytes32(json, ".typeHashes.RESOURCE_TYPEHASH"));
        assertEq(CanonicalHash.JOB_TYPEHASH, vm.parseJsonBytes32(json, ".typeHashes.JOB_TYPEHASH"));
        assertEq(CanonicalHash.VALIDATION_TYPEHASH, vm.parseJsonBytes32(json, ".typeHashes.VALIDATION_TYPEHASH"));
    }

    struct Case {
        string name;
        bytes32 methodHash;
        bytes32 uriHash;
        bytes32 bodyHash;
        uint256 amount;
        address token;
        uint256 chainId;
        address escrow;
        address payer;
        address payee;
        bytes32 nonce;
        bytes32 salt;
        bytes32 expResource;
        bytes32 expJobId;
        bytes32 expRequest;
    }

    function _read(uint256 i) internal view returns (Case memory c) {
        string memory b = string.concat(".hashing[", vm.toString(i), "]");
        c.name = vm.parseJsonString(json, string.concat(b, ".name"));
        c.methodHash = vm.parseJsonBytes32(json, string.concat(b, ".input.methodHash"));
        c.uriHash = vm.parseJsonBytes32(json, string.concat(b, ".input.uriHash"));
        c.bodyHash = vm.parseJsonBytes32(json, string.concat(b, ".input.bodyHash"));
        c.amount = vm.parseJsonUint(json, string.concat(b, ".input.amount"));
        c.token = vm.parseJsonAddress(json, string.concat(b, ".input.token"));
        c.chainId = vm.parseJsonUint(json, string.concat(b, ".input.chainId"));
        c.escrow = vm.parseJsonAddress(json, string.concat(b, ".input.escrow"));
        c.payer = vm.parseJsonAddress(json, string.concat(b, ".input.payer"));
        c.payee = vm.parseJsonAddress(json, string.concat(b, ".input.payee"));
        c.nonce = vm.parseJsonBytes32(json, string.concat(b, ".input.nonce"));
        c.salt = vm.parseJsonBytes32(json, string.concat(b, ".input.salt"));
        c.expResource = vm.parseJsonBytes32(json, string.concat(b, ".expected.resourceHash"));
        c.expJobId = vm.parseJsonBytes32(json, string.concat(b, ".expected.jobId"));
        c.expRequest = vm.parseJsonBytes32(json, string.concat(b, ".expected.requestHash"));
    }

    function test_AllHashingVectors() public view {
        uint256 n = vm.parseJsonUint(json, ".counts.hashing");
        assertGt(n, 0, "no hashing vectors");
        for (uint256 i = 0; i < n; i++) {
            Case memory c = _read(i);
            bytes32 rh = CanonicalHash.resourceHash(c.methodHash, c.uriHash, c.bodyHash, c.amount, c.token, c.chainId);
            assertEq(rh, c.expResource, string.concat("resourceHash: ", c.name));
            bytes32 jid = CanonicalHash.jobId(c.chainId, c.escrow, c.payer, c.payee, rh, c.nonce);
            assertEq(jid, c.expJobId, string.concat("jobId: ", c.name));
            assertEq(CanonicalHash.requestHash(c.chainId, c.escrow, jid, rh, c.salt), c.expRequest,
                     string.concat("requestHash: ", c.name));
        }
    }

    /// @notice The properties the design depends on, asserted directly rather than
    ///         inferred from the vector list.
    function test_BindingProperties() public view {
        string memory b0 = ".hashing[0].expected.resourceHash";
        bytes32 base = vm.parseJsonBytes32(json, b0);
        // sibling resource at the same price must differ (A3)
        assertTrue(base != vm.parseJsonBytes32(json, ".hashing[1].expected.resourceHash"), "sibling resource");
        // one atomic unit more must differ (price binding)
        assertTrue(base != vm.parseJsonBytes32(json, ".hashing[2].expected.resourceHash"), "amount binding");
        // different token must differ (asset binding)
        assertTrue(base != vm.parseJsonBytes32(json, ".hashing[3].expected.resourceHash"), "token binding");
        // different chain must differ (domain separation)
        assertTrue(base != vm.parseJsonBytes32(json, ".hashing[4].expected.resourceHash"), "chain binding");
    }

    function testFuzz_JobIdIsDomainSeparated(bytes32 rh, bytes32 nonce, address payer, address payee) public pure {
        bytes32 a = CanonicalHash.jobId(84532, 0x5FbDB2315678afecb367f032d93F642f64180aa3, payer, payee, rh, nonce);
        bytes32 b = CanonicalHash.jobId(31337, 0x5FbDB2315678afecb367f032d93F642f64180aa3, payer, payee, rh, nonce);
        assertTrue(a != b, "same job id across chains");
    }
}
