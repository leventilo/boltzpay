# langchain-boltzpay

[![PyPI version](https://img.shields.io/pypi/v/langchain-boltzpay)](https://pypi.org/project/langchain-boltzpay/)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/leventilo/boltzpay/blob/main/LICENSE)

LangChain tools for BoltzPay -- pay for API data with AI agents.

## Install

```bash
pip install langchain-boltzpay
```

### Prerequisites

- **Node.js 20+** ([nodejs.org](https://nodejs.org)) -- the CLI bridge calls `npx @boltzpay/cli` under the hood
- **Coinbase CDP keys** ([docs](https://boltzpay.ai)) -- only needed for `fetch` (paid requests)

## Quick Start

```python
from langchain_openai import ChatOpenAI
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import ChatPromptTemplate
from langchain_boltzpay import (
    BoltzPayFetchTool,
    BoltzPayCheckTool,
    BoltzPayDiscoverTool,
)

tools = [BoltzPayDiscoverTool(), BoltzPayCheckTool(), BoltzPayFetchTool()]
llm = ChatOpenAI(model="gpt-4o-mini")

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a researcher. Use BoltzPay to access paid APIs."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools)

result = executor.invoke({"input": "Check the price of invy.bot/api"})
```

## Tool Reference

| Tool | Name | Description | Credentials? |
|------|------|-------------|:------------:|
| `BoltzPayFetchTool` | `boltzpay_fetch` | Fetch data from a paid API, auto-pay with USDC | Yes |
| `BoltzPayCheckTool` | `boltzpay_check` | Check if a URL requires payment | No |
| `BoltzPayQuoteTool` | `boltzpay_quote` | Get price quote without paying | No |
| `BoltzPayDiscoverTool` | `boltzpay_discover` | Browse available paid APIs | No |
| `BoltzPayBudgetTool` | `boltzpay_budget` | Show remaining spending budget | No |
| `BoltzPayHistoryTool` | `boltzpay_history` | Show payment history | No |
| `BoltzPayWalletTool` | `boltzpay_wallet` | Show wallet and config info | No |

## No Credentials Needed

Most tools work without any credentials -- perfect for exploration:

```python
from langchain_boltzpay import BoltzPayDiscoverTool, BoltzPayCheckTool

# Discover available APIs
discover = BoltzPayDiscoverTool()
print(discover._run())

# Check price of an endpoint
check = BoltzPayCheckTool()
print(check._run(url="https://invy.bot/api"))
```

## With Credentials

To actually fetch paid data, set Coinbase CDP environment variables:

```bash
export COINBASE_API_KEY_ID="your-key-id"
export COINBASE_API_KEY_SECRET="your-key-secret"
export COINBASE_WALLET_SECRET="your-wallet-secret"
```

```python
from langchain_boltzpay import BoltzPayFetchTool

fetch = BoltzPayFetchTool()
result = fetch._run(url="https://invy.bot/api")
print(result)  # Paid API response with payment receipt
```

## Error Handling

All tools set `handle_tool_error=True`, so LangChain agents handle errors gracefully. You can also catch errors directly:

```python
from langchain_boltzpay import BoltzPayFetchTool
from langchain_boltzpay.errors import (
    BoltzPayBridgeError,
    BoltzPayNodeNotFoundError,
    BoltzPayTimeoutError,
)

try:
    tool = BoltzPayFetchTool()
    tool._run(url="https://example.com/api")
except BoltzPayNodeNotFoundError:
    print("Install Node.js 20+ from https://nodejs.org")
except BoltzPayTimeoutError:
    print("CLI command timed out (default: 30s)")
except BoltzPayBridgeError as e:
    print(f"CLI error [{e.code}]: {e.message}")
```

## Jupyter Notebook

See [notebooks/getting-started.ipynb](./notebooks/getting-started.ipynb) for a complete walkthrough: discover APIs, check prices, and create an agent.

## MCP Alternative

If you're using **CrewAI** or another MCP-compatible framework, you can use the BoltzPay MCP server directly instead of this LangChain package:

```bash
npx @boltzpay/mcp
```

This exposes the same 7 tools via the Model Context Protocol.

## Links

- [BoltzPay GitHub](https://github.com/leventilo/boltzpay)
- [npm packages](https://www.npmjs.com/org/boltzpay)
- [Documentation](https://boltzpay.ai)
