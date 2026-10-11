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

function paintHeat() {
  const host = document.querySelector<HTMLElement>('#heat');
  if (!host) return;
  // 16 weeks, Monday to Sunday. Early weeks are empty. Later weeks are the streak.
  const weeks = [
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
}

function ipadScroll() {
  const card = document.querySelector<HTMLElement>('#ipad');
  if (!card) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clear = () => {
    card.classList.remove('ipad-scroll');
    card.style.transform = 'none';
  };
  if (reduce.matches) {
    clear();
    return;
  }

  if (CSS.supports('animation-timeline', 'scroll()')) {
    card.classList.add('ipad-scroll');
    card.style.transform = '';
    return;
  }

  let frame = 0;
  const apply = () => {
    frame = 0;
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

paintHeat();
revealOnScroll();
ipadScroll();
