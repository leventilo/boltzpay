"""LangChain BaseTool subclasses for all 7 BoltzPay CLI commands."""

from __future__ import annotations

import json
from typing import Any, Optional, Type

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from .bridge import async_run_cli, run_cli


# ---------------------------------------------------------------------------
# Pydantic input schemas
# ---------------------------------------------------------------------------


class FetchInput(BaseModel):
    """Input for BoltzPayFetchTool."""

    url: str = Field(description="URL of the paid API endpoint to fetch")
    method: str = Field(default="GET", description="HTTP method (GET, POST, etc.)")
    chain: Optional[str] = Field(
        default=None, description="Override chain selection (evm or svm)"
    )


class CheckInput(BaseModel):
    """Input for BoltzPayCheckTool."""

    url: str = Field(description="URL to check for payment requirements")


class QuoteInput(BaseModel):
    """Input for BoltzPayQuoteTool."""

    url: str = Field(description="URL of the paid endpoint to get a price quote for")


class DiscoverInput(BaseModel):
    """Input for BoltzPayDiscoverTool."""

    category: Optional[str] = Field(
        default=None, description="Filter APIs by category"
    )


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


class BoltzPayFetchTool(BaseTool):
    """Fetch data from a paid API endpoint, automatically handling x402/ACP payment on Base or Solana."""

    name: str = "boltzpay_fetch"
    description: str = (
        "Fetch data from a paid API endpoint. Automatically detects x402 and ACP "
        "payment protocols and pays with USDC on Base or Solana. "
        "Requires Coinbase CDP credentials."
    )
    args_schema: Type[BaseModel] = FetchInput
    handle_tool_error: bool = True

    def _run(self, url: str, method: str = "GET", chain: Optional[str] = None, **kwargs: Any) -> str:
        cli_args = [url, "--method", method]
        if chain:
            cli_args.extend(["--chain", chain])
        result = run_cli("fetch", cli_args)
        return json.dumps(result, indent=2)

    async def _arun(self, url: str, method: str = "GET", chain: Optional[str] = None, **kwargs: Any) -> str:
        cli_args = [url, "--method", method]
        if chain:
            cli_args.extend(["--chain", chain])
        result = await async_run_cli("fetch", cli_args)
        return json.dumps(result, indent=2)


class BoltzPayCheckTool(BaseTool):
    """Check if a URL is a paid API endpoint and which protocol it uses."""

    name: str = "boltzpay_check"
    description: str = (
        "Check if a URL requires payment (x402 or ACP). Returns protocol type, "
        "price, and available chains. No credentials needed."
    )
    args_schema: Type[BaseModel] = CheckInput
    handle_tool_error: bool = True

    def _run(self, url: str, **kwargs: Any) -> str:
        result = run_cli("check", [url])
        return json.dumps(result, indent=2)

    async def _arun(self, url: str, **kwargs: Any) -> str:
        result = await async_run_cli("check", [url])
        return json.dumps(result, indent=2)


class BoltzPayQuoteTool(BaseTool):
    """Get a price quote for a paid API endpoint without paying."""

    name: str = "boltzpay_quote"
    description: str = (
        "Get the cost of a paid API endpoint without paying. Returns protocol, "
        "amount, currency, and available networks. No credentials needed."
    )
    args_schema: Type[BaseModel] = QuoteInput
    handle_tool_error: bool = True

    def _run(self, url: str, **kwargs: Any) -> str:
        result = run_cli("quote", [url])
        return json.dumps(result, indent=2)

    async def _arun(self, url: str, **kwargs: Any) -> str:
        result = await async_run_cli("quote", [url])
        return json.dumps(result, indent=2)


class BoltzPayDiscoverTool(BaseTool):
    """Discover available paid API endpoints in the BoltzPay directory."""

    name: str = "boltzpay_discover"
    description: str = (
        "Browse compatible paid API endpoints with live status. "
        "Filter by category. No credentials needed."
    )
    args_schema: Type[BaseModel] = DiscoverInput
    handle_tool_error: bool = True

    def _run(self, category: Optional[str] = None, **kwargs: Any) -> str:
        cli_args: list[str] = []
        if category:
            cli_args.extend(["--category", category])
        result = run_cli("discover", cli_args)
        return json.dumps(result, indent=2)

    async def _arun(self, category: Optional[str] = None, **kwargs: Any) -> str:
        cli_args: list[str] = []
        if category:
            cli_args.extend(["--category", category])
        result = await async_run_cli("discover", cli_args)
        return json.dumps(result, indent=2)


class BoltzPayBudgetTool(BaseTool):
    """Show the remaining spending budget for BoltzPay."""

    name: str = "boltzpay_budget"
    description: str = (
        "Show remaining spending budget including daily/monthly limits "
        "and per-transaction caps. No credentials needed."
    )
    handle_tool_error: bool = True

    def _run(self, **kwargs: Any) -> str:
        result = run_cli("budget")
        return json.dumps(result, indent=2)

    async def _arun(self, **kwargs: Any) -> str:
        result = await async_run_cli("budget")
        return json.dumps(result, indent=2)


class BoltzPayHistoryTool(BaseTool):
    """Show payment history for the current BoltzPay session."""

    name: str = "boltzpay_history"
    description: str = (
        "Show payment history including URLs, amounts, protocols, "
        "and transaction hashes. No credentials needed."
    )
    handle_tool_error: bool = True

    def _run(self, **kwargs: Any) -> str:
        result = run_cli("history")
        return json.dumps(result, indent=2)

    async def _arun(self, **kwargs: Any) -> str:
        result = await async_run_cli("history")
        return json.dumps(result, indent=2)


class BoltzPayWalletTool(BaseTool):
    """Show wallet and configuration information."""

    name: str = "boltzpay_wallet"
    description: str = (
        "Show wallet addresses, balances, supported protocols, "
        "and budget configuration. No credentials needed for read-only info."
    )
    handle_tool_error: bool = True

    def _run(self, **kwargs: Any) -> str:
        result = run_cli("wallet")
        return json.dumps(result, indent=2)

    async def _arun(self, **kwargs: Any) -> str:
        result = await async_run_cli("wallet")
        return json.dumps(result, indent=2)
