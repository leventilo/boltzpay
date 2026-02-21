# Using BoltzPay with CrewAI via MCP

CrewAI natively supports the Model Context Protocol (MCP). This means your CrewAI agents can use **all 7 BoltzPay tools instantly** — no Python package installation required. Just point CrewAI at the BoltzPay MCP server.

## Why MCP?

- **Zero Python dependencies** — no `pip install` needed for BoltzPay tools
- **Always up-to-date** — `npx` fetches the latest `@boltzpay/mcp` automatically
- **All 7 tools available** — fetch, check, quote, discover, budget, history, wallet
- **Same tools as Claude Desktop** — if you use BoltzPay in Claude, you already know these tools

## Prerequisites

- **Python 3.10+** — for CrewAI
- **Node.js 20+** — for `npx` to run the MCP server ([nodejs.org](https://nodejs.org))
- **Coinbase CDP keys** (optional) — only needed for `fetch` (payment). All other tools work without credentials.

## Quick Start

```python
from crewai import Agent, Task, Crew, Process
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

server_params = StdioServerParameters(
    command="npx",
    args=["-y", "@boltzpay/mcp"],
    env={"BOLTZPAY_DAILY_BUDGET": "5.00"},
)

with MCPServerAdapter(server_params) as tools:
    agent = Agent(
        role="Data Researcher",
        goal="Find and access paid APIs",
        backstory="An AI researcher that pays for API data automatically.",
        tools=tools,
    )
    task = Task(
        description="Discover available paid APIs and check pricing.",
        expected_output="A list of APIs with their prices.",
        agent=agent,
    )
    crew = Crew(agents=[agent], tasks=[task], process=Process.sequential)
    result = crew.kickoff()
    print(result)
```

This example works **without Coinbase credentials** — `discover` and `check` are free tools.

## Full Example: Research Agent with Payments

```python
import os
from crewai import Agent, Task, Crew, Process
from crewai_tools import MCPServerAdapter
from mcp import StdioServerParameters

# Configure MCP server with credentials for paid API access
server_params = StdioServerParameters(
    command="npx",
    args=["-y", "@boltzpay/mcp"],
    env={
        "COINBASE_API_KEY_ID": os.environ.get("COINBASE_API_KEY_ID", ""),
        "COINBASE_API_KEY_SECRET": os.environ.get("COINBASE_API_KEY_SECRET", ""),
        "COINBASE_WALLET_SECRET": os.environ.get("COINBASE_WALLET_SECRET", ""),
        "BOLTZPAY_DAILY_BUDGET": "5.00",
        "PATH": os.environ.get("PATH", ""),
    },
)

with MCPServerAdapter(server_params) as tools:
    researcher = Agent(
        role="Crypto Data Researcher",
        goal="Gather cryptocurrency data from paid API sources",
        backstory=(
            "You are an expert data researcher specializing in cryptocurrency markets. "
            "You use BoltzPay to access premium data APIs, always checking prices "
            "before making purchases to stay within budget."
        ),
        tools=tools,
        verbose=True,
    )

    research_task = Task(
        description=(
            "1. Discover available paid APIs using boltzpay_discover\n"
            "2. Check the price of https://invy.bot/api using boltzpay_check\n"
            "3. If the price is reasonable, fetch data using boltzpay_fetch\n"
            "4. Check remaining budget using boltzpay_budget"
        ),
        expected_output="Research report with API data and spending summary.",
        agent=researcher,
    )

    crew = Crew(
        agents=[researcher],
        tasks=[research_task],
        process=Process.sequential,
        verbose=True,
    )
    result = crew.kickoff()
    print(result)
```

## Available Tools

All 7 BoltzPay tools are automatically exposed through the MCP server:

| Tool | Description | Requires Credentials |
|------|-------------|---------------------|
| `boltzpay_fetch` | Fetch data from a paid API. Detects x402/L402, pays with USDC or Lightning. | Yes |
| `boltzpay_check` | Check if a URL requires payment. Returns protocol and pricing. | No |
| `boltzpay_quote` | Get a detailed price quote with chain options. | No |
| `boltzpay_discover` | Browse the directory of compatible paid APIs. | No |
| `boltzpay_budget` | Check daily spending budget and remaining balance. | No |
| `boltzpay_history` | View recent payment transactions. | No |
| `boltzpay_wallet` | Check wallet address and USDC balance. | No |

## Configuration

### Budget Limits

Set a daily spending limit via the `BOLTZPAY_DAILY_BUDGET` environment variable (in USD):

```python
server_params = StdioServerParameters(
    command="npx",
    args=["-y", "@boltzpay/mcp"],
    env={
        "BOLTZPAY_DAILY_BUDGET": "10.00",  # $10/day limit
        # ... other env vars
    },
)
```

### Chain Override

By default, BoltzPay selects the best chain automatically. To force a specific chain, pass the `chain` parameter when calling `boltzpay_fetch`:

- `"evm"` — Base (Ethereum L2)
- `"svm"` — Solana

### Without Credentials

Six of the seven tools work without any Coinbase credentials:

```python
# No credentials needed — just discover and check
server_params = StdioServerParameters(
    command="npx",
    args=["-y", "@boltzpay/mcp"],
    env={"BOLTZPAY_DAILY_BUDGET": "0"},
)

with MCPServerAdapter(server_params) as tools:
    agent = Agent(
        role="API Scout",
        goal="Discover and evaluate paid APIs without purchasing",
        backstory="You scout APIs and report on pricing.",
        tools=tools,
    )
    # Agent can use: check, quote, discover, budget, history, wallet
    # Agent cannot use: fetch (requires credentials + budget > 0)
```

## Troubleshooting

### `npx` not found

**Symptom:** MCP server fails to start with "command not found" or similar error.

**Fix:** Install Node.js 20+ from [nodejs.org](https://nodejs.org). Verify with:

```bash
npx --version
```

### MCP connection timeout

**Symptom:** CrewAI hangs when initializing `MCPServerAdapter`.

**Fix:** The first run may take 10-30 seconds as `npx` downloads `@boltzpay/mcp`. Subsequent runs are faster. If it persists, try installing globally:

```bash
npm install -g @boltzpay/mcp
```

Then use `command="boltzpay-mcp"` instead of `npx`.

### Process cleanup

**Symptom:** Orphaned Node.js processes after CrewAI exits.

**Fix:** Always use the `with MCPServerAdapter(...)` context manager pattern. Never call `.start()` / `.stop()` manually. The context manager ensures proper cleanup even if the crew raises an exception.

```python
# CORRECT: context manager handles cleanup
with MCPServerAdapter(server_params) as tools:
    crew = Crew(agents=[agent], tasks=[task])
    crew.kickoff()

# WRONG: manual lifecycle can leak processes
# adapter = MCPServerAdapter(server_params)
# tools = adapter.start()
# crew.kickoff()
# adapter.stop()  # May not run if kickoff() raises
```

### Credentials not reaching the MCP server

**Symptom:** `boltzpay_fetch` returns "No credentials configured".

**Fix:** Ensure you pass credentials via the `env` dict in `StdioServerParameters`, not via `os.environ` alone. The MCP server runs as a child process and only sees the environment you explicitly provide:

```python
server_params = StdioServerParameters(
    command="npx",
    args=["-y", "@boltzpay/mcp"],
    env={
        "COINBASE_API_KEY_ID": os.environ["COINBASE_API_KEY_ID"],
        "COINBASE_API_KEY_SECRET": os.environ["COINBASE_API_KEY_SECRET"],
        "COINBASE_WALLET_SECRET": os.environ["COINBASE_WALLET_SECRET"],
        "BOLTZPAY_DAILY_BUDGET": "5.00",
        "PATH": os.environ.get("PATH", ""),
    },
)
```

## Alternative: CLI Bridge Package

If you prefer native Python tools over MCP, install the `boltzpay-crewai` package:

```bash
pip install boltzpay-crewai
```

```python
from boltzpay_crewai import BoltzPayFetchTool, BoltzPayCheckTool, BoltzPayDiscoverTool

agent = Agent(
    role="Researcher",
    goal="Access paid APIs",
    tools=[BoltzPayFetchTool(), BoltzPayCheckTool(), BoltzPayDiscoverTool()],
)
```

See the [boltzpay-crewai README](../README.md) for full documentation.

## Links

- [BoltzPay GitHub](https://github.com/leventilo/boltzpay)
- [BoltzPay Documentation](https://boltzpay.ai)
- [CrewAI MCP Documentation](https://docs.crewai.com/en/mcp/stdio)
- [@boltzpay/mcp on npm](https://www.npmjs.com/package/@boltzpay/mcp)
