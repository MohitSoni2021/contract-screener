from dataclasses import dataclass
from typing import Any

from bson import ObjectId
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError

from app.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    name: str
    email: str
    token_id: str
    token_expires_at: int


def get_database(request: Request) -> Any:
    database = getattr(request.app.state, "database", None)
    if database is None:
        raise HTTPException(status_code=503, detail="Database is unavailable.")
    return database


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    database: Any = Depends(get_database),
) -> AuthenticatedUser:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized

    try:
        claims = decode_access_token(credentials.credentials)
    except (InvalidTokenError, TypeError, ValueError):
        raise unauthorized from None

    user_id = claims.get("sub")
    token_id = claims.get("jti")
    if not isinstance(user_id, str) or not ObjectId.is_valid(user_id) or not isinstance(token_id, str):
        raise unauthorized

    revoked = await database.revoked_tokens.find_one({"token_id": token_id}, {"_id": 1})
    if revoked:
        raise unauthorized

    user = await database.users.find_one({"_id": ObjectId(user_id)})
    if user is None:
        raise unauthorized

    return AuthenticatedUser(
        id=str(user["_id"]),
        name=user["name"],
        email=user["email"],
        token_id=token_id,
        token_expires_at=int(claims["exp"]),
    )
