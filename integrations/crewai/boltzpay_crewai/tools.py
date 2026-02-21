"""CrewAI BaseTool subclasses for BoltzPay.

Each tool wraps a ``@boltzpay/cli`` command via the subprocess bridge.
Errors are returned as strings (CrewAI pattern) rather than raised.
"""

from __future__ import annotations

import json
from typing import Optional, Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from .bridge import run_cli
from .errors import BoltzPayBridgeError


# ---------------------------------------------------------------------------
# Pydantic input schemas
# ---------------------------------------------------------------------------


class FetchInput(BaseModel):
    """Input schema for the BoltzPay fetch tool."""

    url: str = Field(description="URL of the paid API endpoint")
    method: str = Field(default="GET", description="HTTP method (default: GET)")
    chain: Optional[str] = Field(
        default=None, description="Chain override: 'evm' (Base) or 'svm' (Solana)"
    )


class CheckInput(BaseModel):
    """Input schema for the BoltzPay check tool."""

    url: str = Field(description="URL to check for payment requirements")


class QuoteInput(BaseModel):
    """Input schema for the BoltzPay quote tool."""

    url: str = Field(description="URL to get a price quote for")


class DiscoverInput(BaseModel):
    """Input schema for the BoltzPay discover tool."""

    category: Optional[str] = Field(
        default=None, description="Filter by category (e.g. 'crypto-data', 'utilities', 'demo')"
    )


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------


def _safe_run(command: str, args: list[str] | None = None) -> str:
    """Run a CLI command and return JSON string, or error string on failure."""
    try:
        result = run_cli(command, args)
        return json.dumps(result, indent=2)
    except BoltzPayBridgeError as exc:
        return f"Error ({exc.code}): {exc.message}"


class BoltzPayFetchTool(BaseTool):
    """Fetch data from a paid API endpoint.

    Automatically detects the payment protocol (x402 or ACP), pays via USDC
    on Base or Solana, and returns the response.
    Requires COINBASE_API_KEY_ID, COINBASE_API_KEY_SECRET, COINBASE_WALLET_SECRET
    environment variables.
    """

    name: str = "boltzpay_fetch"
    description: str = (
        "Fetch data from a paid API. Automatically detects x402/ACP protocol, "
        "pays via USDC on Base or Solana, and returns the response. "
        "Requires Coinbase credentials as environment variables."
    )
    args_schema: Type[BaseModel] = FetchInput

    def _run(self, url: str, method: str = "GET", chain: str | None = None) -> str:
        args = [url, "--method", method]
        if chain:
            args.extend(["--chain", chain])
        return _safe_run("fetch", args)


class BoltzPayCheckTool(BaseTool):
    """Check if a URL requires payment. No credentials needed."""

    name: str = "boltzpay_check"
    description: str = (
        "Check if a URL requires payment and what protocol it uses (x402 or ACP). "
        "Returns pricing and chain options. No credentials needed."
    )
    args_schema: Type[BaseModel] = CheckInput

    def _run(self, url: str) -> str:
        return _safe_run("check", [url])


class BoltzPayQuoteTool(BaseTool):
    """Get a price quote for a paid API endpoint. No credentials needed."""

    name: str = "boltzpay_quote"
    description: str = (
        "Get a detailed price quote for a paid API endpoint. "
        "Returns amount, currency, protocol, and chain options. No credentials needed."
    )
    args_schema: Type[BaseModel] = QuoteInput

    def _run(self, url: str) -> str:
        return _safe_run("quote", [url])


class BoltzPayDiscoverTool(BaseTool):
    """Browse the directory of compatible paid APIs. No credentials needed."""

    name: str = "boltzpay_discover"
    description: str = (
        "Browse the directory of paid APIs compatible with BoltzPay. "
        "Returns available endpoints with pricing and protocol info. No credentials needed."
    )
    args_schema: Type[BaseModel] = DiscoverInput

    def _run(self, category: str | None = None) -> str:
        args: list[str] = []
        if category:
            args.extend(["--category", category])
        return _safe_run("discover", args)


class BoltzPayBudgetTool(BaseTool):
    """Check the current spending budget and remaining balance. No credentials needed."""

    name: str = "boltzpay_budget"
    description: str = (
        "Check the current daily spending budget, amount spent, and remaining balance. "
        "No credentials needed."
    )
    def _run(self) -> str:
        return _safe_run("budget", [])


class BoltzPayHistoryTool(BaseTool):
    """View recent payment history. No credentials needed."""

    name: str = "boltzpay_history"
    description: str = (
        "View recent payment transactions made through BoltzPay. "
        "Shows URL, amount, protocol, and timestamp. No credentials needed."
    )

    def _run(self) -> str:
        return _safe_run("history", [])


class BoltzPayWalletTool(BaseTool):
    """Check wallet address and balance. No credentials needed."""

    name: str = "boltzpay_wallet"
    description: str = (
        "Check the wallet address and USDC balance on Base and Solana. "
        "No credentials needed."
    )

    def _run(self) -> str:
        return _safe_run("wallet", [])
