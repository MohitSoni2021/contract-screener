from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from pymongo.errors import DuplicateKeyError

from app.dependencies import AuthenticatedUser, get_current_user, get_database
from app.security import DUMMY_PASSWORD_HASH, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["authentication"])


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Name is required.")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


def public_user(user: dict[str, Any]) -> dict[str, str]:
    return {"id": str(user["_id"]), "name": user["name"], "email": user["email"]}


def session_response(user: dict[str, Any]) -> dict[str, Any]:
    access_token, _, _ = create_access_token(str(user["_id"]))
    return {"access_token": access_token, "token_type": "bearer", "user": public_user(user)}


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, database: Any = Depends(get_database)) -> dict[str, Any]:
    user = {
        "name": payload.name,
        "email": payload.email,
        "password_hash": hash_password(payload.password),
        "created_at": datetime.now(timezone.utc),
    }
    try:
        result = await database.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="An account with this email already exists.") from None

    user["_id"] = result.inserted_id
    return session_response(user)


@router.post("/login")
async def login(payload: LoginRequest, database: Any = Depends(get_database)) -> dict[str, Any]:
    user = await database.users.find_one({"email": payload.email})
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
