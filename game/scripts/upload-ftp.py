#!/usr/bin/env python3
"""Deprecated deploy entrypoint.

Kept only so old shell history (`python3 scripts/upload-ftp.py`) does not use the
unsafe per-file uploader. The verified deploy path force-uploads root files,
checks the live hashed bundles, and repairs any missing dist files.
"""

import subprocess
import sys
from pathlib import Path


def main() -> int:
    game_root = Path(__file__).resolve().parents[1]
    deploy_script = game_root / "scripts" / "deploy-lftp.sh"
    print(
        "scripts/upload-ftp.py is deprecated; forwarding to scripts/deploy-lftp.sh",
        file=sys.stderr,
    )
    return subprocess.run(["bash", str(deploy_script)], cwd=game_root).returncode


if __name__ == "__main__":
    raise SystemExit(main())
