# Current decisions

- Preserve the approved Clean INK source, canonical hero references, fixed camera and supplied sixteen-frame walk. Visual stabilization and weighted timing do not change gameplay roots or combat authority.
- Retain Graveyard Approach and Ruined Chapel, their reciprocal passage, quiet approach, one/two skeleton encounters and safe supports. Preserve source pixels, current shader behavior and developer tools during delivery changes.
- GameSession owns visits, transactional transitions and current-area resets. Manual saves and boundary autosaves share a checkpoint. Existing/newer/unreadable data is protected until explicit successful load or authorized new-game replacement.
- Keep Game, Dev Preview and Sandbox persistence isolated. Sandbox cannot write player checkpoints. Visual preferences persist independently.
- Source artwork stays in the shared iCloud-backed library. Git contains authored inputs and a small prepared-pack pin. Explicit preparation/publication verifies sources; normal builds use the pinned pack without source access.
- Cache prepared data outside the checkout under a 4 GiB budget. Evict unused disposable data automatically; protect active commands. Published cleanup is explicit and retains current/main/open-PR/supported references.
- Preserve original references and active authored decisions. Delete obsolete generated output and captures instead of archiving them in Git. Agents use bounded summaries and targeted asset inspection.
