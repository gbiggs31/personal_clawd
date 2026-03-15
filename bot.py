import os
import logging
import json
import asyncio
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, MessageHandler, CommandHandler, filters, ContextTypes
import anthropic
from openai import AsyncOpenAI

# ── Config ─────────────────────────────────────────────────────────────────────

load_dotenv()

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
HISTORY_FILE = "conversation_history.json"
MAX_HISTORY_TURNS = 20
ENSEMBLE_TRIGGER = "ensemble:"

SYSTEM_PROMPT = """You are a helpful personal assistant accessible via Telegram. 
Be concise but thorough. Format responses clearly. 
If asked to do something you can't do (e.g. browse the web), say so plainly. End your message with so sayeth the claw"""

SYNTHESIS_PROMPT = """You are synthesising responses from two AI models to the same query.

User query: {query}

Claude's response:
{claude_response}

GPT-4o's response:
{gpt_response}

Please provide:
1. **Synthesis** — a single best answer combining the strongest elements of both
2. **Agreements** — key points both models agreed on
3. **Differences** — any meaningful differences in approach or content
4. **Confidence** — flag anything where the models contradicted each other as lower confidence

Be concise. The synthesis should be more useful than either response alone.

End your synthesis with: so sayeth the claw"""

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ── API clients ────────────────────────────────────────────────────────────────

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

# ── Conversation history ───────────────────────────────────────────────────────

def load_history() -> dict:
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r") as f:
            return json.load(f)
    return {}

def save_history(history: dict):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)

conversation_history = load_history()

def get_user_history(user_id: str) -> list:
    return conversation_history.get(user_id, [])

def append_to_history(user_id: str, role: str, content: str):
    if user_id not in conversation_history:
        conversation_history[user_id] = []
    conversation_history[user_id].append({"role": role, "content": content})
    max_messages = MAX_HISTORY_TURNS * 2
    if len(conversation_history[user_id]) > max_messages:
        conversation_history[user_id] = conversation_history[user_id][-max_messages:]
    save_history(conversation_history)

# ── Single model queries ───────────────────────────────────────────────────────

def query_claude(user_id: str, user_message: str) -> str:
    """Query Claude with conversation history (used for normal messages)."""
    history = get_user_history(user_id)
    messages = history + [{"role": "user", "content": user_message}]
    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=messages
    )
    return response.content[0].text

# ── Ensemble queries (parallel, no history — fresh context per model) ──────────

async def ensemble_claude(query: str) -> tuple[str, str]:
    """Query Claude for ensemble — runs in thread pool to avoid blocking."""
    loop = asyncio.get_event_loop()
    def _call():
        response = claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": query}]
        )
        return response.content[0].text
    result = await loop.run_in_executor(None, _call)
    return ("Claude", result)

async def ensemble_gpt(query: str) -> tuple[str, str]:
    """Query GPT-4o for ensemble."""
    response = await openai_client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1024,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query}
        ]
    )
    return ("GPT-4o", response.choices[0].message.content)

async def synthesise(query: str, claude_response: str, gpt_response: str) -> str:
    """Ask Claude to synthesise both responses."""
    prompt = SYNTHESIS_PROMPT.format(
        query=query,
        claude_response=claude_response,
        gpt_response=gpt_response
    )
    loop = asyncio.get_event_loop()
    def _call():
        response = claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text
    return await loop.run_in_executor(None, _call)

# ── Telegram handlers ──────────────────────────────────────────────────────────

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route messages — ensemble trigger or normal Claude response."""
    user_id = str(update.effective_user.id)
    user_message = update.message.text
    username = update.effective_user.first_name or "User"

    logger.info(f"Message from {username} ({user_id}): {user_message[:50]}...")

    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

    # ── Ensemble path ──────────────────────────────────────────────────────────
    if user_message.lower().startswith(ENSEMBLE_TRIGGER):
        query = user_message[len(ENSEMBLE_TRIGGER):].strip()

        if not query:
            await update.message.reply_text(
                f'Usage: `{ENSEMBLE_TRIGGER} your question here`',
                parse_mode="Markdown"
            )
            return

        await update.message.reply_text("⏳ Querying Claude and GPT-4o in parallel...")

        try:
            # Fire both models simultaneously
            results = await asyncio.gather(
                ensemble_claude(query),
                ensemble_gpt(query),
                return_exceptions=True
            )

            responses = {}
            errors = []
            for result in results:
                if isinstance(result, Exception):
                    errors.append(str(result))
                else:
                    model_name, response_text = result
                    responses[model_name] = response_text

            # Send individual responses
            for model_name, response_text in responses.items():
                await update.message.reply_text(
                    f"*{model_name}:*\n{response_text}",
                    parse_mode="Markdown"
                )

            # Report any model errors
            if errors:
                await update.message.reply_text(
                    f"⚠️ Some models failed: {'; '.join(errors)}"
                )

            # Only synthesise if we have both responses
            if len(responses) == 2:
                await context.bot.send_chat_action(
                    chat_id=update.effective_chat.id, action="typing"
                )
                synthesis = await synthesise(
                    query,
                    responses.get("Claude", ""),
                    responses.get("GPT-4o", "")
                )
                await update.message.reply_text(
                    f"*🔀 Synthesis:*\n{synthesis}",
                    parse_mode="Markdown"
                )
            elif len(responses) == 1:
                await update.message.reply_text(
                    "⚠️ Only one model responded — skipping synthesis."
                )

        except Exception as e:
            logger.error(f"Ensemble error: {e}")
            await update.message.reply_text(f"Ensemble error: {e}")

    # ── Normal Claude path ─────────────────────────────────────────────────────
    else:
        try:
            reply = query_claude(user_id, user_message)
            append_to_history(user_id, "user", user_message)
            append_to_history(user_id, "assistant", reply)
            await update.message.reply_text(reply)

        except Exception as e:
            logger.error(f"Error querying Claude: {e}")
            await update.message.reply_text(f"Error: {e}")

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "👋 Hey! I'm your personal Claude-powered assistant. All hail the Claw.\n\n"
        "Just send me a message and I'll respond. I remember our conversation history.\n\n"
        f"Prefix with `{ENSEMBLE_TRIGGER}` to query Claude + GPT-4o and get a synthesised answer.\n\n"
        f"*Example:* `ensemble: what are the best ways to learn Python?`\n\n"
        "*Commands:*\n"
        "/start - Show this message\n"
        "/clear - Clear your conversation history\n"
        "/history - Show how many messages are stored\n"
        "/claw - Return the claw",
        parse_mode="Markdown"
    )

async def cmd_clear(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Clear conversation history for this user."""
    user_id = str(update.effective_user.id)
    conversation_history[user_id] = []
    save_history(conversation_history)
    await update.message.reply_text("🗑️ Conversation history cleared.")

async def cmd_claw(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Return the claw."""
    await update.message.reply_text("All hail the Claw! 🦀")

async def cmd_history(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show how many messages are stored for this user."""
    user_id = str(update.effective_user.id)
    count = len(get_user_history(user_id))
    await update.message.reply_text(
        f"📝 I have {count} messages stored in your conversation history "
        f"(max {MAX_HISTORY_TURNS * 2})."
    )

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    logger.info("Starting The Claw Phase 2 (ensemble enabled)...")

    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("clear", cmd_clear))
    app.add_handler(CommandHandler("history", cmd_history))
    app.add_handler(CommandHandler("claw", cmd_claw))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logger.info("Bot is running. Press Ctrl+C to stop.")
    app.run_polling()

if __name__ == "__main__":
    main()