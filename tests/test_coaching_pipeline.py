"""
Tests for coaching_pipeline.py

Uses unittest + unittest.mock only — no pytest, no external test deps.

Run with:
    python -m unittest tests/test_coaching_pipeline.py -v
or from repo root:
    python -m unittest discover -s tests -p "test_coaching_pipeline.py" -v
"""

import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch, call

# Ensure the repo root is on the path so the module import works
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Minimal env stubs so the module can be imported without real credentials ──
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")

import coaching_pipeline as cp  # noqa: E402  (import after env stubs)

# ── Helpers ───────────────────────────────────────────────────────────────────

USER_ID = 123456789


def _claude_response(text: str) -> MagicMock:
    """Build a mock anthropic response object that yields `text`."""
    content_block = MagicMock()
    content_block.text = text
    response = MagicMock()
    response.content = [content_block]
    return response


def _db_get_stub(rows_by_table: dict):
    """
    Return a side_effect callable for CoachingDB._get that dispatches on the
    `table` positional argument.

    rows_by_table: {"table_name": [row, ...], ...}
    """
    def _side_effect(table, params=None):
        return rows_by_table.get(table, [])
    return _side_effect


def _db_post_stub(captured: list):
    """Capture every _post call's data argument into `captured`."""
    def _side_effect(table, data, prefer="return=representation"):
        row = {**data, "id": f"fake-uuid-{len(captured)}"}
        captured.append({"table": table, "data": data, "prefer": prefer})
        if "representation" in prefer:
            return [row]
        return None
    return _side_effect


def _db_patch_stub(captured: list):
    """Capture every _patch call into `captured`."""
    def _side_effect(table, params, data, prefer="return=minimal"):
        captured.append({"table": table, "params": params, "data": data})
        return None
    return _side_effect


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestClassifyDurableUpdate(unittest.TestCase):
    """Test 1 — classifier identifies a genuine durable update."""

    def setUp(self):
        self.messages = [
            {"role": "user", "content": "Bicep curls before rows hurt my elbow."},
            {"role": "assistant", "content": "That's bicep pre-fatigue — I'd cut it."},
            {"role": "user", "content": "Yeah let's stop doing that permanently."},
            {"role": "assistant", "content": "Agreed. No bicep pre-fatigue before pull compounds from now on."},
        ]

    @patch("coaching_pipeline.anthropic.Anthropic")
    def test_classify_durable_update(self, MockAnthropic):
        payload = json.dumps({
            "should_update": True,
            "confidence": 0.9,
            "rationale": "Agreed to stop bicep pre-fatigue",
            "update_scope_hint": "durable",
        })
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _claude_response(payload)
        MockAnthropic.return_value = mock_client

        result = cp.classify_coaching_update(self.messages, USER_ID)

        self.assertTrue(result["should_update"])
        self.assertAlmostEqual(result["confidence"], 0.9)
        self.assertEqual(result["update_scope_hint"], "durable")
        mock_client.messages.create.assert_called_once()


class TestClassifyNoUpdateGenericChat(unittest.TestCase):
    """Test 2 — classifier correctly rejects generic encouragement."""

    def setUp(self):
        self.messages = [
            {"role": "user", "content": "Great session today!"},
            {"role": "assistant", "content": "Well done, you smashed it!"},
            {"role": "user", "content": "Felt really strong."},
            {"role": "assistant", "content": "Keep it up, consistency is key."},
        ]

    @patch("coaching_pipeline.anthropic.Anthropic")
    def test_classify_no_update_generic_chat(self, MockAnthropic):
        payload = json.dumps({
            "should_update": False,
            "confidence": 0.95,
            "rationale": "Generic encouragement",
            "update_scope_hint": "none",
        })
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _claude_response(payload)
        MockAnthropic.return_value = mock_client

        result = cp.classify_coaching_update(self.messages, USER_ID)

        self.assertFalse(result["should_update"])
        self.assertEqual(result["update_scope_hint"], "none")


class TestClassifyTooShort(unittest.TestCase):
    """Test 3 — classifier returns early without calling Claude for short convs."""

    @patch("coaching_pipeline.anthropic.Anthropic")
    def test_classify_too_short(self, MockAnthropic):
        messages = [
            {"role": "user", "content": "Hi."},
            {"role": "assistant", "content": "Hey!"},
        ]
        # Claude must NOT be called
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client

        result = cp.classify_coaching_update(messages, USER_ID)

        self.assertFalse(result["should_update"])
        self.assertIn("short", result["rationale"].lower())
        mock_client.messages.create.assert_not_called()


class TestExtractRuleAndOrderChange(unittest.TestCase):
    """Test 4 — extractor returns two updates: a rule and an exercise_order_change."""

    def setUp(self):
        self.messages = [
            {"role": "user", "content": "Should I bench before OHP?"},
            {"role": "assistant", "content": "Yes — bench first, always."},
            {"role": "user", "content": "And no pre-fatigue biceps before rows."},
            {"role": "assistant", "content": "Correct, remove that going forward."},
        ]
        self.program_context = {"state_json": {}, "active_updates": []}

    @patch("coaching_pipeline.anthropic.Anthropic")
    def test_extract_rule_and_order_change(self, MockAnthropic):
        payload = json.dumps({
            "updates": [
                {
                    "updateType": "rule",
                    "title": "No bicep pre-fatigue before pull compounds",
                    "description": "Avoid bicep curls immediately before rows or pull-downs.",
                    "reason": "Causes elbow fatigue that weakens pull strength.",
                    "applicabilityType": "durable",
                    "startAt": None,
                    "endAt": None,
                    "appliesWhile": None,
                    "appliesToProgrammePhase": None,
                    "workoutType": "Pull",
                    "exerciseName": None,
                    "exerciseFamily": "Pull",
                    "ruleKey": "no_bicep_prefatigue_before_pull_compounds",
                    "confidence": 0.92,
                    "evidenceSummary": "no pre-fatigue biceps before rows",
                    "patch": {"remove": "bicep_prefatigue"},
                },
                {
                    "updateType": "exercise_order_change",
                    "title": "Bench before OHP",
                    "description": "Always perform Bench Press before Overhead Press on push days.",
                    "reason": "Better strength output when fresh.",
                    "applicabilityType": "durable",
                    "startAt": None,
                    "endAt": None,
                    "appliesWhile": None,
                    "appliesToProgrammePhase": None,
                    "workoutType": "Push",
                    "exerciseName": None,
                    "exerciseFamily": "Press",
                    "ruleKey": "bench_before_ohp",
                    "confidence": 0.88,
                    "evidenceSummary": "bench before OHP",
                    "patch": {"order": ["bench_press", "overhead_press"]},
                },
            ]
        })
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _claude_response(payload)
        MockAnthropic.return_value = mock_client

        result = cp.extract_coaching_updates(self.messages, self.program_context, USER_ID)

        updates = result.get("updates", [])
        self.assertEqual(len(updates), 2)
        first = updates[0]
        self.assertEqual(first["updateType"], "rule")
        self.assertIn("ruleKey", first)
        self.assertEqual(first["ruleKey"], "no_bicep_prefatigue_before_pull_compounds")


class TestApplyDeactivatesConflictingRule(unittest.TestCase):
    """Test 5 — applying an update supersedes a conflicting applied rule."""

    def test_apply_deactivates_conflicting_rule(self):
        new_update_id = "new-uuid-001"
        old_update_id = "old-uuid-999"

        existing_applied = [{
            "id": old_update_id,
            "telegram_user_id": USER_ID,
            "update_type": "rule",
            "status": "applied",
            "rule_key": "no_bicep_prefatigue_before_pull_compounds",
            "workout_type": "Pull",
            "title": "Old version of rule",
            "description": "Old description",
        }]

        new_row = {
            "id": new_update_id,
            "telegram_user_id": USER_ID,
            "update_type": "rule",
            "status": "proposed",
            "rule_key": "no_bicep_prefatigue_before_pull_compounds",
            "workout_type": "Pull",
            "title": "Updated rule",
            "description": "No bicep pre-fatigue — updated",
        }

        patch_calls: list = []
        post_calls: list = []

        def _get_side(table, params=None):
            if table == "program_updates":
                # First call: fetch the new row by id
                if params and params.get("id") == f"eq.{new_update_id}":
                    return [new_row]
                # Duplicate check: look for applied with same rule_key (excluding new id)
                if (params and params.get("status") == "eq.applied"
                        and params.get("rule_key") == f"eq.{new_row['rule_key']}"
                        and params.get("id") == f"neq.{new_update_id}"
                        and "update_type" not in params):
                    return []  # No duplicate — allow apply to proceed
                # Conflict resolution: look for applied with same type+key+workout_type
                if (params and params.get("status") == "eq.applied"
                        and params.get("update_type") == f"eq.{new_row['update_type']}"
                        and params.get("rule_key") == f"eq.{new_row['rule_key']}"
                        and params.get("id") == f"neq.{new_update_id}"):
                    return existing_applied
                return []
            if table == "program_state":
                return []
            return []

        with patch.object(cp.CoachingDB, "_get", side_effect=_get_side), \
             patch.object(cp.CoachingDB, "_get_one", side_effect=lambda table, params=None: None), \
             patch.object(cp.CoachingDB, "_patch", side_effect=lambda t, p, d, prefer="return=minimal": patch_calls.append({"table": t, "params": p, "data": d})), \
             patch.object(cp.CoachingDB, "_post", side_effect=lambda t, d, prefer="return=minimal": post_calls.append({"table": t, "data": d})), \
             patch("coaching_pipeline.build_canonical_state", return_value={}):

            applied = cp.apply_program_updates(USER_ID, [new_update_id])

        # The new update should be applied
        self.assertIn(new_update_id, applied)

        # Check that a patch was issued to supersede the old update
        supersede_patches = [
            c for c in patch_calls
            if c["table"] == "program_updates"
            and c["params"].get("id") == f"eq.{old_update_id}"
            and c["data"].get("status") == "superseded"
        ]
        self.assertTrue(
            len(supersede_patches) >= 1,
            f"Expected at least one supersede patch for old rule. patch_calls={patch_calls}"
        )

        # Check change_log was written
        change_log_posts = [c for c in post_calls if c["table"] == "program_change_log"]
        self.assertTrue(
            len(change_log_posts) >= 1,
            "Expected at least one program_change_log entry."
        )


class TestApplySkipsDuplicateRule(unittest.TestCase):
    """Test 6 — a duplicate rule_key that is already applied should be skipped."""

    def test_apply_skips_duplicate_rule(self):
        new_update_id = "new-uuid-002"
        existing_id = "existing-uuid-001"
        rule_key = "bench_before_ohp"

        existing_applied = [{
            "id": existing_id,
            "telegram_user_id": USER_ID,
            "update_type": "rule",
            "status": "applied",
            "rule_key": rule_key,
            "workout_type": None,
            "title": "Bench before OHP",
            "description": "Always bench before OHP.",
        }]

        new_row = {
            "id": new_update_id,
            "telegram_user_id": USER_ID,
            "update_type": "rule",
            "status": "proposed",
            "rule_key": rule_key,
            "workout_type": None,
            "title": "Bench before OHP",
            "description": "Always bench before OHP.",
        }

        patch_calls: list = []
        post_calls: list = []

        def _get_side(table, params=None):
            if table == "program_updates":
                # Fetch new row by id
                if params and params.get("id") == f"eq.{new_update_id}":
                    return [new_row]
                # Duplicate check — returns existing applied row
                if (params and params.get("status") == "eq.applied"
                        and params.get("rule_key") == f"eq.{rule_key}"
                        and params.get("id") == f"neq.{new_update_id}"):
                    return existing_applied
                return []
            return []

        with patch.object(cp.CoachingDB, "_get", side_effect=_get_side), \
             patch.object(cp.CoachingDB, "_get_one", return_value=None), \
             patch.object(cp.CoachingDB, "_patch", side_effect=lambda t, p, d, prefer="return=minimal": patch_calls.append({"table": t, "params": p, "data": d})), \
             patch.object(cp.CoachingDB, "_post", side_effect=lambda t, d, prefer="return=minimal": post_calls.append({"table": t, "data": d})), \
             patch("coaching_pipeline.build_canonical_state", return_value={}):

            applied = cp.apply_program_updates(USER_ID, [new_update_id])

        # new_update_id should NOT be in applied list
        self.assertNotIn(new_update_id, applied)

        # A patch should have set status=inactive on the new update
        inactive_patches = [
            c for c in patch_calls
            if c["table"] == "program_updates"
            and c["params"].get("id") == f"eq.{new_update_id}"
            and c["data"].get("status") == "inactive"
        ]
        self.assertTrue(
            len(inactive_patches) >= 1,
            f"Expected inactive patch on duplicate. patch_calls={patch_calls}"
        )


class TestBuildCanonicalState(unittest.TestCase):
    """Test 7 — build_canonical_state assembles state_json correctly."""

    def test_build_canonical_state(self):
        applied_updates = [
            {
                "id": "rule-uuid-1",
                "update_type": "rule",
                "status": "applied",
                "title": "No bicep pre-fatigue",
                "description": "No bicep pre-fatigue before pull compounds.",
                "applicability_type": "durable",
                "rule_key": "no_bicep_prefatigue",
                "workout_type": "Pull",
                "exercise_name": None,
                "exercise_family": None,
                "applies_while": None,
                "applies_to_programme_phase": None,
                "start_at": None,
                "end_at": None,
                "applied_at": "2026-04-13T10:00:00+00:00",
            },
            {
                "id": "constraint-uuid-1",
                "update_type": "constraint",
                "status": "applied",
                "title": "Reduce pressing volume",
                "description": "Reduce pressing volume while shoulder irritated.",
                "applicability_type": "temporary",
                "rule_key": "reduce_pressing_volume_shoulder",
                "workout_type": "Push",
                "exercise_name": None,
                "exercise_family": None,
                "applies_while": "shoulder irritation active",
                "applies_to_programme_phase": None,
                "start_at": "2026-04-01",
                "end_at": None,
                "applied_at": "2026-04-13T10:01:00+00:00",
            },
        ]

        # Existing state row with version=2
        existing_state_row = {
            "telegram_user_id": USER_ID,
            "state_json": {},
            "version": 2,
        }

        patch_calls: list = []
        post_calls: list = []

        def _get_side(table, params=None):
            if table == "program_updates":
                return applied_updates
            return []

        def _get_one_side(table, params=None):
            if table == "program_state":
                return existing_state_row
            return None

        with patch.object(cp.CoachingDB, "_get", side_effect=_get_side), \
             patch.object(cp.CoachingDB, "_get_one", side_effect=_get_one_side), \
             patch.object(cp.CoachingDB, "_patch", side_effect=lambda t, p, d, prefer="return=minimal": patch_calls.append({"table": t, "params": p, "data": d})), \
             patch.object(cp.CoachingDB, "_post", side_effect=lambda t, d, prefer="return=minimal": post_calls.append({"table": t, "data": d})):

            state = cp.build_canonical_state(USER_ID)

        # active_rules: 1 rule
        self.assertEqual(len(state["active_rules"]), 1)
        self.assertEqual(state["active_rules"][0]["rule_key"], "no_bicep_prefatigue")

        # active_constraints: 1 constraint
        self.assertEqual(len(state["active_constraints"]), 1)
        self.assertEqual(state["active_constraints"][0]["applies_while"], "shoulder irritation active")

        # version should be incremented from 2 → 3
        self.assertEqual(state["state_metadata"]["version"], 3)

        # A PATCH should have been issued (row existed)
        state_patches = [c for c in patch_calls if c["table"] == "program_state"]
        self.assertTrue(len(state_patches) >= 1)
        self.assertEqual(state_patches[0]["data"]["version"], 3)


class TestProcessConversationNoUpdate(unittest.TestCase):
    """Test 8 — process_conversation returns early when classifier says no update."""

    @patch("coaching_pipeline.anthropic.Anthropic")
    def test_process_conversation_no_update(self, MockAnthropic):
        payload = json.dumps({
            "should_update": False,
            "confidence": 0.95,
            "rationale": "Generic chat, no programming change.",
            "update_scope_hint": "none",
        })
        mock_client = MagicMock()
        mock_client.messages.create.return_value = _claude_response(payload)
        MockAnthropic.return_value = mock_client

        post_calls: list = []

        messages = [
            {"role": "user", "content": "Great session!"},
            {"role": "assistant", "content": "Nice one!"},
            {"role": "user", "content": "Felt good."},
            {"role": "assistant", "content": "Keep it up."},
        ]

        with patch.object(cp.CoachingDB, "_post", side_effect=lambda t, d, prefer="return=minimal": post_calls.append(d)):
            result = cp.process_conversation(USER_ID, messages)

        self.assertFalse(result["updated"])
        self.assertFalse(result["classification"]["should_update"])
        # No updates should have been persisted
        self.assertEqual(result["proposed_count"], 0)
        self.assertEqual(result["applied_count"], 0)
        # No program_updates POST calls
        self.assertEqual(len(post_calls), 0)


class TestProcessConversationFullPipeline(unittest.TestCase):
    """Test 9 — full pipeline: classify → extract → persist → apply."""

    @patch("coaching_pipeline.anthropic.Anthropic")
    def test_process_conversation_full_pipeline(self, MockAnthropic):
        classifier_payload = json.dumps({
            "should_update": True,
            "confidence": 0.92,
            "rationale": "Clear agreed durable rule.",
            "update_scope_hint": "durable",
        })
        extractor_payload = json.dumps({
            "updates": [
                {
                    "updateType": "rule",
                    "title": "No bicep pre-fatigue before pull compounds",
                    "description": "Avoid bicep curls immediately before rows or pull-downs.",
                    "reason": "Elbow fatigue weakens pull strength.",
                    "applicabilityType": "durable",
                    "startAt": None,
                    "endAt": None,
                    "appliesWhile": None,
                    "appliesToProgrammePhase": None,
                    "workoutType": "Pull",
                    "exerciseName": None,
                    "exerciseFamily": "Pull",
                    "ruleKey": "no_bicep_prefatigue_before_pull_compounds",
                    "confidence": 0.91,
                    "evidenceSummary": "agreed to stop bicep pre-fatigue",
                    "patch": {"remove": "bicep_prefatigue"},
                }
            ]
        })

        # Claude is called twice: once for classify, once for extract
        mock_client = MagicMock()
        mock_client.messages.create.side_effect = [
            _claude_response(classifier_payload),
            _claude_response(extractor_payload),
        ]
        MockAnthropic.return_value = mock_client

        messages = [
            {"role": "user", "content": "Bicep curls before rows hurt my elbow."},
            {"role": "assistant", "content": "That's bicep pre-fatigue — I'd cut it."},
            {"role": "user", "content": "Yeah let's stop doing that permanently."},
            {"role": "assistant", "content": "Agreed. No bicep pre-fatigue before pull compounds from now on."},
        ]

        new_update_id = "pipeline-uuid-001"

        def _get_side(table, params=None):
            # No existing state, no conflicts
            return []

        def _get_one_side(table, params=None):
            return None

        post_calls: list = []

        def _post_side(table, data, prefer="return=representation"):
            post_calls.append({"table": table, "data": data})
            if "representation" in prefer and table == "program_updates":
                return [{**data, "id": new_update_id}]
            return None

        patch_calls: list = []

        def _patch_side(table, params, data, prefer="return=minimal"):
            patch_calls.append({"table": table, "params": params, "data": data})
            return None

        with patch.object(cp.CoachingDB, "_get", side_effect=_get_side), \
             patch.object(cp.CoachingDB, "_get_one", side_effect=_get_one_side), \
             patch.object(cp.CoachingDB, "_post", side_effect=_post_side), \
             patch.object(cp.CoachingDB, "_patch", side_effect=_patch_side), \
             patch("coaching_pipeline.build_canonical_state", return_value={"active_rules": []}):

            # apply_program_updates fetches the row — stub _get to return it on
            # the apply pass, without affecting the earlier calls.
            applied_update_row = {
                "id": new_update_id,
                "telegram_user_id": USER_ID,
                "update_type": "rule",
                "status": "proposed",
                "rule_key": "no_bicep_prefatigue_before_pull_compounds",
                "workout_type": "Pull",
                "title": "No bicep pre-fatigue before pull compounds",
            }

            get_call_count = [0]

            def _get_side_dynamic(table, params=None):
                if table == "program_updates" and params and params.get("id") == f"eq.{new_update_id}":
                    return [applied_update_row]
                return []

            with patch.object(cp.CoachingDB, "_get", side_effect=_get_side_dynamic):
                result = cp.process_conversation(USER_ID, messages)

        self.assertTrue(result["updated"], f"Expected updated=True, got: {result}")
        self.assertEqual(result["applied_count"], 1)
        self.assertEqual(result["proposed_count"], 1)
        self.assertIsNone(result.get("error"))


class TestTemporaryConstraintPreserved(unittest.TestCase):
    """
    Test 10 — a temporary constraint with applies_while is persisted
    with the correct fields.
    """

    def test_temporary_constraint_preserved(self):
        updates = [
            {
                "updateType": "constraint",
                "title": "Reduce pressing volume while shoulder irritated",
                "description": "Lower pressing volume (sets/intensity) while shoulder irritation is active.",
                "reason": "Prevent aggravating existing shoulder issue.",
                "applicabilityType": "temporary",
                "startAt": "2026-04-13",
                "endAt": None,
                "appliesWhile": "shoulder irritation active",
                "appliesToProgrammePhase": None,
                "workoutType": "Push",
                "exerciseName": None,
                "exerciseFamily": "Press",
                "ruleKey": "reduce_pressing_volume_shoulder",
                "confidence": 0.85,
                "evidenceSummary": "reduce pressing volume while shoulder irritated",
                "patch": {"volume_modifier": 0.7, "target": "pressing"},
            }
        ]

        provenance = {"conversation_id": "conv-123", "message_count": 6}
        classifier = {"confidence": 0.88, "should_update": True}

        post_calls: list = []

        def _post_side(table, data, prefer="return=representation"):
            post_calls.append({"table": table, "data": data})
            if "representation" in prefer and table == "program_updates":
                return [{**data, "id": "constraint-uuid-temp-001"}]
            return None

        with patch.object(cp.CoachingDB, "_post", side_effect=_post_side):
            ids = cp.persist_proposed_updates(updates, USER_ID, provenance, classifier)

        self.assertEqual(len(ids), 1)

        # Find the program_updates POST
        pu_posts = [c for c in post_calls if c["table"] == "program_updates"]
        self.assertEqual(len(pu_posts), 1)

        saved = pu_posts[0]["data"]

        # applicability_type and applies_while must be preserved
        self.assertEqual(saved["applicability_type"], "temporary")
        self.assertEqual(saved["applies_while"], "shoulder irritation active")
        self.assertEqual(saved["update_type"], "constraint")
        self.assertEqual(saved["rule_key"], "reduce_pressing_volume_shoulder")
        self.assertEqual(saved["start_at"], "2026-04-13")

        # Confidence threshold: constraint IS in AUTO_APPLY_TYPES → auto-applied
        self.assertEqual(saved["status"], "applied")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    unittest.main(verbosity=2)
