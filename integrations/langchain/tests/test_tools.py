"""Tests for LangChain tool definitions and execution."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from langchain_boltzpay import (
    BoltzPayBudgetTool,
    BoltzPayCheckTool,
    BoltzPayDiscoverTool,
    BoltzPayFetchTool,
    BoltzPayHistoryTool,
    BoltzPayQuoteTool,
    BoltzPayWalletTool,
)
from langchain_boltzpay.tools import FetchInput


ALL_TOOLS = [
    BoltzPayFetchTool,
    BoltzPayCheckTool,
    BoltzPayQuoteTool,
    BoltzPayDiscoverTool,
    BoltzPayBudgetTool,
    BoltzPayHistoryTool,
    BoltzPayWalletTool,
]


class TestToolDefinitions:
    """Verify tool metadata is correct."""

    @pytest.mark.parametrize("tool_cls", ALL_TOOLS)
    def test_has_name(self, tool_cls):
        tool = tool_cls()
        assert tool.name.startswith("boltzpay_")

    @pytest.mark.parametrize("tool_cls", ALL_TOOLS)
    def test_has_description(self, tool_cls):
        tool = tool_cls()
        assert len(tool.description) > 20

    @pytest.mark.parametrize("tool_cls", ALL_TOOLS)
    def test_handle_tool_error_enabled(self, tool_cls):
        tool = tool_cls()
        assert tool.handle_tool_error is True

    def test_tool_names_unique(self):
        names = [cls().name for cls in ALL_TOOLS]
        assert len(names) == len(set(names))

    def test_fetch_tool_has_args_schema(self):
        tool = BoltzPayFetchTool()
        assert tool.args_schema is FetchInput

    def test_history_tool_has_no_required_args(self):
        tool = BoltzPayHistoryTool()
        # History tool accepts no required input parameters
        if tool.args_schema is not None:
            schema = tool.args_schema.model_json_schema()
            assert not schema.get("required", []), "History tool should have no required fields"


class TestToolExecution:
    """Test tool _run() with mocked bridge."""

    def test_fetch_run_returns_json(self):
        mock_response = {
            "success": True,
            "data": "Hello World",
            "payment": {"protocol": "x402", "amount": "$0.01", "currency": "USD", "txHash": "0xabc"},
            "metadata": {"url": "https://invy.bot/api", "status": 200, "duration": 350},
        }

        with patch("langchain_boltzpay.tools.run_cli", return_value=mock_response):
            tool = BoltzPayFetchTool()
            result = tool._run(url="https://invy.bot/api")

        parsed = json.loads(result)
        assert parsed["success"] is True
        assert parsed["data"] == "Hello World"

    def test_fetch_run_passes_chain(self):
        mock_response = {"success": True, "data": "ok"}

        with patch("langchain_boltzpay.tools.run_cli", return_value=mock_response) as mock_cli:
            tool = BoltzPayFetchTool()
            tool._run(url="https://example.com", chain="svm")

        args = mock_cli.call_args
        assert "--chain" in args[0][1]
        assert "svm" in args[0][1]

    def test_discover_run_returns_entries(self):
        mock_response = {
            "success": True,
            "data": [
                {"name": "Invy Bot", "url": "https://invy.bot/api", "protocol": "x402"},
                {"name": "NewsAPI", "url": "https://newsapi.example.com", "protocol": "acp"},
            ],
        }

        with patch("langchain_boltzpay.tools.run_cli", return_value=mock_response):
            tool = BoltzPayDiscoverTool()
            result = tool._run()

        parsed = json.loads(result)
        assert len(parsed["data"]) == 2

    def test_discover_run_with_category(self):
        mock_response = {"success": True, "data": []}

        with patch("langchain_boltzpay.tools.run_cli", return_value=mock_response) as mock_cli:
            tool = BoltzPayDiscoverTool()
            tool._run(category="ai")

        args = mock_cli.call_args
        assert "--category" in args[0][1]
        assert "ai" in args[0][1]

    def test_check_run_returns_json(self):
        mock_response = {
            "success": True,
            "data": {"isPaid": True, "protocol": "x402", "amount": "$0.01"},
        }

        with patch("langchain_boltzpay.tools.run_cli", return_value=mock_response):
            tool = BoltzPayCheckTool()
            result = tool._run(url="https://invy.bot/api")

        parsed = json.loads(result)
        assert parsed["data"]["isPaid"] is True

    def test_budget_run_returns_json(self):
        mock_response = {
            "success": True,
            "data": {"dailySpent": "$0.05", "dailyLimit": "$10.00"},
        }

        with patch("langchain_boltzpay.tools.run_cli", return_value=mock_response):
            tool = BoltzPayBudgetTool()
            result = tool._run()

        parsed = json.loads(result)
        assert parsed["data"]["dailySpent"] == "$0.05"

    def test_history_run_returns_json(self):
        mock_response = {"success": True, "data": []}

        with patch("langchain_boltzpay.tools.run_cli", return_value=mock_response):
            tool = BoltzPayHistoryTool()
            result = tool._run()

        parsed = json.loads(result)
        assert parsed["data"] == []

    def test_wallet_run_returns_json(self):
        mock_response = {
            "success": True,
            "data": {"network": "testnet", "protocols": ["x402"]},
        }

        with patch("langchain_boltzpay.tools.run_cli", return_value=mock_response):
            tool = BoltzPayWalletTool()
            result = tool._run()

        parsed = json.loads(result)
        assert "protocols" in parsed["data"]


class TestInputValidation:
    """Test Pydantic input schema validation."""

    def test_fetch_input_requires_url(self):
        with pytest.raises(ValidationError):
            FetchInput()  # type: ignore[call-arg]

    def test_fetch_input_defaults(self):
        inp = FetchInput(url="https://example.com")
        assert inp.method == "GET"
        assert inp.chain is None

    def test_fetch_input_with_all_fields(self):
        inp = FetchInput(url="https://example.com", method="POST", chain="evm")
        assert inp.url == "https://example.com"
        assert inp.method == "POST"
        assert inp.chain == "evm"
