# WS-E: Social and sharing (Phase 2)

**Start condition:** the real end-to-end session is green (checkpoint 2 passed) and it's before 4:40. The first idle agent takes this brief. The orchestrator installs the Phase 2 dependencies and confirms ownership before you start.

Work the priorities **in order** and stop wherever time runs out. Each one is shippable on its own.

## You own (from the moment you take this brief)

- `larpless/macos/Focusline-macOS/Native/Social/**`
- `larpless/src/native/storyCard.ts`: a new facade. Ask the orchestrator to add `storyCard` to `NativeApis` and `src/native/index.ts`.
- `larpless/src/social/**`: Supabase client and helpers
- `larpless/src/ui/pages/{Login,Feed,Profile}.tsx` and `larpless/src/ui/components/{StoryPreview,PostCard,LivePhoto}.tsx`
- `larpless/supabase/schema.sql`
- Summary page additions: coordinate with WS-D. Add a `<SharePanel/>` component that WS-D drops into Summary with one line.
- `docs/macos/status/WS-E.md`

## P1. Story card export (local, no network)

**Native renderer** (replaces the web plan's html-to-image approach):
- `Native/Social/StoryCardView.swift`: a **SwiftUI** view at 1080×1920 with an off-white Notion page look:
  - A large Instrument Serif duration ("2h 14m")
  - Focus %
  - A stacked subject bar (tag colours)
  - Streak badge "🔥 5"
  - Pomodoros "🍅 4"
  - The optional photo in a rounded frame
  - The "LarpLess" wordmark
- Fonts come from the app bundle; colours from `NotionColors`.
- `Native/Social/FLStoryCard.swift` + `.m`:
  - `render(data: NSDictionary) -> Promise<{ path: string }>`
    - Data: `{ durationS, focusPct, breakdown: [{label, color, pct}], streak, pomodoros, username?, photoBase64? }`
    - `ImageRenderer(content: StoryCardView(...))` with `scale = 1` and a proposed size of 1080×1920 → `nsImage` → PNG.
    - Writes to `~/Downloads/LarpLess/story-<yyyyMMdd-HHmm>.png` and returns the path.
  - `share(path)` → `NSSharingServicePicker(items: [URL])` shown at the key window's content view centre.
  - `reveal(path)` → `NSWorkspace.shared.activateFileViewerSelecting`.
- `StoryPreview.tsx`:
  - After `render`, show `<Image source={{ uri: 'file://' + path }}>` scaled to 270×480, revealed with a soft scale-in (Animated 0.96 → 1, 250 ms).
  - Buttons: "Save for Instagram" (`reveal`) and "Share…" (`share`).

**Acceptance:**
- [ ] The PNG is exactly 1080×1920, the fonts are correct, and the breakdown matches the Summary.

## P2. Live photo

- `LivePhoto.tsx`: a 3-2-1 countdown overlay, then `native.webcam.capturePhoto()` (WS-A, A9).
- Show the result. Offer "Retake" or "Use".
- There is **no gallery upload**. The photo lives only in component state and the story PNG. It's never written to AsyncStorage.

## P3. Supabase posts and feed

**Setup:**
- The orchestrator installs `@supabase/supabase-js`, `react-native-url-polyfill` and `base64-arraybuffer`.
- Put `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `src/social/env.ts` (gitignored; commit `env.example.ts`).

**`supabase/schema.sql`** (from plan.md "Cloud, in Supabase"):
- `profiles(id uuid pk references auth.users, username text unique, avatar_url text)`
- `friendships(user_id, friend_id, status text check (status in ('pending','accepted')), created_at)`
- `posts(id, user_id, photo_path, duration_s, focus_pct, breakdown jsonb, streak int, pomodoros int, caption text, created_at)`
- The `post-photos` storage bucket.
- RLS:
  - Insert and delete only your own posts.
  - Select where the author is you or an accepted friend (either direction).
  - Storage objects follow the same rule via `post_id` / owner folder `photos/<user_id>/…`.

**Client:**
- `src/social/supabase.ts`: `import 'react-native-url-polyfill/auto'`, then `createClient(url, key, { auth: { storage: AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })`.
- **Login:** username + password. Email is `<username>@larpless.local`, the fastest path for the demo. Create a `profiles` row on sign-up.
- **Post** (from `SharePanel`): upload the photo with `decode(photoBase64)` to `post-photos/photos/<uid>/<postId>.jpg` (`contentType: 'image/jpeg'`), then insert the `posts` row with stats from `lastSummary`.
- **Feed page:** friends' posts as Notion cards (photo, name, duration in serif, breakdown tags, streak, time ago via `date-fns` `formatDistanceToNow`). Pull to refresh is a "Refresh" button.
- **Offline:** if the network fails, show the last fetched feed cached in memory and a muted "Offline" tag. The local session flow must never depend on Supabase.

## P4. Friends

- Profile page: add a friend by username (insert `pending`), a list of incoming requests with Accept.
- If time is short: auto-accept (insert `accepted` both ways). This is plan.md cut item 7.

## Sidebar

Add 👥 Feed and 👤 Profile to the sidebar only after P3 works. Ask WS-D, or the orchestrator if WS-D is busy.
