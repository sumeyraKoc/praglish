import hashlib
import hmac
import secrets

# Hackathon MVP icin: bcrypt/passlib gibi ek bagimlilik eklemeden, Python'un
# kendi guvenli PBKDF2 implementasyonuyla sifre hashliyoruz. "salt$hash" olarak
# tek string'de saklaniyor.

_ITERATIONS = 100_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _ITERATIONS)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, hashed: str) -> bool:
    try:
        salt, digest_hex = hashed.split("$")
    except ValueError:
        return False
    new_digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _ITERATIONS)
    return hmac.compare_digest(new_digest.hex(), digest_hex)
