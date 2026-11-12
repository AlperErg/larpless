"""Option 1 bench: zero-shot screen classification with image embeddings (SigLIP) + OCR text embeddings.

Run from larpless/ (Windows, after the venv setup in requirements.txt):

    node scripts/bench-classifier.ts --generate-only            # synthetic mock screens into bench/
    scripts\\embed_bench\\.venv\\Scripts\\python -I scripts\\embed_bench\\bench.py
    ...bench.py --image-model openai/clip-vit-base-patch32      # CLIP head-to-head
    ...bench.py --ocr none                                      # image only
    ...bench.py --onnx                                          # also time the image tower in ONNX Runtime
    ...bench.py --offline                                       # after the first model download
    ...bench.py --courses                                       # sidecar "course" names as custom courses
    ...bench.py --dir holdout                                   # the frozen holdout (score once, never tune)
    ...bench.py --subjects-n 3,5,8,15,46 --ablation             # few-module simulation + channel ablation (#28)
    ...bench.py --composite                                     # study screens with a Spotify/Discord/YouTube window on top
    ...bench.py --rollup                                        # optional subjects off: do their screens reach the core subject? (#35)

Reads bench/<subject-slug>__<desc>.png|jpg; the file and sidecar format is in benchdata.py. Labels are the
library subjects from src/core/subjectLibrary.ts plus "Not study".

PRIVACY (CLAUDE.md "Privacy invariants"): images are resized, JPEG-encoded and OCR'd in memory only.
Nothing is written to disk except model weights (HF_HOME = scripts/embed_bench/.models). Output shows
file names, labels, confidences, timings and OCR *character counts*: never OCR text, window titles or
embedding vectors. Nothing is sent anywhere; the network is used only to download model weights.
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument("--image-model", default="google/siglip2-base-patch16-224")
p.add_argument("--text-model", default="sentence-transformers/all-MiniLM-L6-v2")
p.add_argument("--ocr", choices=["windows", "none"], default="windows" if sys.platform == "win32" else "none")
p.add_argument("--ocr-lang", default="en-US")
p.add_argument("--width", type=int, default=1024, help="capture width, as the app's power profile (768/1024/1280)")
p.add_argument("--jpeg-quality", type=int, default=60)
p.add_argument("--only", default="", help="only files whose name contains this")
p.add_argument("--dir", default="", help="a subfolder of bench/ to score instead, e.g. holdout (never tune on it)")
p.add_argument("--onnx", action="store_true", help="export the image tower to ONNX and time fp32 + int8")
p.add_argument("--offline", action="store_true", help="use cached weights only")
p.add_argument("--dump-scores", metavar="PATH", help="write each image's numeric scores (no text, no pixels) as JSON, "
               "for scripts/embed_bench/parity.mjs")
p.add_argument("--courses", action="store_true", help='add sidecar "course" names as custom courses (text-only, like the app)')
p.add_argument("--course-keywords", metavar="PATH",
               help='with --courses: JSON {"<course>": ["keyword", ...]}, as if the user typed keywords for each course')
p.add_argument("--drop-keywords", metavar="K1,K2",
               help="leave these library keywords out of the text/keyword scores (image prompts are unchanged)")
p.add_argument("--course-base", action="store_true",
               help="with --courses: experiment where each custom course borrows its closest library subject's image score")
p.add_argument("--my-subjects", action="store_true",
               help="experiment: only the library subjects the bench's study screenshots use can be chosen, as if the "
                    "user had ticked the subjects they take")
p.add_argument("--codes-need-digits", action="store_true",
               help='course-code keywords (BIO, MATH, CS...) only match before a course number, e.g. "MATH 101"')
p.add_argument("--keyword-report", action="store_true",
               help="list which keywords (from the subject vocabulary only) fired on distractions and wrong subjects")
p.add_argument("--subjects-n", metavar="N1,N2",
               help="few-module simulation (#28): score every study screen with only N candidate subjects (the true one + "
                    "N-1 random library subjects, plus a 'hard' draw from the same subject area), e.g. 3,5,8,15,46")
p.add_argument("--draws", type=int, default=20, help="with --subjects-n: random draws per N (fixed --seed)")
p.add_argument("--seed", type=int, default=0)
p.add_argument("--ablation", action="store_true",
               help="subject accuracy with each channel combination (image / text / keywords), app weights renormalised")
p.add_argument("--rollup", action="store_true",
               help="core-subject simulation (#35): turn optional subjects off (the Computing ones, the Maths ones, then "
                    "all of them) and score every study screen against where it should land: its own subject if still "
                    "on, else its area's general subject (Algorithms -> Programming). Compares dropping the "
                    "subjects that are off with keeping them as hidden candidates that are relabelled (the app)")
p.add_argument("--composite", nargs="?", const="spotify,discord-public,youtube-home", metavar="NAMES",
               help="multi-window simulation (#28): paste these not-study screenshots (file-name substrings) beside / over "
                    "every study screenshot, in memory only, and score the result as the study subject")
p.add_argument("--composite-layouts", default="split,pip",
               help="split = a side window over the right 40%%; pip = a small window in the bottom-right corner")
args = p.parse_args()
sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252; `-I` ignores PYTHONIOENCODING

# Must be set before transformers / huggingface_hub are imported.
os.environ.setdefault("HF_HOME", str(HERE / ".models"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
if args.offline:
    os.environ["HF_HUB_OFFLINE"] = "1"

import numpy as np  # noqa: E402
import psutil  # noqa: E402
import torch  # noqa: E402

sys.path.insert(0, str(HERE))  # `python -I` leaves the script's folder off sys.path
from benchdata import (  # noqa: E402
    GROUP_OF, LABELS, NOT_STUDY, SUBJECTS, capture_like, course_modules, coverage_curve, coverage_report, custom_courses,
    expectation, expected_label, group_report, hit, list_images, load_like_capture, misses_by_kind, pct, report, sidecar,
    verdict_curves, wilson,
)
from PIL import Image  # noqa: E402
from prompts import DISTRACTION_PROMPTS, IMAGE_TEMPLATES, STUDY_PROMPTS  # noqa: E402

MIN_OCR_CHARS = 40
MAX_TEXT_CHARS = 1000
# Library subjects plus, with --courses, custom courses (no image prompt, as in the app). Set in main().
MODULES: list[dict] = list(SUBJECTS)
USED = None  # --my-subjects mask over SUBJECTS, set in main()

TEXT_DISTRACTIONS = [
    "social media feed: likes, followers, comments, stories, reels, posts",
    "online shopping: add to cart, price, checkout, free delivery, reviews",
    "chat messages: online, typing, sent, seen, group chat",
    "entertainment video: music video, subscribe, playlist, views, trailer",
    "video game: play, level, score, players, match, lobby",
    "streaming: watch now, episode, season, continue watching",
]


def subject_text(s: dict) -> str:
    return f"{s['name']}: {', '.join(s['keywords'])}"


# --------------------------------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------------------------------


def as_tensor(x):
    """transformers returns a tensor or (newer versions) a ModelOutput from get_*_features."""
    if isinstance(x, torch.Tensor):
        return x
    for key in ("pooler_output", "image_embeds", "text_embeds"):
        v = getattr(x, key, None)
        if v is not None:
            return v
    return x[0]


class ImageScorer:
    def __init__(self, model_id: str):
        from transformers import AutoModel, AutoProcessor

        t = time.perf_counter()
        self.model = AutoModel.from_pretrained(model_id).eval()
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.load_s = time.perf_counter() - t
        self.kind = "siglip" if "siglip" in self.model.config.model_type else "clip"

    @torch.no_grad()
    def embed_texts(self, texts: list[str]) -> torch.Tensor:
        kw = dict(padding="max_length", max_length=64, truncation=True) if self.kind == "siglip" else dict(padding=True, truncation=True)
        inputs = self.processor(text=texts, return_tensors="pt", **kw)
        feats = as_tensor(self.model.get_text_features(**inputs))
        return torch.nn.functional.normalize(feats, dim=-1)

    def pixels(self, image) -> torch.Tensor:
        return self.processor(images=image, return_tensors="pt")["pixel_values"]

    @torch.no_grad()
    def embed_pixels(self, pixel_values: torch.Tensor) -> torch.Tensor:
        feats = as_tensor(self.model.get_image_features(pixel_values=pixel_values))
        return torch.nn.functional.normalize(feats, dim=-1)

    def logits(self, img: torch.Tensor, txt: torch.Tensor) -> np.ndarray:
        """Per-prompt logits: SigLIP has a learned bias (sigmoid per label), CLIP only a scale."""
        scale = self.model.logit_scale.exp().item()
        bias = self.model.logit_bias.item() if getattr(self.model, "logit_bias", None) is not None else 0.0
        return (img @ txt.T * scale + bias).squeeze(0).numpy()


class TextScorer:
    def __init__(self, model_id: str):
        from sentence_transformers import SentenceTransformer

        t = time.perf_counter()
        self.model = SentenceTransformer(model_id, device="cpu")
        self.load_s = time.perf_counter() - t

    def embed(self, texts: list[str]) -> np.ndarray:
        return self.model.encode(texts, normalize_embeddings=True, convert_to_numpy=True)


def is_course_code(kw: str) -> bool:
    """Course-code prefixes in the library (BIO, MATH, CS, ...): all caps, 2-5 letters."""
    return 2 <= len(kw) <= 5 and kw.isalpha() and kw.isupper()


def keyword_pattern(kw: str) -> str:
    """Whole word, case-insensitive. With --codes-need-digits a course code only counts before a course number
    ("MATH 101", "CS2010", "BIO-110"), so "bus", "law" or "fin" in ordinary text don't vote."""
    if args.codes_need_digits and is_course_code(kw):
        return rf"(?<![a-z0-9]){re.escape(kw.lower())}[ -]?\d{{2,4}}(?![0-9])"
    return rf"(?<![a-z0-9]){re.escape(kw.lower())}(?![a-z0-9])"


def keyword_matches(text: str) -> list[list[str]]:
    """Per subject, which of its keywords (or its name) appear as whole words, like FLScreenModel counts them."""
    lower = text.lower()
    return [[kw for kw in s["keywords"] + [s["name"]] if re.search(keyword_pattern(kw), lower)] for s in MODULES]


def keyword_scores(text: str) -> np.ndarray:
    """Whole-word keyword hits per subject (control baseline)."""
    return np.array([len(m) for m in keyword_matches(text)], dtype=float)


def keyword_report(items: list[dict]) -> None:
    """Which keywords fire where they shouldn't: on distractions, and for a wrong subject on study screens.
    Prints keywords from the subject vocabulary only, never the screen text around them."""
    misfires: dict[str, set[str]] = {}
    print("\nKEYWORD MISFIRES (keyword -> subject it voted for)")
    for it in items:
        if it["kw_matched"] is None:
            continue
        wrong = [(MODULES[i]["name"], kws) for i, kws in enumerate(it["kw_matched"])
                 if kws and MODULES[i]["name"] not in it["accept"]]
        if wrong:
            print(f"  {it['file'][:40]:<41} " + "; ".join(f"{name}: {', '.join(kws)}" for name, kws in wrong))
            for name, kws in wrong:
                for k in kws:
                    misfires.setdefault(f"{k} ({name})", set()).add(it["file"])
    if misfires:
        top = sorted(misfires.items(), key=lambda kv: -len(kv[1]))[:12]
        print("  most frequent: " + ", ".join(f"{k} x{len(v)}" for k, v in top))


def dir_size_mb(model_id: str) -> float:
    root = Path(os.environ["HF_HOME"]) / "hub" / ("models--" + model_id.replace("/", "--")) / "blobs"
    return sum(f.stat().st_size for f in root.glob("*")) / 1e6 if root.exists() else 0.0


# --------------------------------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------------------------------


def softmax(x: np.ndarray, t: float) -> np.ndarray:
    z = (x - x.max()) / t
    e = np.exp(z)
    return e / e.sum()


def fused_predict(item: dict, prm: dict) -> tuple[str, float]:
    """Gate (study vs not) from image + text margins and keyword hits, then the subject from a weighted mix of
    image, text and keyword probabilities. Mirrors src/core/screenModel.ts fuseScores."""
    p_study = study_probability(item, prm)
    if p_study < 0.5:
        return NOT_STUDY, 1 - p_study
    probs = subject_probs(item, prm)
    order = np.argsort(probs)[::-1]
    k = int(order[0])
    if prm.get("conf") == "margin":
        # Top-1 against the runner-up only: similar subjects (Programming / Algorithms / OS) split the mass,
        # which drags plain probabilities down even when the answer is right.
        conf = probs[k] / (probs[k] + probs[order[1]]) if len(order) > 1 else 1.0
        return MODULES[k]["name"], float(p_study * conf)
    return MODULES[k]["name"], float(p_study * probs[k])


def study_probability(item: dict, prm: dict) -> float:
    kw = item["kw"]
    gate = prm["g_img"] * item["img_margin"] + prm["bias"] + prm.get("g_kw", 0.0) * min(float(kw.max()), 3.0)
    if item["has_text"]:
        gate += prm["g_txt"] * item["txt_margin"]
    return float(1 / (1 + np.exp(-gate)))


def subject_probs(item: dict, prm: dict) -> np.ndarray:
    kw = item["kw"]
    img = item["img_subj"]
    known = np.isfinite(img)  # custom courses have no image prompt
    parts: list[tuple[float, np.ndarray]] = []
    # use_img / use_txt / use_kw switch a channel off for --ablation only; the app always uses all three.
    if known.any() and prm.get("use_img", True):
        p_img = np.zeros(len(img))
        p_img[known] = softmax(img[known], prm["t_img"])
        parts.append((1 - prm["alpha"], p_img))
    if item["has_text"] and prm.get("use_txt", True):
        parts.append((prm["alpha"], softmax(item["txt_subj"], prm["t_txt"])))
    if kw.max() > 0 and prm.get("beta", 0.0) > 0 and prm.get("use_kw", True):
        parts.append((prm["beta"], softmax(kw, prm["t_kw"])))
    total = sum(w for w, _ in parts)
    if total <= 0:
        parts, total = [(1.0, parts[0][1] if parts else np.full(len(img), 1 / len(img)))], 1.0
    return sum(w * p for w, p in parts) / total


def shortlist(item: dict, prm: dict, k: int = 8) -> dict:
    """Option 1's top-k subjects and P(study), for option_bench.py --rerank-from."""
    probs = subject_probs(item, prm)
    order = np.argsort(probs)[::-1][:k]
    return {"pStudy": study_probability(item, prm), "top": [[MODULES[i]["name"], float(probs[i])] for i in order]}


# The parameters the app ships with (src/core/screenModel.ts FUSION). Keep the two in sync.
# v1 (hand-picked, synthetic bench): alpha=0.5, t_img=1, t_txt=0.05, g_img=1, g_txt=10, bias=0, no keywords.
# v2 (2026-10-12, 18 real screenshots): what leave-one-out picked in nearly every fold, with keywords.
APP_PARAMS = dict(alpha=0.25, t_img=1.0, t_txt=0.05, g_img=0.5, g_txt=0.0, bias=0.0, beta=0.5, t_kw=0.5, g_kw=0.0)

GRID = [
    dict(alpha=a, t_img=ti, t_txt=tt, g_img=gi, g_txt=gt, bias=0.0, beta=be, t_kw=tk, g_kw=gk)
    for a in (0.25, 0.5, 0.75)
    for ti in (1.0,)  # 2.0 was never picked; fewer combinations overfit less on a few dozen images
    for tt in (0.02, 0.05, 0.1)
    for gi in (0.5, 1.0)
    for gt in (0.0, 10.0)
    for be in (0.0, 0.5, 1.0)
    for tk in (0.5, 1.0)
    for gk in (0.0, 1.0)
]


def fit(train: list[dict]) -> dict:
    best, best_acc = GRID[0], -1.0
    for prm in GRID:
        acc = sum(hit(fused_predict(it, prm)[0], it) for it in train)
        if acc > best_acc:
            best, best_acc = prm, acc
    return best


def leave_one_out(items: list[dict]) -> tuple[list[tuple[str, float]], list[tuple[str, float]], list[dict]]:
    """Predictions for each item with parameters fitted on the others: plain and margin confidence."""
    folds = [GRID[0]] * len(items) if len(items) < 3 else [fit(items[:i] + items[i + 1 :]) for i in range(len(items))]
    plain = [fused_predict(it, prm) for it, prm in zip(items, folds)]
    margin = [fused_predict(it, {**prm, "conf": "margin"}) for it, prm in zip(items, folds)]
    return plain, margin, folds


# --------------------------------------------------------------------------------------------------
# Few-module simulation (--subjects-n) and channel ablation (--ablation)
# --------------------------------------------------------------------------------------------------

ABLATIONS = [
    ("image", dict(use_txt=False, use_kw=False)),
    ("text", dict(use_img=False, use_kw=False)),
    ("keywords", dict(use_img=False, use_txt=False)),
    ("image+text", dict(use_kw=False)),
    ("image+keywords", dict(use_txt=False)),
    ("text+keywords", dict(use_img=False)),
    ("all three (app)", dict()),
]


def restrict(item: dict, keep: np.ndarray) -> dict:
    """The item as if only the `keep` modules were on: the others can't be chosen. Like the app, the study gate
    still uses every library image prompt (img_margin unchanged); the text margin uses the modules that are on."""
    out = dict(item)
    img = item["img_subj"].copy()
    img[~keep] = np.nan
    kw = item["kw"].copy()
    kw[~keep] = 0
    out.update(img_subj=img, kw=kw)
    if item["has_text"]:
        txt = item["txt_subj"].copy()
        txt[~keep] = -10.0
        out.update(txt_subj=txt, txt_margin=float(txt[keep].max() - item["txt_dist_max"]))
    return out


def draw_sets(items: list[dict], n: int, draws: int, rng: np.random.Generator) -> tuple[list[list[dict]], list[dict]]:
    """For each study item: `draws` random candidate sets of n library subjects (the true one + n-1 others) and
    one hard set (the true subject's area first). Custom courses are always on (they're the user's own)."""
    names = [s["name"] for s in SUBJECTS]
    lib = len(SUBJECTS)
    base = np.zeros(len(MODULES), dtype=bool)
    base[lib:] = True
    random_sets: list[list[dict]] = [[] for _ in range(draws)]
    hard: list[dict] = []
    for it in items:
        true = names.index(it["expected"]) if it["expected"] in names else None
        others = [i for i in range(lib) if i != true]
        k = max(0, min(n - (1 if true is not None else 0), len(others)))
        for d in range(draws):
            keep = base.copy()
            keep[rng.choice(others, size=k, replace=False)] = True
            if true is not None:
                keep[true] = True
            random_sets[d].append(restrict(it, keep))
        group = GROUP_OF.get(it["expected"])
        same = [i for i in others if SUBJECTS[i].get("group") == group]
        rest = [i for i in others if SUBJECTS[i].get("group") != group]
        rng.shuffle(same)
        rng.shuffle(rest)
        keep = base.copy()
        keep[(same + rest)[:k]] = True
        if true is not None:
            keep[true] = True
        hard.append(restrict(it, keep))
    return random_sets, hard


def top1(items: list[dict], prm: dict) -> tuple[int, int]:
    """(right, right at >= 0.2 confidence)."""
    right = sure = 0
    for it in items:
        pred, conf = fused_predict(it, prm)
        if hit(pred, it):
            right += 1
            sure += conf >= 0.2
    return right, sure


def keyword_effect(items: list[dict], prm: dict) -> tuple[int, int]:
    """(answers keywords turn wrong, answers keywords turn right) vs the same weights without the keyword channel."""
    hurt = helped = 0
    no_kw = {**prm, "use_kw": False}
    for it in items:
        a, b = hit(fused_predict(it, prm)[0], it), hit(fused_predict(it, no_kw)[0], it)
        hurt += b and not a
        helped += a and not b
    return hurt, helped


def subjects_n_report(items: list[dict], ns: list[int], draws: int, seed: int, ablation: bool) -> None:
    study = [it for it in items if it["expected"] != NOT_STUDY]
    if not study:
        return
    rng = np.random.default_rng(seed)
    n_study = len(study)
    print(f"\nFEW-MODULE SIMULATION ({n_study} study screens, {draws} random draws per N + 1 hard draw, seed {seed}; "
          f"app params; 'fit' = best GRID params on these draws, in-sample so optimistic)")
    print(f"  {'N':>3}  {'random top-1':>13}  {'sure>=0.2':>9}  {'hard top-1':>10}  {'kw hurt/helped':>14}  "
          f"{'fit top-1':>9}  fitted params")
    sims = {}
    for n in ns:
        t = time.perf_counter()
        random_sets, hard = draw_sets(study, n, draws, rng)
        sims[n] = (random_sets, hard)
        r = [top1(s, APP_PARAMS) for s in random_sets]
        right = sum(x for x, _ in r) / draws
        sure = sum(y for _, y in r) / draws
        h, _ = top1(hard, APP_PARAMS)
        eff = [keyword_effect(s, APP_PARAMS) for s in random_sets + [hard]]
        hurt = sum(a for a, _ in eff) / len(eff)
        helped = sum(b for _, b in eff) / len(eff)
        pool = [it for s in random_sets[: min(draws, 5)] for it in s] + hard
        best = fit(pool)
        fr = sum(top1(s, best)[0] for s in random_sets) / draws
        diff = ", ".join(f"{k}={v}" for k, v in best.items() if APP_PARAMS.get(k) != v) or "same as app"
        print(f"  {n:>3}  {right:5.1f}/{n_study} {100 * right / n_study:3.0f}%  {100 * sure / n_study:8.0f}%  "
              f"{h:>3}/{n_study} {100 * h / n_study:3.0f}%  {hurt:6.1f}/{helped:<6.1f}  {100 * fr / n_study:8.0f}%  "
              f"{diff}  ({time.perf_counter() - t:.0f} s)")
    if ablation:
        print("\n  CHANNEL ABLATION by N (random top-1 / hard top-1; a screen with no signal for the channels counts as wrong)")
        print("  " + f"{'channels':<17}" + "".join(f"{f'N={n}':>16}" for n in ns))
        for name, flags in ABLATIONS:
            prm = {**APP_PARAMS, **flags}
            cells = []
            for n in ns:
                random_sets, hard = sims[n]
                r = sum(top1(s, prm)[0] for s in random_sets) / draws
                cells.append(f"{100 * r / n_study:5.0f}% / {100 * top1(hard, prm)[0] / n_study:3.0f}%")
            print("  " + f"{name:<17}" + "".join(f"{c:>16}" for c in cells))


def ablation_report(items: list[dict]) -> None:
    """Channel ablation on the full candidate set (when --subjects-n isn't given)."""
    study = [it for it in items if it["expected"] != NOT_STUDY]
    print(f"\nCHANNEL ABLATION (all subjects, {len(study)} study screens, app weights renormalised)")
    for name, flags in ABLATIONS:
        right, sure = top1(study, {**APP_PARAMS, **flags})
        lo, hi = wilson(right, len(study))
        print(f"  {name:<17} {right:>3}/{len(study)} ({100 * right / len(study):3.0f}%, CI {100 * lo:.0f}-{100 * hi:.0f})"
              f"  sure>=0.2 {sure}")


# --------------------------------------------------------------------------------------------------
# Core subjects and roll-up (--rollup)
# --------------------------------------------------------------------------------------------------


def rollup_report(items: list[dict]) -> None:
    """With optional subjects off, where do their screens go? Core subjects can't be off; a subject that is off
    counts as its area's general subject (subjectLibrary.ts rollUpSubject). Two ways to get there:
      drop:   the subjects that are off can't be chosen; the best of the rest wins (what "off" did before #35)
      hidden: subjects with a general subject stay candidates, and a win is relabelled as the general one (the app)
    A screen whose subject is off and has no general subject has no right answer and is left out."""
    study = [it for it in items if it["expected"] != NOT_STUDY]
    if not study:
        return
    lib = len(SUBJECTS)
    names = [s["name"] for s in SUBJECTS]
    general = {s["name"]: s.get("general") for s in SUBJECTS}
    core = np.array([bool(s.get("core")) for s in SUBJECTS])
    group = np.array([s.get("group", "-") for s in SUBJECTS])
    scenarios = [(f"{g} specifics off", (group == g) & ~core) for g in dict.fromkeys(group[[n in general and general[n] is not None for n in names]])]
    scenarios.append(("only the core subjects on", ~core))
    print(f"\nROLL-UP ({len(study)} study screens, app params). Core: {', '.join(n for n, c in zip(names, core) if c)}")
    for title, off in scenarios:
        is_off = {n: bool(o) for n, o in zip(names, off)}
        landing = lambda n: general.get(n) if is_off.get(n) else n  # noqa: E731
        keep_drop = np.ones(len(MODULES), dtype=bool)
        keep_drop[:lib] = ~off
        keep_hidden = keep_drop.copy()
        keep_hidden[:lib] |= off & np.array([general[n] is not None for n in names])
        rows = {"moved": [], "kept": []}
        skipped = 0
        for it in study:
            target = {landing(a) for a in it["accept"]} - {None}
            if not target:
                skipped += 1
                continue
            drop = fused_predict(restrict(it, keep_drop), APP_PARAMS)[0]
            hid = landing(fused_predict(restrict(it, keep_hidden), APP_PARAMS)[0])
            rows["moved" if is_off.get(it["expected"]) else "kept"].append((it, target, drop, hid))
        n_all = sum(len(r) for r in rows.values())
        print(f"  {title} ({int(off.sum())} subjects off; {skipped} screens left out: their subject is off with no general subject)")
        for key, label in (("moved", "subject off, should reach its general subject"), ("kept", "subject still on")):
            r = rows[key]
            if not r:
                continue
            d = sum(drop in t for _, t, drop, _ in r)
            h = sum(hid in t for _, t, _, hid in r)
            print(f"    {label:<46} drop {d:>2}/{len(r):<2} ({100 * d / len(r):3.0f}%)   hidden {h:>2}/{len(r):<2} ({100 * h / len(r):3.0f}%)")
            wrong = [(it["file"], drop, hid) for it, t, drop, hid in r if drop not in t or hid not in t]
            for f, drop, hid in wrong[:12]:
                print(f"      {f[:44]:<45} drop -> {drop:<22} hidden -> {hid}")
        d = sum(drop in t for r in rows.values() for _, t, drop, _ in r)
        h = sum(hid in t for r in rows.values() for _, t, _, hid in r)
        print(f"    total {n_all}: drop {d} ({100 * d / max(n_all, 1):.0f}%), hidden {h} ({100 * h / max(n_all, 1):.0f}%)")


# --------------------------------------------------------------------------------------------------
# Multi-window composites (--composite)
# --------------------------------------------------------------------------------------------------


def composite(base: Image.Image, overlay: Image.Image, layout: str) -> Image.Image:
    """A study screen with another window on top, at the base's resolution. In memory only."""
    out = base.convert("RGB").copy()
    w, h = out.size
    ov = overlay.convert("RGB")
    if layout == "split":
        # A side window over the right 40%: the overlay centre-cropped to that panel's shape, then resized.
        pw, ph = int(w * 0.4), h
        ow, oh = ov.size
        if ow / oh > pw / ph:
            cw = int(oh * pw / ph)
            ov = ov.crop(((ow - cw) // 2, 0, (ow - cw) // 2 + cw, oh))
        else:
            ch = int(ow * ph / pw)
            ov = ov.crop((0, (oh - ch) // 2, ow, (oh - ch) // 2 + ch))
        out.paste(ov.resize((pw, ph), Image.LANCZOS), (w - pw, 0))
    elif layout == "pip":
        # A small window (30% wide) in the bottom-right corner, like a mini player or chat pop-out.
        pw = int(w * 0.3)
        ph = int(ov.height * pw / ov.width)
        m = int(w * 0.02)
        out.paste(ov.resize((pw, ph), Image.LANCZOS), (w - pw - m, h - ph - m))
    else:
        raise ValueError(f"unknown layout {layout}")
    return out


def composite_report(files: list[Path], sides: dict, courses: list[str], items: list[dict], score) -> None:
    """Scores every study screenshot with each overlay window in each layout, as the study subject (the study
    window stays in front, so its title is the one the app would see), and compares with the plain screenshot."""
    wanted = [w.strip() for w in args.composite.split(",") if w.strip()]
    overlays = [f for f in files if expected_label(f) == NOT_STUDY and any(w in f.stem for w in wanted)]
    layouts = [x.strip() for x in args.composite_layouts.split(",") if x.strip()]
    bases = [f for f in files if expected_label(f) != NOT_STUDY]
    if not overlays or not bases:
        print("\nCOMPOSITES: no matching overlay or study screenshots")
        return
    plain = {it["file"]: it for it in items}
    print(f"\nCOMPOSITES ({len(bases)} study screens x {len(overlays)} overlays x {len(layouts)} layouts, in memory only; "
          f"overlays: {', '.join(f.stem.split('__')[1] for f in overlays)})")
    comp: list[dict] = []
    t = time.perf_counter()
    for b in bases:
        expected, accept = expectation(b, sides[b], courses)
        for o in overlays:
            for lay in layouts:
                def load(b=b, o=o, lay=lay):
                    with Image.open(b) as bi, Image.open(o) as oi:
                        return capture_like(composite(bi, oi, lay), args.width, args.jpeg_quality)
                tag = o.stem.split("__")[1]
                it = score(f"{b.stem}+{tag}@{lay}", load, sides[b], expected, accept, timed=False, quiet=True)
                if it is not None:
                    it.pop("pv")
                    it.update(base=b.name, overlay=tag, layout=lay)
                    comp.append(it)
    print(f"  scored {len(comp)} composites in {time.perf_counter() - t:.0f} s")
    app = [fused_predict(it, APP_PARAMS) for it in comp]
    report("app", app, comp)
    gate_lost = sum(p == NOT_STUDY for p, _ in app)
    print(f"  study screens called 'not study' (would fire alerts): {gate_lost}/{len(comp)}")
    flipped = [(it, p) for it, (p, _) in zip(comp, app)
               if it["base"] in plain and hit(fused_predict(plain[it["base"]], APP_PARAMS)[0], plain[it["base"]]) and not hit(p, it)]
    print(f"  right on the plain screenshot but wrong with the overlay: {len(flipped)}/{len(comp)}")
    for key in ("overlay", "layout"):
        groups: dict[str, list[bool]] = {}
        for it, (p, _) in zip(comp, app):
            groups.setdefault(it[key], []).append(hit(p, it))
        print(f"  by {key}: " + ", ".join(f"{k} {sum(v)}/{len(v)}" for k, v in groups.items()))
    hurt, helped = keyword_effect(comp, APP_PARAMS)
    print(f"  keywords turn {hurt} answers wrong and {helped} right (vs the same weights without keywords)")
    if flipped:
        print("  flips: " + "; ".join(f"{it['file'][:48]} -> {p}" for it, p in flipped[:15])
              + (" ..." if len(flipped) > 15 else ""))
    group_report("app (composites)", app, comp)
    if args.keyword_report:
        keyword_report(comp)


# --------------------------------------------------------------------------------------------------
# ONNX timing
# --------------------------------------------------------------------------------------------------


def onnx_timing(scorer: ImageScorer, pixel_batches: list[torch.Tensor], txt_emb: torch.Tensor, items: list[dict], idx) -> None:
    import onnxruntime as ort
    from onnxruntime.quantization import QuantType, quantize_dynamic

    out_dir = Path(os.environ["HF_HOME"]) / "onnx" / args.image_model.replace("/", "--")
    out_dir.mkdir(parents=True, exist_ok=True)
    fp32, int8 = out_dir / "vision.onnx", out_dir / "vision.int8.onnx"

    class Tower(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, pixel_values):
            return as_tensor(self.m.get_image_features(pixel_values=pixel_values))

    if not fp32.exists():
        torch.onnx.export(Tower(scorer.model).eval(), (pixel_batches[0],), str(fp32), input_names=["pixel_values"],
                          output_names=["image_embeds"], opset_version=17, dynamo=False)
    if not int8.exists():
        quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8)

    print("\nONNX Runtime (image tower, CPU):")
    for label, path in (("fp32", fp32), ("int8", int8)):
        sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        times, hits = [], 0
        for pv, it in zip(pixel_batches, items):
            t = time.perf_counter()
            emb = sess.run(None, {"pixel_values": pv.numpy()})[0]
            times.append((time.perf_counter() - t) * 1000)
            emb_t = torch.nn.functional.normalize(torch.from_numpy(emb), dim=-1)
            logits = scorer.logits(emb_t, txt_emb)
            scores = np.array([logits[ix].mean() for ix in idx["subjects"]] + [logits[idx["distract"]].max()])
            hits += hit(LABELS[int(scores.argmax())], it)
        print(f"  {label}: {path.stat().st_size / 1e6:6.0f} MB  p50 {pct(times, 50):5.0f} ms  p90 {pct(times, 90):5.0f} ms  image-only top-1 {hits}/{len(items)}")


# --------------------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------------------


def main() -> None:
    files = list_images(args.only, args.dir)
    if not files:
        sys.exit("bench/ has no images. Run: node scripts/bench-classifier.ts --generate-only")
    sides = {f: sidecar(f) for f in files}
    synthetic = all(s.get("synthetic") for s in sides.values())
    skipped = [f.name for f in files if expected_label(f) is None]
    files = [f for f in files if expected_label(f) is not None]
    courses = custom_courses(files, sides) if args.courses else []
    global MODULES
    MODULES = list(SUBJECTS) + course_modules(courses)
    if args.my_subjects:
        # "The subjects I take" = every library subject some study screenshot is labelled with.
        global USED
        # With --courses, a library subject whose screenshots all belong to custom courses is covered by them
        # (Computer Architecture replaces Digital Logic), so the user wouldn't tick it.
        taken = {expected_label(f) for f in files if not (courses and sides[f].get("course") in courses)} - {NOT_STUDY}
        USED = np.array([s["name"] in taken for s in SUBJECTS])
        print(f"  my subjects ({int(USED.sum())} of {len(SUBJECTS)}): {', '.join(s['name'] for s, u in zip(SUBJECTS, USED) if u)}")
    if args.course_base:
        # A course's closest library subject is the prefix of its screenshots (what the user would pick).
        names = [s["name"] for s in SUBJECTS]
        for m in MODULES[len(SUBJECTS):]:
            prefixes = {expected_label(f) for f in files if sides[f].get("course") == m["name"]}
            m["base"] = names.index(prefixes.pop()) if len(prefixes) == 1 else None
        print("  course bases: " + ", ".join(f"{m['name']} -> {names[m['base']] if m['base'] is not None else '-'}"
                                            for m in MODULES[len(SUBJECTS):]))
    if args.drop_keywords:
        drop = {k.strip().lower() for k in args.drop_keywords.split(",") if k.strip()}
        MODULES = [{**m, "keywords": [k for k in m["keywords"] if k.lower() not in drop]} for m in MODULES]
        print(f"  dropped keywords: {', '.join(sorted(drop))}")
    if args.course_keywords:
        extra = json.loads(Path(args.course_keywords).read_text(encoding="utf-8"))
        for m in MODULES[len(SUBJECTS):]:
            m["keywords"] = list(extra.get(m["name"], []))
        print(f"  course keywords from {args.course_keywords}: " +
              ", ".join(f"{m['name']} ({len(m['keywords'])})" for m in MODULES[len(SUBJECTS):]))

    print(f"embed bench · {len(files)} images{f' in bench/{args.dir}' if args.dir else ''}"
          f"{' (all synthetic)' if synthetic else ''} · image {args.image_model} · "
          f"text {args.text_model} · OCR {args.ocr} · capture {args.width}px q{args.jpeg_quality} · {torch.get_num_threads()} threads")
    if courses:
        print(f"  custom courses (text only): {', '.join(courses)}")
    if skipped:
        print(f"  skipped (unknown label prefix): {', '.join(skipped)}")

    img = ImageScorer(args.image_model)
    txt = TextScorer(args.text_model)
    ocr = None
    if args.ocr == "windows":
        from ocr import WindowsOcr

        ocr = WindowsOcr(args.ocr_lang)

    # Prompt embeddings, once per run (no user data in them).
    prompts, idx = [], {"subjects": [], "study": [], "distract": []}
    for s in SUBJECTS:
        start = len(prompts)
        prompts += [t.format(name=s["name"], kws=", ".join(s["keywords"][:3])) for t in IMAGE_TEMPLATES]
        idx["subjects"].append(list(range(start, len(prompts))))
    idx["study"] = list(range(len(prompts), len(prompts) + len(STUDY_PROMPTS)))
    prompts += STUDY_PROMPTS
    idx["distract"] = list(range(len(prompts), len(prompts) + len(DISTRACTION_PROMPTS)))
    prompts += DISTRACTION_PROMPTS
    img_txt_emb = img.embed_texts(prompts)
    subj_txt_emb = txt.embed([subject_text(s) if s["keywords"] else s["name"] for s in MODULES])
    dist_txt_emb = txt.embed(TEXT_DISTRACTIONS)

    items, pixel_batches = [], []
    lat = {"prep": [], "ocr": [], "image": [], "text": []}

    def score(name: str, load, side: dict, expected: str, accept: set[str], timed: bool, quiet: bool = False):
        """Scores one capture (`load()` returns it, in memory) into a bench item, or None on error."""
        try:
            t0 = time.perf_counter()
            capture = load()
            pv = img.pixels(capture)
            t1 = time.perf_counter()
            img_emb = img.embed_pixels(pv)
            t2 = time.perf_counter()
            screen_text = ocr.read(capture) if ocr else ""
            t3 = time.perf_counter()
            # Window title + OCR text: kept in memory for this image only, never printed.
            text = "\n".join(x for x in (side.get("windowTitle") or "", screen_text) if x)[:MAX_TEXT_CHARS]
            has_text = len(screen_text) >= MIN_OCR_CHARS
            if has_text:
                temb = txt.embed([text])
                txt_subj = (temb @ subj_txt_emb.T)[0]
                txt_dist = (temb @ dist_txt_emb.T)[0]
                txt_margin = float(txt_subj.max() - txt_dist.max())
            else:
                txt_subj, txt_margin, txt_dist = np.zeros(len(MODULES)), 0.0, None
            t4 = time.perf_counter()
            kw = keyword_scores(text)
            # Only our own vocabulary (which keywords matched), never the screen text around them.
            kw_matched = keyword_matches(text) if args.keyword_report else None
            ocr_chars = len(screen_text)
            del screen_text, text, capture
        except Exception as e:  # noqa: BLE001 - never echo content, only the stage and type
            print(f"{name:<34} error {type(e).__name__}")
            return None

        logits = img.logits(img_emb, img_txt_emb)
        lib_subj = np.array([logits[ix].mean() for ix in idx["subjects"]])
        img_scores = np.append(lib_subj, logits[idx["distract"]].max())
        img_margin = float(max(logits[idx["study"]].max(), lib_subj.max()) - logits[idx["distract"]].max())
        img_subj = np.append(lib_subj, [np.nan] * (len(MODULES) - len(SUBJECTS)))
        if args.my_subjects:
            # Experiment: the user marked which library subjects they take; the rest can't be chosen.
            off = ~USED
            img_subj[: len(SUBJECTS)][off] = np.nan
            if has_text:
                txt_subj = txt_subj.copy()
                txt_subj[: len(SUBJECTS)][off] = -10.0
            kw = kw.copy()
            kw[: len(SUBJECTS)][off] = 0
            img_margin = float(max(logits[idx["study"]].max(), lib_subj[USED].max()) - logits[idx["distract"]].max())
        if args.course_base:
            # Experiment: each custom course borrows its closest library subject's image score (not in the app).
            for j, m in enumerate(MODULES[len(SUBJECTS):], start=len(SUBJECTS)):
                if m.get("base") is not None:
                    img_subj[j] = lib_subj[m["base"]]
        item = dict(file=name, expected=expected, accept=accept, kind=side.get("kind"), img_subj=img_subj, img_margin=img_margin,
                    txt_subj=txt_subj, txt_margin=txt_margin, has_text=has_text, kw=kw,
                    txt_dist_max=float(txt_dist.max()) if txt_dist is not None else 0.0,
                    img_pred=LABELS[int(img_scores.argmax())],
                    img_conf=float(1 / (1 + np.exp(-img_scores.max()))) if img.kind == "siglip" else float(softmax(img_scores, 1).max()),
                    txt_pred=(MODULES[int(txt_subj.argmax())]["name"] if txt_margin > 0 else NOT_STUDY) if has_text else None,
                    kw_pred=MODULES[int(kw.argmax())]["name"] if kw.max() > 0 else None, kw_matched=kw_matched)
        # The same numbers FLScreenModel hands to JS (ScreenModelScores), for the TS parity check.
        item["scores"] = {
            "image": {**{s["id"]: float(v) for s, v in zip(SUBJECTS, lib_subj)},
                      **{f"study:{i}": float(logits[ix]) for i, ix in enumerate(idx["study"])},
                      **{f"distract:{i}": float(logits[ix]) for i, ix in enumerate(idx["distract"])}},
            "text": None if txt_dist is None else {**{m["id"]: float(v) for m, v in zip(MODULES, txt_subj)},
                                                   **{f"distract:{i}": float(v) for i, v in enumerate(txt_dist)}},
            "keywords": {m["id"]: int(v) for m, v in zip(MODULES, kw)},
            "ocrChars": ocr_chars,
        }
        item["pv"] = pv
        if timed:
            lat["prep"].append((t1 - t0) * 1000)
            lat["image"].append((t2 - t1) * 1000)
            lat["ocr"].append((t3 - t2) * 1000)
            lat["text"].append((t4 - t3) * 1000)
        if not quiet:
            mark = lambda pred: ("✓ " if hit(pred, item) else "✗ ") + (pred or "-")  # noqa: E731
            print(f"{name[:33]:<34} {expected[:14]:<15} {mark(item['img_pred'])[:16]:<17} {mark(item['txt_pred'])[:16]:<17} "
                  f"{mark(item['kw_pred'])[:14]:<15} {ocr_chars:>9}  {(t2 - t1) * 1000:.0f}/{(t3 - t2) * 1000:.0f}/{(t4 - t3) * 1000:.0f}")
        return item

    print(f"\n{'file':<34} {'expected':<15} {'image':<17} {'text':<17} {'keyword':<15} ocr-chars  ms(img/ocr/txt)")
    for n, f in enumerate(files):
        expected, accept = expectation(f, sides[f], courses)
        item = score(f.name, lambda f=f: load_like_capture(f, args.width, args.jpeg_quality), sides[f], expected, accept,
                     timed=n > 0)  # the first image warms up the models
        if item is not None:
            pixel_batches.append(item.pop("pv"))
            items.append(item)

    if not items:
        sys.exit("no image could be scored")
    fused, fused_margin, folds = leave_one_out(items)

    print("\nRESULTS (fused = image gate + text/image subject, tuned leave-one-out)")
    report("image", [(it["img_pred"], it["img_conf"]) for it in items], items)
    report("text", [(it["txt_pred"], 1.0) for it in items], items)
    report("keyword", [(it["kw_pred"], 1.0) for it in items], items)
    report("fused", fused, items)
    print("  fused, probability confidence:")
    coverage_curve(fused, items)
    print("  fused, top-1 vs runner-up confidence:")
    coverage_curve(fused_margin, items)
    print(f"  keyword weight chosen per fold: {sorted(set(f['beta'] for f in folds))}")
    app_preds = [fused_predict(it, APP_PARAMS) for it in items]
    report("app", app_preds, items)
    print("  app confidences: right " + ", ".join(f"{c:.2f}" for (p_, c), it in zip(app_preds, items) if hit(p_, it))
          + " | wrong " + ", ".join(f"{c:.2f}" for (p_, c), it in zip(app_preds, items) if not hit(p_, it)))
    coverage_curve(app_preds, items)
    print("  app, per verdict (the app has one threshold for each):")
    verdict_curves(app_preds, items)
    misses_by_kind(app_preds, items)
    print(f"  params fitted on all images: {fit(items)} (app uses {APP_PARAMS})")
    group_report("fused", fused, items)
    group_report("app", app_preds, items)
    coverage_report(items)
    if args.keyword_report:
        keyword_report(items)
    if args.subjects_n:
        subjects_n_report(items, [int(x) for x in args.subjects_n.split(",")], args.draws, args.seed, args.ablation)
    elif args.ablation:
        ablation_report(items)
    if args.rollup:
        rollup_report(items)
    if args.composite:
        composite_report(files, sides, courses, items, score)

    print("\nLATENCY per image, ms (first image excluded as warm-up)")
    for k, v in lat.items():
        print(f"  {k:<6} p50 {pct(v, 50):6.0f}  p90 {pct(v, 90):6.0f}")
    total = [sum(x) for x in zip(*lat.values())]
    print(f"  total  p50 {pct(total, 50):6.0f}  p90 {pct(total, 90):6.0f}")
    mem = psutil.Process().memory_info()
    peak = getattr(mem, "peak_wset", mem.rss)
    print(f"\nmodels: load image {img.load_s:.1f} s, text {txt.load_s:.1f} s · on disk image {dir_size_mb(args.image_model):.0f} MB, "
          f"text {dir_size_mb(args.text_model):.0f} MB · peak RAM {peak / 1e6:.0f} MB")

    if args.dump_scores:
        dump = [{"file": it["file"], "accept": sorted(it["accept"]), "scores": it["scores"], "bench": list(pred),
                 "shortlist": shortlist(it, APP_PARAMS)}
                for it, pred in zip(items, app_preds)]
        Path(args.dump_scores).write_text(json.dumps({"modules": [{"id": m["id"], "name": m["name"]} for m in MODULES],
                                                      "items": dump}), encoding="utf-8")
        print(f"\nwrote numeric scores for {len(dump)} images to {args.dump_scores}")

    if args.onnx:
        onnx_timing(img, pixel_batches, img_txt_emb, items, idx)

    if len(items) < 50:
        print(f"\nNOTE: only {len(items)} images, so these numbers are noisy. Aim for 50+.")
    if synthetic:
        print("\n" + "=" * 78)
        print(" REMINDER: these are SYNTHETIC mock screens. Add 30-60 real screenshots of your")
        print(" own study material to larpless/bench/ (e.g. calculus__lecture-pdf.png) before")
        print(" trusting any result. Close chats, email and notifications first.")
        print("=" * 78)


if __name__ == "__main__":
    main()
