from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import argparse
import os
import time

from .config import ConfigurationError, load_config
from .engine import ScannerEngine
from .market_data import build_market_data_provider
from .storage import atomic_write_json


def paths() -> tuple[Path, Path, Path]:
    return (
        Path(os.environ.get("SCANNER_CONFIG_DIR", "/scanner/config")),
        Path(os.environ.get("SCANNER_OUTPUT_DIR", "/scanner/output")),
        Path(os.environ.get("SCANNER_STATE_DIR", "/scanner/state")),
    )


def run_once(rebuild_history: bool = False) -> int:
    config_dir, output_dir, state_dir = paths()
    config_path = config_dir / "strategy_config_v1.json"
    try:
        config = load_config(config_path)
    except FileNotFoundError:
        atomic_write_json(
            output_dir / "multi_strategy_v1.json",
            {
                "schemaVersion": "multi_strategy_v1",
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "scanner": {
                    "name": "RiSKYiNVESTOR integrated scanner",
                    "version": "1.0.0",
                    "status": "not_configured",
                    "errors": [],
                    "dataFreshness": None,
                },
                "strategies": [],
            },
        )
        return 0
    except (ConfigurationError, ValueError) as error:
        atomic_write_json(
            output_dir / "multi_strategy_v1.json",
            {
                "schemaVersion": "multi_strategy_v1",
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "scanner": {
                    "name": "RiSKYiNVESTOR integrated scanner",
                    "version": "1.0.0",
                    "status": "configuration_error",
                    "errors": [{"message": str(error)}],
                    "dataFreshness": None,
                },
                "strategies": [],
            },
        )
        return 0

    provider = build_market_data_provider(config.provider, state_dir / "market_cache")
    ScannerEngine(config, provider, state_dir, output_dir).scan(
        rebuild_history=rebuild_history
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--loop", action="store_true")
    mode.add_argument("--rebuild-history", action="store_true")
    arguments = parser.parse_args()
    if arguments.once:
        return run_once()
    if arguments.rebuild_history:
        return run_once(rebuild_history=True)
    interval = max(60, int(os.environ.get("SCANNER_INTERVAL_SECONDS", "3600")))
    while True:
        try:
            run_once()
        except Exception as error:
            print(
                f"scanner cycle failed safely: {type(error).__name__}",
                flush=True,
            )
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())
