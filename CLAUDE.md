# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start dev server with auto-reload (node --watch), runs on port 3456 by default
- `npm start` — Start production server

No build step, linter, or test framework is configured.

## Architecture

LLM Arena is a benchmark tool for comparing LLM responses side-by-side with streaming output and performance metrics.

**Server** (`server.js`): Express server with two endpoints:
- `GET /api/config` — Returns provider status (API key configured?) and model list from `models.json`
- `POST /api/run` — Accepts prompt + model IDs, streams responses from all selected models concurrently via SSE. Each model streams independently; results include TTFT, total time, token counts, tokens/sec, and cost.

**Frontend** (`public/index.html`): Single-file vanilla JS SPA (no framework, no build). Uses `marked.js` for markdown rendering. All CSS/JS is inline. Handles SSE consumption, live timer updates via requestAnimationFrame, sortable summary table, and localStorage-based prompt saving.

**Provider integrations**: Two streaming implementations in `server.js`:
- `streamAnthropic` — Anthropic Messages API (`/v1/messages`) with SSE parsing
- `streamOpenAI` — OpenAI Responses API (`/v1/responses`) with SSE parsing

Both support web search tools, system prompts, temperature, and max tokens.

**Model config** (`models.json`): Defines providers (with `envKey` for API key env var lookup) and models (with pricing per 1M tokens, color for UI, provider reference). Models with `noTemperature: true` skip the temperature parameter.

## Environment

Requires `.env` with `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`. Models whose provider key is missing show as disabled in the UI. See `.env.example`.
