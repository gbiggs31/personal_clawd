"""
One-shot migration: Google Sheets → Supabase.

Run once from the project root after setting up your .env:
    python migrate_to_supabase.py

Safe to re-run — duplicate rows are skipped.
"""

import json
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()

# ── Credentials ───────────────────────────────────────────────────────────────

GOOGLE_CREDS = os.environ.get("GOOGLE_SHEETS_CREDENTIALS", "service_account.json")
GOOGLE_SHEET = os.environ.get("GOOGLE_SHEETS_NAME", "The Claw Gym Log")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("ERROR: Set SUPABASE_URL and SUPABASE_KEY in your .env file first.")

BASE = SUPABASE_URL.rstrip("/") + "/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


def insert(table: str, data: dict) -> str:
    """Returns 'ok', 'skip' (duplicate), or 'error'."""
    r = requests.post(f"{BASE}/{table}", headers=HEADERS, json=data)
    if r.ok:
        return "ok"
    body = r.text.lower()
    if "duplicate" in body or "unique" in body or r.status_code == 409:
        return "skip"
    print(f"  ERROR {r.status_code}: {r.text[:200]}")
    return "error"


# ── Google Sheets client ──────────────────────────────────────────────────────

import gspread
from google.oauth2.service_account import Credentials

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

print("Connecting to Google Sheets...")
creds = Credentials.from_service_account_file(GOOGLE_CREDS, scopes=SCOPES)
gc    = gspread.authorize(creds)
sh    = gc.open(GOOGLE_SHEET)

# ── Column lists ──────────────────────────────────────────────────────────────

SETS_COLS     = ["session_id","date","exercise","set_num","weight_kg","reps",
                 "rpe","rir","note","note_type","injury_flag","injury_body_part",
                 "extras","telegram_message_id"]
SESSIONS_COLS = ["session_id","date","overall_note","duration_mins",
                 "session_type","cardio_flag","abs_flag"]
CYCLES_COLS   = ["cycle_id","start_date","end_date","goals","workout_plan","status"]


# ── Type coercions ────────────────────────────────────────────────────────────

def _bool(val) -> bool:
    return str(val).strip().lower() in ("true", "1", "yes")

def _int(val):
    try:    return int(val)
    except: return None

def _float(val):
    try:    return float(val)
    except: return None

def _str(val):
    s = str(val).strip()
    return s if s else None

def _json(val):
    if isinstance(val, dict): return val
    try:    return json.loads(val) if val else None
    except: return None


# ── Migrate sets ──────────────────────────────────────────────────────────────

print("\nMigrating Sets...")
sets_raw = sh.worksheet("Sets").get_all_records(expected_headers=SETS_COLS)

ok = skip = err = 0
for r in sets_raw:
    if not r.get("session_id") or not r.get("exercise"):
        skip += 1
        continue
    result = insert("sets", {
        "session_id":          _str(r.get("session_id")),
        "date":                _str(r.get("date")),
        "exercise":            _str(r.get("exercise")),
        "set_num":             _int(r.get("set_num")),
        "weight_kg":           _float(r.get("weight_kg")),
        "reps":                _int(r.get("reps")),
        "rpe":                 _float(r.get("rpe")),
        "rir":                 _int(r.get("rir")),
        "note":                _str(r.get("note")),
        "note_type":           _str(r.get("note_type")),
        "injury_flag":         _bool(r.get("injury_flag", False)),
        "injury_body_part":    _str(r.get("injury_body_part")),
        "extras":              _json(r.get("extras")),
        "telegram_message_id": _int(r.get("telegram_message_id")),
    })
    if result == "ok":   ok += 1
    elif result == "skip": skip += 1
    else: err += 1

print(f"  Sets: {ok} inserted, {skip} skipped, {err} errors")


# ── Migrate sessions ──────────────────────────────────────────────────────────

print("\nMigrating Sessions...")
sessions_raw = sh.worksheet("Sessions").get_all_records(expected_headers=SESSIONS_COLS)

ok = skip = err = 0
for r in sessions_raw:
    if not r.get("session_id"):
        skip += 1
        continue
    result = insert("sessions", {
        "session_id":    _str(r.get("session_id")),
        "date":          _str(r.get("date")),
        "overall_note":  _str(r.get("overall_note")),
        "duration_mins": _int(r.get("duration_mins")),
        "session_type":  _str(r.get("session_type")),
        "cardio_flag":   _bool(r.get("cardio_flag", False)),
        "abs_flag":      _bool(r.get("abs_flag", False)),
    })
    if result == "ok":   ok += 1
    elif result == "skip": skip += 1
    else: err += 1

print(f"  Sessions: {ok} inserted, {skip} skipped, {err} errors")


# ── Migrate cycles ────────────────────────────────────────────────────────────

print("\nMigrating Cycles...")
try:
    cycles_raw = sh.worksheet("Cycles").get_all_records(expected_headers=CYCLES_COLS)
except gspread.exceptions.WorksheetNotFound:
    cycles_raw = []
    print("  No Cycles sheet found, skipping.")

ok = skip = err = 0
for r in cycles_raw:
    if not r.get("cycle_id"):
        skip += 1
        continue
    result = insert("cycles", {
        "cycle_id":     _str(r.get("cycle_id")),
        "start_date":   _str(r.get("start_date")),
        "end_date":     _str(r.get("end_date")),
        "goals":        _str(r.get("goals")),
        "workout_plan": _str(r.get("workout_plan")),
        "status":       _str(r.get("status")) or "active",
    })
    if result == "ok":   ok += 1
    elif result == "skip": skip += 1
    else: err += 1

print(f"  Cycles: {ok} inserted, {skip} skipped, {err} errors")


# ── Migrate profile ───────────────────────────────────────────────────────────

print("\nMigrating Profile...")
try:
    profile_raw = sh.worksheet("Profile").get_all_records()
except gspread.exceptions.WorksheetNotFound:
    profile_raw = []
    print("  No Profile sheet found, skipping.")

ok = skip = err = 0
for r in profile_raw:
    key   = _str(r.get("key"))
    value = _str(r.get("value"))
    if not key or not value:
        skip += 1
        continue
    upsert_headers = {**HEADERS, "Prefer": "resolution=merge-duplicates,return=minimal"}
    resp = requests.post(f"{BASE}/profile?on_conflict=key", headers=upsert_headers,
                         json={"key": key, "value": value})
    if resp.ok: ok += 1
    else:
        print(f"  WARN profile key '{key}': {resp.text[:100]}")
        err += 1

print(f"  Profile: {ok} upserted, {skip} skipped, {err} errors")


# ── Done ──────────────────────────────────────────────────────────────────────

print("\nMigration complete.")
