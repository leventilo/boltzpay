"""CLI subprocess bridge for BoltzPay CrewAI tools.

Calls ``npx -y @boltzpay/cli <command> --json`` and parses the JSON envelope.
Independent copy -- does NOT import from langchain-boltzpay.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess

from .errors import BoltzPayBridgeError, BoltzPayNodeNotFoundError, BoltzPayTimeoutError


def _find_npx() -> str:
    """Return the path to the ``npx`` binary, or raise if not found."""
    path = shutil.which("npx")
    if path is None:
        raise BoltzPayNodeNotFoundError()
    return path


def run_cli(command: str, args: list[str] | None = None, *, timeout: int = 30) -> dict:
    """Execute a BoltzPay CLI command synchronously and return parsed JSON.

    Parameters
    ----------
    command:
        CLI sub-command (e.g. ``"fetch"``, ``"check"``).
    args:
        Additional CLI arguments.
    timeout:
        Maximum seconds to wait for the process.

    Returns
    -------
    dict
        Parsed JSON output from the CLI.

    Raises
    ------
    BoltzPayNodeNotFoundError
        If ``npx`` is not on ``PATH``.
    BoltzPayTimeoutError
        If the command exceeds *timeout* seconds.
    BoltzPayBridgeError
        On any other CLI error.
    """
    npx = _find_npx()
    cmd = [npx, "-y", "@boltzpay/cli", command, *(args or []), "--json"]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        raise BoltzPayNodeNotFoundError()
    except subprocess.TimeoutExpired:
        raise BoltzPayTimeoutError(timeout)

    if result.returncode != 0:
        # Try to parse structured error envelope from stdout
        try:
            err = json.loads(result.stdout)
            raise BoltzPayBridgeError(err["error"]["code"], err["error"]["message"])
        except (json.JSONDecodeError, KeyError, TypeError):
            raise BoltzPayBridgeError("CLI_ERROR", result.stderr or "Unknown error")

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        raise BoltzPayBridgeError("PARSE_ERROR", f"Invalid JSON output: {result.stdout[:200]}")


async def async_run_cli(
    command: str, args: list[str] | None = None, *, timeout: int = 30
) -> dict:
    """Execute a BoltzPay CLI command asynchronously and return parsed JSON.

    Same semantics as :func:`run_cli` but non-blocking.
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

    stdout = stdout_bytes.decode() if stdout_bytes else ""
    stderr = stderr_bytes.decode() if stderr_bytes else ""

    if proc.returncode != 0:
        try:
            err = json.loads(stdout)
            raise BoltzPayBridgeError(err["error"]["code"], err["error"]["message"])
        except (json.JSONDecodeError, KeyError, TypeError):
            raise BoltzPayBridgeError("CLI_ERROR", stderr or "Unknown error")

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        raise BoltzPayBridgeError("PARSE_ERROR", f"Invalid JSON output: {stdout[:200]}")
