from __future__ import annotations

from pydantic import BaseModel, EmailStr
from fastapi import APIRouter, HTTPException

from app.services.jwt_auth import create_access_token
from app.services.mongo import get_db
from app.services.passwords import hash_password, verify_password

router = APIRouter()


class AuthRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/signup")
async def signup(body: AuthRequest):
    db = get_db()
    existing = await db.users.find_one({"email": body.email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already exists")

    user_doc = {
        "email": body.email,
        "password_hash": hash_password(body.password),
    }
    res = await db.users.insert_one(user_doc)
    user_id = str(res.inserted_id)

    token = create_access_token(user_id)
    return {"access_token": token}


@router.post("/login")
async def login(body: AuthRequest):
    db = get_db()
    user = await db.users.find_one({"email": body.email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(str(user["_id"]))
    return {"access_token": token}
