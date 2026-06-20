"""
Deprecated standalone script: use generate_combined_heatmap.py (builds combined + Anjuke-only).
Kept for backwards compatibility — delegates to the combined generator.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from generate_combined_heatmap import main

if __name__ == "__main__":
    main()
