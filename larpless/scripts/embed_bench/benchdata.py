"""Bench images, labels and reports shared by bench.py (Option 1) and option_bench.py (Option 2).

Reads bench/[<dir>/]<subject-slug>__<desc>.png|jpg. The slug is the library id without "lib_" (calculus,
signals_systems, ...) or "notstudy". An optional sidecar <name>.json holds {appName, windowTitle}, plus
"accept": [subject names] that also count as correct, "course": a custom course name (used with --courses),
and "kind": a short tag (pdf, ide, social, chat, game, ...) that the report groups misses by.

PRIVACY: images are loaded and resized in memory only; nothing here prints or writes text or pixels.
"""

import io
import json
import math
import subprocess
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
LARPLESS = HERE.parent.parent
BENCH = LARPLESS / "bench"
NOT_STUDY = "Not study"


def load_subjects() -> list[dict]:
    out = subprocess.run(
        ["node", str(HERE / "export_subjects.mjs")], cwd=LARPLESS, capture_output=True, text=True, check=True
    )
    return json.loads(out.stdout)


SUBJECTS = load_subjects()
NAMES = [s["name"] for s in SUBJECTS]
LABELS = NAMES + [NOT_STUDY]
SLUGS = {s["id"].removeprefix("lib_"): s["name"] for s in SUBJECTS}
SLUGS["notstudy"] = NOT_STUDY


# --------------------------------------------------------------------------------------------------
# Images and sidecars
# --------------------------------------------------------------------------------------------------


def list_images(only: str = "", sub: str = "") -> list[Path]:
    """Images in bench/ (or bench/<sub>/, e.g. the holdout), not recursive."""
    root = BENCH / sub if sub else BENCH
    if not root.exists():
        return []
    files = [f for f in root.iterdir() if f.suffix.lower() in (".png", ".jpg", ".jpeg")]
    return sorted(f for f in files if only in f.name)


def sidecar(f: Path) -> dict:
    side = f.with_suffix(".json")
    return json.loads(side.read_text(encoding="utf-8")) if side.exists() else {}


def expected_label(f: Path) -> str | None:
    return SLUGS.get(f.name.split("__")[0].lower())


def custom_courses(files: list[Path], sides: dict[Path, dict]) -> list[str]:
    """Sidecar "course" names that aren't library subjects, as the app would add them."""
    return sorted({sides[f]["course"] for f in files if sides[f].get("course") and sides[f]["course"] not in NAMES})


def course_modules(courses: list[str]) -> list[dict]:
    return [{"id": "mod_" + c.lower().replace(" ", "_"), "name": c, "keywords": []} for c in courses]


def expectation(f: Path, side: dict, courses: list[str]) -> tuple[str, set[str]]:
    """The right answer and every answer that counts as right (a custom course replaces the library one)."""
    expected = expected_label(f)
    if side.get("course") in courses:
        return side["course"], {side["course"]}
    return expected, {expected, *side.get("accept", [])}


def load_like_capture(f: Path, width: int, jpeg_quality: int) -> Image.Image:
    """What the app would hold: resized to the capture width and JPEG round-tripped, all in memory."""
    with Image.open(f) as im:
        im = im.convert("RGB")
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=jpeg_quality)
    buf.seek(0)
    out = Image.open(buf)
    out.load()
    return out


# --------------------------------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------------------------------


def hit(pred: str | None, item: dict) -> bool:
    return pred is not None and pred in item["accept"]


def pct(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, int(round(q / 100 * len(s) + 0.5)) - 1))]


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% interval for k/n right: with 20-60 images this is wide, and worth printing next to every %."""
    if n == 0:
        return 0.0, 0.0
    p = k / n
    d = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, mid - half), min(1.0, mid + half)


def report(name: str, preds: list[tuple[str | None, float]], items: list[dict]) -> None:
    n = len(items)
    answered = [(p, c, it) for (p, c), it in zip(preds, items) if p is not None]
    top1 = sum(hit(p, it) for p, _, it in answered)
    lo, hi = wilson(top1, n)
    gate = sum((p == NOT_STUDY) == (it["expected"] == NOT_STUDY) for p, _, it in answered)
    misses: dict[str, int] = {}
    for p, _, it in answered:
        if not hit(p, it):
            k = f"{it['expected']} -> {p}"
            misses[k] = misses.get(k, 0) + 1
    worst = ", ".join(f"{k} ({v})" for k, v in sorted(misses.items(), key=lambda kv: -kv[1])[:4]) or "-"
    print(f"  {name:<9} top-1 {top1}/{n} ({100 * top1 / n:4.0f}%, 95% CI {100 * lo:.0f}-{100 * hi:.0f})  "
          f"study/not {gate}/{len(answered)}  answered {len(answered)}/{n}  misses: {worst}")


THRESHOLDS = (0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9)


def coverage_curve(preds: list[tuple[str | None, float]], items: list[dict], indent: str = "  ") -> None:
    print(f"{indent}abstain threshold -> coverage / accuracy of answered (rest would go to Ollama):")
    for tau in THRESHOLDS:
        kept = [(p, it) for (p, c), it in zip(preds, items) if p is not None and c >= tau]
        acc = sum(hit(p, it) for p, it in kept) / len(kept) if kept else 0.0
        print(f"{indent}  >= {tau:.2f}: {len(kept)}/{len(items)} answered, {100 * acc:3.0f}% correct")


def verdict_curves(preds: list[tuple[str | None, float]], items: list[dict]) -> None:
    """Coverage per verdict type, so the app's "study" and "not study" thresholds are each set on their own
    errors. A wrong "not study" (study screen called a distraction) is the costly one: it fires alerts."""
    for name, is_not in (("study", False), ("not study", True)):
        pairs = [((p, c), it) for (p, c), it in zip(preds, items) if p is not None and (p == NOT_STUDY) == is_not]
        if not pairs:
            print(f"  '{name}' verdicts: none")
            continue
        print(f"  '{name}' verdicts ({len(pairs)}), confidence -> answered / correct:")
        for tau in THRESHOLDS:
            kept = [(p, it) for (p, c), it in pairs if c >= tau]
            if kept:
                right = sum(hit(p, it) for p, it in kept)
                print(f"    >= {tau:.2f}: {len(kept)}/{len(pairs)} answered, {right} right, {len(kept) - right} wrong")


def misses_by_kind(preds: list[tuple[str | None, float]], items: list[dict]) -> None:
    kinds: dict[str, list[bool]] = {}
    for (p, _), it in zip(preds, items):
        kinds.setdefault(it.get("kind") or "-", []).append(hit(p, it))
    if set(kinds) == {"-"}:
        return
    print("  by kind (sidecar \"kind\"): " + ", ".join(
        f"{k} {sum(v)}/{len(v)}" for k, v in sorted(kinds.items(), key=lambda kv: sum(kv[1]) / len(kv[1]))))
