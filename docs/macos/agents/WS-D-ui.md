# WS-D: UI (React Native macOS)

**Mission:** a Notion-styled, calm, slightly animated desktop UI.
- Sidebar layout, Session page (the star of the demo), Onboarding, Home, Summary, History, Modules, Settings, and a ⌘K palette.
- Build everything against **fixtures and mocks first**. Real data arrives at checkpoint 2 with no UI changes, because you only read the stores and call store actions.

**Metro port:** 8081 (`scripts/run-mac.sh 8081`). `config.USE_MOCK_NATIVE` and `USE_MOCK_CLASSIFIER` stay `true` in your worktree.

## You own

- `larpless/src/ui/**`: `theme.ts`, `components/`, `layout/`, `pages/`
- `larpless/src/App.tsx`: replace Phase 0's dev tabs, but keep a **Dev tools** page reachable that renders `src/dev/HarnessA` and `HarnessB` plus the fixture switcher
- `larpless/src/store/navStore.ts`
- `larpless/__tests__/ui/**` (optional render tests)
- `docs/macos/status/WS-D.md`

Read: [PLAN.md](../PLAN.md) §1, §6, §12; [CONTRACTS.md](../CONTRACTS.md) §1, §3, §6, §9; the "Notion-inspired design system" and "Pages and UX" sections of [`plan.md`](../../../plan.md).

**Data access rules:**
- Read `useSessionStore` / `useAppStore` (zustand selectors) and call their actions.
- Don't call `NativeModules`. You may import `native.permissions`, `native.notifications.requestPermission` and `native.appShell.onMenuCommand` from `src/native`.
- Use `applyFixture` from `src/fixtures/apply.ts` only in Dev tools.

## navStore (`src/store/navStore.ts`)

```ts
type Route = 'onboarding' | 'home' | 'session' | 'summary' | 'history' | 'modules' | 'settings' | 'dev'
           | 'feed' | 'profile' | 'login';   // last three: Phase 2
interface NavState {
  route: Route;
  params: { sessionId?: string };
  paletteOpen: boolean;
  go(r: Route, p?: NavState['params']): void;
  setPaletteOpen(o: boolean): void;
}
```

**Routing behaviour** (`App.tsx`):
- On mount: `useAppStore.load()`. `!settings.onboarded` → `onboarding`, else → `home`.
- When the session status becomes `running` → go to `session`. When it becomes `ended` → `summary`.
- Subscribe to `native.appShell.onMenuCommand`:
  - `commandPalette` → open the palette
  - `startSession` → `start` with the default preset
  - `endSession` → `end`

## Tasks (in order)

### Sprint 1 (2:50–3:30)

**D1. `src/ui/theme.ts`:**
- `colors` (base tokens), `tag: Record<TagColor, {bg, text}>`, `fonts` (Inter Regular/Medium/SemiBold and the Instrument Serif PostScript names from CONTRACTS.md §9), `space` (4, 8, 12, 16, 24, 32, 48), `radius: 4`, `motion: { fast: 150, base: 200, slow: 250 }`.
- This is the **only** place hex values may appear.
- Dark mode is a cut item: structure the tokens so a `dark` set can be added later, but ship light only.

**D2. Primitives** (`src/ui/components/`). Use `StyleSheet` and `Animated` only:

| Component | Spec |
|---|---|
| `Text` | Inter by default. `variant`: `title` (Instrument Serif 40), `h2` (SemiBold 20), `body` (14), `small` (12, muted). |
| `Tag` | Pill: tag bg, tag text, 12 px Medium, radius 4, padding 2×6. Optional `onPress`; `selected` adds a 1 px ring. |
| `Button` | `variant`: `primary` (accent bg, white text), `ghost` (transparent, hover bg `colors.hover`), `danger` (ghost with red text). Hover via `onMouseEnter`/`onMouseLeave` (react-native-macos View props). 28 px tall. |
| `Callout` | Notion callout: emoji, gray-ish bg (`tag.gray.bg`), radius 4, padding 12. |
| `ToggleList` | Rows with a ▸ chevron that rotates 90° (Animated, 150 ms) and a body that expands. Hover bg. |
| `BreakdownBar` | Horizontal 10-px stacked bar of tag-coloured segments (use `tag[color].text` for fill). Widths animate with `Animated.spring` when the data changes. Optional legend of `Tag`s with %. |
| `SerifTimer` | `h:mm:ss` in Instrument Serif 88 pt. Each digit is an `Animated` column that rolls (translateY) when it changes. Fallback: a 120-ms opacity crossfade. Computes elapsed from `timer.baseS`/`runningSinceMs` with its own 250-ms interval. |
| `StatusDot` | 8-px dot; colour by kind (subject = green, distracted = red, away = gray, break = blue). Pulses (scale 1 ↔ 1.6, opacity) while running. |
| `PrivacyBadge` | "🔒 Screenshots analysed: **N** · checks without a screenshot: **M** · stored: **0**". Small, muted, border hairline. |
| `Heatmap` | 12 weeks × 7 days of 10-px squares, 2-px gap. Intensity of green by minutes (0, <15, <30, <60, ≥60). |
| `PageHeader` | Cover strip (full width, 120 px, tag bg colour of the current subject, or `colors.sidebar`), emoji icon (48 px) overlapping it, serif title. |
| `EditableTable` | Notion-style table: header row, hairline grid, `TextInput` cells, a "＋ New" row. Used for modules: Name | Colour | Keywords. Clicking the colour cell cycles through `TagColor`. |
| `Segmented` | Row of `Tag`-like chips for presets (Off / 25/5 / 50/10, strictness 2 / 5 / 10). |

**D3. Layout** (`src/ui/layout/`):
- **Sidebar:** 240 px, `colors.sidebar` bg.
  - Workspace header "🎯 LarpLess".
  - Items, each with a hover bg and the active one bold: 🏠 Home, ⏱ Session (green live dot when running), 📚 Modules, 🗓 History, ⚙️ Settings. A "🛠 Dev tools" item shows only when `config.SHOW_DEV_TOOLS`.
  - At the bottom: an Ollama status line, e.g. "● qwen3-vl:4b ready".
- **Content:** scrollable, max width 900, centred, with 48-px side padding.
- **Page transitions:** 200-ms fade + 8-px slide (Animated) on route change.

**D4. Session page** (never cut):
- `PageHeader`: emoji 🎯, cover strip in the current subject's colour, title "Focus session". The subtitle shows the start time and the Pomodoro chip ("Round 2 of 4 · 12:04 left" or "Break · 3:10").
- `SerifTimer` (large, centred-left).
- Status line: `StatusDot` + "Studying **Biology**" / "Distracted · Instagram" / "Away" / "Paused".
- `Callout` 💡 "Last check: **Biology** — reading cell division slides · 12 s ago". Use `current.at` and update every second.
- `BreakdownBar` with legend.
- Row: webcam state ("📷 You're here" / "📱 Phone spotted" / "🚶 Away" / "Camera off"), sound chip (current sound, click to cycle), `PrivacyBadge`.
- Buttons: Pause/Resume (ghost), End session (danger).
- Must look right in the fixture states `running`, `distracted` and `break`.

**Sprint 1 acceptance:**
- [ ] The app shows the sidebar and the Session page. The Dev tools fixture switcher toggles idle / running / distracted / break / summary, and the Session page reacts.
- [ ] The timer rolls smoothly, the breakdown bar springs when the fixture changes, and the status dot pulses.
- [ ] `grep -rn "#[0-9A-Fa-f]\{3,8\}" src/ui | grep -v theme.ts` is empty.

### Sprint 2 (3:30–4:00)

**D5. Onboarding** (3 steps with a progress line):
1. **Your modules:** `EditableTable`, pre-filled with an example row "Biology / green / cell, mitosis". Needs at least one module to continue → `saveModules`.
2. **Permissions:** a checklist of Screen Recording, Camera and Notifications:
   - Each row shows its status Tag plus "Allow" (`request`) / "Open Settings".
   - Screen Recording also notes that macOS needs LarpLess to relaunch after you allow it, with a **Relaunch** button (`permissions.relaunch()`).
   - Poll `status()` every 2 s while this step is open.
3. **Local AI:** Ollama card.
   - Green: "● qwen3-vl:4b is ready. Everything stays on this Mac."
   - Red: copyable code blocks `ollama pull qwen3-vl:4b` and "Open the Ollama app", plus a Retry button (`refreshOllama`).
   - Finish → `updateSettings({onboarded:true})` → Home.

**D6. Home:**
- `PageHeader` "🎯 LarpLess".
- Greeting by time of day.
- A big primary **Start session** button. ⌥-click (`event.nativeEvent.altKey`) → `start({ pomodoro, demo: true })`.
- `Segmented` Pomodoro preset next to the button.
- "🔥 N-day streak", `Heatmap`, and "Recent sessions" `ToggleList` (date · duration · focus % · mini `BreakdownBar`).

**D7. Summary:**
- Header "Session complete", with the date.
- Stats row: duration (serif 48), focus %, Pomodoros.
- `BreakdownBar` + legend.
- `ToggleList` "Timeline (N checks)". Each row shows time, label `Tag`, activity and app. Expanding a row shows relabel chips (each module, Distracted, Away) → `relabelChunk`. The bar updates.
- "Done" → Home.
- Phase 2 adds the story card and posting here (WS-E).

**D8. History:** sessions grouped by week, totals per subject (`Tag` + hours), `Heatmap`.

**D9. Modules:** the `EditableTable` from onboarding.

**D10. Settings:**
- Model (`TextInput`) + an Ollama status dot and Retry.
- Strictness `Segmented` 2 / 5 / 10 min.
- Toggles: Demo fast mode, Webcam, Sounds; default sound chips; volume (a simple +/- or a 10-step bar).
- "Developer" section → Dev tools.

**D11. ⌘K palette:**
- A centred overlay (560 px, top 20%) with a dimmed backdrop and an autofocused `TextInput`.
- Commands, filtered by substring: Start session, Start demo session, Pause/Resume, End session, Go to Home/History/Modules/Settings/Dev tools, Toggle demo fast mode.
- Arrow keys and Enter via react-native-macos keyboard props on the View. The prop names changed across versions (`keyDownEvents` vs `validKeysDown`); check what the installed version supports. Esc closes. Clicking the backdrop closes.

**Sprint 2 acceptance:**
- [ ] With an empty store, the full onboarding → Home → Start (mocks) → Session → End → Summary → relabel → Home flow works.
- [ ] Every page renders in every fixture state with no layout breakage at 900×600 and 1440×900.
- [ ] The palette opens from the ⌘K menu item (in mock mode, also from a Dev tools button).

### Integration / polish (after 4:00)

- Empty states (no sessions yet, no modules) with friendly emoji callouts.
- Motion polish: breakdown springs and page fades. The story card reveal is Phase 2.
- Dark mode is cut item 4; only if everything else is done.
- Phase 2 pages (Login, Feed, Profile, story card on Summary) come from the WS-E brief.

## Gotchas

- react-native-macos `Pressable` supports `onHoverIn`/`onHoverOut`; `View` supports `onMouseEnter`/`onMouseLeave`. Use them for Notion hover rows.
- `TextInput` on macOS: set `enableFocusRing={false}` and draw your own border for the Notion look.
- If fonts render as the system font, the PostScript names are wrong; see CONTRACTS.md §9.
- Avoid `LayoutAnimation`. It's unreliable on macOS; use `Animated`.
