import json
import logging
from datetime import datetime, timedelta
from typing import Optional

import gspread
from google.oauth2.service_account import Credentials

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

SETS_COLS = [
    "session_id", "date", "exercise", "set_num", "weight_kg", "reps",
    "rpe", "rir", "note", "note_type", "injury_flag", "injury_body_part",
    "extras", "telegram_message_id",
]

SESSIONS_COLS = ["session_id", "date", "overall_note", "duration_mins", "session_type", "cardio_flag", "abs_flag"]

CYCLES_COLS = ["cycle_id", "start_date", "end_date", "goals", "workout_plan", "status"]

PROFILE_FIELDS = [
    "height_cm", "weight_kg", "age", "sex",
    "experience_years", "experience_level",
    "training_notes", "chronic_injuries", "equipment",
]


class GymSheets:
    def __init__(self, credentials_path: str, sheet_name: str):
        creds = Credentials.from_service_account_file(credentials_path, scopes=SCOPES)
        gc = gspread.authorize(creds)
        sh = gc.open(sheet_name)
        self.sets_ws = sh.worksheet("Sets")
        self.sessions_ws = sh.worksheet("Sessions")
        self.cycles_ws = sh.worksheet("Cycles")
        try:
            self.profile_ws = sh.worksheet("Profile")
        except gspread.exceptions.WorksheetNotFound:
            self.profile_ws = sh.add_worksheet(title="Profile", rows=20, cols=2)
            self.profile_ws.append_row(["key", "value"])

    # ── Profile ───────────────────────────────────────────────────────────

    def fetch_profile(self) -> dict:
        """Return profile as {key: value} dict."""
        records = self.profile_ws.get_all_records()
        return {str(r["key"]): str(r["value"]) for r in records if r.get("key") and r.get("value")}

    def update_profile(self, updates: dict):
        """Upsert key-value pairs into the Profile sheet."""
        all_values = self.profile_ws.get_all_values()
        key_to_row = {
            row[0]: i
            for i, row in enumerate(all_values[1:], start=2)
            if row and row[0]
        }
        for key, value in updates.items():
            if not value:
                continue
            if key in key_to_row:
                self.profile_ws.update_cell(key_to_row[key], 2, str(value))
            else:
                self.profile_ws.append_row([key, str(value)])

    # ── Sets ──────────────────────────────────────────────────────────────

    def append_sets(self, rows: list[dict]):
        for row in rows:
            values = []
            for col in SETS_COLS:
                v = row.get(col, "")
                if col == "extras" and isinstance(v, dict):
                    v = json.dumps(v)
                values.append("" if v is None else str(v))
            self.sets_ws.append_row(values, value_input_option="USER_ENTERED")

    def delete_rows_by_message_id(self, message_id: int):
        """Delete all set rows logged under a given Telegram message ID."""
        all_values = self.sets_ws.get_all_values()
        # telegram_message_id is column index 13 (0-based), skipping header row
        indices_to_delete = [
            i
            for i, row in enumerate(all_values[1:], start=2)
            if len(row) >= 14 and row[13] == str(message_id)
        ]
        for idx in sorted(indices_to_delete, reverse=True):
            self.sets_ws.delete_rows(idx)

    # ── Sessions ──────────────────────────────────────────────────────────

    def append_session(self, row: dict):
        values = [
            "" if row.get(col) is None else str(row.get(col, ""))
            for col in SESSIONS_COLS
        ]
        self.sessions_ws.append_row(values, value_input_option="USER_ENTERED")

    # ── Cycles ────────────────────────────────────────────────────────────

    def append_cycle(self, row: dict):
        values = [
            "" if row.get(col) is None else str(row.get(col, ""))
            for col in CYCLES_COLS
        ]
        self.cycles_ws.append_row(values, value_input_option="USER_ENTERED")

    def fetch_active_cycle(self) -> Optional[dict]:
        records = self.cycles_ws.get_all_records(expected_headers=CYCLES_COLS)
        for r in records:
            if r.get("status") == "active":
                return r
        return None

    def complete_cycle(self, cycle_id: str):
        """Mark a cycle as complete by updating its status cell."""
        all_values = self.cycles_ws.get_all_values()
        for i, row in enumerate(all_values[1:], start=2):
            if row and row[0] == cycle_id:
                # status is column 6 (1-based) = index 5 (0-based)
                self.cycles_ws.update_cell(i, 6, "complete")
                return

    # ── Session classification support ────────────────────────────────────

    def fetch_session_exercises(self, session_id: str) -> list[str]:
        """Return ordered unique exercise names for a session (preserves log order)."""
        records = self.sets_ws.get_all_records(expected_headers=SETS_COLS)
        seen: list[str] = []
        for r in records:
            if str(r.get("session_id", "")) == session_id:
                ex = str(r.get("exercise", "")).strip()
                if ex and ex not in seen:
                    seen.append(ex)
        return seen

    # ── Session data ──────────────────────────────────────────────────────

    def fetch_session_sets(self, session_id: str) -> list[dict]:
        """Return all sets logged in the given session, ordered by set_num."""
        records = self.sets_ws.get_all_records(expected_headers=SETS_COLS)
        rows = [r for r in records if str(r.get("session_id", "")) == session_id]
        rows.sort(key=lambda x: (str(x.get("exercise", "")), int(x.get("set_num") or 0)))
        return rows

    def find_orphaned_session(self, date_str: str) -> Optional[str]:
        """Return a session_id from Sets that has no matching Sessions row on date_str."""
        sets_records = self.sets_ws.get_all_records(expected_headers=SETS_COLS)
        sessions_records = self.sessions_ws.get_all_records(expected_headers=SESSIONS_COLS)
        recorded_sids = {str(r.get("session_id", "")) for r in sessions_records}
        for r in sets_records:
            if str(r.get("date", "")) == date_str:
                sid = str(r.get("session_id", ""))
                if sid and sid not in recorded_sids:
                    return sid
        return None

    def delete_rows_by_session_and_exercise(self, session_id: str, exercise_name: str):
        """Delete all sets for a specific exercise in a session (case-insensitive)."""
        all_values = self.sets_ws.get_all_values()
        ex_lower = exercise_name.lower()
        # session_id = col 0 (index 0), exercise = col 2 (index 2)
        indices_to_delete = [
            i
            for i, row in enumerate(all_values[1:], start=2)
            if len(row) >= 3 and row[0] == session_id and row[2].lower() == ex_lower
        ]
        for idx in sorted(indices_to_delete, reverse=True):
            self.sets_ws.delete_rows(idx)

    # ── Exercise lookup ───────────────────────────────────────────────────

    def fetch_exercise_names(self) -> set[str]:
        """Return all unique exercise names from the Sets tab."""
        records = self.sets_ws.get_all_records(expected_headers=SETS_COLS)
        return {str(r.get("exercise", "")).strip() for r in records if r.get("exercise")}

    def fetch_exercise_sessions(
        self, exercise_name: str, max_sessions: int = 10
    ) -> list[dict]:
        """Return sets for the last N sessions that included the given exercise.

        Matching is case-insensitive substring — 'bench' matches 'Bench Press'.
        Results are ordered oldest-first so the caller can render chronologically.
        """
        all_sets = self.sets_ws.get_all_records(expected_headers=SETS_COLS)
        ex_lower = exercise_name.lower()

        matching = [
            s for s in all_sets
            if ex_lower in str(s.get("exercise", "")).lower()
        ]
        if not matching:
            return []

        # Identify the most-recent N distinct sessions
        sessions_by_date: dict[str, str] = {}  # session_id → date
        for s in matching:
            sid = str(s.get("session_id", ""))
            sessions_by_date[sid] = str(s.get("date", ""))

        recent_sids = {
            sid
            for sid, _ in sorted(
                sessions_by_date.items(), key=lambda x: x[1], reverse=True
            )[:max_sessions]
        }

        result = [s for s in matching if str(s.get("session_id", "")) in recent_sids]
        result.sort(
            key=lambda x: (str(x.get("date", "")), int(x.get("set_num") or 0))
        )
        return result

    # ── History fetch ─────────────────────────────────────────────────────

    def fetch_recent_data(self, days: int = 90) -> tuple[list[dict], list[dict]]:
        cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        sets_raw = self.sets_ws.get_all_records(expected_headers=SETS_COLS)
        sessions_raw = self.sessions_ws.get_all_records(expected_headers=SESSIONS_COLS)
        recent_sets = [r for r in sets_raw if str(r.get("date", "")) >= cutoff]
        recent_sessions = [r for r in sessions_raw if str(r.get("date", "")) >= cutoff]
        return recent_sets, recent_sessions


# ── Formatting helpers ─────────────────────────────────────────────────────────

def format_history_for_prompt(sets: list[dict], sessions: list[dict]) -> str:
    if not sets and not sessions:
        return "No workout data in the last 90 days."

    # Group sets by session_id
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
            injury = (
                f" [INJURY: {s.get('injury_body_part')}]"
                if str(s.get("injury_flag", "")).lower() == "true"
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
