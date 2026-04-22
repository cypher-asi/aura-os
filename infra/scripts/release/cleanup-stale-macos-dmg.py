#!/usr/bin/env python3

import os
import plistlib
import re
import subprocess
import time
from pathlib import Path


VOLUME_PATTERN = re.compile(r"^/Volumes/Aura(?: \d+)?$")
IMAGE_PATTERN = re.compile(r"^(?:rw\.)?Aura(?:_.*)?\.dmg$")
ROOT_DEVICE_PATTERN = re.compile(r"^(/dev/disk\d+)")
RETRYABLE_DETACH_EXIT_CODES = {16}


def root_device(device: str) -> str:
    match = ROOT_DEVICE_PATTERN.match(device or "")
    return match.group(1) if match else device


def run_detach(device: str, force: bool) -> subprocess.CompletedProcess[str]:
    args = ["hdiutil", "detach"]
    if force:
        args.append("-force")
    args.append(device)
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
    )


def detach_device(device: str, attempts: int = 4) -> bool:
    normalized = root_device(device)

    for attempt in range(1, attempts + 1):
        force = attempt > 1
        result = run_detach(normalized, force=force)
        if result.returncode == 0:
            return True

        stderr = (result.stderr or result.stdout or "").strip()
        mode = "force detach" if force else "detach"
        print(
            f"Warning: {mode} of {normalized} failed"
            f" (attempt {attempt}/{attempts}, exit {result.returncode})"
            f"{f': {stderr}' if stderr else ''}"
        )

        if result.returncode not in RETRYABLE_DETACH_EXIT_CODES:
            break

        if attempt < attempts:
            time.sleep(attempt)

    return False


def detach_stale_images() -> None:
    raw = subprocess.run(
        ["hdiutil", "info", "-plist"],
        capture_output=True,
        check=True,
    ).stdout
    data = plistlib.loads(raw)
    seen_devices: set[str] = set()

    for image in data.get("images", []):
        image_path = image.get("image-path", "")
        image_name = Path(image_path).name if image_path else ""
        entities = image.get("system-entities", [])
        mount_points = [entity.get("mount-point", "") for entity in entities]
        matches_volume = any(VOLUME_PATTERN.match(mount or "") for mount in mount_points)
        matches_image = bool(image_name and IMAGE_PATTERN.match(image_name))
        if not (matches_volume or matches_image):
            continue

        for entity in reversed(entities):
            device = entity.get("dev-entry")
            if not device:
                continue

            normalized_device = root_device(device)
            if not normalized_device or normalized_device in seen_devices:
                continue
            seen_devices.add(normalized_device)
            print(f"Detaching stale DMG device {normalized_device} from {image_name or 'Aura image'}")
            if not detach_device(normalized_device):
                print(f"Warning: failed to fully detach {normalized_device}; continuing cleanup")


def remove_stale_files() -> None:
    release_dir = os.environ.get("AURA_RELEASE_DIR")
    if not release_dir:
        raise SystemExit("AURA_RELEASE_DIR is required")

    release_path = Path(release_dir)
    if not release_path.exists():
        return

    for pattern in ("rw.Aura*.dmg", "Aura_*.dmg"):
        for path in release_path.glob(pattern):
            print(f"Removing stale DMG file {path}")
            path.unlink(missing_ok=True)


def main() -> None:
    try:
        detach_stale_images()
    except Exception as exc:  # Best-effort cleanup should not abort the packaging retry path.
        print(f"Warning: stale DMG detach cleanup failed: {exc}")
    remove_stale_files()


if __name__ == "__main__":
    main()
