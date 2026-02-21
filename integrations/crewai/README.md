[![PyPI](https://img.shields.io/pypi/v/boltzpay-crewai)](https://pypi.org/project/boltzpay-crewai/) [![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# boltzpay-crewai

CrewAI tools for BoltzPay — two integration paths for paid API access with AI agents.

## Recommended: MCP Integration

CrewAI natively supports MCP. Our MCP server works out of the box — **no Python package needed**.

See the complete guide: **[MCP Integration Guide](docs/mcp-integration.md)**

```python
from crewai import Agent, Task, Crew
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

server_params = StdioServerParameters(
    command="npx",
    args=["-y", "@boltzpay/mcp"],
    env={"BOLTZPAY_DAILY_BUDGET": "5.00"},
)

with MCPServerAdapter(server_params) as tools:
    agent = Agent(role="Researcher", goal="Access paid APIs", tools=tools)
    task = Task(description="Discover paid APIs", expected_output="API list", agent=agent)
    Crew(agents=[agent], tasks=[task]).kickoff()
```

## Alternative: CLI Bridge Tools

For users who prefer native Python tools, this package provides 7 `BaseTool` subclasses that call `@boltzpay/cli` via subprocess.

### Install

```bash
pip install boltzpay-crewai
```

### Prerequisites

- **Python 3.10+**
- **Node.js 20+** — required for the CLI bridge ([nodejs.org](https://nodejs.org))
- **Coinbase CDP keys** (optional) — only needed for `fetch`

### Usage

```python
from crewai import Agent, Task, Crew
from boltzpay_crewai import (
    BoltzPayFetchTool,
    BoltzPayCheckTool,
    BoltzPayDiscoverTool,
)

agent = Agent(
    role="Data Researcher",
    goal="Find and access paid APIs using BoltzPay",
    tools=[BoltzPayFetchTool(), BoltzPayCheckTool(), BoltzPayDiscoverTool()],
)

task = Task(
    description="Discover paid APIs and check pricing for invy.bot",
    expected_output="API pricing report",
    agent=agent,
)

crew = Crew(agents=[agent], tasks=[task])
result = crew.kickoff()
```

## Tool Reference

| Tool | Name | Description | Credentials |
|------|------|-------------|-------------|
| `BoltzPayFetchTool` | `boltzpay_fetch` | Fetch data from a paid API. Detects x402/L402, pays with USDC or Lightning. | Required |
| `BoltzPayCheckTool` | `boltzpay_check` | Check if URL requires payment. Returns protocol and pricing. | Not needed |
| `BoltzPayQuoteTool` | `boltzpay_quote` | Get detailed price quote with chain options. | Not needed |
| `BoltzPayDiscoverTool` | `boltzpay_discover` | Browse directory of compatible paid APIs. | Not needed |
| `BoltzPayBudgetTool` | `boltzpay_budget` | Check daily spending budget and remaining balance. | Not needed |
| `BoltzPayHistoryTool` | `boltzpay_history` | View recent payment transactions. | Not needed |
| `BoltzPayWalletTool` | `boltzpay_wallet` | Check wallet address and USDC balance. | Not needed |

## No Credentials Needed

Six tools work without any Coinbase credentials:

```python
from boltzpay_crewai import BoltzPayCheckTool, BoltzPayDiscoverTool

# Discover APIs and check prices — no keys required
agent = Agent(
    role="API Scout",
    goal="Evaluate paid APIs without purchasing",
    tools=[BoltzPayCheckTool(), BoltzPayDiscoverTool()],
)
```

## Error Handling

CLI bridge tools return error strings instead of raising exceptions (CrewAI pattern), so your agent can recover gracefully:

```
Error (NODE_NOT_FOUND): Node.js/npx not found. Install Node.js 20+ from https://nodejs.org
Error (TIMEOUT): CLI command timed out after 30s
Error (CLI_ERROR): Payment failed: budget exceeded
```

For programmatic error handling, import the error classes:

```python
from boltzpay_crewai import BoltzPayBridgeError, BoltzPayNodeNotFoundError, BoltzPayTimeoutError
```

## Links

- [BoltzPay GitHub](https://github.com/leventilo/boltzpay)
- [BoltzPay Documentation](https://boltzpay.ai)
- [@boltzpay/mcp on npm](https://www.npmjs.com/package/@boltzpay/mcp)
- [CrewAI Documentation](https://docs.crewai.com)
