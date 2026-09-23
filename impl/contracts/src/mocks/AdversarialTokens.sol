// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Tokens that misbehave in the specific ways the escrow must survive
///         (DF-12, DF-16). Used by CONTRACT-011/014; never deployed anywhere real.

/// @dev Delivers less than requested. The escrow must notice via a balance-delta
///      check and refuse the job rather than record an amount it did not receive.
contract FeeOnTransferToken is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 feeBps_) ERC20("Fee On Transfer", "FEE") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, to, value - fee);
        super._update(from, address(0xdead), fee);
    }
}

/// @dev Returns false instead of reverting. Naive `token.transfer(...)` ignores
///      this; SafeERC20 does not.
contract ReturnsFalseToken is ERC20 {
    constructor() ERC20("Returns False", "FALSE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @dev Calls back into a target during a transfer, so reentrancy protection is
///      exercised rather than assumed.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool private _entered;

    constructor() ERC20("Reentrant", "RENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setReentry(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (target != address(0) && !_entered) {
            _entered = true;
            // Deliberately ignore the outcome: the point is to make the call,
            // and the guard under test decides whether it succeeds.
            (bool ok,) = target.call(payload);
            ok;
            _entered = false;
        }
    }
}

/// @dev Always reverts on transfer — a blacklisted or paused payee (DF-16).
///      With "no refund once a pass is recorded", this is how funds could strand.
contract RevertingToken is ERC20 {
    error TransferBlocked();

    constructor() ERC20("Reverting", "STOP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert TransferBlocked();
        super._update(from, to, value);
    }
}
