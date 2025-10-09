#!/usr/bin/env python3
"""Utility to validate OpenRouter connectivity without running the API server."""

import argparse
import asyncio
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence


# Ensure the backend codebase is importable when the script is launched directly
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        val = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


# Load environment variables so we mirror the backend runtime configuration.
_load_env_file(BACKEND_ROOT / ".env")
_load_env_file(BACKEND_ROOT.parent / ".env")


def _ensure_absolute_sqlite_path() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        candidate = BACKEND_ROOT / "braindrive.db"
        if candidate.exists():
            os.environ["DATABASE_URL"] = f"sqlite:///{candidate}"
        return

    prefix = "sqlite:///"
    if db_url.startswith(prefix):
        raw_path = db_url[len(prefix):]
        if raw_path and not os.path.isabs(raw_path):
            resolved = (BACKEND_ROOT / raw_path).resolve()
            os.environ["DATABASE_URL"] = f"sqlite:///{resolved}"


_ensure_absolute_sqlite_path()

from sqlalchemy.exc import OperationalError  # type: ignore  # noqa: E402

from app.ai_providers.registry import provider_registry  # type: ignore  # noqa: E402
from app.core.database import db_factory  # type: ignore  # noqa: E402
from app.core.encryption import EncryptionError, encryption_service  # type: ignore  # noqa: E402
from app.models.settings import SettingInstance, SettingScope  # type: ignore  # noqa: E402
from app.utils.json_parsing import safe_encrypted_json_parse  # type: ignore  # noqa: E402


LOGGER = logging.getLogger("test_openrouter_connection")


DEFAULT_PROVIDER = "openrouter"
DEFAULT_SETTINGS_ID = "openrouter_api_keys_settings"
DEFAULT_SERVER_ID = "openrouter_default_server"


@dataclass
class ProviderTarget:
    user_id: Optional[str]
    settings_id: str = DEFAULT_SETTINGS_ID
    provider: str = DEFAULT_PROVIDER
    server_id: str = DEFAULT_SERVER_ID


@dataclass
class ProviderResult:
    user_id: Optional[str]
    success: bool
    model_count: int = 0
    models_preview: Sequence[str] = ()
    error: Optional[str] = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Test OpenRouter connectivity using stored settings or environment configuration."
    )
    parser.add_argument(
        "--user",
        dest="user",
        default="auto",
        help=(
            "User ID to test (32-char hex). Use 'auto' to test all users with OpenRouter settings or 'env' "
            "to read only the OPENROUTER_API_KEY environment variable."
        ),
    )
    parser.add_argument(
        "--env-only",
        action="store_true",
        help="Skip database lookup and use environment variable OPENROUTER_API_KEY only."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not call the remote API; only validate configuration loading."
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging."
    )
    parser.add_argument(
        "--preview",
        type=int,
        default=5,
        help="Number of model IDs to include in the preview output (default: 5)."
    )
    return parser.parse_args()


def configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="[%(levelname)s] %(message)s")


async def fetch_setting_instances(user_id: Optional[str]) -> List[Dict[str, Any]]:
    """Fetch OpenRouter setting instances for the provided user (or all users)."""
    async_session_factory = db_factory.session_factory
    collected: List[Dict[str, Any]] = []

    async with async_session_factory() as session:
        rows: Optional[List[Any]] = None

        try:
            rows = await SettingInstance.get_all_parameterized(
                session,
                definition_id=DEFAULT_SETTINGS_ID,
                scope=SettingScope.USER.value,
                user_id=user_id,
            )
        except OperationalError as exc:
            LOGGER.warning(
                "settings_instances table not available (parameterized lookup). Did you run migrations? %s",
                exc,
            )
        except Exception as exc:  # noqa: BLE001
            LOGGER.error("Error during parameterized settings lookup: %s", exc)

        if rows:
            for row in rows:
                collected.append(
                    {
                        "id": getattr(row, "id", ""),
                        "value": getattr(row, "value", None),
                        "user_id": getattr(row, "user_id", None),
                        "scope": getattr(row, "scope", None).value if getattr(row, "scope", None) else None,
                    }
                )

        if not collected:
            LOGGER.debug(
                "Parameterized lookup returned no rows; attempting legacy SQL for user_id=%s",
                user_id,
            )
            try:
                legacy_rows = await SettingInstance.get_all(
                    session,
                    definition_id=DEFAULT_SETTINGS_ID,
                    scope=SettingScope.USER.value,
                    user_id=user_id,
                )
                if legacy_rows:
                    for row in legacy_rows:
                        if isinstance(row, dict):
                            collected.append(row)
                        else:
                            collected.append(
                                {
                                    "id": getattr(row, "id", ""),
                                    "value": getattr(row, "value", None),
                                    "user_id": getattr(row, "user_id", None),
                                    "scope": getattr(row, "scope", None),
                                }
                            )
            except OperationalError as exc:
                LOGGER.warning(
                    "settings_instances table not available (legacy lookup). Did you run migrations? %s",
                    exc,
                )
            except Exception as exc:  # noqa: BLE001
                LOGGER.error("Error during legacy settings lookup: %s", exc)

    if not collected:
        LOGGER.warning("No OpenRouter settings found for user_id=%s", user_id or "(any)")

    return collected


def _coerce_value_dict(value: Any, instance_id: str) -> Optional[Dict[str, Any]]:
    """Normalize a settings value into a dictionary, handling encryption and JSON quirks."""
    try:
        if isinstance(value, str) and encryption_service.is_encrypted_value(value):
            LOGGER.debug("Value appears encrypted; decrypting (settings_instance=%s)", instance_id)
            decrypted = encryption_service.decrypt_field("settings_instances", "value", value)
            return safe_encrypted_json_parse(
                decrypted,
                context=f"settings_instance:{instance_id}",
                setting_id=instance_id,
                definition_id=DEFAULT_SETTINGS_ID,
            )

        return safe_encrypted_json_parse(
            value,
            context=f"settings_instance:{instance_id}",
            setting_id=instance_id,
            definition_id=DEFAULT_SETTINGS_ID,
        )
    except EncryptionError as enc_err:
        LOGGER.error("Decryption failed for settings_instance=%s: %s", instance_id, enc_err)
        return None
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Failed to parse setting %s: %s", instance_id, exc)
        return None


def _extract_api_key(value_dict: Optional[Dict[str, Any]]) -> Optional[str]:
    if not isinstance(value_dict, dict):
        return None
    api_key = value_dict.get("api_key") or value_dict.get("apiKey")
    if api_key:
        return api_key.strip() or None
    return None


async def _build_provider_config(target: ProviderTarget) -> Optional[Dict[str, Any]]:
    """Return the provider configuration dict needed by the registry."""
    if target.user_id is None:
        LOGGER.debug("User not specified; attempting env-only lookup")
        env_key = os.getenv("OPENROUTER_API_KEY")
        if not env_key:
            LOGGER.warning("OPENROUTER_API_KEY environment variable is not set")
            return None
        return {
            "api_key": env_key.strip(),
            "server_url": "https://openrouter.ai/api/v1",
            "server_name": "OpenRouter API",
        }

    instances = await fetch_setting_instances(target.user_id)
    if not instances:
        return None

    instance = instances[0]
    raw_value = instance.get("value")
    instance_id = instance.get("id", "")

    value_dict = _coerce_value_dict(raw_value, instance_id or "unknown")
    if not isinstance(value_dict, dict):
        LOGGER.warning("Settings value for user_id=%s could not be parsed", target.user_id)
        return None

    api_key = _extract_api_key(value_dict)

    if not api_key:
        LOGGER.warning("No API key present in settings for user_id=%s", target.user_id)
        return None

    base_url = value_dict.get("baseUrl") or value_dict.get("base_url") or "https://openrouter.ai/api/v1"
    server_name = value_dict.get("server_name") or value_dict.get("serverName") or "OpenRouter API"
    return {
        "api_key": api_key,
        "server_url": base_url,
        "server_name": server_name,
    }


async def test_provider(target: ProviderTarget, preview: int, dry_run: bool) -> ProviderResult:
    config = await _build_provider_config(target)
    if not config or not config.get("api_key"):
        return ProviderResult(user_id=target.user_id, success=False, error="Missing API key in configuration")

    if dry_run:
        LOGGER.info(
            "[DRY RUN] User %s: configuration resolved (base_url=%s)",
            target.user_id or "env",
            config.get("server_url"),
        )
        return ProviderResult(user_id=target.user_id, success=True, model_count=0, models_preview=())

    provider_instance = await provider_registry.get_provider(
        target.provider,
        target.server_id,
        config,
    )

    try:
        models = await provider_instance.get_models()
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Provider fetch failed for user %s: %s", target.user_id, exc)
        return ProviderResult(user_id=target.user_id, success=False, error=str(exc))

    model_ids = [m.get("id") or m.get("name") for m in models if isinstance(m, dict)]
    preview_slice = tuple(model_ids[:preview]) if model_ids else ()
    return ProviderResult(
        user_id=target.user_id,
        success=True,
        model_count=len(model_ids),
        models_preview=preview_slice,
    )


async def run(args: argparse.Namespace) -> int:
    targets: List[ProviderTarget] = []

    if args.env_only or (args.user and args.user.lower() == "env"):
        targets.append(ProviderTarget(user_id=None))
    else:
        if args.user and args.user.lower() == "auto":
            LOGGER.info("Auto-discovery enabled – collecting users with OpenRouter settings")
            rows = await fetch_setting_instances(None)

            unique_ids: List[str] = []
            for row in rows:
                uid = row.get("user_id")
                if uid and uid not in unique_ids:
                    unique_ids.append(uid)

            if not unique_ids:
                LOGGER.warning("No users with OpenRouter settings found")
                return 1

            targets.extend(ProviderTarget(user_id=uid) for uid in unique_ids)
        else:
            targets.append(ProviderTarget(user_id=args.user))

    exit_code = 0
    for target in targets:
        result = await test_provider(target, args.preview, args.dry_run)
        if result.success:
            LOGGER.info(
                "✅ User %s: %d models available%s",
                result.user_id or "env",
                result.model_count,
                f" (preview: {', '.join(result.models_preview)})" if result.models_preview else "",
            )
        else:
            LOGGER.error("❌ User %s: %s", result.user_id or "env", result.error or "Unknown error")
            exit_code = 1

    return exit_code


def main() -> None:
    args = parse_args()
    configure_logging(args.verbose)

    try:
        status = asyncio.run(run(args))
    except KeyboardInterrupt:
        LOGGER.warning("Interrupted by user")
        status = 130
    sys.exit(status)


if __name__ == "__main__":
    main()
