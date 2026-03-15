# The Claw 🦀

A personal Telegram bot powered by Claude. Send it messages, get Claude responses, with persistent conversation memory. Phase 2 adds an ensemble mode that queries Claude and GPT-4o in parallel and synthesises the results.

---

## Phase 1 — Claude bot

### Setup

**1. Install dependencies**
```bash
pip install -r requirements.txt
```

**2. Create your Telegram bot**
1. Open Telegram and message **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the bot token you receive

**3. Get your Anthropic API key**
1. Go to **console.anthropic.com**
2. Create an API key under Account > API Keys

**4. Configure environment variables**
```bash
cp .env.example .env
```
Then edit `.env` and fill in your keys.

**5. Run the bot**
```bash
python bot.py
```

Then open Telegram, find your bot, and start messaging it.

### Commands

| Command | Description |
|---|---|
| `/start` | Show help message |
| `/clear` | Clear your conversation history |
| `/history` | Show how many messages are stored |
| `/claw` | All hail the Claw 🦀 |

### Notes
- Conversation history is saved to `conversation_history.json` — persists across restarts
- History is trimmed to the last 20 exchanges per user to keep API costs low
- To change the bot's personality, edit `SYSTEM_PROMPT` in `bot.py`
- To use a different Claude model, change the `model` parameter in `query_claude()`

---

## Phase 2 — Ensemble mode

Prefix any message with `ensemble:` to query both Claude and GPT-4o simultaneously. The bot returns each model's response individually, then a synthesised answer highlighting agreements, differences, and lower-confidence areas where the models disagreed.

**Example:**
```
ensemble: what is the best way to learn chess as an adult?
```

### Additional setup for Phase 2

**1. Get an OpenAI API key**
1. Go to **platform.openai.com**
2. Create an API key under API Keys

**2. Add it to your `.env`**
```
OPENAI_API_KEY=your_openai_api_key_here
```

**3. Install the updated dependencies**
```bash
pip install -r requirements.txt
```

### How it works
- Both models are queried in parallel using `asyncio.gather` — no sequential waiting
- If one model fails, the other still responds gracefully
- Synthesis is skipped if only one model responds
- Ensemble queries run without conversation history — each is a fresh, independent context

---

## Keeping it running

To run 24/7, deploy to a cheap VPS (Hetzner, DigitalOcean) or a free tier on Railway/Render.