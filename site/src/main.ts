const tones = ['green', 'red', 'gray', 'blue'] as const;
type Tone = (typeof tones)[number];

function selectPanel(tab: HTMLButtonElement) {
  const tabs = document.querySelectorAll<HTMLButtonElement>('[data-panel]');
  const stage = document.querySelector<HTMLElement>('#stage');
  const time = document.querySelector<HTMLElement>('#float-time');
  const label = document.querySelector<HTMLElement>('#float-label');
  const note = document.querySelector<HTMLElement>('#panel-note');
  if (!stage || !time || !label || !note) return;

  const tone = tab.dataset.tone;
  if (!tone || !tones.includes(tone as Tone)) return;

  tabs.forEach((other) => {
    const on = other === tab;
    other.setAttribute('aria-selected', on ? 'true' : 'false');
    other.tabIndex = on ? 0 : -1;
  });

  stage.dataset.tone = tone;
  time.textContent = tab.dataset.time ?? '';
  label.textContent = tab.dataset.label ?? '';
  note.textContent = tab.dataset.note ?? '';
}

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

document.querySelectorAll<HTMLButtonElement>('[data-panel]').forEach((tab, index, tabs) => {
  tab.addEventListener('click', () => selectPanel(tab));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = event.key === 'ArrowRight' ? index + 1 : index - 1;
    const target = tabs[(next + tabs.length) % tabs.length];
    target.focus();
    selectPanel(target);
  });
});

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

  if (coarse) {
    zone.addEventListener('click', (event) => {
      const index = indexOf(event.target);
      if (index < 0) return;
      paint(segs[index]?.classList.contains('hot') ? null : index);
    });
    return;
  }

  zone.addEventListener('pointerover', (event) => {
    const index = indexOf(event.target);
    if (index >= 0) paint(index);
  });
  zone.addEventListener('pointerleave', () => {
    const active = document.activeElement;
    if (active instanceof Element && zone.contains(active) && indexOf(active) >= 0) return;
    paint(null);
  });
  zone.addEventListener('focusin', (event) => {
    const index = indexOf(event.target);
    if (index >= 0) paint(index);
  });
  zone.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && zone.contains(next)) return;
    paint(null);
  });
}

paintHeat();
revealOnScroll();
ipadScroll();
bindScoreBar();
