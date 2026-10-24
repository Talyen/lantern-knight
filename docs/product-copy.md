# Product copy

Applies to Game, Dev Preview, the scene editor and design studies. Intentional lore and character voice remain intact. [Game design](game-design.md#opening-guidance) owns contextual gameplay guidance; [visual references](../references/visual/README.md) show the design targets.

Avoid taglines, avoid helper text, avoid secondary labels - if a screen needs them to make sense, fix the layout instead.

Every visible sentence must help someone identify something, decide, act or recover. Remove text with no concrete job. Before adding help, try a clearer action name, grouping or layout. Do not make users read a paragraph to understand an ordinary control.

- Omit introductory panel descriptions, subtitles repeating headings, decorative category labels and idle reassurance.
- Do not place implementation commentary, source-preservation assurances, agent rationale or completion reports inside the interface. Design-study limitations belong in its review chrome or documentation, not repeated inside each concept screen.
- Keep names and action verbs consistent. Prefer “Equip”, “Organize” and “Return to game” over invented ceremonial phrasing.
- Keep costs, material shortages, replacement consequences, destructive confirmation and useful recovery visible when needed. Put occasional technical explanations behind a disclosure; do not hide essential consequences in hover-only tooltips.
- Preserve accessible names and announced outcomes. Removing visible repetition does not mean removing screen-reader information or replacing unfamiliar actions with unexplained icons.
- Keep active placement instructions contextual; retire them when the operation ends. Show a status message when something happened, failed or is still in progress.

| Before | Treatment | Reason |
| --- | --- | --- |
| “Source artwork stays unchanged.” beside rendering controls | Remove | Implementation assurance does not explain a control. |
| “Manage your equipment and supplies.” below Inventory | Remove | Repeats the screen's purpose. |
| “Sweep and lunge: 52 damage per impact.” | Keep in damage disclosure | Explains a mechanical distinction when requested. |
| “Replaces Traveller’s Charm” | Keep beside Equip | Changes the purchase/equipment decision. |
| “This cannot be undone.” when replacing a journey | Keep | Consequence matters before confirmation. |

Review changed copy in the rendered flow. Count duplicated explanations, not words alone. Sparse UI can still be confusing; essential labels and instructions earn their space.
