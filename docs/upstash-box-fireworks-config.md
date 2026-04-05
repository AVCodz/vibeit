# Upstash Box with Fireworks AI Configuration

This document explains how to configure Upstash Box to use Fireworks AI models (like Kimi K2.5 Turbo) with the OpenCode agent provider.

## Overview

Upstash Box supports three agent providers:
- `claude-code` - Claude Code SDK
- `codex` - OpenAI Codex
- `opencode` - OpenCode agent (supports multiple LLM providers)

When using OpenCode as the agent provider, you can access models from various providers including Fireworks AI, Anthropic, OpenAI, Google, and more.

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Upstash Box API key
UPSTASH_BOX_API_KEY="your-upstash-box-api-key"

# OpenCode agent configuration
UPSTASH_OPENCODE_PROVIDER="opencode"
UPSTASH_OPENCODE_MODEL="fireworks-ai/accounts/fireworks/models/kimi-k2p5"
UPSTASH_OPENCODE_API_KEY="your-fireworks-api-key"
```

### Key Points

1. **Provider**: Must be `"opencode"` (not `"fireworks-ai"`)
   - OpenCode handles routing to external providers based on the model string
   - The provider enum only accepts: `claude-code`, `codex`, `opencode`

2. **Model String Format**: `fireworks-ai/accounts/fireworks/models/{model-name}`
   - Prefix: `fireworks-ai/` tells OpenCode to route to Fireworks AI
   - Full path: `accounts/fireworks/models/` is Fireworks AI's model namespace
   - Model name: e.g., `kimi-k2p5`, `llama-v3p3-70b-instruct`, `deepseek-v3`

3. **API Key**: Direct Fireworks AI API key string
   - Get your key from https://fireworks.ai/account/api-keys
   - This is passed directly to OpenCode, which forwards it to Fireworks AI

## Available Fireworks AI Models

Common models you can use (as of 2026):

```typescript
// Kimi models (Moonshot AI)
"fireworks-ai/accounts/fireworks/models/kimi-k2p5"          // Kimi K2.5
"fireworks-ai/accounts/fireworks/models/kimi-k2-instruct"   // Kimi K2 Instruct
"fireworks-ai/accounts/fireworks/models/kimi-k2-thinking"   // Kimi K2 Thinking

// Meta Llama models
"fireworks-ai/accounts/fireworks/models/llama-v3p3-70b-instruct"
"fireworks-ai/accounts/fireworks/models/llama-v3p1-405b-instruct"

// DeepSeek models
"fireworks-ai/accounts/fireworks/models/deepseek-v3"
"fireworks-ai/accounts/fireworks/models/deepseek-r1-0528"

// MiniMax models
"fireworks-ai/accounts/fireworks/models/minimax-m2"

// Qwen models
"fireworks-ai/accounts/fireworks/models/qwen2p5-coder-32b-instruct"
```

For the complete list, visit: https://fireworks.ai/models

## Code Example

```typescript
import { Box, Agent } from "@upstash/box";

// Using environment variables (recommended)
const box = await Box.create({
  runtime: "node",
  agent: {
    provider: Agent.OpenCode,
    model: process.env.UPSTASH_OPENCODE_MODEL!,
    apiKey: process.env.UPSTASH_OPENCODE_API_KEY!,
  },
});

// Or with hardcoded values
const box = await Box.create({
  runtime: "node",
  agent: {
    provider: Agent.OpenCode,
    model: "fireworks-ai/accounts/fireworks/models/kimi-k2p5",
    apiKey: "fw-xxx-your-api-key",
  },
});
```

## Troubleshooting

### Error: "Invalid agent. Must be empty or one of: claude-code, codex, opencode"

**Problem**: You set `provider: "fireworks-ai"`

**Solution**: Change to `provider: Agent.OpenCode` or `provider: "opencode"`

The provider field must be one of the three supported agent SDKs. OpenCode handles routing to external providers.

### Model not recognized

**Problem**: Model string format is incorrect

**Solution**: Ensure you use the full model path:
```
fireworks-ai/accounts/fireworks/models/{model-name}
```

Not just:
```
kimi-k2p5  ❌
fireworks/kimi-k2p5  ❌
```

### Authentication errors

**Problem**: Invalid or missing API key

**Solution**: 
1. Verify your Fireworks AI API key at https://fireworks.ai/account/api-keys
2. Ensure it's correctly set in `UPSTASH_OPENCODE_API_KEY`
3. API keys start with `fw-`

## Cost Comparison

Fireworks AI offers competitive pricing for open-source models:

| Model | Provider | Cost per 1M tokens (input/output) |
|-------|----------|-----------------------------------|
| Kimi K2.5 | Fireworks AI | $0.60 / $2.50 |
| Claude Sonnet 4 | Anthropic | $3.00 / $15.00 |
| GPT-4o | OpenAI | $2.50 / $10.00 |

OpenCode allows you to easily switch between providers by changing the model string.

## References

- [Upstash Box SDK Documentation](https://upstash.com/docs/box/sdk/typescript)
- [Upstash Box Agent Configuration](https://upstash.com/docs/box/overall/agent)
- [OpenCode Providers](https://opencode.ai/docs/providers/)
- [Fireworks AI Models](https://fireworks.ai/models)
- [Fireworks AI Pricing](https://fireworks.ai/pricing)
