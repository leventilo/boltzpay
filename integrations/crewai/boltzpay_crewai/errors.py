"""Error hierarchy for the BoltzPay CrewAI CLI bridge."""


class BoltzPayBridgeError(Exception):
    """Raised when the CLI bridge fails."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


class BoltzPayNodeNotFoundError(BoltzPayBridgeError):
    """Raised when Node.js/npx is not installed or not in PATH."""

    def __init__(self) -> None:
        super().__init__(
            "NODE_NOT_FOUND",
            "Node.js/npx not found. Install Node.js 20+ from https://nodejs.org "
            "or use the MCP server: npx @boltzpay/mcp",
        )


class BoltzPayTimeoutError(BoltzPayBridgeError):
    """Raised when a CLI command exceeds the timeout."""

    def __init__(self, timeout: int) -> None:
        super().__init__("TIMEOUT", f"CLI command timed out after {timeout}s")
