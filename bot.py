import os
import logging
import json
from datetime import datetime
from dotenv import load_dotenv
from telegram import Update
from telegram.ext import ApplicationBuilder, MessageHandler, CommandHandler, filters, ContextTypes
import anthropic

# ── Config ─────────────────────────────────────────────────────────────────────

load_dotenv()

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
HISTORY_FILE = "conversation_history.json"
MAX_HISTORY_TURNS = 20  # Keep last N turns per user to avoid huge context windows

SYSTEM_PROMPT = """You are a helpful personal assistant accessible via Telegram. 
Be concise but thorough. Format responses clearly. 
If asked to do something you can't do (e.g. browse the web), say so plainly."""

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# ── Claude client ──────────────────────────────────────────────────────────────

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ── Conversation history (in-memory + persisted to JSON) ───────────────────────

def load_history() -> dict:
    """Load conversation history from disk on startup."""
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r") as f:
            return json.load(f)
    return {}

def save_history(history: dict):
    """Persist conversation history to disk."""
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)

conversation_history = load_history()

def get_user_history(user_id: str) -> list:
    return conversation_history.get(user_id, [])

def append_to_history(user_id: str, role: str, content: str):
    if user_id not in conversation_history:
        conversation_history[user_id] = []
    
    conversation_history[user_id].append({
        "role": role,
        "content": content
    })
    
    # Trim to last MAX_HISTORY_TURNS turns (each turn = 1 user + 1 assistant message)
    max_messages = MAX_HISTORY_TURNS * 2
    if len(conversation_history[user_id]) > max_messages:
        conversation_history[user_id] = conversation_history[user_id][-max_messages:]
    
    save_history(conversation_history)

# ── Claude query ───────────────────────────────────────────────────────────────

def query_claude(user_id: str, user_message: str) -> str:
    """Send message to Claude with full conversation history."""
    history = get_user_history(user_id)
    
    messages = history + [{"role": "user", "content": user_message}]
    
    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=messages
    )
    
    return response.content[0].text

# ── Telegram handlers ──────────────────────────────────────────────────────────

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle incoming text messages."""
    user_id = str(update.effective_user.id)
    user_message = update.message.text
    username = update.effective_user.first_name or "User"
    
    logger.info(f"Message from {username} ({user_id}): {user_message[:50]}...")
    
    # Show typing indicator
    await context.bot.send_chat_action(
        chat_id=update.effective_chat.id,
        action="typing"
    )
    
    try:
        reply = query_claude(user_id, user_message)
        
        # Save both sides of the exchange
        append_to_history(user_id, "user", user_message)
        append_to_history(user_id, "assistant", reply)
        
        await update.message.reply_text(reply)
        
    except Exception as e:
        logger.error(f"Error querying Claude: {e}")
        await update.message.reply_text(
            "Sorry, something went wrong. Please try again."
        )

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /start command."""
    await update.message.reply_text(
        "👋 Hey! I'm your personal Claude-powered assistant.\n\n"
        "Just send me a message and I'll respond. I remember our conversation history.\n\n"
        "Commands:\n"
        "/start - Show this message\n"
        "/clear - Clear your conversation history\n"
        "/history - Show how many messages are stored"
    )

async def cmd_clear(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Clear conversation history for this user."""
    user_id = str(update.effective_user.id)
    conversation_history[user_id] = []
    save_history(conversation_history)
    await update.message.reply_text("🗑️ Conversation history cleared.")

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
    logger.info("Starting Clawdbot Phase 1...")
    
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    
    # Register command handlers
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("clear", cmd_clear))
    app.add_handler(CommandHandler("history", cmd_history))
    
    # Register message handler (text only, ignores commands)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    
    logger.info("Bot is running. Press Ctrl+C to stop.")
    app.run_polling()

if __name__ == "__main__":
    main()
