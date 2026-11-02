/**
 * Launch cover for Mac and Windows. The logo assembles itself: the crown drops in,
 * one pen stroke draws the session ring clockwise (study, break, distracted, away)
 * in the live theme colours, the hands fade in at the logo's time and start turning
 * like a clock running fast, and the serif name settles. The hands keep turning
 * until the cover has gone, so nothing snaps or stops on screen.
 * Plain views only: Windows Fabric drops painted content out of Animated.View, so
 * the arcs and hands are rows of overlapping discs rather than SVG paths.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import type { TagColor } from '../../contracts/domain';
import { colors, tag, themed } from '../theme';
import { Text } from './Text';

export const BOOT_INTRO_MS = 1080;
export const BOOT_EXIT_MS = 280;

// Geometry is brand/larpless-logo.png scaled by 1/5 around the clock centre.
const MARK = 112;
const CX = 56;
const CY = 64;
const RADIUS = 38;
const STROKE = 11;
const HAND = 9;
/** Hand lengths include the round cap behind the pivot. */
const HOUR_LEN = 29;
const MINUTE_LEN = 36;
/** Disc spacing along the ring's centre line, px. Small enough that the edge scallop is < 0.05 px. */
const DISC_STEP = 1.2;
/**
 * How far each arc is trimmed at both ends, in degrees: most of the round cap's
 * reach, so the caps land near the logo's cuts while the gaps stay open (a full
 * trim made the gaps look wider than the logo's and shrank the gray arc to a dot).
 */
const CAP_DEG = 0.85 * (STROKE / 2 / RADIUS) * (180 / Math.PI);

/** The hands appear here, then spin up to speed over `SPIN_RAMP_MS`. */
const HANDS_AT = 380;
const HANDS_FADE_MS = 260;
const SPIN_RAMP_MS = 600;
/** One minute-hand lap; the hour hand turns twelve times slower, as on a real clock. */
const MINUTE_LAP_MS = 1600;

type ArcColor = Extract<TagColor, 'green' | 'blue' | 'yellow' | 'gray'>;

/** Screen angles, 0° east, clockwise positive. Measured from the brand mark. */
const ARCS: { color: ArcColor; start: number; sweep: number }[] = [
  { color: 'green', start: -83, sweep: 173 },
  { color: 'blue', start: 96, sweep: 94 },
  { color: 'yellow', start: -164, sweep: 37 },
  { color: 'gray', start: -120, sweep: 23 },
];

/** One disc of the ring, `STROKE` wide, centred on the ring's centre line. */
interface Segment {
  color: ArcColor;
  deg: number;
  /** Clockwise distance from the start of the study arc, where the pen begins. */
  rel: number;
  x: number;
  y: number;
}

function wrap(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The ring as overlapping discs. Their outline is an exact annulus with round ends,
 * and nothing is rotated, so no edge is snapped to the pixel grid at an angle: the
 * old row of tiny rotated rectangles came out ragged, with seams where they met.
 */
function buildSegments(): Segment[] {
  const origin = ARCS[0].start;
  const stepDeg = (DISC_STEP / RADIUS) * (180 / Math.PI);
  const out: Segment[] = [];
  for (const arc of ARCS) {
    const from = arc.start + CAP_DEG;
    const sweep = Math.max(0, arc.sweep - 2 * CAP_DEG);
    const n = Math.max(1, Math.ceil(sweep / stepDeg));
    for (let k = 0; k <= n; k++) {
      const deg = from + (sweep * k) / n;
      const rad = (deg * Math.PI) / 180;
      out.push({
        color: arc.color,
        deg,
        rel: wrap(deg - origin),
        x: CX + RADIUS * Math.cos(rad),
        y: CY + RADIUS * Math.sin(rad),
      });
    }
  }
  return out.sort((a, b) => a.rel - b.rel);
}

export const BOOT_SEGMENTS: Segment[] = buildSegments();
/** Pen position (degrees from the start of the study arc) once every disc is drawn. */
export const BOOT_PEN_END = BOOT_SEGMENTS[BOOT_SEGMENTS.length - 1].rel;

/**
 * 1 once the pen has reached a disc, else 0. No partial opacity: overlapping
 * translucent discs would show as darker seams; the round front disc is the pen tip.
 */
export function segmentReveal(s: Segment, pen: number): number {
  return pen >= s.rel ? 1 : 0;
}

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

function progress(elapsed: number, start: number, dur: number): number {
  return clamp01((elapsed - start) / dur);
}

/**
 * Minute-hand angle `t` ms after the hands appear. The speed eases up from rest
 * (smoothstep), so the angle is its integral: no jolt when the spin starts.
 */
export function spinAngle(t: number): number {
  if (t <= 0) return 0;
  const speed = 360 / MINUTE_LAP_MS;
  const r = SPIN_RAMP_MS;
  if (t >= r) return speed * (t - r / 2);
  const x = t / r;
  // ∫ smoothstep = r · (x³ − x⁴/2)
  return speed * r * (x ** 3 - x ** 4 / 2);
}

export interface BootPose {
  crown: number;
  /** Pen position in degrees; segments up to here are drawn (see `segmentReveal`). */
  pen: number;
  hands: number;
  minuteDeg: number;
  hourDeg: number;
  word: number;
  /** 1 while the cover is opaque, 0 once it has left. */
  cover: number;
  done: boolean;
}

/** Pose at `elapsed` ms. `exitAt` is the elapsed time the exit began, once the app is ready. */
export function bootPose(elapsed: number, exitAt: number | null, reduced: boolean): BootPose {
  if (reduced) {
    return {
      crown: 1,
      pen: BOOT_PEN_END,
      hands: 1,
      minuteDeg: 0,
      hourDeg: 0,
      word: 1,
      cover: 1,
      done: false,
    };
  }
  const spin = spinAngle(elapsed - HANDS_AT);
  const exitT = exitAt == null ? 0 : progress(elapsed, exitAt, BOOT_EXIT_MS);
  return {
    crown: easeOut(progress(elapsed, 60, 240)),
    pen: easeInOut(progress(elapsed, 100, 620)) * BOOT_PEN_END,
    hands: easeOut(progress(elapsed, HANDS_AT, HANDS_FADE_MS)),
    minuteDeg: spin % 360,
    hourDeg: (spin / 12) % 360,
    word: easeOut(progress(elapsed, 720, 360)),
    cover: 1 - easeIn(exitT),
    done: exitAt != null && elapsed - exitAt >= BOOT_EXIT_MS,
  };
}

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

/** Blends two `#RRGGBB` colours; fading a hand by colour keeps its overlapping discs from showing seams. */
function mixHex(from: string, to: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const k = clamp01(t);
  const c = [0, 1, 2].map((i) => Math.round(ch(from, i) + (ch(to, i) - ch(from, i)) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * A rounded hand from the clock centre at screen angle `deg` (0° east, clockwise).
 * Drawn as a row of discs 1 px apart, each placed by trigonometry, with no rotate
 * transform: on Windows a rotated 80 px square holding the hand swung it out past
 * the ring instead of pivoting it. Discs need no rotation, so the hand stays on its axis.
 */
function Hand({ deg, length, color }: { deg: number; length: number; color: string }) {
  return (
    <>
      {handDiscs(deg, length).map((p, k) => (
        <View
          key={k}
          style={[styles.handDot, { left: p.x - HAND / 2, top: p.y - HAND / 2, backgroundColor: color }]}
        />
      ))}
    </>
  );
}

/** Disc centres for a hand, in mark coordinates (the clock centre is `BOOT_CENTER`). */
export function handDiscs(deg: number, length: number): { x: number; y: number }[] {
  const rad = (deg * Math.PI) / 180;
  const reach = length - HAND;
  const n = Math.ceil(reach) + 1;
  return Array.from({ length: n }, (_, k) => {
    const d = (reach * k) / (n - 1);
    return { x: CX + Math.cos(rad) * d, y: CY + Math.sin(rad) * d };
  });
}

export const BOOT_CENTER = { x: CX, y: CY };
export const BOOT_HANDS = { hour: HOUR_LEN, minute: MINUTE_LEN, width: HAND, ringInner: RADIUS - STROKE / 2, ringStroke: STROKE };

/** ~200 discs; memoised on the pen so it stops re-rendering once the ring is drawn. */
const Ring = memo(function Ring({ pen }: { pen: number }) {
  return (
    <>
      {BOOT_SEGMENTS.map((s, i) =>
        segmentReveal(s, pen) ? (
          <View
            key={i}
            style={[
              styles.segment,
              { left: s.x - STROKE / 2, top: s.y - STROKE / 2, backgroundColor: tag[s.color].text },
            ]}
          />
        ) : null,
      )}
    </>
  );
});

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

  const handColor = mixHex(colors.bg, colors.text, pose.hands);

  return (
    <View
      testID="boot-screen"
      accessibilityRole="image"
      accessibilityLabel="LarpLess"
      pointerEvents="auto"
      style={[styles.fill, { opacity: pose.cover }]}>
      <View style={styles.mark}>
        <View
          style={[
            styles.crown,
            { backgroundColor: tag.red.text, opacity: pose.crown, transform: [{ translateY: (1 - pose.crown) * -6 }] },
          ]}
        />
        <Ring pen={pose.pen} />
        <Hand deg={pose.hourDeg} length={HOUR_LEN} color={handColor} />
        <Hand deg={pose.minuteDeg - 90} length={MINUTE_LEN} color={handColor} />
        <View style={[styles.dot, { backgroundColor: tag.red.text, opacity: pose.hands }]} />
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
    mark: { width: MARK, height: MARK },
    crown: {
      position: 'absolute',
      width: 18,
      height: 9,
      borderRadius: 3,
      left: CX - 9,
      top: CY - 55 - 4.5,
    },
    segment: { position: 'absolute', width: STROKE, height: STROKE, borderRadius: STROKE / 2 },
    handDot: { position: 'absolute', width: HAND, height: HAND, borderRadius: HAND / 2 },
    dot: {
      position: 'absolute',
      width: 12,
      height: 12,
      borderRadius: 6,
      left: CX - 6,
      top: CY - 6,
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
