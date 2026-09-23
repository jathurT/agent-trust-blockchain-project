// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title MockUSDC
/// @notice A local stand-in for Base Sepolia USDC that matches the properties the
///         system actually depends on: 6 decimals, the EIP-712 domain
///         {name: "USDC", version: "2"}, and EIP-3009 authorizations (V-81).
/// @dev    Test substrate only. The real token is used on testnet (DEPLOY-001).
///         `receiveWithAuthorization` enforces `to == msg.sender`, which is what
///         lets a contract pull funds against a job-bound nonce — the primitive
///         behind the gasless funding path in STRETCH-006 (DF-03).
contract MockUSDC is ERC20, EIP712 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    /// @notice authorizer => nonce => used. Mirrors FiatTokenV2's accessor.
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error InvalidSignature();
    error CallerMustBePayee();

    constructor() ERC20("USD Coin", "USDC") EIP712("USDC", "2") {}

    /// @dev USDC has 6 decimals; every amount in this project is atomic units.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Test helper. Not present on the real token.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice EIP-712 version, as FiatTokenV2 exposes it.
    function version() external pure returns (string memory) {
        return "2";
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _requireValidAuthorization(from, nonce, validAfter, validBefore);
        _requireValidSignature(
            from,
            keccak256(
                abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
            ),
            v,
            r,
            s
        );
        _markAuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    /// @notice Same as above, except only the payee may submit it. That restriction
    ///         is what prevents a third party from front-running the settlement of
    ///         someone else's authorization (V-81, and attack I-B in V-16).
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (to != msg.sender) revert CallerMustBePayee();
        _requireValidAuthorization(from, nonce, validAfter, validBefore);
        _requireValidSignature(
            from,
            keccak256(
                abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
            ),
            v,
            r,
            s
        );
        _markAuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        if (_authorizationStates[authorizer][nonce]) revert AuthorizationAlreadyUsed();
        _requireValidSignature(authorizer, keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce)), v, r, s);
        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function _requireValidAuthorization(address from, bytes32 nonce, uint256 validAfter, uint256 validBefore)
        private
        view
    {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (_authorizationStates[from][nonce]) revert AuthorizationAlreadyUsed();
    }

    function _requireValidSignature(address signer, bytes32 structHash, uint8 v, bytes32 r, bytes32 s) private view {
        if (ECDSA.recover(_hashTypedDataV4(structHash), v, r, s) != signer) revert InvalidSignature();
    }

    function _markAuthorizationUsed(address from, bytes32 nonce) private {
        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
    }
}
