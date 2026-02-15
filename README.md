# LLM Arena

Local web app for benchmarking LLM models side-by-side. Send a prompt to multiple models in parallel and compare speed, token usage, cost, and output quality.

![screenshot](https://img.shields.io/badge/local-only-blue)

## Features

- **Parallel execution** — all selected models run simultaneously with real-time streaming
- **Metrics** — TTFT, total time, tokens/s, input/output tokens, cost (in cents)
- **Sortable comparison table** — ranked results with winners highlighted per column
- **Markdown rendering** — model outputs rendered as formatted markdown
- **Web search** — toggle web search for models that support it (Anthropic tool API + OpenAI Responses API)
- **Saved prompts** — store and recall prompts from localStorage
- **Easily extensible** — add models by editing `models.json`

## Supported models

Out of the box:

| Provider | Models |
|----------|--------|
| Anthropic | Sonnet 4.5, Haiku 4.5, Opus 4.6 |
| OpenAI | GPT-4.1 / Mini / Nano, GPT-5.2 / GPT-5 Mini / GPT-5 Nano |

## Setup

```bash
git clone https://github.com/Afstkla/llm-arena.git
cd llm-arena
npm install
```

Create a `.env` file with your API keys:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

You only need the keys for providers you want to use. Models without a configured key will be greyed out.

## Usage

```bash
npm start
# or with auto-restart on file changes:
npm run dev
```

Open **http://localhost:3456**, type a prompt, select models, hit Run (or `Cmd/Ctrl + Enter`).

## Adding models

Edit `models.json` to add or modify models:

```json
{
  "id": "model-api-id",
  "name": "Display Name",
  "provider": "anthropic",
  "color": "#ff6b6b",
  "inputCostPer1M": 3.00,
  "outputCostPer1M": 15.00
}
```

Optional fields:
- `"noTemperature": true` — for models that don't support custom temperature (e.g. GPT-5 Mini/Nano)

## Adding providers

Add a new entry to the `providers` block in `models.json`:

```json
"google": {
  "name": "Google",
  "baseUrl": "https://generativelanguage.googleapis.com",
  "envKey": "GOOGLE_API_KEY"
}
```

Then add a `streamGoogle` function in `server.js` and wire it up in the route handler.

## Tech

Single-page app with no build step. Express server proxies streaming API calls via SSE.

- **Backend**: Node.js, Express
- **Frontend**: Vanilla HTML/CSS/JS, [marked](https://github.com/markedjs/marked) for markdown
- **APIs**: Anthropic Messages API, OpenAI Responses API
