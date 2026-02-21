"""Error hierarchy for the BoltzPay LangChain bridge."""


class BoltzPayBridgeError(Exception):
    """Base error for BoltzPay CLI bridge operations."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


class BoltzPayNodeNotFoundError(BoltzPayBridgeError):
    """Raised when npx is not found in PATH."""

    def __init__(self) -> None:
        super().__init__(
            code="NODE_NOT_FOUND",
            message=(
                "Node.js/npx not found. Install Node.js 20+ from "
                "https://nodejs.org or use the MCP server: npx @boltzpay/mcp"
            ),
        )


class BoltzPayTimeoutError(BoltzPayBridgeError):
    """Raised when a CLI subprocess exceeds the timeout."""

    def __init__(self, timeout: int) -> None:
        super().__init__(
            code="TIMEOUT",
            message=f"BoltzPay CLI command timed out after {timeout} seconds",
        )
