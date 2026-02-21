"""Tests for BoltzPay CrewAI tools.

Validates tool metadata, bridge interaction, and error handling.
All CLI calls are mocked -- no Node.js required to run these tests.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from boltzpay_crewai import (
    BoltzPayBudgetTool,
    BoltzPayCheckTool,
    BoltzPayDiscoverTool,
    BoltzPayFetchTool,
    BoltzPayHistoryTool,
    BoltzPayQuoteTool,
    BoltzPayWalletTool,
)
from boltzpay_crewai.errors import (
    BoltzPayBridgeError,
    BoltzPayNodeNotFoundError,
    BoltzPayTimeoutError,
)


# ---------------------------------------------------------------------------
# Tool metadata
# ---------------------------------------------------------------------------

ALL_TOOLS = [
    BoltzPayFetchTool,
    BoltzPayCheckTool,
    BoltzPayQuoteTool,
    BoltzPayDiscoverTool,
    BoltzPayBudgetTool,
    BoltzPayHistoryTool,
    BoltzPayWalletTool,
]

TOOL_NAMES = [
    "boltzpay_fetch",
    "boltzpay_check",
    "boltzpay_quote",
    "boltzpay_discover",
    "boltzpay_budget",
    "boltzpay_history",
    "boltzpay_wallet",
]


@pytest.mark.parametrize("tool_cls,expected_name", zip(ALL_TOOLS, TOOL_NAMES))
def test_tool_name(tool_cls, expected_name):
    """Each tool exposes the correct name."""
    tool = tool_cls()
    assert tool.name == expected_name


@pytest.mark.parametrize("tool_cls", ALL_TOOLS)
def test_tool_has_description(tool_cls):
    """Every tool must have a non-empty description."""
    tool = tool_cls()
    assert isinstance(tool.description, str)
    assert len(tool.description) > 20


def test_fetch_tool_has_args_schema():
    """FetchTool must declare an args_schema with url, method, chain."""
    tool = BoltzPayFetchTool()
    schema = tool.args_schema
    fields = schema.model_fields
    assert "url" in fields
    assert "method" in fields
    assert "chain" in fields


def test_check_tool_has_args_schema():
    """CheckTool must declare an args_schema with url."""
    tool = BoltzPayCheckTool()
    fields = tool.args_schema.model_fields
    assert "url" in fields


def test_discover_tool_has_args_schema():
    """DiscoverTool must declare an args_schema with category."""
    tool = BoltzPayDiscoverTool()
    fields = tool.args_schema.model_fields
    assert "category" in fields


# ---------------------------------------------------------------------------
# Bridge interaction (mocked)
# ---------------------------------------------------------------------------

MOCK_FETCH_RESPONSE = {
    "success": True,
    "data": {"content": "paid data"},
    "payment": {
        "protocol": "x402-v2",
        "amount": "$0.01",
        "currency": "USDC",
        "txHash": "0x" + "a" * 64,
    },
    "metadata": {"url": "https://example.com/api", "status": 200, "duration": 1234},
}

MOCK_CHECK_RESPONSE = {
    "success": True,
    "data": {"isPaid": True, "protocol": "x402-v2", "amount": "$0.01"},
    "payment": None,
    "metadata": {"url": "https://example.com/api", "status": 402, "duration": 500},
}

MOCK_DISCOVER_RESPONSE = {
    "success": True,
    "data": [
        {"name": "invy.bot", "url": "https://invy.bot/api", "category": "crypto-data"}
    ],
    "payment": None,
    "metadata": {"url": "", "status": 200, "duration": 100},
}


@patch("boltzpay_crewai.tools.run_cli")
def test_fetch_tool_run(mock_run_cli):
    """FetchTool._run() returns JSON string from bridge."""
    mock_run_cli.return_value = MOCK_FETCH_RESPONSE
    tool = BoltzPayFetchTool()
    result = tool._run(url="https://example.com/api")
    assert isinstance(result, str)
    parsed = json.loads(result)
    assert parsed["success"] is True
    mock_run_cli.assert_called_once_with("fetch", ["https://example.com/api", "--method", "GET"])


@patch("boltzpay_crewai.tools.run_cli")
def test_fetch_tool_with_chain(mock_run_cli):
    """FetchTool._run() passes chain override to CLI."""
    mock_run_cli.return_value = MOCK_FETCH_RESPONSE
    tool = BoltzPayFetchTool()
    tool._run(url="https://example.com/api", chain="svm")
    mock_run_cli.assert_called_once_with(
        "fetch", ["https://example.com/api", "--method", "GET", "--chain", "svm"]
    )


@patch("boltzpay_crewai.tools.run_cli")
def test_check_tool_run(mock_run_cli):
    """CheckTool._run() returns JSON string from bridge."""
    mock_run_cli.return_value = MOCK_CHECK_RESPONSE
    tool = BoltzPayCheckTool()
    result = tool._run(url="https://example.com/api")
    parsed = json.loads(result)
    assert parsed["data"]["isPaid"] is True


@patch("boltzpay_crewai.tools.run_cli")
def test_discover_tool_run(mock_run_cli):
    """DiscoverTool._run() returns entries from bridge."""
    mock_run_cli.return_value = MOCK_DISCOVER_RESPONSE
    tool = BoltzPayDiscoverTool()
    result = tool._run()
    parsed = json.loads(result)
    assert len(parsed["data"]) == 1
    assert parsed["data"][0]["name"] == "invy.bot"


@patch("boltzpay_crewai.tools.run_cli")
def test_discover_tool_with_category(mock_run_cli):
    """DiscoverTool._run() passes category filter to CLI."""
    mock_run_cli.return_value = MOCK_DISCOVER_RESPONSE
    tool = BoltzPayDiscoverTool()
    tool._run(category="crypto-data")
    mock_run_cli.assert_called_once_with("discover", ["--category", "crypto-data"])


@patch("boltzpay_crewai.tools.run_cli")
def test_budget_tool_run(mock_run_cli):
    """BudgetTool._run() calls budget command."""
    mock_run_cli.return_value = {"success": True, "data": {"daily": "$5.00", "spent": "$0.00"}}
    tool = BoltzPayBudgetTool()
    result = tool._run()
    assert isinstance(result, str)
    mock_run_cli.assert_called_once_with("budget", [])


@patch("boltzpay_crewai.tools.run_cli")
def test_history_tool_run(mock_run_cli):
    """HistoryTool._run() calls history command."""
    mock_run_cli.return_value = {"success": True, "data": []}
    tool = BoltzPayHistoryTool()
    result = tool._run()
    mock_run_cli.assert_called_once_with("history", [])


@patch("boltzpay_crewai.tools.run_cli")
def test_wallet_tool_run(mock_run_cli):
    """WalletTool._run() calls wallet command."""
    mock_run_cli.return_value = {"success": True, "data": {"address": "0x..."}}
    tool = BoltzPayWalletTool()
    result = tool._run()
    mock_run_cli.assert_called_once_with("wallet", [])


# ---------------------------------------------------------------------------
# Error handling -- errors returned as strings (CrewAI pattern)
# ---------------------------------------------------------------------------


@patch("boltzpay_crewai.tools.run_cli")
def test_bridge_error_returns_string(mock_run_cli):
    """Bridge errors are returned as error strings, not raised."""
    mock_run_cli.side_effect = BoltzPayBridgeError("CLI_ERROR", "Something went wrong")
    tool = BoltzPayFetchTool()
    result = tool._run(url="https://example.com/api")
    assert "Error (CLI_ERROR)" in result
    assert "Something went wrong" in result


@patch("boltzpay_crewai.tools.run_cli")
def test_node_not_found_returns_string(mock_run_cli):
    """Node not found errors are returned as strings with install instructions."""
    mock_run_cli.side_effect = BoltzPayNodeNotFoundError()
    tool = BoltzPayFetchTool()
    result = tool._run(url="https://example.com/api")
    assert "NODE_NOT_FOUND" in result
    assert "nodejs.org" in result


@patch("boltzpay_crewai.tools.run_cli")
def test_timeout_returns_string(mock_run_cli):
    """Timeout errors are returned as strings."""
    mock_run_cli.side_effect = BoltzPayTimeoutError(30)
    tool = BoltzPayFetchTool()
    result = tool._run(url="https://example.com/api")
    assert "TIMEOUT" in result
    assert "30s" in result


# ---------------------------------------------------------------------------
# Error classes
# ---------------------------------------------------------------------------


def test_bridge_error_attributes():
    """BoltzPayBridgeError has code and message attributes."""
    err = BoltzPayBridgeError("TEST_CODE", "test message")
    assert err.code == "TEST_CODE"
    assert err.message == "test message"
    assert "TEST_CODE: test message" in str(err)


def test_node_not_found_error():
    """BoltzPayNodeNotFoundError has NODE_NOT_FOUND code."""
    err = BoltzPayNodeNotFoundError()
    assert err.code == "NODE_NOT_FOUND"
    assert "nodejs.org" in err.message


def test_timeout_error():
    """BoltzPayTimeoutError includes the timeout value."""
    err = BoltzPayTimeoutError(30)
    assert err.code == "TIMEOUT"
    assert "30s" in err.message
