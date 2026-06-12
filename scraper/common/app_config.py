"""Read shared config/config.json. cwd is repo root (same assumption as
config/cookies resolution in cli.py)."""
import json
from pathlib import Path


def load_scraping_config() -> dict:
    p = Path("config/config.json")
    if not p.exists():
        raise FileNotFoundError(
            f"config/config.json not found at {p.resolve()} — run from repo root"
        )
    return json.loads(p.read_text()).get("scraping", {})
