"""Tests for the CLI subprocess bridge."""

from __future__ import annotations

import json
import subprocess
from unittest.mock import MagicMock, patch

import pytest

from langchain_boltzpay.bridge import run_cli
from langchain_boltzpay.errors import (
    BoltzPayBridgeError,
    BoltzPayNodeNotFoundError,
    BoltzPayTimeoutError,
)


@pytest.fixture(autouse=True)
def _mock_npx_exists():
    """Ensure _find_npx always succeeds in tests."""
    with patch("langchain_boltzpay.bridge.shutil.which", return_value="/usr/local/bin/npx"):
        yield


class TestRunCliSuccess:
    """Test successful CLI bridge calls."""

    def test_parses_success_json(self):
        payload = {"success": True, "data": {"isPaid": True}, "payment": None, "metadata": {}}
        mock_result = MagicMock()
        mock_result.stdout = json.dumps(payload)
        mock_result.returncode = 0

        with patch("langchain_boltzpay.bridge.subprocess.run", return_value=mock_result):
            result = run_cli("check", ["https://example.com"])

        assert result == payload
        assert result["success"] is True

    def test_passes_correct_args(self):
        payload = {"success": True, "data": {}}
        mock_result = MagicMock()
        mock_result.stdout = json.dumps(payload)
        mock_result.returncode = 0

        with patch("langchain_boltzpay.bridge.subprocess.run", return_value=mock_result) as mock_run:
            run_cli("fetch", ["https://api.example.com", "--method", "POST"])

        actual_cmd = mock_run.call_args[0][0]
        assert actual_cmd == [
            "/usr/local/bin/npx", "-y", "@boltzpay/cli",
            "fetch", "https://api.example.com", "--method", "POST", "--json",
        ]


class TestRunCliErrors:
    """Test error handling in the CLI bridge."""

    def test_json_error_envelope(self):
        error_payload = {
            "success": False,
            "error": {"code": "AUTH_MISSING", "message": "Coinbase credentials not configured"},
        }
        mock_result = MagicMock()
        mock_result.stdout = json.dumps(error_payload)
        mock_result.returncode = 1

        with patch("langchain_boltzpay.bridge.subprocess.run", return_value=mock_result):
            with pytest.raises(BoltzPayBridgeError) as exc_info:
                run_cli("fetch", ["https://example.com"])

        assert exc_info.value.code == "AUTH_MISSING"
        assert "Coinbase credentials" in exc_info.value.message

    def test_file_not_found_raises_node_not_found(self):
        with patch(
            "langchain_boltzpay.bridge.subprocess.run",
            side_effect=FileNotFoundError(),
        ):
            with pytest.raises(BoltzPayNodeNotFoundError) as exc_info:
                run_cli("check", ["https://example.com"])

        assert exc_info.value.code == "NODE_NOT_FOUND"
        assert "Node.js" in exc_info.value.message

    def test_timeout_raises_timeout_error(self):
        with patch(
            "langchain_boltzpay.bridge.subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd="npx", timeout=30),
        ):
            with pytest.raises(BoltzPayTimeoutError) as exc_info:
                run_cli("check", ["https://example.com"])

        assert exc_info.value.code == "TIMEOUT"
        assert "30" in exc_info.value.message

    def test_non_json_stdout_falls_back_to_stderr(self):
        mock_result = MagicMock()
        mock_result.stdout = "not json at all"
        mock_result.stderr = "Something went wrong on stderr"
        mock_result.returncode = 1

        with patch("langchain_boltzpay.bridge.subprocess.run", return_value=mock_result):
            with pytest.raises(BoltzPayBridgeError) as exc_info:
                run_cli("fetch", ["https://example.com"])

        assert exc_info.value.code == "CLI_ERROR"
        assert "stderr" in exc_info.value.message

    def test_non_json_stdout_empty_stderr(self):
        mock_result = MagicMock()
        mock_result.stdout = ""
        mock_result.stderr = ""
        mock_result.returncode = 1

        with patch("langchain_boltzpay.bridge.subprocess.run", return_value=mock_result):
            with pytest.raises(BoltzPayBridgeError) as exc_info:
                run_cli("fetch", ["https://example.com"])

        assert exc_info.value.code == "CLI_ERROR"
        assert "exited with code" in exc_info.value.message
