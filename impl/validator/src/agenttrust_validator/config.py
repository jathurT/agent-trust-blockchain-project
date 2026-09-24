"""VAL-001 — configuration.

Fails fast with every problem listed at once, the same rule the TypeScript services
follow (ENV-005). The private key is read once into memory and is never logged, never
echoed in `/health`, and never included in an error message -- `Settings.__repr__` is
overridden so an accidental `print(settings)` cannot leak it either.
"""

from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_ADDRESS_LEN = 42


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=True)

    RPC_URL: str
    CHAIN_ID: int
    ESCROW_ADDRESS: str
    VALIDATION_REGISTRY: str
    IDENTITY_REGISTRY: str

    # The key itself. Held as a plain string because eth-account needs it, but kept out
    # of every representation below.
    VALIDATOR_PRIVATE_KEY: str

    EVIDENCE_DIR: str = "./evidence-store"
    #: Seconds to wait for the payee to bind its requestHash before giving up (VAL-004).
    BINDING_TIMEOUT_SECONDS: int = 120
    #: Seconds between polls. HTTP-only RPC means polling, never subscriptions (V-83).
    POLL_INTERVAL_SECONDS: float = 1.0
    #: Attestation value for a pass. The escrow's PASS_THRESHOLD is 100.
    PASS_RESPONSE: int = 100
    FAIL_RESPONSE: int = 0
    FEEDBACK_TAG: str = "agenttrust"
    #: The origin this validator publishes on its agent card (REG-006). It is a
    #: convenience for discovery only: the escrow names the validator by **address** at
    #: funding, so a wrong origin here cannot redirect an attestation anywhere.
    PUBLIC_ORIGIN: str = "http://127.0.0.1:8099"

    @field_validator("ESCROW_ADDRESS", "VALIDATION_REGISTRY", "IDENTITY_REGISTRY")
    @classmethod
    def _address(cls, value: str) -> str:
        if not value.startswith("0x") or len(value) != _ADDRESS_LEN:
            raise ValueError(f"not a 20-byte address: {value}")
        return value

    @field_validator("VALIDATOR_PRIVATE_KEY")
    @classmethod
    def _key(cls, value: str) -> str:
        raw = value[2:] if value.startswith("0x") else value
        if len(raw) != 64:
            # Deliberately does not echo the value.
            raise ValueError("VALIDATOR_PRIVATE_KEY is not a 32-byte hex key")
        return value if value.startswith("0x") else "0x" + value

    def __repr__(self) -> str:  # pragma: no cover - trivial
        return (
            f"Settings(RPC_URL={self.RPC_URL!r}, CHAIN_ID={self.CHAIN_ID}, "
            f"ESCROW_ADDRESS={self.ESCROW_ADDRESS!r}, VALIDATOR_PRIVATE_KEY=<redacted>)"
        )

    __str__ = __repr__

    def public_view(self) -> dict[str, object]:
        """Everything `/health` may report. The key is not in it, by construction."""
        return {
            "chainId": self.CHAIN_ID,
            "escrow": self.ESCROW_ADDRESS,
            "validationRegistry": self.VALIDATION_REGISTRY,
            "identityRegistry": self.IDENTITY_REGISTRY,
            "bindingTimeoutSeconds": self.BINDING_TIMEOUT_SECONDS,
            "passResponse": self.PASS_RESPONSE,
            "feedbackTag": self.FEEDBACK_TAG,
            "publicOrigin": self.PUBLIC_ORIGIN,
        }
