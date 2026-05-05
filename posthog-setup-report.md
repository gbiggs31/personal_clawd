<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Avenra gym Telegram bot. A shared `posthog_analytics.py` module was created to initialize the PostHog client (instance-based API, exception autocapture enabled, atexit shutdown registered). Event tracking was added to `bot.py` across 9 distinct user actions, and to `coaching_pipeline.py` for backend coaching events. Environment variables `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` were written to `.env` and `posthog>=3.0.0` was added to `requirements.txt`.

| Event | Description | File |
|---|---|---|
| `user_started` | User runs /start; `is_new_user` flag distinguishes first-time vs returning | `bot.py` |
| `workout_sets_logged` | Sets successfully written to DB; includes `set_count`, `exercise_count`, `has_injury_flag`, `confidence` | `bot.py` |
| `session_completed` | User closes session via /done; includes `session_type`, `set_count`, `duration_mins` | `bot.py` |
| `training_cycle_started` | User confirms a new training cycle via /confirmcycle; includes `cycle_id`, `start_date`, `end_date` | `bot.py` |
| `training_cycle_ended` | User ends their cycle via /endcycle; includes `cycle_id` | `bot.py` |
| `coaching_update_applied` | Coaching pipeline auto-applies durable updates; includes `applied_count`, `proposed_count`, `update_scope`, `classifier_confidence` | `coaching_pipeline.py` |
| `rate_limit_hit` | User exceeds daily API limit; includes `daily_limit` | `bot.py` |
| `user_profile_updated` | User updates profile via /setprofile; includes `fields_updated` list | `bot.py` |
| `feedback_submitted` | User submits feedback via /feedback; includes `message_length` | `bot.py` |
| `exercise_lookup_used` | User triggers an exercise history lookup; includes `session_count` | `bot.py` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://eu.posthog.com/project/172980/dashboard/662271
- **New users activated per week**: https://eu.posthog.com/project/172980/insights/m2u012ig
- **Session completions over time**: https://eu.posthog.com/project/172980/insights/h64lyMuT
- **Coaching updates applied**: https://eu.posthog.com/project/172980/insights/jkf7DpaW
- **Workout logging to session completion funnel**: https://eu.posthog.com/project/172980/insights/wILC6DLi
- **Rate limit hits (churn signal)**: https://eu.posthog.com/project/172980/insights/GbsqZr84

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
