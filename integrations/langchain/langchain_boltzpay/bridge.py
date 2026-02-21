"""CLI subprocess bridge — calls @boltzpay/cli via npx."""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from typing import Any

from .errors import (
    BoltzPayBridgeError,
    BoltzPayNodeNotFoundError,
    BoltzPayTimeoutError,
)


def _find_npx() -> str:
    """Locate the npx binary in PATH."""
    path = shutil.which("npx")
    if path is None:
        raise BoltzPayNodeNotFoundError()
    return path


def run_cli(command: str, args: list[str] | None = None, timeout: int = 30) -> dict[str, Any]:
    """Run a BoltzPay CLI command synchronously and return parsed JSON.

    Args:
        command: CLI command name (fetch, check, quote, etc.)
        args: Additional arguments for the command.
        timeout: Maximum seconds to wait for the subprocess.

    Returns:
        Parsed JSON dict from CLI stdout.

    Raises:
        BoltzPayNodeNotFoundError: npx not in PATH.
        BoltzPayTimeoutError: Subprocess exceeded timeout.
        BoltzPayBridgeError: CLI returned an error or unparseable output.
    """
    npx = _find_npx()
    cmd = [npx, "-y", "@boltzpay/cli", command, *(args or []), "--json"]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        raise BoltzPayNodeNotFoundError()
    except subprocess.TimeoutExpired:
        raise BoltzPayTimeoutError(timeout)

    stdout = result.stdout.strip()

    # Try to parse stdout as JSON
    try:
        data = json.loads(stdout)
    except (json.JSONDecodeError, ValueError):
        # stdout is not JSON — use stderr as fallback
        stderr = result.stderr.strip()
        raise BoltzPayBridgeError(
            code="CLI_ERROR",
            message=stderr or f"CLI exited with code {result.returncode}",
        )

    # Check for JSON error envelope
    if isinstance(data, dict) and data.get("success") is False:
        error_info = data.get("error", {})
        raise BoltzPayBridgeError(
            code=error_info.get("code", "UNKNOWN"),
            message=error_info.get("message", "Unknown CLI error"),
        )

    return data


async def async_run_cli(
    command: str, args: list[str] | None = None, timeout: int = 30
) -> dict[str, Any]:
    """Run a BoltzPay CLI command asynchronously and return parsed JSON.

    Args:
        command: CLI command name (fetch, check, quote, etc.)
        args: Additional arguments for the command.
        timeout: Maximum seconds to wait for the subprocess.

    Returns:
        Parsed JSON dict from CLI stdout.

    Raises:
        BoltzPayNodeNotFoundError: npx not in PATH.
        BoltzPayTimeoutError: Subprocess exceeded timeout.
        BoltzPayBridgeError: CLI returned an error or unparseable output.
    """
    npx = _find_npx()
    cmd = [npx, "-y", "@boltzpay/cli", command, *(args or []), "--json"]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        raise BoltzPayNodeNotFoundError()

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise BoltzPayTimeoutError(timeout)

    stdout = stdout_bytes.decode().strip()

    # Try to parse stdout as JSON
    try:
        data = json.loads(stdout)
    except (json.JSONDecodeError, ValueError):
        stderr = stderr_bytes.decode().strip()
        raise BoltzPayBridgeError(
            code="CLI_ERROR",
            message=stderr or f"CLI exited with code {proc.returncode}",
        )

    # Check for JSON error envelope
    if isinstance(data, dict) and data.get("success") is False:
        error_info = data.get("error", {})
        raise BoltzPayBridgeError(
            code=error_info.get("code", "UNKNOWN"),
            message=error_info.get("message", "Unknown CLI error"),
        )

    return data
