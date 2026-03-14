# Clawdbot Phase 1

A personal Telegram bot powered by the Claude API. Send it messages, get Claude responses, with persistent conversation memory.

## Setup

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Create your Telegram bot
1. Open Telegram and message **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the bot token you receive

### 3. Get your Anthropic API key
1. Go to **console.anthropic.com**
2. Create an API key under Account > API Keys

### 4. Configure environment variables
```bash
cp .env.example .env
```
Then edit `.env` and fill in your two keys.

### 5. Run the bot
```bash
python bot.py
```

Then open Telegram, find your bot, and start messaging it.

## Commands

| Command | Description |
|---|---|
| `/start` | Show help message |
| `/clear` | Clear your conversation history |
| `/history` | Show how many messages are stored |

## Notes

- Conversation history is saved to `conversation_history.json` — persists across restarts
- History is trimmed to the last 20 exchanges per user to keep API costs low
- To change the bot's personality, edit `SYSTEM_PROMPT` in `bot.py`
- To use a different Claude model, change the `model` parameter in `query_claude()`

## Keeping it running

To run 24/7, deploy to a cheap VPS (Hetzner, DigitalOcean) or a free tier on Railway/Render.
