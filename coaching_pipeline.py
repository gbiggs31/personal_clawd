"""
Avenra coaching update pipeline.

Responsible for:
  1. Classifying whether a conversation contains a durable coaching change.
  2. Extracting structured patch-style updates from the conversation.
  3. Persisting proposed updates to Supabase (program_updates table).
  4. Applying updates, resolving conflicts, and maintaining an audit trail
     (program_change_log).
  5. Assembling and upserting a canonical program_state for each user.

All DB operations use raw PostgREST HTTP — no supabase-py dependency.
Claude calls use the anthropic SDK.
"""

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import anthropic
import requests

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_LIMIT = 10_000

CLASSIFIER_CONFIDENCE_THRESHOLD: float = 0.75
EXTRACTOR_CONFIDENCE_THRESHOLD: float = 0.75

# Update types that are safe to auto-apply when both confidence scores pass.
AUTO_APPLY_TYPES: set[str] = {
    "rule",
    "constraint",
    "effort_change",
    "exercise_order_change",
    "substitution",
    "progression_change",
    "volume_change",
    "priority_change",
}

# Ignore conversations that are too short for a meaningful update.
MIN_MESSAGES_FOR_PIPELINE: int = 2

# ── Prompts ───────────────────────────────────────────────────────────────────

CLASSIFIER_SYSTEM = (
    "You are an expert coaching analyst for Avenra. Read a coaching conversation and decide "
    "if it contains a durable or semi-durable coaching change that should affect future "
    "recommendations. Return YES only when a clear agreed-upon programming change is concluded. "
    "Examples YES: agreed to stop bicep pre-fatigue before pull compounds, bench before OHP "
    "from now on, reduce pressing volume while shoulder irritated, avoid failure on compounds "
    "for recovery. "
    "Examples NO: generic praise, concept explanations, one-off session advice, unconfirmed "
    "speculation, casual chat. "
    "Be conservative. "
    'Return ONLY JSON: {"should_update": bool, "confidence": 0.0-1.0, "rationale": "...", '
    '"update_scope_hint": "durable|temporary|phase_based|none"}'
)

EXTRACTOR_SYSTEM = (
    "You extract structured coaching updates from conversations. Be conservative — only include "
    "clearly supported changes. Output patch-style updates NOT a rewritten programme. "
    "Each update must have: "
    "updateType (rule/constraint/exercise_order_change/substitution/progression_change/"
    "volume_change/effort_change/priority_change), "
    "title, "
    "description, "
    "reason, "
    "applicabilityType (durable/temporary/phase_based), "
    "startAt (ISO date or null), "
    "endAt (ISO date or null), "
    "appliesWhile (string or null), "
    "appliesToProgrammePhase (string or null), "
    "workoutType (string or null), "
    "exerciseName (string or null), "
    "exerciseFamily (string or null), "
    "ruleKey (stable snake_case slug, max 60 chars), "
    "confidence (0.0-1.0), "
    "evidenceSummary (short quote from conversation), "
    "patch (structured object describing the change). "
    'Return ONLY JSON: {"updates": [...]}. '
    'If nothing to extract: {"updates": []}'
)

# ── CoachingDB ────────────────────────────────────────────────────────────────


class CoachingDB:
    """Thin PostgREST HTTP client — same pattern as GymDB."""

    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _get(self, table: str, params: dict = None) -> list[dict]:
        p = {"limit": _LIMIT, **(params or {})}
        r = requests.get(f"{self.base}/{table}", headers=self.headers, params=p)
        r.raise_for_status()
        return r.json()

    def _get_one(self, table: str, params: dict = None) -> Optional[dict]:
        """Return the first matching row, or None."""
        rows = self._get(table, params)
        return rows[0] if rows else None

    def _post(self, table: str, data: dict, prefer: str = "return=representation") -> Optional[list]:
        r = requests.post(
            f"{self.base}/{table}",
            headers={**self.headers, "Prefer": prefer},
            json=data,
        )
        r.raise_for_status()
        return r.json() if "representation" in prefer else None

    def _patch(self, table: str, params: dict, data: dict, prefer: str = "return=minimal") -> Optional[list]:
        r = requests.patch(
            f"{self.base}/{table}",
            headers={**self.headers, "Prefer": prefer},
            params=params,
            json=data,
        )
        r.raise_for_status()
        return r.json() if "representation" in prefer else None


# ── Module-level DB factory ───────────────────────────────────────────────────

def _get_db() -> CoachingDB:
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
    return CoachingDB(url, key)


def _get_claude() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))


# ── Small helpers ─────────────────────────────────────────────────────────────

def _now_iso() -> str:
    """Return current UTC time as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _rule_key_from_text(text: str) -> str:
    """Convert free text to a stable snake_case slug, max 60 chars."""
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower().strip())
    slug = slug.strip("_")
    return slug[:60]


def _format_messages(messages: list[dict]) -> str:
    """Render a list of {role, content} dicts as a readable transcript."""
    lines = []
    for m in messages:
        role = m.get("role", "unknown").capitalize()
        content = m.get("content", "")
        lines.append(f"{role}: {content}")
    return "\n\n".join(lines)


def _parse_json_response(text: str) -> dict:
    """
    Parse JSON from a Claude response, stripping markdown fences if present.
    Raises ValueError if the text cannot be decoded as JSON.
    """
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.IGNORECASE)
    return json.loads(cleaned.strip())


# ── Pipeline steps ────────────────────────────────────────────────────────────


def classify_coaching_update(messages: list[dict], user_id: int) -> dict:
    """
    Step 1 — decide whether the conversation warrants a state update.

    Returns a dict with keys:
      should_update (bool), confidence (float), rationale (str),
      update_scope_hint (str).
    """
    if len(messages) < MIN_MESSAGES_FOR_PIPELINE:
        return {
            "should_update": False,
            "confidence": 1.0,
            "rationale": "Too short — conversation has fewer messages than the minimum threshold.",
            "update_scope_hint": "none",
        }

    transcript = _format_messages(messages)
    user_prompt = (
        f"Here is the coaching conversation for user {user_id}:\n\n{transcript}\n\n"
        "Does this conversation contain a durable/semi-durable coaching update? "
        "Return ONLY JSON as described."
    )

    claude = _get_claude()
    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=256,
        system=CLASSIFIER_SYSTEM,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = response.content[0].text
    try:
        result = _parse_json_response(raw)
    except (ValueError, KeyError) as exc:
        logger.warning("Classifier parse error for user %s: %s | raw=%r", user_id, exc, raw)
        return {
            "should_update": False,
            "confidence": 0.0,
            "rationale": f"Parse error: {exc}",
            "update_scope_hint": "none",
        }

    # Normalise: Claude sometimes returns string "true"/"false"
    if isinstance(result.get("should_update"), str):
        result["should_update"] = result["should_update"].lower() == "true"

    return result


def retrieve_program_context(user_id: int) -> dict:
    """
    Step 2 — load the existing program state and active updates for the user.

    Returns {"state_json": dict, "active_updates": list[dict]}.
    """
    db = _get_db()

    state_row = db._get_one(
        "program_state",
        {"telegram_user_id": f"eq.{user_id}"},
    )
    state_json = state_row.get("state_json", {}) if state_row else {}

    applied_updates = db._get(
        "program_updates",
        {
            "telegram_user_id": f"eq.{user_id}",
            "status": "eq.applied",
            "order": "created_at.asc",
        },
    )

    return {
        "state_json": state_json,
        "active_updates": applied_updates,
    }


def extract_coaching_updates(
    messages: list[dict],
    program_context: dict,
    user_id: int,
) -> dict:
    """
    Step 3 — ask Claude to extract patch-style updates from the conversation.

    Returns {"updates": [...]}.
    """
    transcript = _format_messages(messages)

    # Summarise current active rules for context
    active_updates = program_context.get("active_updates", [])
    if active_updates:
        rule_lines = []
        for u in active_updates:
            rule_lines.append(
                f"  [{u.get('update_type')}] {u.get('title')} "
                f"(key={u.get('rule_key')}, scope={u.get('applicability_type')})"
            )
        rules_section = "Currently active coaching rules/updates:\n" + "\n".join(rule_lines)
    else:
        rules_section = "No active coaching rules on file yet."

    user_prompt = (
        f"User ID: {user_id}\n\n"
        f"{rules_section}\n\n"
        f"Conversation transcript:\n\n{transcript}\n\n"
        "Extract all durable/semi-durable coaching updates from this conversation. "
        "Return ONLY JSON as described."
    )

    claude = _get_claude()
    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=EXTRACTOR_SYSTEM,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = response.content[0].text
    logger.info("Extractor raw response for user %s: %r", user_id, raw[:500])
    try:
        result = _parse_json_response(raw)
    except (ValueError, KeyError) as exc:
        logger.warning("Extractor parse error for user %s: %s | raw=%r", user_id, exc, raw)
        return {"updates": []}

    if not isinstance(result.get("updates"), list):
        logger.warning("Extractor result missing 'updates' list for user %s: %r", user_id, result)
        return {"updates": []}

    logger.info("Extractor found %d update(s) for user %s", len(result["updates"]), user_id)
    return result


def persist_proposed_updates(
    updates: list[dict],
    user_id: int,
    provenance: dict,
) -> list[str]:
    """
    Step 4 — write each extracted update to program_updates as 'proposed'.

    apply_program_updates (step 5) handles the transition to 'applied' and
    triggers the canonical-state rebuild.

    Returns a list of persisted row IDs (UUIDs as strings).
    """
    db = _get_db()
    persisted_ids: list[str] = []

    for update in updates:
        update_type = update.get("updateType") or update.get("update_type", "rule")
        title = update.get("title", "Untitled update")
        description = update.get("description", "")
        reason = update.get("reason") or None
        applicability_type = update.get("applicabilityType") or update.get("applicability_type", "durable")
        start_at = update.get("startAt") or update.get("start_at") or None
        end_at = update.get("endAt") or update.get("end_at") or None
        applies_while = update.get("appliesWhile") or update.get("applies_while") or None
        applies_to_programme_phase = (
            update.get("appliesToProgrammePhase") or update.get("applies_to_programme_phase") or None
        )
        workout_type = update.get("workoutType") or update.get("workout_type") or None
        exercise_name = update.get("exerciseName") or update.get("exercise_name") or None
        exercise_family = update.get("exerciseFamily") or update.get("exercise_family") or None
        confidence = float(update.get("confidence", 0.0))
        rule_key = update.get("ruleKey") or update.get("rule_key") or None

        # Generate rule_key from title if not provided
        if not rule_key:
            rule_key = _rule_key_from_text(title)

        # Always persist as proposed; apply_program_updates handles the
        # applied transition and canonical-state rebuild.
        status = "proposed"
        applied_at = None

        row = {
            "telegram_user_id": user_id,
            "update_type": update_type,
            "status": status,
            "title": title,
            "description": description,
            "reason": reason,
            "applicability_type": applicability_type,
            "start_at": start_at,
            "end_at": end_at,
            "applies_while": applies_while,
            "applies_to_programme_phase": applies_to_programme_phase,
            "workout_type": workout_type,
            "exercise_name": exercise_name,
            "exercise_family": exercise_family,
            "confidence": confidence,
            "rule_key": rule_key,
            "provenance_json": provenance,
            "extracted_payload": update,
            "applied_at": applied_at,
        }

        try:
            result = db._post("program_updates", row, prefer="return=representation")
            if result and isinstance(result, list) and result[0].get("id"):
                persisted_ids.append(result[0]["id"])
                logger.debug(
                    "Persisted update id=%s status=%s rule_key=%s",
                    result[0]["id"], status, rule_key,
                )
        except Exception:
            logger.exception(
                "Failed to persist update for user %s: title=%r", user_id, title
            )

    return persisted_ids


def _log_change(
    db: CoachingDB,
    user_id: int,
    source_update_id: Optional[str],
    change_type: str,
    before: Optional[dict],
    after: Optional[dict],
) -> None:
    """Write one row to program_change_log. Swallows all exceptions."""
    try:
        db._post(
            "program_change_log",
            {
                "telegram_user_id": user_id,
                "source_update_id": source_update_id,
                "change_type": change_type,
                "before_json": before,
                "after_json": after,
                "applied_by": "system",
            },
            prefer="return=minimal",
        )
    except Exception:
        logger.exception(
            "Failed to write change_log for user %s change_type=%s", user_id, change_type
        )


def apply_program_updates(user_id: int, update_ids: list[str]) -> list[str]:
    """
    Step 5 — transition proposed updates to 'applied', handling conflicts.

    For each update_id:
      - Skip if already applied (log the fact).
      - Find conflicts: same update_type + same workout_type (if set) + same rule_key
        → mark those as superseded.
      - Duplicate check: if the same rule_key already has an applied row → mark
        the new one inactive and skip (avoids duplicate active rules).
      - Apply: PATCH status=applied, applied_at=now.
      - Write to program_change_log.

    After all updates applied: rebuild canonical state.
    Returns list of applied IDs.
    """
    db = _get_db()
    applied_ids: list[str] = []
    now = _now_iso()

    for update_id in update_ids:
        try:
            # Fetch the target row
            rows = db._get(
                "program_updates",
                {
                    "id": f"eq.{update_id}",
                    "telegram_user_id": f"eq.{user_id}",
                },
            )
            if not rows:
                logger.warning("apply_program_updates: id=%s not found for user %s", update_id, user_id)
                continue

            row = rows[0]
            if row.get("status") == "applied":
                logger.info("apply_program_updates: id=%s already applied, skipping.", update_id)
                _log_change(db, user_id, update_id, "already_applied", None, None)
                continue

            update_type = row.get("update_type")
            rule_key = row.get("rule_key")
            workout_type = row.get("workout_type")

            # ── Duplicate check ───────────────────────────────────────────────
            # If an applied row with the same rule_key already exists, mark the
            # incoming row as inactive and skip — we don't want duplicate active
            # rules for the same logical concern.
            if rule_key:
                existing_params = {
                    "telegram_user_id": f"eq.{user_id}",
                    "rule_key": f"eq.{rule_key}",
                    "status": "eq.applied",
                    "id": f"neq.{update_id}",
                }
                existing_applied = db._get("program_updates", existing_params)
                if existing_applied:
                    logger.info(
                        "apply_program_updates: rule_key=%r already active, marking id=%s inactive.",
                        rule_key, update_id,
                    )
                    db._patch(
                        "program_updates",
                        {"id": f"eq.{update_id}", "telegram_user_id": f"eq.{user_id}"},
                        {"status": "inactive", "updated_at": now},
                    )
                    _log_change(
                        db, user_id, update_id, "duplicate_skipped",
                        row, {"status": "inactive"},
                    )
                    continue

            # ── Conflict resolution ───────────────────────────────────────────
            # Supersede any other applied row that shares update_type + rule_key
            # (and workout_type if relevant).
            if rule_key:
                conflict_params = {
                    "telegram_user_id": f"eq.{user_id}",
                    "update_type": f"eq.{update_type}",
                    "rule_key": f"eq.{rule_key}",
                    "status": "eq.applied",
                    "id": f"neq.{update_id}",
                }
                if workout_type:
                    conflict_params["workout_type"] = f"eq.{workout_type}"

                conflicts = db._get("program_updates", conflict_params)
                for conflict in conflicts:
                    conflict_id = conflict["id"]
                    logger.info(
                        "apply_program_updates: superseding id=%s with id=%s (rule_key=%r)",
                        conflict_id, update_id, rule_key,
                    )
                    db._patch(
                        "program_updates",
                        {"id": f"eq.{conflict_id}", "telegram_user_id": f"eq.{user_id}"},
                        {
                            "status": "superseded",
                            "superseded_by": update_id,
                            "updated_at": now,
                        },
                    )
                    _log_change(
                        db, user_id, conflict_id, "superseded",
                        conflict, {"status": "superseded", "superseded_by": update_id},
                    )

            # ── Apply ─────────────────────────────────────────────────────────
            db._patch(
                "program_updates",
                {"id": f"eq.{update_id}", "telegram_user_id": f"eq.{user_id}"},
                {"status": "applied", "applied_at": now, "updated_at": now},
            )
            _log_change(
                db, user_id, update_id, "applied",
                {"status": row.get("status")},
                {"status": "applied", "applied_at": now},
            )
            applied_ids.append(update_id)
            logger.info("apply_program_updates: applied id=%s rule_key=%r", update_id, rule_key)

        except Exception:
            logger.exception(
                "apply_program_updates: unexpected error for update_id=%s user=%s",
                update_id, user_id,
            )

    # Rebuild canonical state if any update_ids were processed — covers the
    # case where all candidates were duplicates (already-applied rows exist
    # but state was never assembled due to earlier bugs).
    if update_ids:
        try:
            build_canonical_state(user_id)
        except Exception:
            logger.exception("build_canonical_state failed for user %s", user_id)

    return applied_ids


def build_canonical_state(user_id: int) -> dict:
    """
    Step 6 — assemble and upsert program_state from all applied program_updates.

    Returns the assembled state_json dict.
    """
    db = _get_db()
    now = _now_iso()

    applied_updates = db._get(
        "program_updates",
        {
            "telegram_user_id": f"eq.{user_id}",
            "status": "eq.applied",
            "order": "applied_at.asc",
        },
    )

    # Deduplicate: if multiple applied rows share the same rule_key, keep only
    # the most recently applied one (applied_at desc, then id for stability).
    seen_rule_keys: set[str] = set()
    deduped_updates: list[dict] = []
    for u in sorted(
        applied_updates,
        key=lambda x: (x.get("applied_at") or "", x.get("id") or ""),
        reverse=True,
    ):
        rk = u.get("rule_key")
        if rk and rk in seen_rule_keys:
            continue
        if rk:
            seen_rule_keys.add(rk)
        deduped_updates.append(u)

    active_rules: list[dict] = []
    active_constraints: list[dict] = []
    coaching_updates: list[dict] = []
    priorities: list[str] = []

    for u in deduped_updates:
        update_type = u.get("update_type", "")
        base = {
            "id": u.get("id"),
            "rule_key": u.get("rule_key"),
            "text": u.get("description") or u.get("title", ""),
            "title": u.get("title"),
            "applicability_type": u.get("applicability_type", "durable"),
            "workout_type": u.get("workout_type"),
            "exercise_name": u.get("exercise_name"),
            "exercise_family": u.get("exercise_family"),
            "applies_while": u.get("applies_while"),
            "applies_to_programme_phase": u.get("applies_to_programme_phase"),
            "start_at": u.get("start_at"),
            "end_at": u.get("end_at"),
            "applied_at": u.get("applied_at"),
            "update_type": update_type,
        }

        if update_type == "rule":
            active_rules.append(base)
        elif update_type == "constraint":
            active_constraints.append(base)
        elif update_type == "priority_change":
            if u.get("title"):
                priorities.append(u["title"])
        else:
            coaching_updates.append(base)

    # Read current version (increment it)
    existing_state_row = db._get_one(
        "program_state",
        {"telegram_user_id": f"eq.{user_id}"},
    )
    current_version = existing_state_row.get("version", 0) if existing_state_row else 0

    state_json = {
        "active_rules": active_rules,
        "active_constraints": active_constraints,
        "coaching_updates": coaching_updates,
        "priorities": priorities,
        "state_metadata": {
            "version": current_version + 1,
            "last_rebuilt_at": now,
            "applied_update_count": len(applied_updates),
        },
    }

    if existing_state_row:
        db._patch(
            "program_state",
            {"telegram_user_id": f"eq.{user_id}"},
            {
                "state_json": state_json,
                "version": current_version + 1,
                "updated_at": now,
            },
        )
    else:
        db._post(
            "program_state",
            {
                "telegram_user_id": user_id,
                "state_json": state_json,
                "version": 1,
            },
            prefer="return=minimal",
        )

    logger.info(
        "build_canonical_state: user=%s version=%s rules=%d constraints=%d other=%d",
        user_id,
        current_version + 1,
        len(active_rules),
        len(active_constraints),
        len(coaching_updates),
    )
    return state_json


def get_canonical_state(user_id: int) -> dict:
    """
    Read and return program_state.state_json for the user.
    Returns {} if no state has been assembled yet.
    """
    db = _get_db()
    row = db._get_one(
        "program_state",
        {"telegram_user_id": f"eq.{user_id}"},
    )
    if row and isinstance(row.get("state_json"), dict):
        return row["state_json"]
    return {}


def get_debug_info(user_id: int) -> dict:
    """
    Return a debug payload with:
      - canonical_state: current program_state.state_json
      - active_updates: all applied program_updates
      - recent_changes: last 20 program_change_log rows
    """
    db = _get_db()

    canonical_state = get_canonical_state(user_id)

    active_updates = db._get(
        "program_updates",
        {
            "telegram_user_id": f"eq.{user_id}",
            "status": "eq.applied",
            "order": "applied_at.desc",
        },
    )

    recent_changes = db._get(
        "program_change_log",
        {
            "telegram_user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": "20",
        },
    )

    return {
        "canonical_state": canonical_state,
        "active_updates": active_updates,
        "recent_changes": recent_changes,
    }


def process_conversation(
    user_id: int,
    messages: list[dict],
    conversation_id: str = None,
) -> dict:
    """
    Orchestrate the full coaching update pipeline for one conversation snapshot.

    Steps:
      1. Classify — should we update?
      2. Retrieve current program context.
      3. Extract structured updates.
      4. Persist proposed updates.
      5. Apply auto-apply-eligible updates.
      6. Rebuild canonical state (triggered inside apply_program_updates).

    Always returns a result dict — never raises (this runs in background).
    """
    result: dict = {
        "updated": False,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "classification": None,
        "proposed_count": 0,
        "applied_count": 0,
        "error": None,
    }

    try:
        # ── Step 1: classify ──────────────────────────────────────────────────
        classification = classify_coaching_update(messages, user_id)
        result["classification"] = classification

        if not classification.get("should_update"):
            result["reason"] = f"Classifier says no update: {classification.get('rationale', '')}"
            logger.info(
                "process_conversation: user=%s no update — %s",
                user_id, classification.get("rationale"),
            )
            return result

        if classification.get("confidence", 0.0) < CLASSIFIER_CONFIDENCE_THRESHOLD:
            result["reason"] = (
                f"Classifier confidence {classification['confidence']:.2f} below threshold "
                f"{CLASSIFIER_CONFIDENCE_THRESHOLD}"
            )
            logger.info("process_conversation: user=%s low confidence %.2f, skipping.", user_id, classification.get("confidence", 0.0))
            return result

        # ── Step 2: retrieve context ──────────────────────────────────────────
        program_context = retrieve_program_context(user_id)

        # ── Step 3: extract ───────────────────────────────────────────────────
        extraction = extract_coaching_updates(messages, program_context, user_id)
        updates = extraction.get("updates", [])

        if not updates:
            result["reason"] = "Extractor returned no updates."
            logger.info("process_conversation: user=%s extractor returned empty.", user_id)
            return result

        # ── Step 4: persist ───────────────────────────────────────────────────
        provenance = {
            "conversation_id": conversation_id,
            "message_count": len(messages),
            "classifier_confidence": classification.get("confidence"),
            "update_scope_hint": classification.get("update_scope_hint"),
            "extracted_at": _now_iso(),
        }
        persisted_ids = persist_proposed_updates(updates, user_id, provenance)
        result["proposed_count"] = len(persisted_ids)

        if not persisted_ids:
            result["reason"] = "No updates were persisted (DB errors?)."
            return result

        # ── Step 5: apply auto-apply updates ──────────────────────────────────
        # Only attempt to apply those that were stored as 'applied' status
        # OR those that pass both thresholds and are in AUTO_APPLY_TYPES.
        # apply_program_updates handles the actual state transition, conflict
        # resolution, and canonical state rebuild.
        classifier_confident = (
            classification.get("confidence", 0.0) >= CLASSIFIER_CONFIDENCE_THRESHOLD
        )

        # Build candidate list: IDs where the update qualifies for auto-apply
        auto_apply_candidates: list[str] = []
        for upd, uid_str in zip(updates, persisted_ids):
            update_type = upd.get("updateType") or upd.get("update_type", "")
            upd_confidence = float(upd.get("confidence", 0.0))
            if (
                classifier_confident
                and upd_confidence >= EXTRACTOR_CONFIDENCE_THRESHOLD
                and update_type in AUTO_APPLY_TYPES
            ):
                auto_apply_candidates.append(uid_str)

        if not auto_apply_candidates:
            logger.info(
                "process_conversation: user=%s %d update(s) persisted but none qualify for auto-apply "
                "(types: %s)",
                user_id, len(persisted_ids),
                [u.get("updateType") or u.get("update_type") for u in updates],
            )

        applied_ids = apply_program_updates(user_id, auto_apply_candidates)
        result["applied_count"] = len(applied_ids)
        result["updated"] = len(applied_ids) > 0

        logger.info(
            "process_conversation: user=%s proposed=%d applied=%d",
            user_id, len(persisted_ids), len(applied_ids),
        )

    except Exception as exc:
        logger.exception("process_conversation: unhandled error for user %s", user_id)
        result["error"] = str(exc)

    return result
