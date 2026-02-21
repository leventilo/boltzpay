"""BoltzPay CrewAI integration — CLI bridge tools for paid API access.

Two integration paths:
1. **MCP (recommended):** Use ``npx @boltzpay/mcp`` with CrewAI's native
   ``MCPServerAdapter``. See ``docs/mcp-integration.md``.
2. **CLI bridge (this package):** Import ``BaseTool`` subclasses that call
   ``@boltzpay/cli`` via subprocess.
"""

from .errors import BoltzPayBridgeError, BoltzPayNodeNotFoundError, BoltzPayTimeoutError
from .tools import (
    BoltzPayBudgetTool,
    BoltzPayCheckTool,
    BoltzPayDiscoverTool,
    BoltzPayFetchTool,
    BoltzPayHistoryTool,
    BoltzPayQuoteTool,
    BoltzPayWalletTool,
)

__all__ = [
    # Tools
    "BoltzPayFetchTool",
    "BoltzPayCheckTool",
    "BoltzPayQuoteTool",
    "BoltzPayDiscoverTool",
    "BoltzPayBudgetTool",
    "BoltzPayHistoryTool",
    "BoltzPayWalletTool",
    # Errors
    "BoltzPayBridgeError",
    "BoltzPayNodeNotFoundError",
    "BoltzPayTimeoutError",
]
