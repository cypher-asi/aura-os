#!/usr/bin/env python3

import os
import plistlib
import re
import subprocess
from pathlib import Path


VOLUME_PATTERN = re.compile(r"^/Volumes/Aura(?: \d+)?$")
IMAGE_PATTERN = re.compile(r"^(?:rw\.)?Aura(?:_.*)?\.dmg$")


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
            if not device or device in seen_devices:
                continue
            seen_devices.add(device)
            print(f"Detaching stale DMG device {device} from {image_name or 'Aura image'}")
            result = subprocess.run(
                ["hdiutil", "detach", device],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                continue
            subprocess.run(["hdiutil", "detach", "-force", device], check=True)


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
    detach_stale_images()
    remove_stale_files()


if __name__ == "__main__":
    main()
