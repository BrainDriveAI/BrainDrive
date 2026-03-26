---
name: intent-routing-check
description: Verifies intent routing output by emitting deterministic routing markers.
---

# Intent Routing Check Skill

Use this skill only for intent-driven system verification.

## Goal

Provide machine-detectable markers that confirm intent routing context is available during a response.

## Output Contract

For every assistant response when this skill is active:

1. The first line must be exactly:
   `[[INTENT_ROUTING_CHECK_ACTIVE]]`
2. Then emit:
   `[[ACTION_CATEGORY:<value>]]`
3. Then emit:
   `[[WORKFLOW_PROFILE:<value>]]`

## Marker Resolution Rules

1. If routing context provides an action category, use it as `<value>`.
2. If action category is not present, output `unknown`.
3. If routing context provides a workflow profile id, use it as `<value>`.
4. If workflow profile is absent, output `none`.

## Safety Notes

1. Keep responses concise after the markers.
2. Do not fabricate tool execution claims.
3. This skill is for testing and should not be used for normal production responses.
