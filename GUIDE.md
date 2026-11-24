# The LarpLess Guide

LarpLess tells you how much of your study time was really study. It watches the window in front and, if you allow it, your webcam. An AI model on your computer judges what it sees, and LarpLess turns the session into a focus score split across subjects, breaks and distractions. This guide covers every part of the app. On Windows, read **Ctrl** where it says **⌘** and **Alt** where it says **⌥**.

You can come back here any time from **Settings → About → Guide**, from the command palette (**⌘K → Open guide**), or on a Mac from **Help → LarpLess Guide**.

## Contents

- [Set up](#set-up)
- [Run a study session](#run-a-study-session)
- [The floating timer](#the-floating-timer)
- [Pomodoro, breaks and sounds](#pomodoro-breaks-and-sounds)
- [Distraction alerts](#distraction-alerts)
- [How LarpLess labels your time](#how-larpless-labels-your-time)
- [After a session: summary and history](#after-a-session-summary-and-history)
- [Subjects](#subjects)
- [Add your own courses](#add-your-own-courses)
- [Friends](#friends)
- [Settings](#settings)
- [Command palette and shortcuts](#command-palette-and-shortcuts)
- [Privacy in short](#privacy-in-short)
- [Troubleshooting](#troubleshooting)

## Set up

The first time you open LarpLess, onboarding walks you through four short steps. You can run it again later from **Settings → About → Onboarding → Run again**.

1. **How powerful is this Mac or PC?** LarpLess reads your screen with one of two AI models, and both run entirely on your computer. It recommends one based on your chip, memory and graphics card.
   - **On-device classifier**: a small model built into LarpLess. A check takes under a second on any computer and needs no other app. It's a one-time download of about 460 MB. Screens it isn't sure about count as *unknown*.
   - **Vision LLM (Ollama)**: a vision language model that runs in Ollama, a free app. It's sharper, but it wants a recent Mac with 16 GB of memory, or a PC with a graphics card. The model is a 1.9 GB download.

   You can switch any time in **Settings → Local AI → Screen check**.
2. **Your subjects.** There's nothing to pick: LarpLess already recognises dozens of subjects. You can add your own courses here or later (see [Add your own courses](#add-your-own-courses)), or choose **Skip for now**.
3. **Permissions.**
   - **Screen Recording** (Mac only) lets LarpLess read the window in front. macOS applies it only after LarpLess relaunches, so use **Relaunch**.
   - **Camera** is optional. It notices when you step away or pick up your phone.
   - **Notifications** lets LarpLess nudge you when you drift off.
4. **Download the model.** In the on-device classifier mode, download the classifier. In the Ollama mode, install Ollama (**Download Ollama**), then download the model. You can choose **Finish anyway** and download later from Settings; demo mode works without any model.

## Run a study session

1. On **Home**, pick a Pomodoro preset if you want one (**Off**, **25/5**, **50/10** or **Custom**), then press **Start session**. You can also press **⌘Return** or use **⌘K → Start session**.
2. Study. LarpLess checks the window in front every second without taking a screenshot. When a new window has stayed in front for a moment, it checks what's on it. Every 10 to 30 seconds it records one label for that stretch of time (see [How LarpLess labels your time](#how-larpless-labels-your-time)).
3. The **Session** page shows the running timer, what you're doing now ("Studying **Biology**", "**Distracted** · YouTube", "Away"), the last check and a live breakdown. You can **Pause**, **Resume** or **End session** (**⌘.**) here or from the floating timer.

Some other things to know about sessions:

- **Sleep pauses the session.** If your computer sleeps, or LarpLess misses its checks for over 30 seconds, the session pauses from that moment so the time doesn't count. Press **Resume** when you're back.
- **Closing LarpLess saves the session.** If you close LarpLess while a session runs (on Windows, closing its window; on a Mac, **⌘Q**), the session ends just as with **End session** and is saved to History before the app closes. If you didn't want it, delete it from History. (Closing the main window on a Mac only hides it; the session keeps running.)
- **Try it without studying.** **⌥-click Start session** on Home, or **⌘K → Start demo session**, replays a recorded session through the real timer, alerts and summary. It never looks at your screen or camera.

## The floating timer

While a session runs, a small timer floats above your other windows. Its colour shows where you are: green while you study, red when you're distracted, blue on a break and grey while paused or away.

- Hover over it for controls: the Pomodoro switch and presets, **skip**, background sounds, volume, **Pause**/**Resume**, **End** and **Open** (back to LarpLess).
- Drag it wherever you like. On Windows, **Ctrl + scroll** makes it larger or smaller.
- If music is playing, a **now-playing** strip under the timer shows the song with play/pause and skip buttons. The song never leaves the timer. Turn it off in **Settings → Focus → Now playing**.
- If you closed it, **⌘K → Show floating timer** brings it back.

## Pomodoro, breaks and sounds

**Pomodoro presets**

| Preset | Study | Break | Long break |
| --- | --- | --- | --- |
| 25/5 | 25 min | 5 min | 15 min after every 4th round |
| 50/10 | 50 min | 10 min | none |
| Custom | 1–180 min | 1–60 min | none |

- **Your default.** Set the default preset in **Settings → Focus → Pomodoro**. You can turn Pomodoro on or change the preset mid-session from the floating timer.
- **Hiding the countdown.** If watching the time left distracts you, hover over the floating timer and press the **eye** button: the timer then shows only the round or break, without the time left or the ring. Press it again to bring the countdown back. This lasts for the current session; **Settings → Focus → Pomodoro countdown** (on by default) sets how new sessions start. Rounds and breaks still end on time, with the same chime and notification.
- **During a break** LarpLess stops looking: no screen checks, no camera, and no alerts. Background sound drops to 30% and the session timer stops.
- **Skipping.** **Skip break** jumps straight back to studying. A study round you skip doesn't count as a finished Pomodoro.
- **Background sounds.** White, pink and brown noise, rain and café sounds play from the Session page's sound chip or the floating timer. Pick a default sound and volume in **Settings → Sound**.

## Distraction alerts

When you drift off, the floating timer turns red right away. If you stay distracted, LarpLess nudges you:

- **First nudge:** after the time set in **Settings → Focus → Strictness** (1, 2, 5 or 10 minutes; 1 minute by default), you get a notification and a soft chime.
- **Second nudge:** after three times that, you get another notification and the timer starts to pulse.
- **Back on track:** as soon as a check sees you studying again, the alert resets and the timer flashes "Back on track ✓".

Time away from your desk, and checks LarpLess wasn't sure about, neither trigger nor reset an alert. Turn the chimes off in **Settings → Sound → Chimes & alerts**.

## How LarpLess labels your time

Each stretch of a session gets one of four labels:

- **A subject:** the screen shows study, and which subject it is.
- **Distracted:** the screen shows something else, or your phone was in view for more than a sixth of the stretch.
- **Away:** the camera didn't see you for more than two thirds of the stretch.
- **Unknown:** LarpLess couldn't tell, for example because a check failed or the classifier wasn't sure.

Your **focus score** is study time ÷ (study time + distracted time). Away and unknown time don't count either way, so stepping out to get water doesn't hurt your score.

How often a label is recorded depends on **Settings → Focus → Power**:

| Power | One label every | Good for |
| --- | --- | --- |
| Eco | 30 s | Older or slower computers |
| Medium (default) | 15 s | Most computers |
| High | 10 s | Fast computers |

If checks run slow, LarpLess steps down to a lighter level for the rest of that session on its own. Your setting stays as it is.

Many apps and sites are labelled without a screenshot. For example, Instagram, TikTok, Netflix and Steam are always distractions, and tools like Vivado or Logisim are always study. LarpLess also reuses a recent answer for the same window.

## After a session: summary and history

- **Summary.** When you end a session, its summary shows the session's length, your focus score, the Pomodoros you finished and a breakdown by subject.
  - Open **Timeline** to see every check.
  - If a check got something wrong, open it and **Relabel** it with the right subject, **Distracted** or **Away**. The stats update right away.
- **Home** shows your streak, this week's total, a 12-week heatmap and your recent sessions.
  - A day counts towards your streak when you study for at least 15 minutes in one session.
  - Your streak lasts until the end of the next day.
- **History** lists every session by week, with your total time per subject.
- **Deleting a session.** Use **Delete…** on a session in History or on its summary. LarpLess warns you if deleting it would shorten your streak. If you shared it with friends, it asks whether to delete the post too. Deleting can't be undone.

## Subjects

The **Subjects** page (**Modules** in the sidebar) lists everything LarpLess recognises: sciences, maths, computing, engineering, humanities, social sciences and business, health and medicine, and arts and design. You don't have to set anything up. LarpLess labels your time with whichever subject you study.

- **Turning subjects off.** Click a subject to turn it off, so LarpLess never labels your time with it. **Turn all on** brings them all back.
- **Core subjects.** Biology, Chemistry, Physics, Maths, Programming, History, Literature and Economics are core subjects, drawn with an outline. They're always on.
- **Maths and computing.** If you turn off a maths or computing subject, time spent on it counts as **Maths** or **Programming**, so it doesn't land in an unrelated subject.

## Add your own courses

The built-in subjects are broad. If you want a label for a specific course, like *Cell Biology* or *Algorithms*, add it as your own course with keywords that point to it.

<!-- figure:modules -->

### How to add one

1. Open **Subjects** (**Modules** in the sidebar, or **⌘K → Go to Modules**).
2. Under **Your own courses (optional)**, click **＋ New**.
3. Type a **Name**. Built-in subject names are taken, so make it specific: *Cell Biology* or *Biology 101* rather than *Biology*.
4. Click the **Colour** tag to cycle through colours.
5. Type **Keywords**, separated by commas: `BIO101, mitosis, Krebs cycle`.

Changes save automatically. To remove a course, hover over its row and click the bin. Your courses also appear at the top of the subject list, where you can turn them off like any other subject.

### Choosing keywords

Keywords help LarpLess decide *which* subject a screen belongs to. Whether you're studying at all is judged from the screen itself. In both screen check modes, the keywords that work best are words that actually appear on screen while you study the course: in the window title, the slides, the document or the web page.

**Use terms that only show up in that course:**

- the course code: `BIO101`, `CS210`
- the textbook's title or author, and your lecturer's name
- topic names: `mitosis`, `Krebs cycle`, `organelle`
- the course website or platform name, if only that course uses it

**Avoid generic words** that fit any subject, such as `lecture`, `notes`, `chapter`, `exam`, `study`, `homework` or `slides`. They show up on every course's screens, so they make your subjects harder to tell apart, not easier.

**Give overlapping courses different keywords.** If two of your courses are close, like *Algorithms* and *Data Structures*, give each one keywords the other doesn't have: `Dijkstra, dynamic programming` for one and `linked list, hash table` for the other. Don't put the same keyword on both.

A few more tips:

- **Put your most specific keywords first.** In the Vision LLM (Ollama) mode, the AI model sees up to 8 keywords per course.
- **Whole words only.** In the on-device classifier mode a keyword has to match a whole word on screen. `cell` doesn't match "cellular", so add both if you need them.
- **Don't leave a course empty.** A course with no keywords is harder to recognise, especially in the on-device classifier mode, which leans on the words it reads on screen.
- **Check the result.** After a session, look at its **Timeline**. If checks landed on the wrong subject, relabel them and add a keyword that was on screen at the time.

## Friends

Friends is **off by default**, and while it's off nothing leaves your computer. Turned on, you can share the stats of finished sessions and see your friends' sessions.

1. Open **Friends** and choose **Turn on Friends**, or switch it on in **Settings → Friends**.
2. **Create an account** with a username (3–20 letters, numbers or underscores) and a password. You need to be 16 or older.
3. **Add a friend:** on the **Friends** tab, type their exact username and **Send request**. Requests from others show up there to **Accept** or **Decline**.
4. **Share a session:** on its summary, add an optional caption and press **Post to friends**. Posts show up in your friends' **Feed**.

A post carries your focus time, focus score, subject breakdown and streak. Never screenshots, window titles or app names.

- **Your own server.** You can run Friends on a Supabase project of your own instead: **Settings → Friends → Use your own server**.
- **Leaving.** Sign out or delete your account in **Settings → Account**. Deleting your account removes your username, friends and posts. Your history on your computer stays.

## Settings

- **Appearance:** light, dark, or follow the system.
- **Friends** and **Account:** see [Friends](#friends).
- **Local AI**
  - **Screen check:** switch between the on-device classifier and the Vision LLM (Ollama), and download the classifier.
  - **Model**, **Ollama URL** and **Status:** the Ollama model and its address. The address must be on your own computer.
  - **Memory saver** runs Ollama without a prompt cache that can hold up to 8 GB of memory.
- **Focus**
  - **Power** sets how often labels are recorded.
  - **Strictness** sets how soon alerts come.
  - **Pomodoro** sets the default preset.
  - **Webcam** turns away and phone detection on or off.
  - **Now playing** turns the song strip on the timer on or off.
  - **Demo fast mode** makes alerts come after 20 seconds, for trying them out.
- **Sound:** chimes and alerts, the default background sound, and volume.
- **About**
  - **Guide** opens this page.
  - **Send feedback** opens a GitHub issue. Issues are public.
  - **Privacy Policy**, **Terms of Use** and **Acknowledgements**.
  - **Onboarding → Run again** walks you through setup again.

## Command palette and shortcuts

Press **⌘K** to open the command palette. Type to filter, use the arrow keys to choose, and press Return to run a command. It can start, pause, resume or end a session, start a demo, skip a break, show the floating timer, go to any page, switch light or dark mode, sign in or out, and open this guide.

| Shortcut | Action |
| --- | --- |
| ⌘K | Command palette |
| ⌘Return | Start session |
| ⌘. | End session |
| ⌥-click **Start session** | Demo session |

## Privacy in short

- Screenshots and webcam images are analysed in memory on your computer and then thrown away. They are never saved or sent anywhere.
- Only labels are saved. Window titles never are.
- Nothing is captured during breaks or while you're away.
- Your history stays on your computer. Friends sees only the stats you choose to post.

The [Privacy Policy](PRIVACY.md) has the details.

## Troubleshooting

- **Every check says "Not sure".**
  - In the on-device classifier mode, check that the classifier is downloaded in **Settings → Local AI**.
  - In the Ollama mode, check the **Status** row there: Ollama has to be running with the model downloaded.
  - On a Mac, also check that Screen Recording is allowed, and relaunch LarpLess after allowing it.
- **Checks are slow.** Pick **Eco** in **Settings → Focus → Power**, or switch to the on-device classifier.
- **A course gets the wrong label.** Make its keywords more specific (see [Choosing keywords](#choosing-keywords)), and relabel the wrong checks in the summary's timeline.
- **No away or phone detection.** Turn on **Settings → Focus → Webcam** and allow camera access for LarpLess in your system settings.
- **Something else.** **Settings → About → Send feedback** opens a GitHub issue with your app version filled in. You can also email support@larpless.app.
