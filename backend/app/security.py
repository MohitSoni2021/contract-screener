from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
from pwdlib import PasswordHash

from app.config import required_setting, token_lifetime_minutes

JWT_ALGORITHM = "HS256"
password_hash = PasswordHash.recommended()
DUMMY_PASSWORD_HASH = password_hash.hash(uuid4().hex)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user_id: str) -> tuple[str, str, datetime]:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=token_lifetime_minutes())
    token_id = str(uuid4())
    payload = {
        "sub": user_id,
        "jti": token_id,
        "iat": now,
        "exp": expires_at,
        "iss": "elcara-api",
        "aud": "elcara-web",
    }
    token = jwt.encode(payload, required_setting("JWT_SECRET_KEY"), algorithm=JWT_ALGORITHM)
    return token, token_id, expires_at


def decode_access_token(token: str) -> dict:
    return jwt.decode(
        token,
        required_setting("JWT_SECRET_KEY"),
        algorithms=[JWT_ALGORITHM],
        issuer="elcara-api",
        audience="elcara-web",
        options={"require": ["sub", "jti", "exp", "iat"]},
    )
