# Section B External Validation Blockers

As of `main@e29dc6b`, these conditions require an authorized operator or real
user workflow and cannot be closed by repository tests alone.

## B3 Real Authorized Account

Required: permitted backend origin, authorized account reference, allowed
action scope, success marker, and action classification. Without these inputs,
real account identity and end-to-end handoff cannot be claimed.

## B4 Reusable Backend Recipe

Required: one real backend workflow, versioned recipe/account marker,
preconditions/postconditions, bounded output/download contract, approved effect
policy, and a second account/tenant/template to measure reuse. Without a second
workflow, multi-customer Recipe generation is not evidenced.

## Existing Chrome/CDP

Required: user-owned Chromium with explicit Remote Debugging approval, approved
origin/account scope, new-tab evidence, safe disconnect evidence, and revocation
stopping later W2L commands. Library-level endpoint validation is not live
evidence.

## Conditional cache validation

Validators and transport representation fields are now part of the monitor
path. A real server returning `304 Not Modified` with a matching cached body
still needs a controlled integration test before this is called production
validated.
