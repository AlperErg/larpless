const tones = ['green', 'red', 'gray', 'blue'] as const;
type Tone = (typeof tones)[number];

const SCORE_WEEKS = [
  '0000000',
  '0000000',
  '0000000',
  '0000000',
  '1002000',
  '2102100',
  '0010200',
  '2312010',
  '3231200',
  '1023200',
  '3324310',
  '2343200',
  '4332410',
  '3423300',
  '4434320',
  '3443200',
];

/** 16 weeks, Monday to Sunday. The last `streak` days through `endDay` (0 = Mon) are the run. */
function streakWeeks(streak: number, endDay: number): string[] {
  const weeks = 16;
  const cells = Array.from({ length: weeks * 7 }, () => 0);
  const today = (weeks - 1) * 7 + endDay;
  for (let i = 0; i < streak; i++) {
    const idx = today - i;
    if (idx < 0) break;
    cells[idx] = 4 - (i % 3);
  }
  for (const back of [20, 24, 28, 33, 41, 46, 52, 60, 67, 74]) {
    const idx = today - back;
    if (idx < 0 || back <= streak) continue;
    cells[idx] = 1 + (back % 3);
  }
  const out: string[] = [];
  for (let w = 0; w < weeks; w++) out.push(cells.slice(w * 7, w * 7 + 7).join(''));
  return out;
}

function paintHeat() {
  document.querySelectorAll<HTMLElement>('.heat').forEach((host) => {
    if (host.childElementCount > 0) return;
    const streak = Number(host.dataset.streak);
    const end = Number(host.dataset.end);
    const weeks =
      Number.isFinite(streak) && streak > 0 ? streakWeeks(streak, Number.isFinite(end) ? end : 6) : SCORE_WEEKS;
    const frag = document.createDocumentFragment();
    weeks.forEach((week, weekIndex) => {
      for (const level of week) {
        const cell = document.createElement('i');
        cell.dataset.l = level;
        cell.style.animationDelay = `${weekIndex * 40}ms`;
        frag.append(cell);
      }
    });
    host.append(frag);
  });
}

function ipadScroll() {
  const card = document.querySelector<HTMLElement>('#ipad');
  if (!card) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  // The tilt needs room around the frame. iPhone and iPad viewports don't have it.
  const room = window.matchMedia('(min-width: 1100px) and (min-height: 900px)');

  const clear = () => {
    card.classList.remove('ipad-scroll');
    card.style.transform = '';
  };

  let frame = 0;
  const apply = () => {
    frame = 0;
    if (reduce.matches || !room.matches) {
      clear();
      return;
    }

    if (CSS.supports('animation-timeline', 'scroll()')) {
      card.classList.add('ipad-scroll');
      card.style.transform = '';
      return;
    }

    const range = window.innerHeight * 0.85;
    const progress = Math.min(1, Math.max(0, window.scrollY / range));
    const scale = 1.05 + (1 - 1.05) * progress;
    const rotate = 18 * (1 - progress);
    card.style.transform = `rotateX(${rotate}deg) scale(${scale})`;
  };
  const onScroll = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(apply);
  };

  apply();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  reduce.addEventListener('change', apply);
  room.addEventListener('change', apply);
}

function revealOnScroll() {
  const nodes = document.querySelectorAll('section h2, figure, .summary, .steps, .stage, .callout, .closer, .feed');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  nodes.forEach((node) => node.classList.add('reveal'));
  if (reduce) {
    nodes.forEach((node) => node.classList.add('in'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.16, rootMargin: '0px 0px -6% 0px' },
  );
  nodes.forEach((node) => observer.observe(node));
}

/**
 * The floating-panel demo in "How it works". Like the real panel, the session clock runs while you
 * study, drift or step away, and a break counts down. While it's on screen and untouched, it tours
 * the four states; picking a state yourself ends the tour.
 */
function bindPanelDemo() {
  const stage = document.querySelector<HTMLElement>('#stage');
  const time = document.querySelector<HTMLElement>('#float-time');
  const label = document.querySelector<HTMLElement>('#float-label');
  const note = document.querySelector<HTMLElement>('#panel-note');
  const chips = document.querySelector<HTMLElement>('.panel-tools .chips');
  const tools = document.querySelector<HTMLElement>('.panel-tools');
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel]'));
  if (!stage || !time || !label || !note || !chips || !tools || tabs.length === 0) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const toSecs = (text: string | undefined) => {
    const [m, sec] = (text ?? '0:0').split(':').map(Number);
    return (m || 0) * 60 + (sec || 0);
  };
  const fmt = (secs: number) => {
    const m = Math.floor(secs / 60);
    return `${String(m).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  };

  let current = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0];
  let elapsed = toSecs(tabs[0].dataset.time);
  let breakLeft = toSecs(tabs.find((tab) => tab.dataset.tone === 'blue')?.dataset.time);
  const breakStart = breakLeft;
  const isBreak = () => current.dataset.tone === 'blue';
  const paintTime = () => {
    time.textContent = fmt(isBreak() ? breakLeft : elapsed);
  };

  // The text changes at once (so it's never stale, even mid-click or in a background tab);
  // the motion is only visual: the new label rises into place and sharpens.
  const swapLabel = (text: string) => {
    if (label.textContent === text) return;
    label.textContent = text;
    if (reduce.matches || typeof label.animate !== 'function') return;
    label.getAnimations().forEach((animation) => animation.cancel());
    label.animate(
      [
        { opacity: 0, transform: 'translateY(7px)', filter: 'blur(3px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ],
      { duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  };

  const select = (tab: HTMLButtonElement) => {
    const tone = tab.dataset.tone;
    if (!tone || !tones.includes(tone as Tone)) return;
    const enteringBreak = tone === 'blue' && !isBreak();
    current = tab;
    tabs.forEach((other) => {
      const on = other === tab;
      other.setAttribute('aria-selected', on ? 'true' : 'false');
      other.tabIndex = on ? 0 : -1;
    });
    if (enteringBreak) breakLeft = breakStart;
    stage.dataset.tone = tone;
    swapLabel(tab.dataset.label ?? '');
    note.textContent = tab.dataset.note ?? '';
    paintTime();
  };

  // The clock: one tick a second, only while the demo is on screen and the tab is visible.
  let onScreen = false;
  let clock = 0;
  const runClock = () => {
    const want = onScreen && !document.hidden;
    if (want && !clock) {
      clock = window.setInterval(() => {
        if (isBreak()) breakLeft = Math.max(0, breakLeft - 1);
        else elapsed += 1;
        paintTime();
      }, 1000);
    } else if (!want && clock) {
      window.clearInterval(clock);
      clock = 0;
    }
  };

  // The tour: the active chip's progress line is the timer; its animationend advances the state.
  let touring = !reduce.matches;
  let held = false;
  const syncTour = () => {
    chips.classList.toggle('tour', touring);
    chips.classList.toggle('tour-paused', touring && (held || !onScreen || document.hidden));
  };
  const endTour = () => {
    if (!touring) return;
    touring = false;
    note.setAttribute('aria-live', 'polite');
    syncTour();
  };
  chips.addEventListener('animationend', (event) => {
    if (!touring || event.animationName !== 'chip-fill') return;
    const next = tabs[(tabs.indexOf(current) + 1) % tabs.length];
    select(next);
  });
  // Hovering or focusing the demo holds the tour so people can read it.
  const hold = (on: boolean) => {
    held = on;
    syncTour();
  };
  for (const area of [stage, tools]) {
    area.addEventListener('pointerenter', () => hold(true));
    area.addEventListener('pointerleave', () => hold(tools.contains(document.activeElement)));
  }
  tools.addEventListener('focusin', () => hold(true));
  tools.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node && tools.contains(event.relatedTarget))) hold(false);
  });
  reduce.addEventListener('change', () => {
    if (reduce.matches) endTour();
  });

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      endTour();
      select(tab);
    });
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const next = event.key === 'ArrowRight' ? index + 1 : index - 1;
      const target = tabs[(next + tabs.length) % tabs.length];
      target.focus();
      endTour();
      select(target);
    });
  });

  const seen = new IntersectionObserver(
    (entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      runClock();
      syncTour();
    },
    { threshold: 0.35 },
  );
  seen.observe(stage);
  document.addEventListener('visibilitychange', () => {
    runClock();
    syncTour();
  });

  paintTime();
  syncTour();
}

function bindScoreBar() {
  const summary = document.querySelector<HTMLElement>('#score .summary');
  const zone = summary?.querySelector<HTMLElement>('.score-hit');
  if (!summary || !zone) return;
  const segs = Array.from(zone.querySelectorAll<HTMLElement>('.bar .seg'));
  const rows = Array.from(zone.querySelectorAll<HTMLElement>('.legend li[data-seg]'));
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const paint = (index: number | null) => {
    summary.classList.toggle('lit', index !== null);
    segs.forEach((seg, i) => seg.classList.toggle('hot', i === index));
    rows.forEach((row, i) => row.classList.toggle('hot', i === index));
  };

  const indexOf = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return -1;
    const seg = target.closest('.bar .seg');
    if (seg instanceof HTMLElement && zone.contains(seg)) return segs.indexOf(seg);
    const row = target.closest('.legend li[data-seg]');
    if (row instanceof HTMLElement && zone.contains(row)) return rows.indexOf(row);
    return -1;
  };

  // Play the split once when the bar first comes into view, so people learn it opens.
  let touched = false;
  const explore = () => {
    touched = true;
    summary.classList.add('explored');
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) {
    const intro = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        intro.disconnect();
        window.setTimeout(() => {
          if (touched) return;
          paint(0);
          window.setTimeout(() => {
            if (!touched) paint(null);
          }, 2600);
        }, 1100);
      },
      { threshold: 0.9 },
    );
    intro.observe(zone);
  }

  if (coarse) {
    zone.addEventListener('click', (event) => {
      const index = indexOf(event.target);
      if (index < 0) return;
      explore();
      paint(segs[index]?.classList.contains('hot') ? null : index);
    });
    return;
  }

  zone.addEventListener('pointerover', (event) => {
    const index = indexOf(event.target);
    if (index < 0) return;
    explore();
    paint(index);
  });
  zone.addEventListener('pointerleave', () => {
    const active = document.activeElement;
    if (active instanceof Element && zone.contains(active) && indexOf(active) >= 0) return;
    paint(null);
  });
  zone.addEventListener('focusin', (event) => {
    const index = indexOf(event.target);
    if (index < 0) return;
    explore();
    paint(index);
  });
  zone.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && zone.contains(next)) return;
    paint(null);
  });
}

const GUIDES = { mac: '#getting-started-on-mac', win: '#getting-started-on-windows' } as const;
type Os = keyof typeof GUIDES;

function bindTerminal() {
  const term = document.querySelector<HTMLElement>('#term');
  if (!term) return;
  const tabs = Array.from(term.querySelectorAll<HTMLButtonElement>('.term-tab'));
  const panels = Array.from(term.querySelectorAll<HTMLElement>('.term-lines[data-os]'));
  const copy = term.querySelector<HTMLButtonElement>('#term-copy');
  const label = copy?.querySelector<HTMLElement>('.term-copy-label');
  const status = term.querySelector<HTMLElement>('#term-status');
  const guide = document.querySelector<HTMLAnchorElement>('[data-guide]');
  let os: Os = 'mac';

  const select = (next: Os) => {
    os = next;
    tabs.forEach((tab) => {
      const on = tab.dataset.os === next;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    panels.forEach((panel) => (panel.hidden = panel.dataset.os !== next));
    if (guide) guide.href = guide.href.replace(/#.*$/, GUIDES[next]);
  };

  if (/Windows/i.test(navigator.userAgent)) select('win');

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.dataset.os as Os));
    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const target = tabs[(index + step + tabs.length) % tabs.length];
      target.focus();
      select(target.dataset.os as Os);
    });
  });

  let reset = 0;
  const show = (text: string, done: boolean) => {
    if (!copy || !label) return;
    label.textContent = text;
    if (done) copy.dataset.done = '';
    else delete copy.dataset.done;
  };
  copy?.addEventListener('click', async () => {
    const panel = panels.find((p) => p.dataset.os === os);
    if (!panel) return;
    const text = Array.from(panel.querySelectorAll('.term-cmd'))
      .map((cmd) => cmd.textContent ?? '')
      .join('\n');
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    show(ok ? 'Copied' : 'Copy failed', ok);
    if (status) status.textContent = ok ? 'Commands copied to the clipboard' : 'Could not copy. Select the commands instead.';
    window.clearTimeout(reset);
    reset = window.setTimeout(() => {
      show('Copy', false);
      if (status) status.textContent = '';
    }, 2000);
  });
}

/** On phones the header tucks away while scrolling down and returns on the way up. */
function tuckHeader() {
  const top = document.querySelector<HTMLElement>('.top');
  if (!top) return;
  const small = window.matchMedia('(max-width: 720px)');
  let last = window.scrollY;
  // Cheap enough (a class toggle) to run on every scroll event without frame batching.
  const update = () => {
    const y = window.scrollY;
    const keep = !small.matches || y < 120 || top.contains(document.activeElement);
    if (keep || y < last - 4) top.classList.remove('tucked');
    else if (y > last + 4) top.classList.add('tucked');
    last = y;
  };
  window.addEventListener('scroll', update, { passive: true });
  top.addEventListener('focusin', () => top.classList.remove('tucked'));
  small.addEventListener('change', update);
}

/** Phone menu: a native modal dialog styled as a sheet dropping from the top (Esc, focus trap and focus return come free). */
function bindMenu() {
  const button = document.querySelector<HTMLButtonElement>('#menu-btn');
  const sheet = document.querySelector<HTMLDialogElement>('#menu');
  if (!button || !sheet || typeof sheet.showModal !== 'function') return;

  button.addEventListener('click', () => {
    sheet.showModal();
    button.setAttribute('aria-expanded', 'true');
  });
  sheet.addEventListener('close', () => button.setAttribute('aria-expanded', 'false'));
  // Picking a section closes the sheet; the link's own jump still happens.
  sheet.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => sheet.close()));
  // A tap on the dimmed backdrop lands on the dialog element itself, outside its box.
  sheet.addEventListener('click', (event) => {
    if (event.target !== sheet) return;
    const box = sheet.getBoundingClientRect();
    const inside =
      event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) sheet.close();
  });
  // Past phone width the menu button is gone, so don't leave the sheet open.
  window.matchMedia('(min-width: 721px)').addEventListener('change', (event) => {
    if (event.matches && sheet.open) sheet.close();
  });
}

paintHeat();
bindPanelDemo();
revealOnScroll();
ipadScroll();
bindScoreBar();
bindTerminal();
tuckHeader();
bindMenu();
