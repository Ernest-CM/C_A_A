from __future__ import annotations

from fastapi import Header, HTTPException

from app.services.jwt_auth import verify_access_token


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        return verify_access_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
