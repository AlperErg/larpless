/**
 * Launch cover for Mac and Windows. The mark is the session ring (study, break,
 * distracted, away) drawn in the live theme colours, then the serif name settles.
 * Plain views only: Windows Fabric drops painted content out of Animated.View.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import type { TagColor } from '../../contracts/domain';
import { colors, tag, themed } from '../theme';
import { Text } from './Text';

export const BOOT_INTRO_MS = 1080;
export const BOOT_EXIT_MS = 280;

const RING = 104;
const CX = 52;
const CY = 58;
const RADIUS = 32;

type ArcColor = Extract<TagColor, 'green' | 'blue' | 'red' | 'gray'>;

interface Tick {
  color: ArcColor;
  /** Screen angle, 0° east, clockwise positive. Matches the brand mark. */
  deg: number;
  order: number;
}

const ARCS: { color: ArcColor; start: number; sweep: number }[] = [
  { color: 'green', start: -83, sweep: 189 },
  { color: 'blue', start: 120, sweep: 55 },
  { color: 'red', start: -171, sweep: 36 },
  { color: 'gray', start: -121, sweep: 24 },
];

function wrap(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function buildTicks(): Tick[] {
  const step = 7;
  const ticks: { color: ArcColor; deg: number }[] = [];
  for (const arc of ARCS) {
    for (let a = 3.5; a < arc.sweep - 3; a += step) {
      ticks.push({ color: arc.color, deg: arc.start + a });
    }
  }
  const origin = ARCS[0].start;
  ticks.sort((a, b) => wrap(a.deg - origin) - wrap(b.deg - origin));
  return ticks.map((t, order) => ({ ...t, order }));
}

export const BOOT_TICKS: Tick[] = buildTicks();

/** Fast start, long settle. Same family as the site's `--ease`. */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

function easeIn(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x;
}

function span(elapsed: number, start: number, dur: number): number {
  if (elapsed <= start) return 0;
  return easeOut(Math.min(1, (elapsed - start) / dur));
}

export interface BootPose {
  track: number;
  ticks: number[];
  hands: number;
  crown: number;
  word: number;
  /** 1 while the cover is opaque, 0 once it has left. */
  cover: number;
  done: boolean;
}

const TICK_AT = 80;
const TICK_STEP = 12;
const TICK_DUR = 180;

/** Pose at `elapsed` ms. `exitAt` is the elapsed time the exit began, once the app is ready. */
export function bootPose(elapsed: number, exitAt: number | null, reduced: boolean): BootPose {
  if (reduced) {
    return {
      track: 1,
      ticks: BOOT_TICKS.map(() => 1),
      hands: 1,
      crown: 1,
      word: 1,
      cover: 1,
      done: false,
    };
  }
  const ticks = BOOT_TICKS.map((_, i) => span(elapsed, TICK_AT + i * TICK_STEP, TICK_DUR));
  const last = TICK_AT + (BOOT_TICKS.length - 1) * TICK_STEP;
  const exitT = exitAt == null ? 0 : Math.min(1, (elapsed - exitAt) / BOOT_EXIT_MS);
  return {
    track: span(elapsed, 40, 240),
    ticks,
    hands: span(elapsed, last - 40, 280),
    crown: span(elapsed, last + 40, 240),
    word: span(elapsed, last + 20, 420),
    cover: 1 - easeIn(exitT),
    done: exitAt != null && elapsed - exitAt >= BOOT_EXIT_MS,
  };
}

export function BootScreen({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [elapsed, setElapsed] = useState(0);
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

  useEffect(() => {
    if (reduced) return undefined;
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
  }, [reduced]);

  const pose = bootPose(elapsed, exitAt, reduced);
  const waiting = !reduced && ready === false && elapsed >= BOOT_INTRO_MS;
  const dot = waiting ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed / 260)) : pose.hands;

  useEffect(() => {
    if (!ready || finished.current) return;
    if (reduced) {
      finished.current = true;
      onDoneRef.current();
      return;
    }
    if (elapsed < BOOT_INTRO_MS) return;
    setExitAt((at) => (at == null ? elapsed : at));
  }, [ready, reduced, elapsed]);

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
      style={[styles.fill, { opacity: pose.cover, transform: [{ translateY: (1 - pose.cover) * -8 }] }]}>
      <View style={styles.mark}>
        <View style={[styles.track, { opacity: 0.55 * pose.track }]} />
        {BOOT_TICKS.map((t, i) => {
          const rad = (t.deg * Math.PI) / 180;
          const reveal = pose.ticks[i];
          const x = CX + RADIUS * Math.cos(rad);
          const y = CY + RADIUS * Math.sin(rad);
          return (
            <View
              key={t.order}
              style={[
                styles.tick,
                {
                  left: x - 3.5,
                  top: y - 6,
                  backgroundColor: tag[t.color].text,
                  opacity: reveal,
                  transform: [{ rotate: `${t.deg + 90}deg` }, { scale: 0.6 + 0.4 * reveal }],
                },
              ]}
            />
          );
        })}
        <View style={[styles.hands, { opacity: pose.hands, transform: [{ scale: 0.86 + 0.14 * pose.hands }] }]}>
          <View style={[styles.minute, { backgroundColor: colors.text }]} />
          <View style={[styles.hour, { backgroundColor: colors.text }]} />
          <View
            style={[
              styles.dot,
              { backgroundColor: tag.red.text, left: CX - 4, top: CY - 4, opacity: waiting ? dot : 1 },
            ]}
          />
        </View>
        <View style={[styles.crown, { backgroundColor: tag.red.text, opacity: pose.crown }]} />
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
    mark: { width: RING, height: RING },
    track: {
      position: 'absolute',
      left: CX - RADIUS,
      top: CY - RADIUS,
      width: RADIUS * 2,
      height: RADIUS * 2,
      borderRadius: RADIUS,
      borderWidth: 5,
      borderColor: colors.border,
    },
    tick: {
      position: 'absolute',
      width: 7,
      height: 12,
      borderRadius: 4,
    },
    hands: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: RING,
      height: RING,
    },
    minute: {
      position: 'absolute',
      width: 3,
      height: 16,
      borderRadius: 2,
      top: CY - 16,
    },
    hour: {
      position: 'absolute',
      width: 15,
      height: 3,
      borderRadius: 2,
      left: CX,
      top: CY - 1.5,
    },
    dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
    crown: {
      position: 'absolute',
      width: 12,
      height: 4,
      borderRadius: 2,
      left: CX - 6,
      top: CY - RADIUS - 12,
    },
    word: {
      marginTop: 22,
      fontSize: 44,
      lineHeight: 52,
      letterSpacing: -1.2,
      color: colors.text,
    },
  }),
);
