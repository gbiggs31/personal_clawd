import json
import logging
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)

EXTRACTION_MODEL = "claude-sonnet-4-20250514"

EXTRACTION_SYSTEM = """You are a gym log parser. Extract structured workout data from natural language input.

Return ONLY valid JSON — no preamble, no markdown fences, no explanation.

## Output schema (workout log)
{
  "sets": [
    {
      "exercise": "string — canonical name, e.g. 'Bench Press', 'Romanian Deadlift'",
      "set_num": "integer — 1-indexed within each exercise",
      "weight_kg": "float | null",
      "reps": "integer | null",
      "rpe": "float | null",
      "rir": "integer | null",
      "note": "string | null",
      "note_type": "set | exercise | session | null",
      "injury_flag": "boolean",
      "injury_body_part": "string | null — e.g. 'left knee', 'lower back'",
      "extras": "{ snake_case_key: value } | null"
    }
  ],
  "session_note": "string | null",
  "confidence": "float 0.0–1.0",
  "clarification_needed": "string | null — specific question to ask user"
}

## Output schema (not a workout log)
{"no_workout_data": true, "reason": "string"}

## Parsing rules

### Set notation
- "3x5 @ 100kg"       → 3 identical sets: weight=100, reps=5, set_num 1,2,3
- "8,7,6 @ 80kg"      → 3 sets reps 8, 7, 6 at same weight, set_num 1,2,3
- "building up to Xkg"→ pyramid: intermediate sets have weight_kg=null, final set has actual weight
- "5 sets of 5"        → 5 sets, weight_kg=null if not given

### RPE — infer from language cues; null if no cues present
- "easy", "comfortable", "light"                           → 6
- "solid", "good", "decent"                               → 7.5
- "hard", "tough", "challenging", "grind"                 → 8.5
- "missed a rep", "failed a rep", "couldn't lock out"     → 9.5
- "max effort", "absolute max", "true 1RM"                → 10

### RIR — infer from language cues; null if no mention
- "true failure", "failed the rep", "couldn't get another" → 0
- "almost had another", "one more maybe", "close to failure" → 1
- "couple left", "2 in reserve", "few left"                → 2

### extras dict
Use snake_case keys consistently across sessions:
- Eccentric emphasis   → eccentric_seconds: integer
- Band tension         → band_tension_kg: float
- Tempo                → tempo: "eccentric-pause-concentric" e.g. "3-1-1"
- Machine variant      → machine_variant: "hammer strength"
- Grip                 → grip_width: "wide" | "narrow" | "close"
- Cardio: distance_km, pace_min_per_km (string), duration_mins

### Note classification
- "set": note about a specific set ("form broke down on last rep")
- "exercise": note about the exercise overall ("shoulder felt tight throughout")
- "session": note about the whole session ("slept badly, low energy")

### Injury
- injury_flag=true for any pain, discomfort, niggle, soreness, or tightness that sounds concerning
- injury_body_part: specific anatomical location

### Confidence
- 1.0: everything unambiguous
- 0.75–0.99: minor assumptions made; note what was assumed
- <0.75: significant ambiguity; clarification_needed must be a specific question
- When confidence < 0.75, still populate sets with best-guess values

### Cardio
Same schema: reps=null, weight_kg=null, extras holds duration_mins/distance_km/pace etc."""


CYCLE_SUMMARY_SYSTEM = """You extract structured training cycle data from a planning conversation.

Return ONLY valid JSON — no preamble, no markdown fences:
{
  "goals": "concise goals statement (2–4 sentences capturing what the user wants to achieve)",
  "workout_plan": "full structured program in markdown — week-by-week or day-by-day as fits the goal; include exercises, sets, reps, and progression scheme",
  "end_date": "YYYY-MM-DD — calculate from the start_date and cycle duration discussed"
}"""


def _call_claude(client: anthropic.Anthropic, system: str, messages: list, max_tokens: int = 2048) -> str:
    response = client.messages.create(
        model=EXTRACTION_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    return response.content[0].text


def extract_workout(
    client: anthropic.Anthropic,
    text: str,
    partial_parse: Optional[dict] = None,
    clarification: Optional[str] = None,
) -> dict:
    """Parse natural-language workout text into structured JSON.

    Synchronous — wrap in run_in_executor when calling from async context.

    Second-pass usage: pass partial_parse (from first attempt) and the user's
    clarification response to resolve ambiguities.
    """
    if partial_parse and clarification:
        user_content = (
            f"Original log:\n{text}\n\n"
            f"User clarification:\n{clarification}\n\n"
            f"Partial parse to refine:\n{json.dumps(partial_parse, indent=2)}"
        )
    else:
        user_content = text

    raw = _call_claude(client, EXTRACTION_SYSTEM, [{"role": "user", "content": user_content}])

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.error(f"Extraction returned non-JSON: {raw[:300]}")
        return {"no_workout_data": True, "reason": "Parser returned invalid JSON — please try rephrasing."}


SESSION_CLASSIFY_SYSTEM = """Classify a workout session from its exercise list.

Return ONLY valid JSON — no preamble, no fences:
{
  "session_type": "push | pull | legs | upper | full_body | cardio | other",
  "cardio_flag": boolean,
  "abs_flag": boolean
}

Definitions:
- push: chest, shoulders, triceps (bench, OHP, dips, flyes, lateral raises, etc.)
- pull: back, biceps (rows, pulldowns, pull-ups, curls, face pulls, etc.)
- legs: lower body (squat, deadlift, leg press, lunges, leg curl, calf raise, etc.)
- upper: meaningful mix of push AND pull exercises
- full_body: includes both upper and lower body compound work
- cardio: primarily cardiovascular (running, cycling, rowing, elliptical, etc.)
- other: doesn't fit the above

cardio_flag: true if ANY cardio exercise is present, regardless of session_type
abs_flag: true if ANY ab or core isolation work is present (crunches, planks, cable crunches, hanging leg raises, etc.)"""


def classify_session(client: anthropic.Anthropic, exercises: list[str]) -> dict:
    """Classify a session's type and flags from its exercise list.

    Synchronous — wrap in run_in_executor when calling from async context.
    Returns a safe default if classification fails.
    """
    if not exercises:
        return {"session_type": "other", "cardio_flag": False, "abs_flag": False}

    user_content = "Exercises: " + ", ".join(exercises)
    raw = _call_claude(
        client, SESSION_CLASSIFY_SYSTEM, [{"role": "user", "content": user_content}], max_tokens=80
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.error(f"Session classify returned non-JSON: {raw[:200]}")
        return {"session_type": "other", "cardio_flag": False, "abs_flag": False}


EXERCISE_LOOKUP_SYSTEM = """You are a personal trainer reviewing an athlete's recent performance on a specific exercise.

You will receive the exercise name, any target context the user mentioned (e.g. an upcoming weight or rep goal), and a chronological log of recent sets.

## Response format — keep it tight, this is read on a phone before a set

**[Exercise Name]** — last [N] sessions

[most recent date first]
[date]: [weight]×[reps], [weight]×[reps], ... (RPE [x] | RIR [x] if known) [note if present]
...

**Coaching notes:**
- [specific observation grounded in the numbers — trend, stall, regression]
- [injury or pain flag if present — proactive, not alarmist; practical cue]
- [recurring form pattern from notes if it appears more than once]
- [one key technique cue appropriate to this exercise]

## Rules
- Reference actual numbers: "you hit 85kg×8 at RPE 7.5 last week"
- If a target weight/rep scheme was given, say explicitly whether it looks achievable and why
- If injury flags are present on this exercise, address them directly with a form/load cue
- If the same note (grip, elbow flare, depth, etc.) appears across multiple sessions, call it out as a pattern
- 3–5 bullet points max in coaching notes — no padding
- Do NOT use generic praise ("great work", "solid effort") — be direct and specific"""


def lookup_exercise(
    client: anthropic.Anthropic,
    exercise_name: str,
    history_text: str,
    target_context: Optional[str] = None,
) -> str:
    """Generate an exercise lookup + coaching response.

    Synchronous — wrap in run_in_executor when calling from async context.
    """
    user_content = f"Exercise: {exercise_name}"
    if target_context:
        user_content += f"\nTarget context: {target_context}"
    user_content += f"\n\nRecent session data:\n{history_text}"

    return _call_claude(
        client,
        EXERCISE_LOOKUP_SYSTEM,
        [{"role": "user", "content": user_content}],
    )


PROFILE_EXTRACT_SYSTEM = """Extract user profile information from natural language.

Return ONLY valid JSON — no preamble, no markdown fences:
{
  "height_cm": number | null,
  "weight_kg": number | null,
  "age": integer | null,
  "sex": "string | null",
  "experience_years": number | null,
  "experience_level": "beginner | intermediate | advanced | null",
  "training_notes": "string | null — tendencies, preferences, training style",
  "chronic_injuries": "string | null — persistent issues to always be aware of",
  "equipment": "string | null — available equipment / gym setup"
}

Only populate fields explicitly mentioned. Set unmentioned fields to null."""


def extract_profile(client: anthropic.Anthropic, text: str) -> dict:
    """Extract profile fields from natural language. Returns {field: value} with nulls omitted.

    Synchronous — wrap in run_in_executor when calling from async context.
    """
    raw = _call_claude(client, PROFILE_EXTRACT_SYSTEM, [{"role": "user", "content": text}], max_tokens=512)
    try:
        data = json.loads(raw)
        return {k: v for k, v in data.items() if v is not None}
    except json.JSONDecodeError:
        logger.error(f"Profile extraction returned non-JSON: {raw[:200]}")
        return {}


def summarise_cycle(
    client: anthropic.Anthropic,
    planning_history: list,
    start_date: str,
) -> dict:
    """Summarise a planning conversation into goals + structured plan + end_date.

    Synchronous — wrap in run_in_executor when calling from async context.
    """
    instruction = (
        f"The training cycle starts on {start_date}. "
        "Based on the conversation above, extract the goals, full structured workout plan, "
        "and end date. Return only valid JSON matching the schema."
    )
    messages = planning_history + [{"role": "user", "content": instruction}]
    raw = _call_claude(client, CYCLE_SUMMARY_SYSTEM, messages)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.error(f"Cycle summary returned non-JSON: {raw[:300]}")
        raise ValueError(
            "Could not parse the cycle plan — try /confirmcycle again or rephrase the plan."
        )
