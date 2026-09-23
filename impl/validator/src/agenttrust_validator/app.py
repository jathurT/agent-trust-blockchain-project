"""VAL-001/002 — the validator's HTTP surface.

Two routes matter: `/health`, which says what this validator is configured for without
ever revealing its key, and `POST /evidence`, which takes the seller's bundle and runs
the whole decision through to the attestation and the release.
"""

from __future__ import annotations

import base64
import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .chain import ChainClient, ChainUnavailable
from .config import Settings
from .decide import EvidenceRejected, EvidenceStore, Receipt, accept_evidence, attest, decide

log = logging.getLogger("agenttrust.validator")


class ReceiptModel(BaseModel):
    jobId: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    resourceHash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    responseHash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")
    sellerAgentId: int = Field(ge=0)
    servedAt: int = Field(ge=0)
    salt: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")

    def to_receipt(self) -> Receipt:
        return Receipt(
            job_id=bytes.fromhex(self.jobId[2:]),
            resource_hash=bytes.fromhex(self.resourceHash[2:]),
            response_hash=bytes.fromhex(self.responseHash[2:]),
            seller_agent_id=self.sellerAgentId,
            served_at=self.servedAt,
            salt=bytes.fromhex(self.salt[2:]),
        )


class EvidenceSubmission(BaseModel):
    receipt: ReceiptModel
    #: 65-byte EOA signature over the DeliveryReceipt.
    signature: str = Field(pattern=r"^0x[0-9a-fA-F]{130}$")
    #: base64 so arbitrary bytes survive JSON intact -- the hash is over the raw bytes.
    requestBodyBase64: str
    responseBodyBase64: str
    path: str


def create_app(settings: Settings, chain: ChainClient | None = None) -> FastAPI:
    app = FastAPI(title="AgentTrust validator", version="0.1.0")
    client = chain or ChainClient(
        rpc_url=settings.RPC_URL,
        chain_id=settings.CHAIN_ID,
        escrow=settings.ESCROW_ADDRESS,
        validation_registry=settings.VALIDATION_REGISTRY,
        private_key=settings.VALIDATOR_PRIVATE_KEY,
    )
    store = EvidenceStore(settings.EVIDENCE_DIR)
    app.state.chain = client
    app.state.store = store
    app.state.settings = settings

    @app.get("/health")
    def health() -> dict[str, object]:
        # `public_view` cannot contain the key: it is built field by field.
        body: dict[str, object] = {"status": "ok", "validator": client.address, **settings.public_view()}
        try:
            client.verify_chain_id()
            body["chainConnected"] = True
            body["blockNumber"] = client.w3.eth.block_number
        except ChainUnavailable as exc:
            body["status"] = "degraded"
            body["chainConnected"] = False
            body["chainError"] = str(exc)
        return body

    @app.post("/evidence")
    def post_evidence(submission: EvidenceSubmission) -> dict[str, object]:
        try:
            evidence = accept_evidence(
                chain=client,
                store=store,
                receipt=submission.receipt.to_receipt(),
                signature=bytes.fromhex(submission.signature[2:]),
                request_body=base64.b64decode(submission.requestBodyBase64),
                response_body=base64.b64decode(submission.responseBodyBase64),
                path=submission.path,
            )
        except EvidenceRejected as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ChainUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        decision = decide(chain=client, evidence=evidence)
        try:
            decision = attest(chain=client, evidence=evidence, decision=decision, settings=settings)
        except ChainUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        log.info(
            "decided",
            extra={"jobId": "0x" + evidence.receipt.job_id.hex(), "passed": decision.passed},
        )
        return {"evidenceId": evidence.evidence_id, **decision.as_json()}

    return app
