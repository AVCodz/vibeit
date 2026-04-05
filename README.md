# VibeIt

A Next.js application with Upstash Box integration for AI-powered coding environments.

## Features

- **Upstash Box Integration**: Sandboxed AI coding agents with OpenCode
- **Fireworks AI Support**: Cost-effective LLM models (Kimi K2.5, Llama, DeepSeek)
- **Environment Management**: Secure project-level environment variable handling
- **Preview Environments**: Automatic Vite dev server management in sandboxed boxes

## Getting Started

### Prerequisites

1. Node.js 18+ and pnpm
2. [Upstash Box API Key](https://upstash.com)
3. [Fireworks AI API Key](https://fireworks.ai) (optional, for custom models)

### Installation

1. Clone and install dependencies:

```bash
pnpm install
```

2. Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

3. Configure required environment variables (see [Configuration](#configuration) below)

### Running the Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Configuration

### Required Environment Variables

```bash
# Database
DATABASE_URL="postgresql://username:password@host:5432/database"

# Authentication
BETTER_AUTH_SECRET="replace-with-a-long-random-secret"
BETTER_AUTH_URL="http://localhost:3000"
GOOGLE_CLIENT_ID="your-google-oauth-client-id"
GOOGLE_CLIENT_SECRET="your-google-oauth-client-secret"

# Upstash Box (AI Coding Agents)
UPSTASH_BOX_API_KEY="your-upstash-box-api-key"
```

### Upstash Box with Fireworks AI (Recommended)

For cost-effective AI coding assistance:

```bash
# OpenCode agent configuration
UPSTASH_OPENCODE_PROVIDER="opencode"
UPSTASH_OPENCODE_MODEL="fireworks-ai/accounts/fireworks/models/kimi-k2p5"
UPSTASH_OPENCODE_API_KEY="your-fireworks-api-key"
```

**Why Fireworks AI?**
- 10x cheaper than closed-source alternatives
- Kimi K2.5: $0.60/$2.50 per 1M tokens vs Claude Sonnet 4: $3.00/$15.00
- Fast inference with open-source models
- No data retention by default

**Available Models:**
- `kimi-k2p5` - Optimized for coding tasks
- `llama-v3p3-70b-instruct` - General-purpose reasoning
- `deepseek-v3` - Advanced reasoning model
- More at [fireworks.ai/models](https://fireworks.ai/models)

See [docs/upstash-box-fireworks-config.md](./docs/upstash-box-fireworks-config.md) for detailed configuration.

### Alternative: Use Upstash-Provided Keys

```bash
# Let Upstash manage the API keys (default)
UPSTASH_OPENCODE_PROVIDER="opencode"
# Leave UPSTASH_OPENCODE_API_KEY unset to use Upstash's keys
```

### OpenRouter (For Chat Features)

```bash
OPENROUTER_API_KEY="your-openrouter-api-key"
OPENROUTER_MODEL="google/gemini-2.5-flash"
```

### Cloudflare R2 (For File Storage)

```bash
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_BUCKET="your-r2-bucket-name"
R2_PUBLIC_BASE_URL="https://cdn.your-domain.com"
```

## Documentation

- [Upstash Box Fireworks AI Configuration](./docs/upstash-box-fireworks-config.md)
- [Environment Variable Management](./docs/env-var-management-implementation.md)
- [Database Schema](./database-schema.md)

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI**: shadcn/ui + Tailwind CSS
- **Database**: PostgreSQL with Drizzle ORM
- **Authentication**: Better Auth
- **AI Integration**: Upstash Box + OpenCode
- **LLM Providers**: Fireworks AI, OpenRouter
- **Storage**: Cloudflare R2
