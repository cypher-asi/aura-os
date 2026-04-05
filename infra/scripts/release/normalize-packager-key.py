#!/usr/bin/env python3

import base64
import os
import sys


COMMENT_PREFIX = "untrusted comment: "
DEFAULT_SECRET_COMMENT = "rsign encrypted secret key"


def decode_or_passthrough(value: str) -> str:
    try:
        decoded = base64.b64decode(value, validate=True)
        return decoded.decode("utf-8")
    except Exception:
        return value


def normalize_secret(raw: str) -> str:
    decoded = decode_or_passthrough(raw.strip()).lstrip("\ufeff")
    if decoded.startswith(COMMENT_PREFIX):
        normalized = decoded
    else:
        normalized = f"{COMMENT_PREFIX}{DEFAULT_SECRET_COMMENT}\n{decoded.lstrip()}"
    return base64.b64encode(normalized.encode("utf-8")).decode("utf-8")


def main() -> int:
    raw = os.environ.get("CARGO_PACKAGER_SIGN_PRIVATE_KEY", "").strip()
    if not raw:
        return 0
    sys.stdout.write(normalize_secret(raw))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
