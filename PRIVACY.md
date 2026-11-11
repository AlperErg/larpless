# LarpLess Privacy Policy

**Last updated: 11 November 2026**

LarpLess is a study tracker for Mac and Windows. It looks at your screen and webcam to tell when you're studying, and it's built so that what it sees stays on your computer. This policy explains what LarpLess handles, where it goes, and what you can do about it. LarpLess is open source, so you can check every claim here in the code.

**The short version**

- Screenshots and webcam images are analysed in your computer's memory and then thrown away. They are never saved, and never sent over the internet.
- Your study history is saved only on your computer.
- **Friends is off by default.** Until you turn it on, LarpLess sends nothing to me or to anyone else, apart from downloads you start yourself (see [Downloads you start](#downloads-you-start)).
- If you turn Friends on, my server stores your username, your friend requests and friendships, and the stats of sessions you choose to post.
- The app has no ads, analytics or tracking. The website counts visits with cookieless analytics (see [The website](#3-the-website)). I don't sell your data or use it to train AI models.

## Who is responsible

LarpLess and its Friends server are run by **Mustafa Alper Ergüne** ("I", "me"), an individual based in Turkey. For the data on the Friends server, I am the data controller (*veri sorumlusu* under Turkish Law No. 6698 on the Protection of Personal Data, "KVKK", and the controller under the EU and UK General Data Protection Regulation, "GDPR", where it applies).

Contact: **privacy@ergune.dev** for privacy questions and requests, **support@larpless.app** for feedback and help with the app.

LarpLess is built by several contributors. Contributing code gives nobody access to your data: I alone administer the Friends server. If you connect LarpLess to a server of your own (**Settings → Friends → Use your own server**), whoever runs that server is responsible for the data on it, and the Friends part of this policy doesn't apply to it.

## 1. On your computer

### What LarpLess looks at, then throws away

LarpLess reads your screen and webcam only during a study session. When it needs to see the screen, it takes a screenshot and has an AI model on your computer judge it. Depending on the screen check mode, that's Ollama, a separate app running on your own computer at `127.0.0.1`, or the on-device classifier built into LarpLess.

| What | Why | What happens to it |
| --- | --- | --- |
| Screenshots | To tell whether the screen shows studying, and which subject | Analysed in memory on your computer, then discarded. Never saved, logged or sent over the internet. |
| Text read from the screen, and image features (on-device classifier only) | The same | Kept in memory inside LarpLess, then discarded. Only scores leave the model. |
| The name and title of the window in front | To tell apps and websites apart without a screenshot | Used in memory. The window title is never saved. |
| Webcam images, one per second (only if you allow the camera) | To tell whether you're at your desk and whether you've picked up your phone | Analysed in memory on your computer, then discarded. |
| The song that's playing | The now-playing strip on the floating timer | Shown in the timer only. Never saved, logged or passed to the rest of the app. |
| Your computer's chip and memory | To recommend a screen check mode during setup | Read once. Not saved or sent. |

No screenshots are taken outside a study session, during Pomodoro breaks, or while the webcam shows you're away from your desk.

### What LarpLess saves on your computer

This is kept in the app's data folder: `~/Library/Application Support/com.larpless.app` on a Mac, and the app's local data folder (`LocalState`) on Windows.

- **Your sessions:** when each one started and ended, the time you studied, your focus score, the time per subject and the Pomodoros you finished.
- **A timeline for each session**, with one entry every 10 to 30 seconds. Each entry records whether you were studying, distracted, away or unknown, the subject, the kind of distraction (such as "Social media") or the study tool (such as "Vivado"), the name of the app in front (such as "Safari"), and how the label was decided. It never records window titles, screenshots or images.
- **Your courses** (names, colours and keywords) and your settings. If you use your own Friends server, its address and publishable key are saved with the settings.
- **The on-device classifier's model files**, if you download them (about 460 MB).
- **Your Friends sign-in token**, if you use Friends: in the macOS Keychain, or on Windows in a file encrypted for your Windows user account. Signing out, or deleting your account, removes it.

LarpLess also writes technical messages to your computer's logs, such as how long a check took. They never contain anything from your screen or camera.

None of this reaches me. You can delete a session on the **History** page. To delete everything on a Mac, delete the folder above. On Windows, uninstalling LarpLess deletes its local data folder.

### Downloads you start

- **On-device classifier:** downloaded from Hugging Face (`huggingface.co`), which receives your IP address and the names of the files requested. Hugging Face's privacy policy applies.
- **Ollama:** **Download Ollama** opens `ollama.com` in your browser. **Download model** asks Ollama, which is a separate app on your computer, to fetch the AI model from Ollama's servers. Ollama's privacy policy applies.

The app has no analytics, crash reporting, advertising or tracking, and it doesn't check for updates.

## 2. Friends (only if you turn it on)

Friends lets you post a finished session's stats for your friends to see. It's off until you turn it on in **Settings → Friends** or on the Friends page. While it's off, LarpLess doesn't connect to the Friends server at all.

### What the Friends server stores

| Data | What it is | Who can see it |
| --- | --- | --- |
| **Account** | Your username; a placeholder email address made from it (`username@larpless.local`, which can't receive mail); your password, stored only as a one-way hash, so nobody can read it, me included; when you created the account and last signed in | Me, as administrator. Your username is visible to your friends and to anyone you've sent a friend request to or had one from. Anyone else can find your account only by typing your exact username. |
| **Sign-in sessions** | For each device you're signed in on: its IP address, its user agent (a short description of the app and operating system) and when you signed in | Me, as administrator |
| **Friend requests and friendships** | Who sent a request to whom, whether it was accepted, and when | You and the other person |
| **Limit records** | When you sent a friend request, looked up a username or posted, used to enforce limits against spam | Nobody; only the server's limit checks read them |
| **Posts** | Only sessions you choose to post: when the session started, the time you studied, your focus score, Pomodoros, streak, the subject breakdown (subject names, including the names of your own courses, with the time and share for each, and the time you were distracted), the caption you write (up to 280 characters), the app's ID for the session (made from its start time), which stops it being posted twice, and when you posted | You and your accepted friends |

Posts never include your session timeline, screenshots, images, window titles, app names, or anything else from your screen or camera. A caption is free text, so don't write anything in it you wouldn't want your friends to read.

The service also keeps **technical logs**. The hosting provider records each request to the server, including the IP address it came from and the time, so the service can run and be kept secure. These logs are deleted automatically after 1 day, and logs of sign-in events after 1 hour.

### Why I process it

| Purpose | Data | Legal basis |
| --- | --- | --- |
| Running your account and Friends: signing you in, handling friend requests, showing your posts to your friends | Account, sign-in sessions, friendships, posts | Necessary to provide the service you asked for (KVKK Art. 5(2)(c); GDPR Art. 6(1)(b)) |
| Keeping the service secure, preventing abuse and fixing problems | Sign-in sessions, limit records, technical logs | My legitimate interest in a secure, working service (KVKK Art. 5(2)(f); GDPR Art. 6(1)(f)) |
| Meeting a legal obligation, such as a valid order from a court or authority | Only what the obligation requires | Legal obligation (KVKK Art. 5(2)(ç); GDPR Art. 6(1)(c)) |

The data is collected electronically, through the LarpLess app, when you create an account and use Friends.

I don't use your data for advertising, sell it, share it with data brokers, or use it to train AI models. Nobody makes decisions about you based solely on automated processing of it.

### Who processes it, and where

The Friends server runs on **Supabase**, which hosts the database and the sign-in system for me as a data processor. The data is stored in Supabase's **West EU (Ireland)** region, so it is transferred outside Turkey. Supabase and its subprocessors, such as cloud hosting and network providers, may also handle it in other countries. Supabase does this under its Data Processing Agreement, which includes the European Commission's Standard Contractual Clauses. Its subprocessors are listed at <https://supabase.com/legal/customer-resources/subprocessor-list>.

I don't share the data with anyone else, unless the law requires it.

### How long it's kept

- **Account, friendships and posts:** until you delete your account, or I delete it under the [Terms of Use](TERMS.md). Removing a friend deletes that friendship, and they stop seeing your posts. When you delete a session you posted, you can delete its post with it.
- **Sign-in sessions:** until you sign out on that device, or delete your account.
- **Limit records:** 1 day.
- **Technical logs:** 1 day. Logs of sign-in events: 1 hour.

When you delete your account (**Settings → Account → Delete account**), your account, profile, friendships, posts, limit records and sign-in sessions are deleted from the server straight away. If I ever shut the Friends service down, I'll delete its data.

### Security

All connections to the server use HTTPS. The database's access rules let only you and your friends read your posts, and stop anyone else from changing your account or posts. Passwords are stored as hashes, and your sign-in token on your computer is kept in the Keychain, or encrypted for your Windows user account. No system is perfectly secure. If a breach affects your data, I'll notify the authorities and the people affected, as the law requires.

### Age

You must be **16 or older** to create a Friends account. If I learn that someone under 16 has an account, I'll delete it. Parents and guardians can contact me at privacy@ergune.dev. LarpLess itself works without an account.

## 3. The website

The LarpLess website is hosted by Netlify, which processes your IP address and request details to deliver the page and protect it from abuse. The page loads its fonts from Google Fonts, so Google also receives your IP address and browser details. The website sets no cookies and has no forms. It counts visits with Umami, a cookieless analytics service: when you load a page or click certain links, the page URL, referrer, browser, operating system, screen size, language and approximate country are sent to Umami through the website's own domain. Umami doesn't store your IP address or follow you across sites, and the website can't identify you from it. Netlify's, Google's and Umami's privacy policies apply.

## 4. Your rights

Under KVKK, and under the GDPR if you're in the EU, EEA or UK, you can ask me:

- whether I process your data, and for a copy of it, with what I use it for and who receives it;
- to correct data that's wrong;
- to delete it, including a single post;
- to restrict my use of it, or object to uses based on my legitimate interests;
- for your account data and posts in a machine-readable format;
- to tell anyone I've passed your data to about a correction or deletion;
- under KVKK, to object to a result that is against you and comes solely from automated analysis, and to claim compensation if unlawful processing harmed you.

You can do several of these yourself: turn Friends off, remove friends, delete sessions on your computer, or delete your account in **Settings → Account → Delete account**.

For anything else, email **privacy@ergune.dev** with your username. I may ask you to show that the account is yours before acting. I'll answer within 30 days, free of charge.

If you're not happy with my answer, you can complain to a data protection authority:

- **In Turkey:** the Personal Data Protection Board (*Kişisel Verileri Koruma Kurulu*). Under KVKK you first apply to me. You can then complain to the Board within 30 days of my answer, or within 60 days of your request if I don't answer.
- **In the EU, EEA or UK:** the data protection authority where you live or work.

## 5. Changes to this policy

I'll update this file whenever LarpLess changes what it handles, and change the date at the top. Every earlier version is kept in the project's Git history. If a change significantly affects data on the Friends server, I'll announce it on the project's GitHub page before it takes effect.

## Contact

Mustafa Alper Ergüne · **privacy@ergune.dev**

Feedback and support: **support@larpless.app**
