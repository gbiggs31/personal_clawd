import os
import logging
import json
import asyncio
import uuid
import re
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    filters,
    ContextTypes,
)
import anthropic
from openai import AsyncOpenAI

from gym_db import GymDB, format_history_for_prompt, format_cycle_for_prompt
from gym_extractor import extract_workout, summarise_cycle, summarise_session, lookup_exercise, classify_session, extract_profile

# ── Config ─────────────────────────────────────────────────────────────────────

load_dotenv()

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]

GYM_TOPIC_ID = int(os.environ["GYM_TOPIC_ID"]) if os.environ.get("GYM_TOPIC_ID") else None
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
SIGNUP_PAGE_URL = os.environ.get("SIGNUP_PAGE_URL", "https://liftwise.biggsdata.com/signup.html")

HISTORY_FILE = "conversation_history.json"
MAX_HISTORY_TURNS = 20
ENSEMBLE_TRIGGER = "ensemble:"
GYM_TRIGGER = "gym:"
CONFIDENCE_THRESHOLD = 0.75

# Words that signal a verbal correction request
_EDIT_WORDS = frozenset({
    "change", "update", "fix", "correct", "wrong", "actually", "meant",
    "edit", "redo", "replace", "amend", "adjust", "modify",
})

# Patterns used for exercise lookup detection
_WEIGHT_REP_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*kg\b"       # e.g. 80kg
    r"|\b\d+\s*x\s*\d+\b"           # e.g. 3x5
    r"|\b\d+\s*sets?\b"              # e.g. 3 sets
    r"|\b\d+\s*reps?\b"              # e.g. 5 reps
    r"|\b@\s*\d+",                   # e.g. @ 100
    re.IGNORECASE,
)
_QUESTION_WORDS = frozenset({
    "how", "what", "why", "when", "where", "which", "who",
    "should", "can", "could", "would", "will", "is", "are",
    "tell", "explain", "suggest", "give", "show",
})

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

CYCLE_PLANNING_SYSTEM = """You are an expert strength and conditioning coach helping a user plan a new training cycle.

Your goal is to gather enough information to write a detailed, structured program. In the first response, ask about any of the following you don't already know:
- Training goals (strength, hypertrophy, fat loss, endurance, sport-specific, etc.)
- Current training status and recent history
- Available equipment and gym setup
- Days per week available, preferred session length
- Desired cycle length
- Injuries, limitations, or exercises to avoid
- Current performance benchmarks (key lifts, body weight, etc.)

When you have sufficient information, produce a detailed week-by-week program with exercises, sets, reps, and a progression scheme. Be specific and practical — make it something the user can follow directly.

The user will review and confirm with /confirmcycle to save it as their active training cycle."""

GYM_QUERY_SYSTEM_TEMPLATE = """You are a knowledgeable personal training assistant with full context of the user's training history and current program.

Answer questions about workouts, progression, technique, recovery, and programming concisely and specifically — always grounded in the user's actual data where relevant. Reference active injury flags proactively when they are relevant.

{profile_section}

{cycle_section}

{session_section}

{history_section}"""

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.DEBUG,
)
logger = logging.getLogger(__name__)

# ── API clients ────────────────────────────────────────────────────────────────

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY, max_retries=5)
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

# ── Gym in-memory state ────────────────────────────────────────────────────────

_sheets: Optional[GymDB] = None
active_cycles: dict[str, Optional[dict]] = {}   # user_id → active cycle (None if none)
gym_sessions: dict[str, str] = {}               # user_id → session_id (UUID)
session_start: dict[str, datetime] = {}         # user_id → session start time
pending_logs: dict[str, dict] = {}              # user_id → {text, partial_parse}
cycle_planning: dict[str, list] = {}            # user_id → planning conversation history
_user_exercises: dict[str, set[str]] = {}       # user_id → exercise names (for lookup detection)
_active_users: set[str] = set()                 # cache of confirmed-active user IDs

# ── DB initialisation ──────────────────────────────────────────────────────────

async def get_sheets() -> GymDB:
    """Lazy-init: connect to Supabase on first use and cache the client."""
    global _sheets
    if _sheets is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in .env")
        loop = asyncio.get_event_loop()
        _sheets = await loop.run_in_executor(
            None,
            lambda: GymDB(SUPABASE_URL, SUPABASE_KEY),
        )
        logger.info("Supabase client initialised.")
    return _sheets


async def get_active_cycle(user_id: str) -> Optional[dict]:
    """Fetch and cache the active cycle for a user."""
    if user_id not in active_cycles:
        loop = asyncio.get_event_loop()
        sheets = await get_sheets()
        active_cycles[user_id] = await loop.run_in_executor(
            None, lambda: sheets.fetch_active_cycle(int(user_id))
        )
        if active_cycles[user_id]:
            logger.info(f"Active cycle loaded for {user_id}: {active_cycles[user_id].get('start_date')}")
    return active_cycles[user_id]

async def is_user_active(user_id: str) -> bool:
    """Check if user has completed signup. Caches positives in-memory."""
    if user_id in _active_users:
        return True
    loop = asyncio.get_event_loop()
    sheets = await get_sheets()
    status = await loop.run_in_executor(None, lambda: sheets.get_user_status(int(user_id)))
    if status == "active":
        _active_users.add(user_id)
        return True
    return False

# ── Topic detection ────────────────────────────────────────────────────────────

def in_gym_topic(update: Update) -> bool:
    msg = update.message or update.edited_message
    if not msg:
        return False
    # Private chats are always the gym context
    if msg.chat.type == "private":
        return True
    # In groups, check for the designated topic thread
    return GYM_TOPIC_ID is not None and msg.message_thread_id == GYM_TOPIC_ID

# ── Claude query functions ─────────────────────────────────────────────────────

def query_claude(user_id: str, user_message: str) -> str:
    """Query Claude with conversation history. Synchronous."""
    history = get_user_history(user_id)
    messages = history + [{"role": "user", "content": user_message}]
    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    return response.content[0].text


async def query_gpt(user_id: str, user_message: str) -> str:
    """Query GPT-4o with conversation history. Async."""
    history = get_user_history(user_id)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history + [{"role": "user", "content": user_message}]
    response = await openai_client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1024,
        messages=messages,
    )
    return response.choices[0].message.content


def query_claude_gym(user_message: str, history_text: str, session_text: str = "", profile: dict | None = None, cycle: dict | None = None) -> str:
    """Query Claude for gym questions — profile + cycle + session + history injected as context. Synchronous."""
    if profile:
        lines = [f"- {k.replace('_', ' ').title()}: {v}" for k, v in profile.items()]
        profile_section = "=== USER PROFILE ===\n" + "\n".join(lines)
    else:
        profile_section = "No user profile set. User can add one with /setprofile."

    cycle_section = (
        format_cycle_for_prompt(cycle)
        if cycle
        else "No active training cycle. The user can create one with /newcycle."
    )
    session_section = (
        f"=== CURRENT SESSION ===\n{session_text}"
        if session_text
        else "No active session (no sets logged yet today)."
    )
    system = GYM_QUERY_SYSTEM_TEMPLATE.format(
        profile_section=profile_section,
        cycle_section=cycle_section,
        session_section=session_section,
        history_section=f"=== GYM HISTORY (last 90 days) ===\n{history_text}",
    )
    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    )
    return response.content[0].text


def query_claude_cycle_planning(planning_history: list, user_message: str) -> str:
    """Continue a multi-turn cycle planning conversation. Synchronous."""
    messages = planning_history + [{"role": "user", "content": user_message}]
    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        system=CYCLE_PLANNING_SYSTEM,
        messages=messages,
    )
    return response.content[0].text

# ── Ensemble queries ───────────────────────────────────────────────────────────

async def ensemble_claude(query: str) -> tuple[str, str]:
    loop = asyncio.get_event_loop()

    def _call():
        response = claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": query}],
        )
        return response.content[0].text

    result = await loop.run_in_executor(None, _call)
    return ("Claude", result)


async def ensemble_gpt(query: str) -> tuple[str, str]:
    response = await openai_client.chat.completions.create(
        model="gpt-4o",
        max_tokens=1024,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ],
    )
    return ("GPT-4o", response.choices[0].message.content)


async def synthesise(query: str, claude_response: str, gpt_response: str) -> str:
    prompt = SYNTHESIS_PROMPT.format(
        query=query, claude_response=claude_response, gpt_response=gpt_response
    )
    loop = asyncio.get_event_loop()

    def _call():
        response = claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    return await loop.run_in_executor(None, _call)

# ── Gym logging core ───────────────────────────────────────────────────────────

def _build_set_rows(
    sets: list, session_id: str, date_str: str, message_id: int
) -> list[dict]:
    return [
        {
            "session_id": session_id,
            "date": date_str,
            "exercise": s.get("exercise", ""),
            "set_num": s.get("set_num", ""),
            "weight_kg": s.get("weight_kg", ""),
            "reps": s.get("reps", ""),
            "rpe": s.get("rpe", ""),
            "rir": s.get("rir", ""),
            "note": s.get("note", ""),
            "note_type": s.get("note_type", ""),
            "injury_flag": s.get("injury_flag", False),
            "injury_body_part": s.get("injury_body_part", ""),
            "extras": s.get("extras"),
            "telegram_message_id": message_id,
        }
        for s in sets
    ]


def _format_logged_sets(sets: list) -> str:
    exercises: dict[str, list] = {}
    for s in sets:
        exercises.setdefault(s.get("exercise", "?"), []).append(s)
    lines = [f"Logged {len(sets)} set(s):"]
    for ex, ex_sets in exercises.items():
        parts = [
            f"{s.get('weight_kg') if s.get('weight_kg') is not None else 'bw'}"
            f"×{s.get('reps') if s.get('reps') is not None else '?'}"
            for s in ex_sets
        ]
        lines.append(f"  {ex}: {', '.join(parts)}")
    return "\n".join(lines)


async def _do_log(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    user_id: str,
    text: str,
    partial_parse: Optional[dict] = None,
    clarification: Optional[str] = None,
):
    """Extract workout from text and write to the Sets sheet.

    Shared by /log, clarification resolution, and the edit handler.
    """
    loop = asyncio.get_event_loop()
    sheets = await get_sheets()

    # Ensure an active session exists
    if user_id not in gym_sessions:
        gym_sessions[user_id] = str(uuid.uuid4())
        session_start[user_id] = datetime.now()
    session_id = gym_sessions[user_id]

    result = await loop.run_in_executor(
        None,
        lambda: extract_workout(claude, text, partial_parse, clarification),
    )

    if result.get("no_workout_data"):
        await update.effective_message.reply_text(
            f"Doesn't look like a workout log: {result.get('reason', '')}\n"
            "To ask a question, just send a message without /log."
        )
        return

    confidence = result.get("confidence", 1.0)

    if confidence < CONFIDENCE_THRESHOLD:
        pending_logs[user_id] = {"text": text, "partial_parse": result}
        question = result.get("clarification_needed") or "Can you clarify?"
        await update.effective_message.reply_text(
            f"Almost got it ({confidence:.0%} confidence). {question}"
        )
        return

    # Write rows
    date_str = datetime.now().strftime("%Y-%m-%d")
    message_id = update.effective_message.message_id
    sets = result.get("sets", [])
    rows = _build_set_rows(sets, session_id, date_str, message_id)
    await loop.run_in_executor(None, lambda: sheets.append_sets(rows, int(user_id)))

    # Keep per-user exercise cache up to date so lookups work immediately after first log
    if user_id not in _user_exercises:
        _user_exercises[user_id] = set()
    for s in sets:
        if s.get("exercise"):
            _user_exercises[user_id].add(s["exercise"])

    # Confirm
    reply = _format_logged_sets(sets)
    if result.get("session_note"):
        reply += f"\nNote: {result['session_note']}"
    await update.effective_message.reply_text(reply)

# ── Verbal edit ──────────────────────────────────────────────────────────────

def _detect_edit_intent(text: str) -> bool:
    """Return True if the message looks like a request to correct a logged set."""
    return any(w in _EDIT_WORDS for w in text.lower().split()[:6])


async def handle_verbal_edit(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    user_id: str,
    text: str,
):
    """Handle a verbal correction like 'change my bench press to 3x5 @ 90kg'."""
    if user_id not in gym_sessions:
        await update.effective_message.reply_text(
            "No active session to edit — log something with /log first."
        )
        return

    loop = asyncio.get_event_loop()
    sheets = await get_sheets()
    session_id = gym_sessions[user_id]

    result = await loop.run_in_executor(
        None, lambda: extract_workout(claude, text)
    )

    if result.get("no_workout_data") or not result.get("sets"):
        await update.effective_message.reply_text(
            "Couldn't parse a correction from that. "
            "Try: 'change my bench press to 3x5 @ 90kg'"
        )
        return

    # Delete existing rows for each corrected exercise in the current session
    exercises = {s.get("exercise", "") for s in result["sets"] if s.get("exercise")}
    for exercise in exercises:
        await loop.run_in_executor(
            None,
            lambda ex=exercise: sheets.delete_rows_by_session_and_exercise(session_id, ex, int(user_id)),
        )

    # Re-insert corrected rows
    date_str = datetime.now().strftime("%Y-%m-%d")
    message_id = update.effective_message.message_id
    rows = _build_set_rows(result["sets"], session_id, date_str, message_id)
    await loop.run_in_executor(None, lambda: sheets.append_sets(rows, int(user_id)))

    if user_id not in _user_exercises:
        _user_exercises[user_id] = set()
    for s in result["sets"]:
        if s.get("exercise"):
            _user_exercises[user_id].add(s["exercise"])

    reply = "Updated: " + _format_logged_sets(result["sets"])
    await update.effective_message.reply_text(reply)


# ── Exercise lookup ───────────────────────────────────────────────────────────

def _detect_exercise_lookup(text: str, known_exercises: set[str]) -> Optional[str]:
    """Return the best-matching exercise name if the message looks like a lookup.

    A lookup is a short message (≤ 8 words, no question mark) whose core content
    — after stripping weight/rep notation — matches an exercise in known_exercises.
    Returns None if no match or if the message looks like a general query.
    """
    stripped = text.strip()

    # Hard disqualifiers
    if "?" in stripped or len(stripped.split()) > 8:
        return None
    first_words = stripped.lower().split()[:3]
    if any(w in _QUESTION_WORDS for w in first_words):
        return None

    # Strip weight/rep notation to isolate the exercise name
    cleaned = _WEIGHT_REP_RE.sub("", stripped).strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if not cleaned or len(cleaned) < 3:
        return None

    # Score candidates: exact match wins; otherwise prefer longer (more specific) names
    best_match: Optional[str] = None
    best_score: int = 0

    for ex in known_exercises:
        ex_lower = ex.lower()
        if len(ex_lower) < 3:
            continue
        if ex_lower == cleaned:
            return ex  # exact match — done
        if ex_lower in cleaned or cleaned in ex_lower:
            score = len(ex_lower)
            if score > best_score:
                best_score = score
                best_match = ex

    logger.debug(
        f"Exercise lookup: text={text!r} cleaned={cleaned!r} "
        f"known_count={len(known_exercises)} matched={best_match!r}"
    )
    return best_match


def _format_exercise_history(sets: list[dict]) -> str:
    """Format exercise-specific sets into a readable block for the lookup prompt."""
    # Group by (date, session_id), most recent first
    sessions: dict[tuple, list] = {}
    for s in sets:
        key = (str(s.get("date", "")), str(s.get("session_id", "")))
        sessions.setdefault(key, []).append(s)

    lines = []
    for (date, _), sess_sets in sorted(sessions.items(), reverse=True):
        set_parts = []
        exercise_note = ""
        for s in sorted(sess_sets, key=lambda x: int(x.get("set_num") or 0)):
            w = s.get("weight_kg") or "bw"
            r = s.get("reps") or "?"
            rpe = f" RPE {s['rpe']}" if s.get("rpe") else ""
            rir = f" RIR {s['rir']}" if s.get("rir") else ""
            injury = " [INJURY]" if str(s.get("injury_flag", "")).lower() == "true" else ""
            set_note = f" [{s['note']}]" if s.get("note") and s.get("note_type") == "set" else ""
            set_parts.append(f"{w}×{r}{rpe}{rir}{set_note}{injury}")
            if not exercise_note and s.get("note") and s.get("note_type") == "exercise":
                exercise_note = f" — {s['note']}"

        lines.append(f"{date}: {', '.join(set_parts)}{exercise_note}")

    return "\n".join(lines)


async def handle_exercise_lookup(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    user_id: str,
    text: str,
    matched_exercise: str,
):
    """Fetch recent sets for the exercise and generate a coaching response."""
    loop = asyncio.get_event_loop()
    try:
        sheets = await get_sheets()
        exercise_sets = await loop.run_in_executor(
            None, lambda: sheets.fetch_exercise_sessions(matched_exercise, int(user_id))
        )

        if not exercise_sets:
            await update.message.reply_text(
                f"No history found for '{matched_exercise}'."
            )
            return

        history_text = _format_exercise_history(exercise_sets)

        # Extract any target context (weight/rep goal the user mentioned)
        cleaned_name = _WEIGHT_REP_RE.sub("", text).strip().lower()
        target_context = text if cleaned_name.lower() != matched_exercise.lower() else None

        reply = await loop.run_in_executor(
            None,
            lambda: lookup_exercise(claude, matched_exercise, history_text, target_context),
        )
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"Exercise lookup error: {e}")
        await update.message.reply_text(f"Error fetching exercise data: {e}")

# ── Gym topic routing ──────────────────────────────────────────────────────────

async def handle_gym_topic_message(
    update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: str, text: str
):
    """Route a plain-text message received in the Gym topic."""
    loop = asyncio.get_event_loop()

    # Priority 1: active cycle planning conversation
    if user_id in cycle_planning:
        history = cycle_planning[user_id]
        reply = await loop.run_in_executor(
            None, lambda: query_claude_cycle_planning(history, text)
        )
        cycle_planning[user_id] = history + [
            {"role": "user", "content": text},
            {"role": "assistant", "content": reply},
        ]
        await update.message.reply_text(
            reply + "\n\n_/confirmcycle to save • /cancelcycle to discard_",
            parse_mode="Markdown",
        )
        return

    # Priority 2: resolve a pending log clarification
    if user_id in pending_logs:
        pending = pending_logs[user_id]  # peek — don't pop until success
        try:
            await _do_log(update, context, user_id, pending["text"], pending["partial_parse"], text)
            pending_logs.pop(user_id)  # only remove on success
        except anthropic.APIStatusError as e:
            if e.status_code == 529:
                await update.effective_message.reply_text(
                    "Claude is overloaded right now — please resend your reply in a moment."
                )
            else:
                raise
        return

    # Priority 3: verbal correction ("change my bench press to 90kg x 5")
    if _detect_edit_intent(text):
        await handle_verbal_edit(update, context, user_id, text)
        return

    # Priority 4: exercise lookup shortcut
    # Ensure per-user exercise cache is populated (may be empty after a bot restart)
    if user_id not in _user_exercises:
        sheets = await get_sheets()
        exercises = await loop.run_in_executor(
            None, lambda: sheets.fetch_exercise_names(int(user_id))
        )
        _user_exercises[user_id] = exercises
    matched_exercise = _detect_exercise_lookup(text, _user_exercises.get(user_id, set()))
    if matched_exercise:
        await handle_exercise_lookup(update, context, user_id, text, matched_exercise)
        return

    # Priority 5: gym query with context
    await handle_gym_query(update, context, user_id, text)


async def handle_gym_query(
    update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: str, query: str
):
    """Fetch 90-day history + active cycle + current session, ask Claude, reply."""
    loop = asyncio.get_event_loop()
    try:
        sheets = await get_sheets()
        sets, sessions = await loop.run_in_executor(
            None, lambda: sheets.fetch_recent_data(int(user_id))
        )
        profile = await loop.run_in_executor(None, lambda: sheets.fetch_profile(int(user_id)))
        history_text = format_history_for_prompt(sets, sessions)
        cycle = await get_active_cycle(user_id)

        session_text = ""
        if user_id in gym_sessions:
            session_id = gym_sessions[user_id]
            session_sets = await loop.run_in_executor(
                None, lambda: sheets.fetch_session_sets(session_id, int(user_id))
            )
            if session_sets:
                session_text = _format_exercise_history(session_sets)

        reply = await loop.run_in_executor(
            None, lambda: query_claude_gym(query, history_text, session_text, profile, cycle)
        )
        await update.effective_message.reply_text(reply)
    except Exception as e:
        logger.error(f"Gym query error: {e}")
        await update.effective_message.reply_text(f"Error: {e}")

# ── Telegram message handlers ──────────────────────────────────────────────────

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Route messages: gym topic → gym prefix → ensemble → normal Claude."""
    user_id = str(update.effective_user.id)
    user_message = update.message.text
    username = update.effective_user.first_name or "User"

    logger.info(f"Message from {username} ({user_id}): {user_message[:50]}...")

    # ── Auth gate ──────────────────────────────────────────────────────────────
    if not await is_user_active(user_id):
        await update.message.reply_text(
            "You need to sign up before using Liftwise.\n"
            "Send /start to get your signup link."
        )
        return

    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

    # ── Gym topic ──────────────────────────────────────────────────────────────
    if in_gym_topic(update):
        try:
            await handle_gym_topic_message(update, context, user_id, user_message)
        except anthropic.APIStatusError as e:
            logger.error(f"Anthropic API error: {e}", exc_info=True)
            if e.status_code == 529:
                await update.effective_message.reply_text(
                    "Claude is overloaded right now — please try again in a moment."
                )
            else:
                await update.effective_message.reply_text(f"API error ({e.status_code}): {e.message}")
        except Exception as e:
            logger.error(f"Gym topic handler error: {e}", exc_info=True)
            await update.effective_message.reply_text(f"Error: {e}")
        return

    # ── gym: prefix (anywhere) ─────────────────────────────────────────────────
    if user_message.lower().startswith(GYM_TRIGGER):
        query = user_message[len(GYM_TRIGGER):].strip()
        if query:
            await handle_gym_query(update, context, user_id, query)
        else:
            await update.message.reply_text(
                "Usage: `gym: your question`", parse_mode="Markdown"
            )
        return

    # ── Ensemble path ──────────────────────────────────────────────────────────
    if user_message.lower().startswith(ENSEMBLE_TRIGGER):
        query = user_message[len(ENSEMBLE_TRIGGER):].strip()
        if not query:
            await update.message.reply_text(
                f'Usage: `{ENSEMBLE_TRIGGER} your question here`', parse_mode="Markdown"
            )
            return

        await update.message.reply_text("⏳ Querying Claude and GPT-4o in parallel...")

        try:
            results = await asyncio.gather(
                ensemble_claude(query), ensemble_gpt(query), return_exceptions=True
            )
            responses: dict[str, str] = {}
            errors: list[str] = []
            for result in results:
                if isinstance(result, Exception):
                    errors.append(str(result))
                else:
                    model_name, response_text = result
                    responses[model_name] = response_text

            for model_name, response_text in responses.items():
                await update.message.reply_text(
                    f"*{model_name}:*\n{response_text}", parse_mode="Markdown"
                )

            if errors:
                await update.message.reply_text(
                    f"⚠️ Some models failed: {'; '.join(errors)}"
                )

            if len(responses) == 2:
                await context.bot.send_chat_action(
                    chat_id=update.effective_chat.id, action="typing"
                )
                synthesis = await synthesise(
                    query, responses.get("Claude", ""), responses.get("GPT-4o", "")
                )
                await update.message.reply_text(
                    f"*🔀 Synthesis:*\n{synthesis}", parse_mode="Markdown"
                )
            elif len(responses) == 1:
                await update.message.reply_text(
                    "⚠️ Only one model responded — skipping synthesis."
                )

        except Exception as e:
            logger.error(f"Ensemble error: {e}")
            await update.message.reply_text(f"Ensemble error: {e}")
        return

    # ── Normal GPT-4o path ─────────────────────────────────────────────────────
    try:
        reply = await query_gpt(user_id, user_message)
        append_to_history(user_id, "user", user_message)
        append_to_history(user_id, "assistant", reply)
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"Error querying GPT-4o: {e}")
        await update.message.reply_text(f"Error: {e}")


async def handle_edited_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Re-parse edited messages in the Gym topic and update sheet rows."""
    if not in_gym_topic(update):
        return
    if not update.edited_message or not update.edited_message.text:
        return

    user_id = str(update.effective_user.id)
    message_id = update.edited_message.message_id
    text = update.edited_message.text

    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

    try:
        loop = asyncio.get_event_loop()
        sheets = await get_sheets()
        await loop.run_in_executor(
            None, lambda: sheets.delete_rows_by_message_id(message_id, int(user_id))
        )
        await _do_log(update, context, user_id, text)
    except Exception as e:
        logger.error(f"Edit handler error: {e}")
        await update.edited_message.reply_text(f"Error updating log: {e}")

# ── Standard command handlers ──────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    loop = asyncio.get_event_loop()

    try:
        sheets = await get_sheets()
        status = await loop.run_in_executor(None, lambda: sheets.get_user_status(int(user_id)))

        if status == "active":
            _active_users.add(user_id)
            await update.message.reply_text(
                "Welcome back to Liftwise! Send /guide for the full command reference.",
                parse_mode="Markdown",
            )
            return

        # Generate a fresh token regardless of whether they're new or pending
        token = str(uuid.uuid4())
        if status is None:
            await loop.run_in_executor(None, lambda: sheets.create_pending_user(int(user_id)))

        await loop.run_in_executor(None, lambda: sheets.create_signup_token(int(user_id), token))
        signup_url = f"{SIGNUP_PAGE_URL}?token={token}"

        if status == "pending":
            msg = (
                "Your signup isn't complete yet. Use the link below to finish — "
                "it expires in 15 minutes.\n\n"
                f"{signup_url}\n\n"
                "After signing up, send /start again to begin."
            )
        else:
            msg = (
                "Welcome to Liftwise — your AI gym assistant.\n\n"
                "Complete your signup using the link below (expires in 15 minutes):\n\n"
                f"{signup_url}\n\n"
                "After signing up, send /start again to get started."
            )
        await update.message.reply_text(msg)

    except Exception as e:
        logger.error(f"Start command error: {e}", exc_info=True)
        await update.message.reply_text("Something went wrong. Please try again in a moment.")


async def cmd_guide(update: Update, context: ContextTypes.DEFAULT_TYPE):
    guide = (
        "*THE CLAW — QUICK REFERENCE*\n"
        "\n"
        "*ANYWHERE*\n"
        "Just chat → Claude answers with conversation history\n"
        "`ensemble: <question>` → Claude + GPT-4o in parallel with synthesis\n"
        "`gym: <question>` → Gym question with your full training context\n"
        "\n"
        "*GYM TOPIC — LOGGING*\n"
        "`/log <workout>` → Parse and log sets to the sheet\n"
        "Examples:\n"
        "  /log bench press 3x5 @ 100kg RPE 8\n"
        "  /log squat 120, 125, 130kg x3\n"
        "  /log rdl 4 sets of 8 @ 80kg, shoulder felt tight\n"
        "Edit a sent message → bot re-parses and updates the sheet\n"
        "`change/fix/update <exercise> to <new values>` → correct a logged set\n"
        "  e.g. change my bench press to 3x5 @ 95kg\n"
        "`/done [note]` → close session, saves duration + session type\n"
        "\n"
        "*GYM TOPIC — QUERIES*\n"
        "Any plain text → Claude answers with your full gym history + current session\n"
        "`<exercise name>` (short, no ?) → exercise history + coaching notes\n"
        "  e.g. bench press / squat\n"
        "`/stats` → 90-day training summary\n"
        "`/history` → session and set counts\n"
        "\n"
        "*TRAINING CYCLES*\n"
        "`/newcycle [goals]` → start planning a new cycle with Claude\n"
        "`/confirmcycle` → save the planned cycle as active\n"
        "`/cancelcycle` → discard the current plan\n"
        "`/cycle` → view your active cycle\n"
        "`/endcycle [note]` → mark the current cycle complete\n"
        "\n"
        "*LOGGING SYNTAX*\n"
        "`3x5 @ 100kg` → 3 sets of 5 at 100kg\n"
        "`8,7,6 @ 80kg` → 3 sets with descending reps\n"
        "`5 sets of 5` → 5 sets, weight inferred or null\n"
        "`RPE 8` / `RIR 2` → effort rating\n"
        "`bw` → bodyweight\n"
        "Notes and injury flags parsed automatically from natural language\n"
        "\n"
        "*PROFILE*\n"
        "`/profile` → view your saved profile\n"
        "`/setprofile <text>` → update profile in plain language\n"
        "  e.g. /setprofile 28yo, 180cm, 83kg, 4 years lifting, left knee issue\n"
        "\n"
        "*GENERAL*\n"
        "`/clear` → clear conversation history\n"
        "`/guide` → this message\n"
    )
    await update.message.reply_text(guide, parse_mode="Markdown")


async def cmd_clear(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    conversation_history[user_id] = []
    save_history(conversation_history)
    await update.message.reply_text("Conversation history cleared.")


async def cmd_claw(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("All hail the Claw! 🦀")


async def cmd_history(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)

    # In gym topic: show gym history from sheets
    if in_gym_topic(update):
        await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
        try:
            loop = asyncio.get_event_loop()
            sheets = await get_sheets()
            sets, sessions = await loop.run_in_executor(
                None, lambda: sheets.fetch_recent_data(int(user_id))
            )
            history_text = format_history_for_prompt(sets, sessions)
            await update.message.reply_text(
                f"Last 90 days — {len(sessions)} session(s), {len(sets)} set(s):\n\n{history_text}"
            )
        except Exception as e:
            await update.message.reply_text(f"Error fetching gym history: {e}")
        return

    # Elsewhere: conversation message count
    count = len(get_user_history(user_id))
    await update.message.reply_text(
        f"📝 {count} messages stored (max {MAX_HISTORY_TURNS * 2})."
    )

# ── Gym command handlers ───────────────────────────────────────────────────────

async def cmd_log(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    text = " ".join(context.args) if context.args else ""
    if not text:
        await update.message.reply_text("Usage: /log <workout description>")
        return
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        await _do_log(update, context, user_id, text)
    except Exception as e:
        logger.error(f"Log command error: {e}")
        await update.message.reply_text(f"Error logging workout: {e}")


async def cmd_done(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)

    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        loop = asyncio.get_event_loop()
        sheets = await get_sheets()

        # If no active in-memory session, try to recover one from today's sheet data
        if user_id not in gym_sessions:
            date_str = datetime.now().strftime("%Y-%m-%d")
            orphaned_sid = await loop.run_in_executor(
                None, lambda: sheets.find_orphaned_session(date_str, int(user_id))
            )
            if orphaned_sid:
                gym_sessions[user_id] = orphaned_sid
                logger.info(f"Recovered orphaned session {orphaned_sid} for user {user_id}")
            else:
                await update.message.reply_text("No active gym session. Log something with /log first.")
                return

        session_id = gym_sessions.pop(user_id)
        start_time = session_start.pop(user_id, None)
        duration_mins = (
            int((datetime.now() - start_time).total_seconds() // 60)
            if start_time
            else None
        )
        overall_note = " ".join(context.args) if context.args else None

        # Fetch sets and exercises logged this session
        session_sets, exercises = await loop.run_in_executor(
            None, lambda: (
                sheets.fetch_session_sets(session_id, int(user_id)),
                sheets.fetch_session_exercises(session_id, int(user_id)),
            )
        )
        classification = await loop.run_in_executor(
            None, lambda: classify_session(claude, exercises)
        )

        row = {
            "session_id": session_id,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "overall_note": overall_note or "",
            "duration_mins": duration_mins if duration_mins is not None else "",
            "session_type": classification.get("session_type", "other"),
            "cardio_flag": classification.get("cardio_flag", False),
            "abs_flag": classification.get("abs_flag", False),
        }
        await loop.run_in_executor(None, lambda: sheets.append_session(row, int(user_id)))

        dur_str = f" ({duration_mins} mins)" if duration_mins is not None else ""
        note_str = f"\nNote: {overall_note}" if overall_note else ""
        type_str = classification.get("session_type", "other")
        flags = [f for f, v in [("cardio", classification.get("cardio_flag")), ("abs", classification.get("abs_flag"))] if v]
        flags_str = f" + {', '.join(flags)}" if flags else ""
        await update.message.reply_text(f"Session closed{dur_str} — {type_str}{flags_str}.{note_str}")

        # Generate and send session summary + coaching notes
        if session_sets:
            await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
            summary = await loop.run_in_executor(
                None,
                lambda: summarise_session(claude, session_sets, duration_mins, type_str, overall_note),
            )
            await update.message.reply_text(summary)
    except Exception as e:
        logger.error(f"Done command error: {e}")
        await update.message.reply_text(f"Error closing session: {e}")


async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        loop = asyncio.get_event_loop()
        sheets = await get_sheets()
        sets, sessions = await loop.run_in_executor(
            None, lambda: sheets.fetch_recent_data(int(user_id))
        )

        if not sets and not sessions:
            await update.message.reply_text("No workout data found in the last 90 days.")
            return

        history_text = format_history_for_prompt(sets, sessions)
        cycle = await get_active_cycle(user_id)
        stats_query = (
            "Give me a concise training stats summary for the last 90 days. "
            "Include: sessions per week average, top exercises by volume, "
            "notable PRs or strength trends, and any recurring injury flags."
        )
        reply = await loop.run_in_executor(
            None, lambda: query_claude_gym(stats_query, history_text, cycle=cycle)
        )
        await update.message.reply_text(reply)
    except Exception as e:
        logger.error(f"Stats error: {e}")
        await update.message.reply_text(f"Error fetching stats: {e}")

# ── Profile command handlers ───────────────────────────────────────────────────

async def cmd_profile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show the current user profile."""
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        loop = asyncio.get_event_loop()
        sheets = await get_sheets()
        profile = await loop.run_in_executor(None, lambda: sheets.fetch_profile(int(user_id)))
        if not profile:
            await update.message.reply_text(
                "No profile set yet.\n"
                "Use /setprofile to add your details, e.g.:\n"
                "/setprofile I'm 28, 180cm, 83kg, been lifting 4 years, "
                "mainly strength focus, left knee occasionally niggles"
            )
            return
        lines = [f"*{k.replace('_', ' ').title()}:* {v}" for k, v in profile.items()]
        await update.message.reply_text("*Your Profile*\n\n" + "\n".join(lines), parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Profile fetch error: {e}")
        await update.message.reply_text(f"Error: {e}")


async def cmd_setprofile(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Update profile fields from natural language."""
    text = " ".join(context.args) if context.args else ""
    if not text:
        await update.message.reply_text(
            "Tell me about yourself in plain language, e.g.:\n"
            "/setprofile 28 years old, 180cm, 83kg, training for 4 years, "
            "intermediate, chronic left knee issue, train at a commercial gym"
        )
        return
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        loop = asyncio.get_event_loop()
        sheets = await get_sheets()
        updates = await loop.run_in_executor(None, lambda: extract_profile(claude, text))
        if not updates:
            await update.message.reply_text("Couldn't extract any profile fields from that — try rephrasing.")
            return
        await loop.run_in_executor(None, lambda: sheets.update_profile(updates, int(user_id)))
        lines = [f"*{k.replace('_', ' ').title()}:* {v}" for k, v in updates.items()]
        await update.message.reply_text("Profile updated:\n\n" + "\n".join(lines), parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Profile update error: {e}")
        await update.message.reply_text(f"Error: {e}")


# ── Cycle command handlers ─────────────────────────────────────────────────────

async def cmd_newcycle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    initial_text = " ".join(context.args) if context.args else None

    cycle_planning[user_id] = []
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

    if initial_text:
        # User provided goals upfront — get Claude's first response
        loop = asyncio.get_event_loop()
        reply = await loop.run_in_executor(
            None, lambda: query_claude_cycle_planning([], initial_text)
        )
        cycle_planning[user_id] = [
            {"role": "user", "content": initial_text},
            {"role": "assistant", "content": reply},
        ]
        await update.message.reply_text(
            reply + "\n\n_/confirmcycle to save • /cancelcycle to discard_",
            parse_mode="Markdown",
        )
    else:
        # Multi-turn: ask for info in the Gym topic
        await update.message.reply_text(
            "Let's plan your new training cycle.\n\n"
            "Tell me: your goals, how many weeks, days per week available, "
            "equipment, any injuries or limitations, and current benchmarks "
            "if you're strength-focused.\n\n"
            "Send your info in the Gym topic and we'll build the plan together. "
            "Run /confirmcycle when you're happy with it, or /cancelcycle to stop."
        )


async def cmd_confirmcycle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    global active_cycle
    user_id = str(update.effective_user.id)

    if user_id not in cycle_planning or not cycle_planning[user_id]:
        await update.message.reply_text(
            "No active cycle plan to confirm. Use /newcycle to start one."
        )
        return

    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        loop = asyncio.get_event_loop()
        sheets = await get_sheets()
        start_date = datetime.now().strftime("%Y-%m-%d")

        history = cycle_planning[user_id]
        summary = await loop.run_in_executor(
            None, lambda: summarise_cycle(claude, history, start_date)
        )

        # Complete any existing active cycle first
        existing = active_cycles.get(user_id)
        if existing:
            old_id = existing.get("cycle_id", "")
            await loop.run_in_executor(None, lambda: sheets.complete_cycle(old_id, int(user_id)))

        cycle_id = str(uuid.uuid4())
        new_cycle = {
            "cycle_id": cycle_id,
            "start_date": start_date,
            "end_date": summary.get("end_date", ""),
            "goals": summary.get("goals", ""),
            "workout_plan": summary.get("workout_plan", ""),
            "status": "active",
        }
        await loop.run_in_executor(None, lambda: sheets.append_cycle(new_cycle, int(user_id)))
        active_cycles[user_id] = new_cycle
        del cycle_planning[user_id]

        plan_preview = new_cycle["workout_plan"]
        if len(plan_preview) > 800:
            plan_preview = plan_preview[:800] + "…"

        await update.message.reply_text(
            f"Training cycle saved!\n\n"
            f"Start: {start_date} | End: {new_cycle['end_date']}\n"
            f"Goals: {new_cycle['goals']}\n\n"
            f"{plan_preview}"
        )
    except Exception as e:
        logger.error(f"Confirm cycle error: {e}")
        await update.message.reply_text(f"Error saving cycle: {e}")


async def cmd_cancelcycle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    if user_id in cycle_planning:
        del cycle_planning[user_id]
        await update.message.reply_text("Cycle plan discarded.")
    else:
        await update.message.reply_text("No active cycle plan to cancel.")


async def cmd_cycle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    cycle = await get_active_cycle(user_id)
    if not cycle:
        await update.message.reply_text(
            "No active training cycle. Use /newcycle to create one."
        )
        return
    await update.message.reply_text(format_cycle_for_prompt(cycle))


async def cmd_endcycle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    cycle = await get_active_cycle(user_id)
    if not cycle:
        await update.message.reply_text("No active training cycle to end.")
        return

    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        loop = asyncio.get_event_loop()
        sheets = await get_sheets()
        cycle_id = cycle.get("cycle_id", "")
        await loop.run_in_executor(None, lambda: sheets.complete_cycle(cycle_id, int(user_id)))
        active_cycles[user_id] = None
        note = " ".join(context.args) if context.args else ""
        note_str = f"\nNote: {note}" if note else ""
        await update.message.reply_text(f"Training cycle completed.{note_str}")
    except Exception as e:
        logger.error(f"End cycle error: {e}")
        await update.message.reply_text(f"Error ending cycle: {e}")

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    logger.info("Starting The Claw Phase 3 (gym logging + cycle planning)...")

    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()

    # Standard commands
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("guide", cmd_guide))
    app.add_handler(CommandHandler("clear", cmd_clear))
    app.add_handler(CommandHandler("history", cmd_history))
    app.add_handler(CommandHandler("claw", cmd_claw))

    # Gym commands
    app.add_handler(CommandHandler("log", cmd_log))
    app.add_handler(CommandHandler("done", cmd_done))
    app.add_handler(CommandHandler("stats", cmd_stats))
    app.add_handler(CommandHandler("profile", cmd_profile))
    app.add_handler(CommandHandler("setprofile", cmd_setprofile))

    # Cycle commands
    app.add_handler(CommandHandler("newcycle", cmd_newcycle))
    app.add_handler(CommandHandler("confirmcycle", cmd_confirmcycle))
    app.add_handler(CommandHandler("cancelcycle", cmd_cancelcycle))
    app.add_handler(CommandHandler("cycle", cmd_cycle))
    app.add_handler(CommandHandler("endcycle", cmd_endcycle))

    # Message handlers — edit handler must be registered before the catch-all
    app.add_handler(
        MessageHandler(filters.UpdateType.EDITED_MESSAGE & filters.TEXT, handle_edited_message)
    )
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    logger.info("Bot is running. Press Ctrl+C to stop.")
    app.run_polling()


if __name__ == "__main__":
    main()
