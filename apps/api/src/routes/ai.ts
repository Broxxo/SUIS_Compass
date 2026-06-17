import express, { Request } from 'express';

const router = express.Router();
const SILICONFLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';

function getSiliconFlowApiKey(): string | undefined {
  const key = process.env.SILICONFLOW_API_KEY?.trim();
  return key || undefined;
}

function getUserId(req: Request): string | undefined {
  return (req as Request & { userId?: string }).userId;
}

// 流式聊天（课程河流 AI 助手）
router.post('/chat', async (req, res) => {
  if (!getUserId(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!getSiliconFlowApiKey()) {
    return res.status(503).json({ error: 'AI service not configured (SILICONFLOW_API_KEY)' });
  }

  const { model, messages, stream = true, temperature, max_tokens, enable_web_search } = req.body as {
    model?: string;
    messages?: unknown[];
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    enable_web_search?: boolean;
  };

  if (!model || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'model and messages required' });
  }

  try {
    const response = await fetch(SILICONFLOW_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getSiliconFlowApiKey()}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: stream === true,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 2000,
        ...(enable_web_search === true && { enable_web_search: true }),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).send(text || response.statusText);
    }

    if (stream === true && response.body) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
        if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
          (res as unknown as { flush: () => void }).flush();
        }
      }
      res.end();
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('AI chat proxy error:', err);
    res.status(500).json({ error: 'AI request failed' });
  }
});

// 非流式生成（单元生成等）
router.post('/generate', async (req, res) => {
  if (!getUserId(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!getSiliconFlowApiKey()) {
    return res.status(503).json({ error: 'AI service not configured (SILICONFLOW_API_KEY)' });
  }

  const { model, messages, temperature, max_tokens } = req.body as {
    model?: string;
    messages?: unknown[];
    temperature?: number;
    max_tokens?: number;
  };

  if (!model || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'model and messages required' });
  }

  try {
    const response = await fetch(SILICONFLOW_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getSiliconFlowApiKey()}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: temperature ?? 0.5,
        max_tokens: max_tokens ?? 4000,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).send(text || response.statusText);
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('AI generate proxy error:', err);
    res.status(500).json({ error: 'AI request failed' });
  }
});

export default router;
