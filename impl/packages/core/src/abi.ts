/**
 * AGENT-001 — the contract surface the services bind to.
 *
 * Written as human-readable signatures rather than imported from the JSON artifacts,
 * because viem infers argument and return types from a literal `parseAbi` and loses
 * them through a widened JSON import. The risk of hand-writing is drift, so
 * `test/abi.test.ts` checks every signature here against
 * `impl/packages/core/abi/*.abi.json`, which `impl/scripts/export-abi.sh` regenerates
 * from the compiled contracts. That is the same arrangement as the Solidity interfaces
 * and REG-008: a readable declaration, mechanically checked against the real thing.
 */
import { parseAbi } from "viem";

export const escrowAbi = parseAbi([
  "struct ResourceRef { bytes32 methodHash; bytes32 uriHash; bytes32 bodyHash; }",
  "struct GatePolicy { address[] trustedClients; uint16 minDistinct; uint64 minCount; int128 minAvgValue; }",
  "struct Job { address payer; address payee; uint256 payeeAgentId; address validator; address token; uint256 amount; bytes32 resourceHash; bytes32 requestHash; uint64 fundedAt; uint64 deadline; uint64 grace; uint8 state; bool validationRecorded; }",

  "function fund(uint256 payeeAgentId, address token, uint256 amount, ResourceRef resource, bytes32 nonce, uint64 ttlSeconds, address validator, GatePolicy gate) returns (bytes32 jobId)",
  "function bindValidation(bytes32 jobId, bytes32 salt) returns (bytes32 requestHash)",
  "function confirmValidation(bytes32 jobId)",
  "function release(bytes32 jobId)",
  "function refund(bytes32 jobId)",

  "function jobs(bytes32 jobId) view returns (Job)",
  "function jobState(bytes32 jobId) view returns (uint8)",
  "function isReleasable(bytes32 jobId) view returns (bool)",
  "function isRefundable(bytes32 jobId) view returns (bool)",
  "function consumedNonce(address payer, bytes32 nonce) view returns (bool)",
  "function previewResourceHash(ResourceRef resource, uint256 amount, address token) view returns (bytes32)",
  "function previewJobId(address payer, address payee, bytes32 resourceHash, bytes32 nonce) view returns (bytes32)",
  "function previewRequestHash(bytes32 jobId, bytes32 salt) view returns (bytes32)",
  "function previewPayee(uint256 agentId) view returns (address)",
  "function minTtl() view returns (uint64)",
  "function maxTtl() view returns (uint64)",
  "function grace() view returns (uint64)",
  "function tokenAllowed(address token) view returns (bool)",
  "function identityRegistry() view returns (address)",
  "function reputationRegistry() view returns (address)",
  "function validationRegistry() view returns (address)",
  "function PASS_THRESHOLD() view returns (uint8)",
  "function FEEDBACK_TAG() view returns (string)",
  "function minDistinctFloor() view returns (uint16)",
  "function minCountFloor() view returns (uint64)",
  "function minAvgValueFloor() view returns (int128)",

  "event JobFunded(bytes32 indexed jobId, address indexed payer, address indexed payee, uint256 payeeAgentId, address validator, address token, uint256 amount, bytes32 resourceHash, uint64 deadline)",
  "event ValidationBound(bytes32 indexed jobId, bytes32 indexed requestHash, address indexed payee)",
  "event ValidationRecorded(bytes32 indexed jobId, bytes32 indexed requestHash, uint8 response, uint256 lastUpdate)",
  "event JobReleased(bytes32 indexed jobId, address indexed payee, address token, uint256 amount)",
  "event JobRefunded(bytes32 indexed jobId, address indexed payer, address token, uint256 amount)",

  // Custom errors. Without these viem reports a bare 4-byte selector and a caller
  // cannot tell "this job does not exist" from "the node is broken" — which is
  // exactly the distinction SPEC-002 §7 turns into 409 versus 503.
  "error AlreadyBound(bytes32 jobId, bytes32 requestHash)",
  "error BadState(bytes32 jobId, uint8 state)",
  "error DeadlineNotReached(uint64 nowTs, uint64 refundableAt)",
  "error DuplicateTrustedClient(address client)",
  "error GraceOutOfBounds(uint64 given, uint64 max)",
  "error InsufficientGasForReputationRead(uint256 available, uint256 required)",
  "error InvalidTtlBounds()",
  "error InvalidValidator(address validator)",
  "error JobAlreadyExists(bytes32 jobId)",
  "error NotBound(bytes32 jobId)",
  "error NotPayee(address caller, address payee)",
  "error NotValidated(bytes32 jobId)",
  "error OutOfBounds(string parameter, uint256 given, uint256 max)",
  "error ReplayedNonce(address payer, bytes32 nonce)",
  "error ReputationReadGasTooLow(uint64 given, uint64 min)",
  "error ReputationTooLow(uint8 dimension, int256 observed, int256 required)",
  "error RequestMismatch(bytes32 requestHash)",
  "error TokenNotAllowed(address token)",
  "error TooManyTrustedClients(uint256 given, uint16 max)",
  "error TransferAmountMismatch(uint256 expected, uint256 received)",
  "error TtlOutOfBounds(uint64 ttlSeconds, uint64 minTtl, uint64 maxTtl)",
  "error UnknownJob(bytes32 jobId)",
  "error ValidationExists(bytes32 jobId)",
  "error ValidationReadFailed(bytes32 requestHash)",
  "error ZeroAmount()",
  "error ZeroTrustedClient()",
]);

export const identityRegistryAbi = parseAbi([
  "struct MetadataEntry { string metadataKey; bytes metadataValue; }",
  "function register(string agentURI) returns (uint256 agentId)",
  "function register(string agentURI, MetadataEntry[] metadata) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
  "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes signature)",
  "function isAuthorizedOrOwner(address spender, uint256 agentId) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function getVersion() pure returns (string)",
]);

export const reputationRegistryAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function revokeFeedback(uint256 agentId, uint64 feedbackIndex)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function getClients(uint256 agentId) view returns (address[])",
  "function getLastIndex(uint256 agentId, address clientAddress) view returns (uint64)",
  "function getVersion() pure returns (string)",
]);

export const validationRegistryAbi = parseAbi([
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
  "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
  "function getAgentValidations(uint256 agentId) view returns (bytes32[])",
  "function getVersion() pure returns (string)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/** Mirrors `AgentTrustEscrow.State`. Zero means the job does not exist. */
export enum JobState {
  None = 0,
  Funded = 1,
  Released = 2,
  Refunded = 3,
}
