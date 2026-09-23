// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentTrustEscrow} from "../src/AgentTrustEscrow.sol";
import {MockIdentityRegistry} from "../src/mocks/MockIdentityRegistry.sol";
import {MockReputationRegistry} from "../src/mocks/MockReputationRegistry.sol";
import {MockValidationRegistry} from "../src/mocks/MockValidationRegistry.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice CONTRACT-017 — deploy the escrow and write a record the services can read.
///
/// Local (Anvil), deploying the mock registries and a mock token alongside:
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///     --account agenttrust-deployer --sender <address>
///
/// Base Sepolia, against the live registries and real USDC — set
/// IDENTITY_REGISTRY, REPUTATION_REGISTRY, VALIDATION_REGISTRY and USDC_ADDRESS and
/// the script wires them instead of deploying anything:
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify \
///     --account agenttrust-deployer --sender <address>
///
/// @dev Signing is by keystore account (`--account`). A raw private key is never a
///      command-line argument, because arguments end up in shell history and in `ps`.
contract Deploy is Script {
    struct Config {
        address identityRegistry;
        address reputationRegistry;
        address validationRegistry;
        address token;
        uint64 minTtl;
        uint64 maxTtl;
        uint64 grace;
        uint16 maxTrustedClients;
        uint64 reputationReadGas;
        bool deployedMocks;
    }

    function run() external returns (AgentTrustEscrow escrow, Config memory cfg) {
        cfg = _config();

        vm.startBroadcast();
        if (cfg.identityRegistry == address(0)) {
            cfg = _deployMocks(cfg);
        }
        escrow = new AgentTrustEscrow(
            _owner(),
            cfg.identityRegistry,
            cfg.reputationRegistry,
            cfg.validationRegistry,
            cfg.minTtl,
            cfg.maxTtl,
            cfg.grace,
            cfg.maxTrustedClients,
            cfg.reputationReadGas
        );
        escrow.setTokenAllowed(cfg.token, true);
        vm.stopBroadcast();

        _write(address(escrow), cfg);
        return (escrow, cfg);
    }

    /// @dev Defaults are the PROPOSED parameters in task.md §6.8. Every one of them is
    ///      overridable, so a deployment never depends on a value buried in code.
    function _config() internal view returns (Config memory cfg) {
        cfg.identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        cfg.reputationRegistry = vm.envOr("REPUTATION_REGISTRY", address(0));
        cfg.validationRegistry = vm.envOr("VALIDATION_REGISTRY", address(0));
        cfg.token = vm.envOr("USDC_ADDRESS", address(0));
        cfg.minTtl = uint64(vm.envOr("MIN_TTL_SECONDS", uint256(10 minutes)));
        cfg.maxTtl = uint64(vm.envOr("MAX_TTL_SECONDS", uint256(24 hours)));
        cfg.grace = uint64(vm.envOr("GRACE_SECONDS", uint256(15 minutes)));
        cfg.maxTrustedClients = uint16(vm.envOr("MAX_TRUSTED_CLIENTS", uint256(10)));
        cfg.reputationReadGas = uint64(vm.envOr("REPUTATION_READ_GAS", uint256(250_000)));

        // All three registries come from the same place, or none of them do: a
        // deployment that mixed a live registry with a mock would be a trap.
        bool anyLive = cfg.identityRegistry != address(0) || cfg.reputationRegistry != address(0)
            || cfg.validationRegistry != address(0);
        bool allLive = cfg.identityRegistry != address(0) && cfg.reputationRegistry != address(0)
            && cfg.validationRegistry != address(0);
        require(!anyLive || allLive, "set all three registry addresses, or none");
    }

    function _owner() internal view returns (address) {
        return vm.envOr("ESCROW_OWNER", msg.sender);
    }

    function _deployMocks(Config memory cfg) internal returns (Config memory) {
        MockIdentityRegistry id = new MockIdentityRegistry();
        cfg.identityRegistry = address(id);
        cfg.reputationRegistry = address(new MockReputationRegistry(address(id)));
        cfg.validationRegistry = address(new MockValidationRegistry(address(id)));
        if (cfg.token == address(0)) cfg.token = address(new MockUSDC());
        cfg.deployedMocks = true;
        return cfg;
    }

    /// @dev Written as JSON so the TypeScript and Python services read one file rather
    ///      than each carrying its own copy of the addresses.
    function _write(address escrow, Config memory cfg) internal {
        string memory path = string.concat("../../deployments/", vm.toString(block.chainid), ".json");
        string memory o = "deployment";

        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "block", block.number);
        vm.serializeAddress(o, "escrow", escrow);
        vm.serializeAddress(o, "owner", _owner());
        vm.serializeAddress(o, "token", cfg.token);
        vm.serializeAddress(o, "identityRegistry", cfg.identityRegistry);
        vm.serializeAddress(o, "reputationRegistry", cfg.reputationRegistry);
        vm.serializeAddress(o, "validationRegistry", cfg.validationRegistry);
        vm.serializeBool(o, "mockRegistries", cfg.deployedMocks);
        vm.serializeUint(o, "minTtlSeconds", cfg.minTtl);
        vm.serializeUint(o, "maxTtlSeconds", cfg.maxTtl);
        vm.serializeUint(o, "graceSeconds", cfg.grace);
        vm.serializeUint(o, "maxTrustedClients", cfg.maxTrustedClients);
        vm.serializeUint(o, "reputationReadGas", cfg.reputationReadGas);
        string memory json = vm.serializeString(o, "commit", _commit());

        vm.writeJson(json, path);
        console.log("escrow      %s", escrow);
        console.log("registries  %s (mocks: %s)", cfg.identityRegistry, cfg.deployedMocks);
        console.log("written     deployments/%s.json", vm.toString(block.chainid));
    }

    /// @dev Records which source produced these addresses. Unavailable inside a plain
    ///      `forge script` run without FFI, so it degrades to "unknown" rather than
    ///      failing the deployment.
    function _commit() internal view returns (string memory) {
        return vm.envOr("GIT_COMMIT", string("unknown"));
    }
}
