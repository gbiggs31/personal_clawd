import logging
from datetime import datetime, timedelta
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_LIMIT = 10_000  # max rows per request (personal log, will never hit this)


class GymDB:
    """Supabase PostgREST data layer — multi-user, no supabase-py dependency."""

    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    # ── Internal helpers ───────────────────────────────────────────────────

    def _get(self, table: str, params: dict = None) -> list[dict]:
        p = {"limit": _LIMIT, **(params or {})}
        r = requests.get(f"{self.base}/{table}", headers=self.headers, params=p)
        r.raise_for_status()
        return r.json()

    def _post(self, table: str, data: dict, prefer: str = "return=minimal"):
        r = requests.post(
            f"{self.base}/{table}",
            headers={**self.headers, "Prefer": prefer},
            json=data,
        )
        r.raise_for_status()

    def _delete(self, table: str, params: dict):
        r = requests.delete(f"{self.base}/{table}", headers=self.headers, params=params)
        r.raise_for_status()

    def _patch(self, table: str, params: dict, data: dict):
        r = requests.patch(
            f"{self.base}/{table}",
            headers={**self.headers, "Prefer": "return=minimal"},
            params=params,
            json=data,
        )
        r.raise_for_status()

    # ── Sets ──────────────────────────────────────────────────────────────

    def append_sets(self, rows: list[dict], user_id: int):
        for row in rows:
            extras = row.get("extras")
            data = {
                "telegram_user_id":    user_id,
                "session_id":          row.get("session_id"),
                "date":                row.get("date"),
                "exercise":            row.get("exercise"),
                "set_num":             row.get("set_num") or None,
                "weight_kg":           row.get("weight_kg") or None,
                "reps":                row.get("reps") or None,
                "rpe":                 row.get("rpe") or None,
                "rir":                 row.get("rir") or None,
                "note":                row.get("note") or None,
                "note_type":           row.get("note_type") or None,
                "injury_flag":         bool(row.get("injury_flag", False)),
                "injury_body_part":    row.get("injury_body_part") or None,
                "extras":              extras if isinstance(extras, dict) else None,
                "telegram_message_id": row.get("telegram_message_id") or None,
            }
            self._post("sets", data)

    def delete_rows_by_message_id(self, message_id: int, user_id: int):
        self._delete("sets", {
            "telegram_message_id": f"eq.{message_id}",
            "telegram_user_id":    f"eq.{user_id}",
        })

    def delete_rows_by_session_and_exercise(self, session_id: str, exercise_name: str, user_id: int):
        self._delete("sets", {
            "telegram_user_id": f"eq.{user_id}",
            "session_id":       f"eq.{session_id}",
            "exercise":         f"ilike.{exercise_name}",
        })

    # ── Sessions ──────────────────────────────────────────────────────────

    def append_session(self, row: dict, user_id: int):
        data = {
            "telegram_user_id": user_id,
            "session_id":       row.get("session_id"),
            "date":             row.get("date"),
            "overall_note":     row.get("overall_note") or None,
            "duration_mins":    row.get("duration_mins") or None,
            "session_type":     row.get("session_type"),
            "cardio_flag":      bool(row.get("cardio_flag", False)),
            "abs_flag":         bool(row.get("abs_flag", False)),
        }
        self._post("sessions", data)

    # ── Cycles ────────────────────────────────────────────────────────────

    def append_cycle(self, row: dict, user_id: int):
        data = {
            "telegram_user_id": user_id,
            "cycle_id":         row.get("cycle_id"),
            "start_date":       row.get("start_date"),
            "end_date":         row.get("end_date"),
            "goals":            row.get("goals"),
            "workout_plan":     row.get("workout_plan"),
            "status":           row.get("status", "active"),
        }
        self._post("cycles", data)

    def fetch_active_cycle(self, user_id: int) -> Optional[dict]:
        result = self._get("cycles", {
            "telegram_user_id": f"eq.{user_id}",
            "status":           "eq.active",
        })
        return result[0] if result else None

    def complete_cycle(self, cycle_id: str, user_id: int):
        self._patch("cycles", {
            "cycle_id":         f"eq.{cycle_id}",
            "telegram_user_id": f"eq.{user_id}",
        }, {"status": "complete"})

    # ── Session helpers ───────────────────────────────────────────────────

    def fetch_session_exercises(self, session_id: str, user_id: int) -> list[str]:
        result = self._get("sets", {
            "select":           "exercise,set_num",
            "telegram_user_id": f"eq.{user_id}",
            "session_id":       f"eq.{session_id}",
            "order":            "set_num",
        })
        seen: list[str] = []
        for r in result:
            ex = str(r.get("exercise", "")).strip()
            if ex and ex not in seen:
                seen.append(ex)
        return seen

    def fetch_session_sets(self, session_id: str, user_id: int) -> list[dict]:
        return self._get("sets", {
            "telegram_user_id": f"eq.{user_id}",
            "session_id":       f"eq.{session_id}",
            "order":            "set_num",
        })

    def find_orphaned_session(self, date_str: str, user_id: int) -> Optional[str]:
        sets_result = self._get("sets", {
            "select":           "session_id",
            "telegram_user_id": f"eq.{user_id}",
            "date":             f"eq.{date_str}",
        })
        if not sets_result:
            return None
        sids_with_sets = {r["session_id"] for r in sets_result if r.get("session_id")}
        sessions_result = self._get("sessions", {
            "select":           "session_id",
            "telegram_user_id": f"eq.{user_id}",
        })
        recorded = {r["session_id"] for r in sessions_result}
        for sid in sids_with_sets:
            if sid not in recorded:
                return sid
        return None

    # ── Exercise lookup ───────────────────────────────────────────────────

    def fetch_exercise_names(self, user_id: int) -> set[str]:
        result = self._get("sets", {
            "select":           "exercise",
            "telegram_user_id": f"eq.{user_id}",
        })
        return {r["exercise"].strip() for r in result if r.get("exercise")}

    def fetch_exercise_sessions(self, exercise_name: str, user_id: int, max_sessions: int = 10) -> list[dict]:
        result = self._get("sets", {
            "telegram_user_id": f"eq.{user_id}",
            "exercise":         f"ilike.*{exercise_name}*",
        })
        if not result:
            return []

        sessions_by_date: dict[str, str] = {}
        for s in result:
            sid = str(s.get("session_id", ""))
            sessions_by_date[sid] = str(s.get("date", ""))

        recent_sids = {
            sid
            for sid, _ in sorted(sessions_by_date.items(), key=lambda x: x[1], reverse=True)[:max_sessions]
        }

        matching = [s for s in result if s.get("session_id") in recent_sids]
        matching.sort(key=lambda x: (str(x.get("date", "")), int(x.get("set_num") or 0)))
        return matching

    # ── History ───────────────────────────────────────────────────────────

    def fetch_recent_data(self, user_id: int, days: int = 90) -> tuple[list[dict], list[dict]]:
        cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        sets_result = self._get("sets", {
            "telegram_user_id": f"eq.{user_id}",
            "date":             f"gte.{cutoff}",
        })
        sessions_result = self._get("sessions", {
            "telegram_user_id": f"eq.{user_id}",
            "date":             f"gte.{cutoff}",
        })
        return sets_result, sessions_result

    # ── Profile ───────────────────────────────────────────────────────────

    def fetch_profile(self, user_id: int) -> dict:
        result = self._get("profile", {"telegram_user_id": f"eq.{user_id}"})
        return {r["key"]: r["value"] for r in result if r.get("key") and r.get("value")}

    # ── User auth ─────────────────────────────────────────────────────────────

    def get_user_status(self, telegram_user_id: int) -> Optional[str]:
        """Returns 'active', 'pending', or None if not found."""
        result = self._get("users", {
            "select":           "status",
            "telegram_user_id": f"eq.{telegram_user_id}",
        })
        return result[0]["status"] if result else None

    def create_pending_user(self, telegram_user_id: int):
        """Insert a pending user row, ignoring if already exists."""
        self._post(
            "users?on_conflict=telegram_user_id",
            {"telegram_user_id": telegram_user_id, "status": "pending"},
            prefer="resolution=ignore-duplicates,return=minimal",
        )

    def create_signup_token(self, telegram_user_id: int, token: str):
        self._post("link_tokens", {
            "telegram_user_id": telegram_user_id,
            "token":            token,
        })

    # ── Profile ───────────────────────────────────────────────────────────────

    def update_profile(self, updates: dict, user_id: int):
        for key, value in updates.items():
            if not value:
                continue
            self._post(
                "profile?on_conflict=telegram_user_id,key",
                {"telegram_user_id": user_id, "key": key, "value": str(value)},
                prefer="resolution=merge-duplicates,return=minimal",
            )


# ── Formatting helpers (shared with bot.py) ───────────────────────────────────

def format_history_for_prompt(sets: list[dict], sessions: list[dict]) -> str:
    if not sets and not sessions:
        return "No workout data in the last 90 days."

    session_sets: dict[str, list] = {}
    for s in sets:
        session_sets.setdefault(str(s.get("session_id", "")), []).append(s)

    lines = []
    for sess in sorted(sessions, key=lambda x: str(x.get("date", ""))):
        sid = str(sess.get("session_id", ""))
        duration = sess.get("duration_mins")
        dur_str = f" | {duration} mins" if duration else ""
        lines.append(f"\n[{sess.get('date')}{dur_str}]")

        if sess.get("overall_note"):
            lines.append(f"  Session note: {sess['overall_note']}")

        for s in sorted(
            session_sets.get(sid, []),
            key=lambda x: (str(x.get("exercise", "")), int(x.get("set_num") or 0)),
        ):
            injury_flag = s.get("injury_flag", False)
            injury = (
                f" [INJURY: {s.get('injury_body_part')}]"
                if (injury_flag is True or str(injury_flag).lower() == "true")
                else ""
            )
            extras_str = f" | {s['extras']}" if s.get("extras") else ""
            weight = s.get("weight_kg") or "bw"
            reps = s.get("reps") or "?"
            rpe = s.get("rpe") or "-"
            rir = s.get("rir") or "-"
            note = f" // {s['note']}" if s.get("note") else ""
            lines.append(
                f"  {s.get('exercise')} #{s.get('set_num')}: "
                f"{weight}kg × {reps} | RPE {rpe} | RIR {rir}"
                f"{extras_str}{injury}{note}"
            )

    return "\n".join(lines)


def format_cycle_for_prompt(cycle: dict) -> str:
    start = cycle.get("start_date", "?")
    end = cycle.get("end_date", "?")
    try:
        end_dt = datetime.strptime(str(end), "%Y-%m-%d")
        weeks_remaining = max(0, (end_dt - datetime.now()).days // 7)
        remaining_str = f" ({weeks_remaining} weeks remaining)"
    except (ValueError, TypeError):
        remaining_str = ""

    return (
        f"=== CURRENT TRAINING CYCLE ===\n"
        f"Start: {start} | End: {end}{remaining_str}\n"
        f"Goals: {cycle.get('goals', '')}\n\n"
        f"Program:\n{cycle.get('workout_plan', '')}"
    )
