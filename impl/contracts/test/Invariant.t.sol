// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {AgentTrustEscrow} from "../src/AgentTrustEscrow.sol";
import {MockIdentityRegistry} from "../src/mocks/MockIdentityRegistry.sol";
import {MockReputationRegistry} from "../src/mocks/MockReputationRegistry.sol";
import {MockValidationRegistry} from "../src/mocks/MockValidationRegistry.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Drives the escrow through random legal sequences from several actors.
/// @dev    Everything the handler does is something a real participant could do; it
///         never reaches into storage. Calls that revert are expected and counted
///         rather than suppressed, so a handler that silently stopped exercising the
///         contract would show up as a ghost-run count of zero.
contract EscrowHandler is Test {
    AgentTrustEscrow public escrow;
    MockIdentityRegistry public identity;
    MockValidationRegistry public validation;
    MockUSDC public usdc;

    address public immutable owner;
    address public immutable seller;
    address public immutable validator;
    uint256 public immutable sellerAgentId;

    address[3] public buyers;

    bytes32[] public jobIds;
    mapping(bytes32 => bool) public known;
    mapping(bytes32 => bytes32) public saltOf;

    /// @notice Jobs seen leaving Funded, counted independently of contract storage.
    mapping(bytes32 => uint256) public settledCount;
    uint256 public funded;
    uint256 public released;
    uint256 public refunded;

    /// @notice Double-entry shadow accounting. Conservation alone is not enough: an
    ///         escrow that pays the wrong party still holds the right total. These
    ///         track what each party is *owed*, so the invariants can check
    ///         destination as well as amount.
    uint256 public creditedToPayee;
    mapping(address => uint256) public paidIn;
    mapping(address => uint256) public refundedTo;

    uint256 public constant BUYER_START = 1e12;

    uint256 private _nonce;

    /// @dev Diagnostic: the last reason `fund` refused, so a run that never funds
    ///      anything says why instead of just failing invariant D.
    bytes4 public lastFundRevert;
    uint256 public fundAttempts;

    constructor(
        AgentTrustEscrow escrow_,
        MockIdentityRegistry identity_,
        MockValidationRegistry validation_,
        MockUSDC usdc_,
        address owner_,
        address seller_,
        address validator_,
        uint256 sellerAgentId_
    ) {
        escrow = escrow_;
        identity = identity_;
        validation = validation_;
        usdc = usdc_;
        owner = owner_;
        seller = seller_;
        validator = validator_;
        sellerAgentId = sellerAgentId_;

        buyers[0] = makeAddr("buyer0");
        buyers[1] = makeAddr("buyer1");
        buyers[2] = makeAddr("buyer2");
        for (uint256 i; i < buyers.length; i++) {
            usdc.mint(buyers[i], BUYER_START);
            vm.prank(buyers[i]);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    function jobCount() external view returns (uint256) {
        return jobIds.length;
    }

    function fund(uint256 buyerSeed, uint256 amount, uint64 ttl) external {
        address buyer = buyers[buyerSeed % buyers.length];
        amount = bound(amount, 1, 1e6);
        ttl = uint64(bound(ttl, escrow.minTtl(), escrow.maxTtl()));

        vm.prank(buyer);
        try escrow.fund(
            sellerAgentId,
            address(usdc),
            amount,
            AgentTrustEscrow.ResourceRef({
                methodHash: keccak256("POST"),
                uriHash: keccak256("https://seller.example/v1/summarise"),
                bodyHash: keccak256(abi.encode(_nonce))
            }),
            bytes32(++_nonce),
            ttl,
            validator,
            AgentTrustEscrow.GatePolicy({
                trustedClients: new address[](0),
                minDistinct: 0,
                minCount: 0,
                minAvgValue: 0
            })
        ) returns (bytes32 jobId) {
            if (!known[jobId]) {
                known[jobId] = true;
                jobIds.push(jobId);
                saltOf[jobId] = keccak256(abi.encode("salt", jobId));
            }
            funded++;
            paidIn[buyer] += amount;
        } catch (bytes memory reason) {
            lastFundRevert = reason.length >= 4 ? bytes4(reason) : bytes4(0);
        }
        fundAttempts++;
    }

    function bind(uint256 seed) external {
        bytes32 jobId = _pick(seed);
        if (jobId == bytes32(0)) return;
        bytes32 salt = saltOf[jobId];
        bytes32 requestHash = escrow.previewRequestHash(jobId, salt);

        vm.prank(seller);
        try validation.validationRequest(validator, sellerAgentId, "", requestHash) {} catch {}
        vm.prank(seller);
        try escrow.bindValidation(jobId, salt) {} catch {}
    }

    /// @dev The response is biased towards the passing value. Drawn uniformly from
    ///      0..100 a release would be reached roughly once in a hundred attestations,
    ///      and a run that never settles anything leaves the balance invariants holding
    ///      vacuously. Biasing which states are *reachable* is not the same as
    ///      weakening what is asserted: the invariants below are unchanged, and
    ///      `afterInvariant` fails the run if no settlement happened.
    function attest(uint256 seed, uint8 response) external {
        bytes32 jobId = _pick(seed);
        if (jobId == bytes32(0)) return;
        uint8 verdict = response % 2 == 0 ? escrow.PASS_THRESHOLD() : uint8(bound(response, 0, 99));
        bytes32 requestHash = escrow.previewRequestHash(jobId, saltOf[jobId]);

        vm.prank(validator);
        try validation.validationResponse(requestHash, verdict, "", bytes32(0), "agenttrust") {} catch {}
    }

    function confirm(uint256 seed) external {
        bytes32 jobId = _pick(seed);
        if (jobId == bytes32(0)) return;
        try escrow.confirmValidation(jobId) {} catch {}
    }

    function release(uint256 seed) external {
        bytes32 jobId = _pick(seed);
        if (jobId == bytes32(0)) return;
        uint256 amount = escrow.jobs(jobId).amount;
        try escrow.release(jobId) {
            settledCount[jobId]++;
            released++;
            creditedToPayee += amount;
        } catch {}
    }

    function refund(uint256 seed) external {
        bytes32 jobId = _pick(seed);
        if (jobId == bytes32(0)) return;
        address payer = escrow.jobs(jobId).payer;
        uint256 amount = escrow.jobs(jobId).amount;
        try escrow.refund(jobId) {
            settledCount[jobId]++;
            refunded++;
            refundedTo[payer] += amount;
        } catch {}
    }

    function warp(uint64 by) external {
        vm.warp(vm.getBlockTimestamp() + bound(by, 1, 4 hours));
    }

    /// @dev Jumps to just past one job's refund point. Without it the refund branch is
    ///      effectively unreachable: TTLs run to 24 hours and a run of a few hundred
    ///      random warps rarely covers that.
    function warpPastRefundPoint(uint256 seed) external {
        bytes32 jobId = _pick(seed);
        if (jobId == bytes32(0)) return;
        uint256 target = uint256(escrow.jobs(jobId).deadline) + escrow.grace() + 1;
        if (target > vm.getBlockTimestamp()) vm.warp(target);
    }

    /// @dev Every owner-only entry point, fired from the owner at random moments.
    ///      Invariant C says none of these may move a single token.
    function reconfigure(uint256 which, uint64 a, uint64 b, uint16 c, int128 d) external {
        vm.startPrank(owner);
        uint256 pick = which % 6;
        if (pick == 0) try escrow.setGrace(a) {} catch {}
        else if (pick == 1) try escrow.setTtlBounds(uint64(bound(a, 1, 1 days)), uint64(bound(b, 1 days, 30 days))) {} catch {}
        else if (pick == 2) try escrow.setGateFloors(c, a, d) {} catch {}
        else if (pick == 3) try escrow.setMaxTrustedClients(c) {} catch {}
        else if (pick == 4) try escrow.setReputationReadGas(uint64(bound(a, 45_000, 1e7))) {} catch {}
        else try escrow.setTokenAllowed(address(usdc), c % 2 == 0) {} catch {}

        // Restore a configuration `fund` can satisfy. Without this the run wedges: one
        // random `setGateFloors(7, 500, ...)` makes every later fund with an empty
        // trusted-client policy revert, and the balance invariants then hold vacuously
        // for the rest of the run. Invariant D is what caught that.
        escrow.setGateFloors(0, 0, 0);
        escrow.setTtlBounds(10 minutes, 24 hours);
        escrow.setMaxTrustedClients(10);
        escrow.setReputationReadGas(250_000);
        escrow.setTokenAllowed(address(usdc), true);
        vm.stopPrank();
    }

    /// @dev The escrow's own accounting, recomputed from outside it.
    function escrowedTotal() external view returns (uint256 total) {
        for (uint256 i; i < jobIds.length; i++) {
            if (escrow.jobState(jobIds[i]) == AgentTrustEscrow.State.Funded) {
                total += escrow.jobs(jobIds[i]).amount;
            }
        }
    }

    function maxSettlementsForAnyJob() external view returns (uint256 worst) {
        for (uint256 i; i < jobIds.length; i++) {
            if (settledCount[jobIds[i]] > worst) worst = settledCount[jobIds[i]];
        }
    }

    function _pick(uint256 seed) internal view returns (bytes32) {
        if (jobIds.length == 0) return bytes32(0);
        return jobIds[seed % jobIds.length];
    }
}

/// @notice CONTRACT-013 — the two properties that matter most: money is conserved and
///         a job settles at most once.
contract InvariantTest is Test {
    AgentTrustEscrow internal escrow;
    MockIdentityRegistry internal identity;
    MockReputationRegistry internal reputation;
    MockValidationRegistry internal validation;
    MockUSDC internal usdc;
    EscrowHandler internal handler;

    address internal owner = makeAddr("owner");
    address internal seller = makeAddr("seller");
    address internal validator = makeAddr("validator");

    function setUp() public {
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry(address(identity));
        validation = new MockValidationRegistry(address(identity));
        usdc = new MockUSDC();

        vm.prank(seller);
        uint256 sellerAgentId = identity.register("https://seller.example/agent.json");

        escrow = new AgentTrustEscrow(
            owner, address(identity), address(reputation), address(validation), 10 minutes, 24 hours, 15 minutes, 10, 250_000
        );
        vm.prank(owner);
        escrow.setTokenAllowed(address(usdc), true);

        handler =
            new EscrowHandler(escrow, identity, validation, usdc, owner, seller, validator, sellerAgentId);
        targetContract(address(handler));
    }

    /// @notice Invariant A. Every token the escrow holds belongs to a job that is still
    ///         Funded — no dust left behind by a settlement, nothing paid out twice,
    ///         nothing paid out of a job that never settled.
    function invariant_A_EscrowHoldsExactlyTheFundedJobs() public view {
        assertEq(usdc.balanceOf(address(escrow)), handler.escrowedTotal());
    }

    /// @notice Invariant B. A job leaves Funded at most once, counted outside the
    ///         contract so a broken state machine cannot also fake the evidence.
    function invariant_B_NoJobSettlesTwice() public view {
        assertLe(handler.maxSettlementsForAnyJob(), 1);
        assertEq(handler.released() + handler.refunded(), _settledJobs());
    }

    /// @notice Invariant E. Released money reached the payee, and only the payee.
    /// @dev    A and C would both pass against an escrow that released to the payer, or
    ///         to whoever called `release` — the total in the contract would still be
    ///         right. Mutation testing found exactly that, twice, which is why this
    ///         invariant exists.
    function invariant_E_ReleasedMoneyReachedThePayee() public view {
        assertEq(usdc.balanceOf(seller), handler.creditedToPayee());
    }

    /// @notice Invariant F. Each buyer is out of pocket by exactly what it funded and
    ///         has not had refunded.
    function invariant_F_EachBuyersBalanceIsFullyExplained() public view {
        for (uint256 i; i < 3; i++) {
            address buyer = handler.buyers(i);
            assertEq(
                usdc.balanceOf(buyer),
                handler.BUYER_START() - handler.paidIn(buyer) + handler.refundedTo(buyer)
            );
        }
    }

    /// @notice Invariant G. Nobody else ends up holding the money — not the caller of
    ///         `release`/`refund`, not the validator, not the owner.
    function invariant_G_NoThirdPartyHoldsEscrowedFunds() public view {
        assertEq(usdc.balanceOf(address(handler)), 0);
        assertEq(usdc.balanceOf(validator), 0);
        assertEq(usdc.balanceOf(owner), 0);
        assertEq(usdc.balanceOf(address(this)), 0);
    }

    /// @notice Invariant C. No owner-only call moves escrowed money. The owner is
    ///         firing every setter throughout the run; if any of them could reach the
    ///         balance, invariant A would break while this one located it.
    function invariant_C_ConfigurationNeverTouchesTheBalance() public view {
        assertEq(usdc.balanceOf(address(escrow)), handler.escrowedTotal());
        assertEq(usdc.balanceOf(owner), 0);
    }

    /// @notice Not an invariant about the contract but about the test: if the handler
    ///         never funded anything, the three above would hold vacuously.
    /// @dev    This belongs in `afterInvariant`, not in an `invariant_` function.
    ///         Foundry checks those after **every** call including the first, so
    ///         "at least one job has been funded" can never hold at the start of a run
    ///         and an `invariant_` version fails immediately, every time — which is
    ///         exactly what happened and what sent me looking for a contract bug that
    ///         was not there. `afterInvariant` runs once, at the end of each run.
    function afterInvariant() public view {
        if (handler.funded() == 0) {
            console.log("fund never succeeded in %s attempts", handler.fundAttempts());
            console.logBytes4(handler.lastFundRevert());
        }
        assertGt(handler.funded(), 0, "handler never funded a job: the invariants above held vacuously");
        assertGt(handler.released() + handler.refunded(), 0, "handler never settled a job");
    }

    function _settledJobs() internal view returns (uint256 n) {
        uint256 count = handler.jobCount();
        for (uint256 i; i < count; i++) {
            if (handler.settledCount(handler.jobIds(i)) > 0) n++;
        }
    }
}
