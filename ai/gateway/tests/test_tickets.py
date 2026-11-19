import base64
import hashlib
import hmac
import json

import pytest
from fastapi import HTTPException

from app.main import decode_ticket


def encode_ticket(payload: dict, secret: str) -> str:
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    signature = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    signed = base64.urlsafe_b64encode(signature).decode().rstrip("=")
    return f"{body}.{signed}"


def claims(**overrides):
    value = {
        "request_id": "req_test_123",
        "user_id": "user_test_123",
        "source_file_id": "file_test_123",
        "nonce": "nonce_test_123",
        "exp": 4_102_444_800,
    }
    value.update(overrides)
    return value


def test_valid_ticket_is_decoded(monkeypatch):
    monkeypatch.setattr("app.main.TICKET_SECRET", "unit-test-secret")
    ticket = encode_ticket(claims(), "unit-test-secret")
    assert decode_ticket(ticket)["request_id"] == "req_test_123"


def test_tampered_signature_is_rejected(monkeypatch):
    monkeypatch.setattr("app.main.TICKET_SECRET", "unit-test-secret")
    ticket = encode_ticket(claims(), "unit-test-secret")
    body, signature = ticket.split(".", 1)
    replacement = ("A" if signature[0] != "A" else "B") + signature[1:]
    with pytest.raises(HTTPException) as error:
        decode_ticket(f"{body}.{replacement}")
    assert error.value.status_code == 401


def test_expired_ticket_is_rejected(monkeypatch):
    monkeypatch.setattr("app.main.TICKET_SECRET", "unit-test-secret")
    ticket = encode_ticket(claims(exp=1), "unit-test-secret")
    with pytest.raises(HTTPException) as error:
        decode_ticket(ticket)
    assert error.value.status_code == 401


def test_missing_required_claim_is_rejected(monkeypatch):
    monkeypatch.setattr("app.main.TICKET_SECRET", "unit-test-secret")
    payload = claims()
    del payload["source_file_id"]
    ticket = encode_ticket(payload, "unit-test-secret")
    with pytest.raises(HTTPException) as error:
        decode_ticket(ticket)
    assert error.value.status_code == 401


def test_unconfigured_secret_fails_closed(monkeypatch):
    monkeypatch.setattr("app.main.TICKET_SECRET", "")
    with pytest.raises(HTTPException) as error:
        decode_ticket("a.b")
    assert error.value.status_code == 503
