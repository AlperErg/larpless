/**
 * Launch cover for Mac and Windows: the app icon's monitor (brand/larpless-icon.svg, #67)
 * wakes up. It rises in with its eyes shut, opens them looking straight at you
 * ("locked in"), blinks, then glances aside and stops in the icon's own pose while the
 * serif name settles. If the app is still loading after that, it keeps blinking now and
 * then, so nothing freezes on screen.
 * The eyes are holes in the body, as in the icon, so the darker slab underneath shows
 * through their top edge; a shut eye is a short dash, the icon's "away" face.
 * The SVG sits in plain Views and is redrawn from a timer, never inside an
 * Animated.View: Windows Fabric drops painted content out of those (see platform.ts).
 */
import { memo, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { brand, colors, themed } from '../theme';
import { Text } from './Text';

export const BOOT_INTRO_MS = 1200;
export const BOOT_EXIT_MS = 280;

/** On-screen size of the mascot, px. */
const MARK = 128;
/** The icon's own viewBox (its 1024 canvas trimmed to the artwork). */
const VIEWBOX = '55 95 914 914';
/** The slab under the body is the same outline, moved down this far. */
const BASE_DY = 42;

// Eye geometry in icon units. The icon draws the glance: eyes at x 606 and 770.
const EYE_W = 96;
const EYE_H = 200;
const EYE_CY = 450;
/** Looking straight ahead, the pair is centred on the body (x 512). */
export const EYE_CENTERS = [430, 594] as const;
/** How far the eyes travel to reach the icon's pose. */
export const GLANCE_DX = 176;
/** A shut eye: the "away" dash, a little wider than an open eye and thinner than the slab's lip. */
const SHUT_W = 112;
const SHUT_H = 28;

// Timeline, ms from mount.
const RISE = { at: 0, dur: 320 };
const OPEN = { at: 280, dur: 200 };
const BLINK = { at: 640, dur: 170 };
const GLANCE = { at: 880, dur: 300 };
const WORD = { at: 760, dur: 360 };
/** While the app is still loading, blink every `IDLE_EVERY` ms from `IDLE_FROM`. */
export const BOOT_IDLE_FROM = BOOT_INTRO_MS + 600;
export const BOOT_IDLE_EVERY = 2400;

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Fast start, long settle. Same family as the site's `--ease`. */
export function easeOut(t: number): number {
  return 1 - (1 - clamp01(t)) ** 3;
}

function easeIn(t: number): number {
  const x = clamp01(t);
  return x * x;
}

function easeInOut(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

function progress(elapsed: number, span: { at: number; dur: number }): number {
  return clamp01((elapsed - span.at) / span.dur);
}

/** 0 → 1 → 0 over `dur` from `at`: the lids close and reopen. */
function pulse(elapsed: number, span: { at: number; dur: number }): number {
  const x = (elapsed - span.at) / span.dur;
  return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x);
}

export interface BootPose {
  /** The mascot rising in: 0 hidden, 1 in place. */
  body: number;
  /** Eye offset from straight ahead, icon units; `GLANCE_DX` is the icon's pose. */
  eyeX: number;
  /** 0 eyes open, 1 shut. */
  lid: number;
  word: number;
  /** 1 while the cover is opaque, 0 once it has left. */
  cover: number;
  done: boolean;
}

/** Pose at `elapsed` ms. `exitAt` is the elapsed time the exit began, once the app is ready. */
export function bootPose(elapsed: number, exitAt: number | null, reduced: boolean): BootPose {
  if (reduced) {
    return { body: 1, eyeX: GLANCE_DX, lid: 0, word: 1, cover: 1, done: false };
  }
  const idle = elapsed >= BOOT_IDLE_FROM ? pulse((elapsed - BOOT_IDLE_FROM) % BOOT_IDLE_EVERY, { at: 0, dur: BLINK.dur }) : 0;
  const exitT = exitAt == null ? 0 : clamp01((elapsed - exitAt) / BOOT_EXIT_MS);
  return {
    body: easeOut(progress(elapsed, RISE)),
    eyeX: easeInOut(progress(elapsed, GLANCE)) * GLANCE_DX,
    lid: Math.max(1 - easeOut(progress(elapsed, OPEN)), pulse(elapsed, BLINK), idle),
    word: easeOut(progress(elapsed, WORD)),
    cover: 1 - easeIn(exitT),
    done: exitAt != null && elapsed - exitAt >= BOOT_EXIT_MS,
  };
}

function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * One eye hole: a pill centred on (cx, cy), traced counter-clockwise so the nonzero
 * fill cuts it out of the clockwise body (evenodd would also cut where the neck
 * and foot overlap the screen).
 */
export function eyeHole(cx: number, cy: number, w: number, h: number): string {
  const r = Math.min(w, h) / 2;
  const l = cx - w / 2;
  const rt = cx + w / 2;
  const t = cy - h / 2;
  const b = cy + h / 2;
  const arc = (x: number, y: number) => `A${n(r)},${n(r)} 0 0 0 ${n(x)},${n(y)}`;
  return (
    `M${n(cx)},${n(t)} H${n(l + r)} ${arc(l, t + r)} V${n(b - r)} ${arc(l + r, b)} ` +
    `H${n(rt - r)} ${arc(rt, b - r)} V${n(t + r)} ${arc(rt - r, t)} Z`
  );
}

/** Screen, neck and foot (clockwise), then both eye holes, all moved down by `dy`. */
export function mascotPath(eyeX: number, lid: number, dy = 0): string {
  const y = (v: number) => n(v + dy);
  const outline =
    `M300,${y(170)} H724 A190,190 0 0 1 914,${y(360)} V${y(570)} A190,190 0 0 1 724,${y(760)} ` +
    `H300 A190,190 0 0 1 110,${y(570)} V${y(360)} A190,190 0 0 1 300,${y(170)} Z ` +
    `M432,${y(700)} H592 V${y(850)} H432 Z ` +
    `M352,${y(812)} H672 A40,40 0 0 1 672,${y(892)} H352 A40,40 0 0 1 352,${y(812)} Z`;
  const k = clamp01(lid);
  const w = EYE_W + (SHUT_W - EYE_W) * k;
  const h = EYE_H + (SHUT_H - EYE_H) * k;
  const eyes = EYE_CENTERS.map((cx) => eyeHole(cx + eyeX, EYE_CY + dy, w, h)).join(' ');
  return `${outline} ${eyes}`;
}

const SHINE = 'M250,300 A150,150 0 0 1 380,232';

/** Re-renders only when the face changes; the inputs are rounded so still frames are skipped. */
const Mascot = memo(function Mascot({ eyeX, lid }: { eyeX: number; lid: number }) {
  return (
    <Svg width={MARK} height={MARK} viewBox={VIEWBOX}>
      <Defs>
        <LinearGradient id="fl-boot-body" x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" stopColor={brand.bodyTop} />
          <Stop offset="1" stopColor={brand.bodyBottom} />
        </LinearGradient>
      </Defs>
      <Path d={mascotPath(eyeX, lid, BASE_DY)} fill={brand.base} />
      <Path d={mascotPath(eyeX, lid)} fill="url(#fl-boot-body)" />
      <Path d={SHINE} fill="none" stroke={brand.shine} strokeOpacity={0.5} strokeWidth={38} strokeLinecap="round" />
    </Svg>
  );
});

/**
 * Milliseconds since mount, stepped by a 16 ms timer. Not requestAnimationFrame: on
 * the RN 0.81 event loop its callbacks land inside React's commit, so a state update
 * every frame counts as nested and trips "Maximum update depth exceeded" on Windows.
 * Poses come from the clock, not a frame count, so timer jitter never changes speed.
 */
function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    let alive = true;
    const started = Date.now();
    let timer = 0;
    const tick = () => {
      if (!alive) return;
      setElapsed(Date.now() - started);
      timer = setTimeout(tick, 16) as unknown as number;
    };
    timer = setTimeout(tick, 16) as unknown as number;
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [running]);
  return elapsed;
}

export function BootScreen({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [reduced, setReduced] = useState(false);
  const [exitAt, setExitAt] = useState<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finished = useRef(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive && v) setReduced(true);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      if (alive) setReduced(v);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const elapsed = useElapsed(!reduced);
  const pose = bootPose(elapsed, exitAt, reduced);

  useEffect(() => {
    if (!ready || finished.current) return;
    if (reduced) {
      finished.current = true;
      onDoneRef.current();
      return;
    }
    // Set once; calling setState here on every frame of the exit would be a needless update per tick.
    if (elapsed < BOOT_INTRO_MS || exitAt != null) return;
    setExitAt(elapsed);
  }, [ready, reduced, elapsed, exitAt]);

  useEffect(() => {
    if (!pose.done || finished.current) return;
    finished.current = true;
    onDoneRef.current();
  }, [pose.done]);

  return (
    <View
      testID="boot-screen"
      accessibilityRole="image"
      accessibilityLabel="LarpLess"
      pointerEvents="auto"
      style={[styles.fill, { opacity: pose.cover }]}>
      <View
        testID="boot-mascot"
        style={{
          opacity: pose.body,
          transform: [{ translateY: (1 - pose.body) * 12 }, { scale: 0.9 + 0.1 * pose.body }],
        }}>
        <Mascot eyeX={Math.round(pose.eyeX * 2) / 2} lid={Math.round(pose.lid * 100) / 100} />
      </View>
      <View style={{ opacity: pose.word, transform: [{ translateY: (1 - pose.word) * 14 }] }}>
        <Text serif center style={styles.word}>
          LarpLess
        </Text>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    fill: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 30,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bg,
    },
    word: {
      marginTop: 18,
      fontSize: 44,
      lineHeight: 52,
      letterSpacing: -1.2,
      color: colors.text,
    },
  }),
);
