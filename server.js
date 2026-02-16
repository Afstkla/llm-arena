require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'models.json'), 'utf-8'));
}

app.get('/api/config', (_req, res) => {
  const config = loadConfig();
  const status = {};
  for (const [key, provider] of Object.entries(config.providers)) {
    status[key] = { ...provider, configured: !!process.env[provider.envKey] };
  }
  res.json({ providers: status, models: config.models });
});

// ── SSE helpers ──

function sseWrite(res, data) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function consumeSSE(reader, decoder, onLine) {
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const line of parts) {
      if (line.startsWith('data: ')) onLine(line);
    }
  }
  if (buf && buf.startsWith('data: ')) onLine(buf);
}

// ── Anthropic streaming ──

async function streamAnthropic(model, prompt, systemPrompt, maxTokens, temperature, webSearch, onEvent, signal) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const body = {
    model: model.id,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    stream: true,
  };
  if (systemPrompt) body.system = systemPrompt;
  if (temperature !== undefined) body.temperature = temperature;
  if (webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];

  const start = Date.now();
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let ttft = null, inputTokens = 0, outputTokens = 0, output = '';
  let streamError = null;

  await consumeSSE(reader, decoder, (line) => {
    let data;
    try { data = JSON.parse(line.slice(6)); } catch { return; }

    if (data.type === 'message_start') {
      inputTokens = data.message?.usage?.input_tokens || 0;
    } else if (data.type === 'content_block_delta') {
      const text = data.delta?.text || '';
      if (!text) return;
      if (ttft === null) ttft = Date.now() - start;
      output += text;
      onEvent({ type: 'chunk', content: text });
    } else if (data.type === 'message_delta') {
      outputTokens = data.usage?.output_tokens || 0;
    } else if (data.type === 'error') {
      streamError = data.error?.message || 'Anthropic stream error';
    }
  });

  if (streamError) throw new Error(streamError);
  return { ttft: ttft || 0, totalTime: Date.now() - start, inputTokens, outputTokens, output };
}

// ── OpenAI streaming (Responses API) ──

async function streamOpenAI(model, prompt, systemPrompt, maxTokens, temperature, webSearch, onEvent, signal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const input = [];
  if (systemPrompt) input.push({ role: 'system', content: systemPrompt });
  input.push({ role: 'user', content: prompt });

  const body = {
    model: model.id,
    input,
    max_output_tokens: maxTokens,
    stream: true,
  };
  if (temperature !== undefined && !model.noTemperature) body.temperature = temperature;
  if (webSearch) body.tools = [{ type: 'web_search' }];

  const start = Date.now();
  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let ttft = null, inputTokens = 0, outputTokens = 0, output = '';

  await consumeSSE(reader, decoder, (line) => {
    const raw = line.slice(6).trim();
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'response.output_text.delta') {
      if (ttft === null) ttft = Date.now() - start;
      output += data.delta || '';
      onEvent({ type: 'chunk', content: data.delta || '' });
    } else if (data.type === 'response.completed') {
      const usage = data.response?.usage;
      if (usage) {
        inputTokens = usage.input_tokens || 0;
        outputTokens = usage.output_tokens || 0;
      }
    }
  });

  return { ttft: ttft || 0, totalTime: Date.now() - start, inputTokens, outputTokens, output };
}

// ── Gemini streaming ──

async function streamGemini(model, prompt, systemPrompt, maxTokens, temperature, webSearch, onEvent, signal) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  if (temperature !== undefined) body.generationConfig.temperature = temperature;
  if (webSearch) body.tools = [{ google_search: {} }];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:streamGenerateContent?alt=sse`;
  const start = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let ttft = null, inputTokens = 0, outputTokens = 0, output = '';

  await consumeSSE(reader, decoder, (line) => {
    let data;
    try { data = JSON.parse(line.slice(6)); } catch { return; }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      if (ttft === null) ttft = Date.now() - start;
      output += text;
      onEvent({ type: 'chunk', content: text });
    }

    if (data.usageMetadata) {
      inputTokens = data.usageMetadata.promptTokenCount || 0;
      outputTokens = data.usageMetadata.candidatesTokenCount || 0;
    }
  });

  return { ttft: ttft || 0, totalTime: Date.now() - start, inputTokens, outputTokens, output };
}

// ── Main run endpoint ──

app.post('/api/run', async (req, res) => {
  const { prompt, models: modelIds, maxTokens = 4096, temperature = 0, systemPrompt = '', webSearch = false } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const ac = new AbortController();
  res.on('close', () => ac.abort());

  const config = loadConfig();
  const selected = modelIds
    .map(id => config.models.find(m => m.id === id))
    .filter(Boolean);

  const tasks = selected.map(async (model) => {
    sseWrite(res, { type: 'start', modelId: model.id });
    try {
      const handler = model.provider === 'anthropic' ? streamAnthropic
        : model.provider === 'google' ? streamGemini : streamOpenAI;
      const result = await handler(model, prompt, systemPrompt, maxTokens, temperature, webSearch, (ev) => {
        sseWrite(res, { ...ev, modelId: model.id });
      }, ac.signal);

      const cost =
        (result.inputTokens * model.inputCostPer1M / 1e6) +
        (result.outputTokens * model.outputCostPer1M / 1e6);

      sseWrite(res, {
        type: 'complete', modelId: model.id,
        ttft: result.ttft,
        totalTime: result.totalTime,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        tokensPerSecond: result.totalTime > 0 ? Math.round(result.outputTokens / (result.totalTime / 1000) * 10) / 10 : 0,
        cost,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        sseWrite(res, { type: 'error', modelId: model.id, error: err.message });
      }
    }
  });

  await Promise.allSettled(tasks);
  sseWrite(res, { type: 'done' });
  res.end();
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`\n  ▸ Arena running at http://localhost:${PORT}\n`);
});
