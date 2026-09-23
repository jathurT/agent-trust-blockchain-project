// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {FeeOnTransferToken, ReturnsFalseToken, RevertingToken} from "../src/mocks/AdversarialTokens.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockUSDCTest is Test {
    MockUSDC internal usdc;
    uint256 internal payerKey = 0xA11CE;
    address internal payer;
    address internal payee = address(0xBEEF);

    function setUp() public {
        usdc = new MockUSDC();
        payer = vm.addr(payerKey);
        usdc.mint(payer, 1_000_000); // 1 USDC
        vm.warp(1_700_000_000);
    }

    /// The properties the rest of the system depends on (V-81).
    function test_MatchesRealUsdcShape() public view {
        assertEq(usdc.decimals(), 6, "decimals");
        assertEq(usdc.version(), "2", "version");
        // The EIP-712 domain must use name "USDC" (not the ERC-20 name "USD Coin").
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USDC"),
                keccak256("2"),
                block.chainid,
                address(usdc)
            )
        );
        assertEq(usdc.DOMAIN_SEPARATOR(), expected, "domain separator formula");
    }

    function _signReceive(bytes32 nonce, uint256 value, address to) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), payer, to, value, uint256(0), type(uint256).max, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(payerKey, digest);
    }

    function test_ReceiveWithAuthorization_OnlyPayeeMaySubmit() public {
        bytes32 nonce = keccak256("n1");
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(nonce, 250_000, payee);

        // A third party holding the same signature cannot settle it (attack I-B).
        vm.prank(address(0xDEAD));
        vm.expectRevert(MockUSDC.CallerMustBePayee.selector);
        usdc.receiveWithAuthorization(payer, payee, 250_000, 0, type(uint256).max, nonce, v, r, s);

        vm.prank(payee);
        usdc.receiveWithAuthorization(payer, payee, 250_000, 0, type(uint256).max, nonce, v, r, s);
        assertEq(usdc.balanceOf(payee), 250_000, "payee funded");
        assertTrue(usdc.authorizationState(payer, nonce), "nonce burned");
    }

    function test_AuthorizationNonceCannotBeReused() public {
        bytes32 nonce = keccak256("n2");
        (uint8 v, bytes32 r, bytes32 s) = _signReceive(nonce, 100_000, payee);
        vm.prank(payee);
        usdc.receiveWithAuthorization(payer, payee, 100_000, 0, type(uint256).max, nonce, v, r, s);

        vm.prank(payee);
        vm.expectRevert(MockUSDC.AuthorizationAlreadyUsed.selector);
        usdc.receiveWithAuthorization(payer, payee, 100_000, 0, type(uint256).max, nonce, v, r, s);
    }

    function test_AuthorizationRespectsValidityWindow() public {
        bytes32 nonce = keccak256("n3");
        bytes32 structHash = keccak256(
            abi.encode(
                usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                payer, payee, uint256(1), vm.getBlockTimestamp() + 100, type(uint256).max, nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerKey, digest);
        vm.prank(payee);
        vm.expectRevert(MockUSDC.AuthorizationNotYetValid.selector);
        usdc.receiveWithAuthorization(payer, payee, 1, vm.getBlockTimestamp() + 100, type(uint256).max, nonce, v, r, s);
    }

    function test_WrongSignerIsRejected() public {
        bytes32 nonce = keccak256("n4");
        bytes32 structHash = keccak256(
            abi.encode(usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), payer, payee, uint256(1), uint256(0), type(uint256).max, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, digest); // someone else
        vm.prank(payee);
        vm.expectRevert(MockUSDC.InvalidSignature.selector);
        usdc.receiveWithAuthorization(payer, payee, 1, 0, type(uint256).max, nonce, v, r, s);
    }
}

/// @notice Each adversarial token must actually misbehave, otherwise the tests
///         that rely on it in CONTRACT-014 would pass for the wrong reason.
contract AdversarialTokenTest is Test {
    using SafeERC20 for IERC20;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function test_FeeOnTransferDeliversLessThanRequested() public {
        FeeOnTransferToken t = new FeeOnTransferToken(100); // 1%
        t.mint(alice, 1_000_000);
        vm.prank(alice);
        t.transfer(bob, 1_000_000);
        assertEq(t.balanceOf(bob), 990_000, "recipient got less than sent");
    }

    function test_ReturnsFalseTokenIsCaughtBySafeERC20() public {
        ReturnsFalseToken t = new ReturnsFalseToken();
        SafeTransferCaller caller = new SafeTransferCaller();
        t.mint(address(caller), 1_000);

        // The raw call reports failure by return value, which naive code ignores.
        vm.prank(address(caller));
        assertFalse(t.transfer(bob, 1), "raw transfer reports failure");

        // SafeERC20 turns that into a revert. The call must be made *externally*:
        // safeTransfer is an internal library function, so an expectRevert placed
        // on it would be matched against the inner token call, which succeeds.
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(t)));
        caller.send(IERC20(address(t)), bob, 1);
    }

    function test_RevertingTokenBlocksPayouts() public {
        RevertingToken t = new RevertingToken();
        t.mint(alice, 1_000);
        vm.prank(alice);
        vm.expectRevert(RevertingToken.TransferBlocked.selector);
        t.transfer(bob, 1);
    }
}

/// @dev Exists so SafeERC20's revert happens across an external call boundary,
///      where vm.expectRevert can see it.
contract SafeTransferCaller {
    using SafeERC20 for IERC20;

    function send(IERC20 token, address to, uint256 value) external {
        token.safeTransfer(to, value);
    }
}
