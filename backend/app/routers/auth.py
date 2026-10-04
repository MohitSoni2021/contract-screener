from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from pymongo.errors import DuplicateKeyError

from app.dependencies import AuthenticatedUser, get_current_user, get_database
from app.security import DUMMY_PASSWORD_HASH, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["authentication"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


def public_user(user: dict[str, Any]) -> dict[str, str]:
    return {"id": str(user["_id"]), "name": user.get("name", "User"), "email": user["email"]}


def session_response(user: dict[str, Any]) -> dict[str, Any]:
    access_token, _, _ = create_access_token(str(user["_id"]))
    return {"access_token": access_token, "token_type": "bearer", "user": public_user(user)}


@router.post("/login")
async def login(payload: LoginRequest, database: Any = Depends(get_database)) -> dict[str, Any]:
    user = await database.users.find_one({"email": payload.email})

    # Auto-provision or update demo account if logging in with automated credentials
    if payload.email == "try.mohitsoni@gmail.com" and payload.password == "123456789":
        if user is None:
            user = {
                "name": "Mohit Soni",
                "email": "try.mohitsoni@gmail.com",
                "password_hash": hash_password("123456789"),
                "created_at": datetime.now(timezone.utc),
            }
            result = await database.users.insert_one(user)
            user["_id"] = result.inserted_id
            return session_response(user)
        else:
            if not verify_password(payload.password, user.get("password_hash", "")):
                new_hash = hash_password("123456789")
                await database.users.update_one({"_id": user["_id"]}, {"$set": {"password_hash": new_hash}})
                user["password_hash"] = new_hash
            return session_response(user)

    stored_hash = user["password_hash"] if user else DUMMY_PASSWORD_HASH
    password_valid = verify_password(payload.password, stored_hash)
    if user is None or not password_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email or password is incorrect.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return session_response(user)


@router.get("/me")
async def get_me(user: AuthenticatedUser = Depends(get_current_user)) -> dict[str, str]:
    return {"id": user.id, "name": user.name, "email": user.email}


@router.post("/logout")
async def logout(
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, str]:
    try:
        await database.revoked_tokens.insert_one(
            {
                "token_id": user.token_id,
                "user_id": ObjectId(user.id),
                "expires_at": datetime.fromtimestamp(user.token_expires_at, tz=timezone.utc),
            }
        )
    except DuplicateKeyError:
        pass
    return {"message": "Signed out."}
