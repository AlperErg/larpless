"""Option 1 bench: zero-shot screen classification with image embeddings (SigLIP) + OCR text embeddings.

Run from larpless/ (Windows, after the venv setup in requirements.txt):

    node scripts/bench-classifier.ts --generate-only            # synthetic mock screens into bench/
    scripts\\embed_bench\\.venv\\Scripts\\python -I scripts\\embed_bench\\bench.py
    ...bench.py --image-model openai/clip-vit-base-patch32      # CLIP head-to-head
    ...bench.py --ocr none                                      # image only
    ...bench.py --onnx                                          # also time the image tower in ONNX Runtime
    ...bench.py --offline                                       # after the first model download

Reads bench/<subject-slug>__<desc>.png|jpg. The slug is the library id without "lib_" (calculus,
signals_systems, ...) or "notstudy". An optional sidecar bench/<name>.json holds {appName, windowTitle},
plus "accept": [subject names] that also count as correct, and "synthetic": true for generated scenes.
Labels are the 44 library subjects from src/core/subjectLibrary.ts plus "Not study".

PRIVACY (CLAUDE.md "Privacy invariants"): images are resized, JPEG-encoded and OCR'd in memory only.
Nothing is written to disk except model weights (HF_HOME = scripts/embed_bench/.models). Output shows
file names, labels, confidences, timings and OCR *character counts*: never OCR text, window titles or
embedding vectors. Nothing is sent anywhere; the network is used only to download model weights.
"""

import argparse
import io
import json
import os
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
LARPLESS = HERE.parent.parent
BENCH = LARPLESS / "bench"
NOT_STUDY = "Not study"

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument("--image-model", default="google/siglip2-base-patch16-224")
p.add_argument("--text-model", default="sentence-transformers/all-MiniLM-L6-v2")
p.add_argument("--ocr", choices=["windows", "none"], default="windows" if sys.platform == "win32" else "none")
p.add_argument("--ocr-lang", default="en-US")
p.add_argument("--width", type=int, default=1024, help="capture width, as the app's power profile (768/1024/1280)")
p.add_argument("--jpeg-quality", type=int, default=60)
p.add_argument("--only", default="", help="only files whose name contains this")
p.add_argument("--onnx", action="store_true", help="export the image tower to ONNX and time fp32 + int8")
p.add_argument("--offline", action="store_true", help="use cached weights only")
p.add_argument("--courses", action="store_true", help='add sidecar "course" names as custom courses (text-only, like the app)')
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
from PIL import Image  # noqa: E402

MIN_OCR_CHARS = 40
MAX_TEXT_CHARS = 1000

# --------------------------------------------------------------------------------------------------
# Labels and prompts
# --------------------------------------------------------------------------------------------------


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
# Library subjects plus, with --courses, custom courses (no image prompt, as in the app). Set in main().
MODULES: list[dict] = list(SUBJECTS)

sys.path.insert(0, str(HERE))  # `python -I` leaves the script's folder off sys.path
from prompts import DISTRACTION_PROMPTS, IMAGE_TEMPLATES, STUDY_PROMPTS  # noqa: E402

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
# Bench images (in memory)
# --------------------------------------------------------------------------------------------------


def list_images() -> list[Path]:
    if not BENCH.exists():
        return []
    files = [f for f in BENCH.iterdir() if f.suffix.lower() in (".png", ".jpg", ".jpeg")]
    return sorted(f for f in files if args.only in f.name)


def sidecar(f: Path) -> dict:
    side = f.with_suffix(".json")
    return json.loads(side.read_text(encoding="utf-8")) if side.exists() else {}


def expected_label(f: Path) -> str | None:
    return SLUGS.get(f.name.split("__")[0].lower())


def load_like_capture(f: Path) -> Image.Image:
    """What the app would hold: resized to the capture width and JPEG round-tripped, all in memory."""
    with Image.open(f) as im:
        im = im.convert("RGB")
        if im.width > args.width:
            im = im.resize((args.width, round(im.height * args.width / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=args.jpeg_quality)
    buf.seek(0)
    out = Image.open(buf)
    out.load()
    return out


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

    def pixels(self, image: Image.Image) -> torch.Tensor:
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


def keyword_scores(text: str) -> np.ndarray:
    """Whole-word keyword hits per subject (control baseline)."""
    lower = text.lower()
    out = np.zeros(len(MODULES))
    for i, s in enumerate(MODULES):
        for kw in s["keywords"] + [s["name"]]:
            if re.search(rf"(?<![a-z0-9]){re.escape(kw.lower())}(?![a-z0-9])", lower):
                out[i] += 1
    return out


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
    """Gate (study vs not) from image + text margins, then the subject from a weighted mix."""
    gate = prm["g_img"] * item["img_margin"] + prm["bias"]
    if item["has_text"]:
        gate += prm["g_txt"] * item["txt_margin"]
    p_study = 1 / (1 + np.exp(-gate))
    if p_study < 0.5:
        return NOT_STUDY, 1 - p_study
    img = item["img_subj"]
    known = np.isfinite(img)  # custom courses have no image prompt
    probs = np.zeros(len(img))
    probs[known] = softmax(img[known], prm["t_img"])
    if item["has_text"]:
        txt = softmax(item["txt_subj"], prm["t_txt"])
        probs = (1 - prm["alpha"]) * probs + prm["alpha"] * txt if known.any() else txt
    k = int(probs.argmax())
    return MODULES[k]["name"], float(p_study * probs[k])


# The parameters the app ships with (src/core/screenModel.ts FUSION). Keep the two in sync. Chosen by hand
# because on the synthetic bench every grid point ties at 100%, so the fit can't tell them apart: equal
# weight to image and text for the subject, both margins in the gate.
APP_PARAMS = dict(alpha=0.5, t_img=1.0, t_txt=0.05, g_img=1.0, g_txt=10.0, bias=0.0)

GRID = [
    dict(alpha=a, t_img=ti, t_txt=tt, g_img=gi, g_txt=gt, bias=b)
    for a in (0.0, 0.25, 0.5, 0.75, 1.0)
    for ti in (0.5, 1.0, 2.0)
    for tt in (0.02, 0.05, 0.1)
    for gi in (0.5, 1.0, 2.0)
    for gt in (0.0, 10.0, 30.0)
    for b in (-1.0, 0.0, 1.0)
]


def hit(pred: str | None, item: dict) -> bool:
    return pred is not None and pred in item["accept"]


def fit(train: list[dict]) -> dict:
    best, best_acc = GRID[0], -1.0
    for prm in GRID:
        acc = sum(hit(fused_predict(it, prm)[0], it) for it in train)
        if acc > best_acc:
            best, best_acc = prm, acc
    return best


def leave_one_out(items: list[dict]) -> list[tuple[str, float]]:
    if len(items) < 3:
        return [fused_predict(it, GRID[0]) for it in items]
    return [fused_predict(it, fit(items[:i] + items[i + 1 :])) for i, it in enumerate(items)]


def pct(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, int(round(q / 100 * len(s) + 0.5)) - 1))]


def report(name: str, preds: list[tuple[str | None, float]], items: list[dict]) -> None:
    n = len(items)
    answered = [(p, c, it) for (p, c), it in zip(preds, items) if p is not None]
    top1 = sum(hit(p, it) for p, _, it in answered)
    gate = sum((p == NOT_STUDY) == (it["expected"] == NOT_STUDY) for p, _, it in answered)
    misses: dict[str, int] = {}
    for p, _, it in answered:
        if not hit(p, it):
            k = f"{it['expected']} -> {p}"
            misses[k] = misses.get(k, 0) + 1
    worst = ", ".join(f"{k} ({v})" for k, v in sorted(misses.items(), key=lambda kv: -kv[1])[:4]) or "-"
    print(f"  {name:<9} top-1 {top1}/{n} ({100 * top1 / n:4.0f}%)  study/not {gate}/{len(answered)}  answered {len(answered)}/{n}  misses: {worst}")


def coverage_curve(preds: list[tuple[str, float]], items: list[dict]) -> None:
    print("  abstain threshold -> coverage / accuracy of answered (rest would be 'unknown'):")
    for tau in (0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7):
        kept = [(p, it) for (p, c), it in zip(preds, items) if c >= tau]
        acc = sum(hit(p, it) for p, it in kept) / len(kept) if kept else 0.0
        print(f"    >= {tau:.2f}: {len(kept)}/{len(items)} answered, {100 * acc:3.0f}% correct")


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
    files = list_images()
    if not files:
        sys.exit("bench/ has no images. Run: node scripts/bench-classifier.ts --generate-only")
    sides = {f: sidecar(f) for f in files}
    synthetic = all(s.get("synthetic") for s in sides.values())
    skipped = [f.name for f in files if expected_label(f) is None]
    files = [f for f in files if expected_label(f) is not None]
    courses = sorted({sides[f]["course"] for f in files if args.courses and sides[f].get("course") and sides[f]["course"] not in NAMES})
    global MODULES
    MODULES = list(SUBJECTS) + [{"id": "mod_" + c.lower().replace(" ", "_"), "name": c, "keywords": []} for c in courses]

    print(f"embed bench · {len(files)} images{' (all synthetic)' if synthetic else ''} · image {args.image_model} · "
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
    print(f"\n{'file':<34} {'expected':<15} {'image':<17} {'text':<17} {'keyword':<15} ocr-chars  ms(img/ocr/txt)")
    for n, f in enumerate(files):
        side = sides[f]
        expected = expected_label(f)
        accept = {expected, *side.get("accept", [])}
        if side.get("course") in courses:
            expected, accept = side["course"], {side["course"]}
        try:
            t0 = time.perf_counter()
            capture = load_like_capture(f)
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
                txt_margin = float(txt_subj.max() - (temb @ dist_txt_emb.T)[0].max())
            else:
                txt_subj, txt_margin = np.zeros(len(MODULES)), 0.0
            t4 = time.perf_counter()
            kw = keyword_scores(text)
            ocr_chars = len(screen_text)
            del screen_text, text, capture
        except Exception as e:  # noqa: BLE001 - never echo content, only the stage and type
            print(f"{f.name:<34} error {type(e).__name__}")
            continue

        logits = img.logits(img_emb, img_txt_emb)
        lib_subj = np.array([logits[ix].mean() for ix in idx["subjects"]])
        img_scores = np.append(lib_subj, logits[idx["distract"]].max())
        img_margin = float(max(logits[idx["study"]].max(), lib_subj.max()) - logits[idx["distract"]].max())
        img_subj = np.append(lib_subj, [np.nan] * (len(MODULES) - len(SUBJECTS)))
        item = dict(file=f.name, expected=expected, accept=accept, img_subj=img_subj, img_margin=img_margin,
                    txt_subj=txt_subj, txt_margin=txt_margin, has_text=has_text,
                    img_pred=LABELS[int(img_scores.argmax())],
                    img_conf=float(1 / (1 + np.exp(-img_scores.max()))) if img.kind == "siglip" else float(softmax(img_scores, 1).max()),
                    txt_pred=(MODULES[int(txt_subj.argmax())]["name"] if txt_margin > 0 else NOT_STUDY) if has_text else None,
                    kw_pred=MODULES[int(kw.argmax())]["name"] if kw.max() > 0 else None)
        items.append(item)
        pixel_batches.append(pv)
        if n > 0:  # first image warms up the models
            lat["prep"].append((t1 - t0) * 1000)
            lat["image"].append((t2 - t1) * 1000)
            lat["ocr"].append((t3 - t2) * 1000)
            lat["text"].append((t4 - t3) * 1000)
        mark = lambda pred: ("✓ " if hit(pred, item) else "✗ ") + (pred or "-")  # noqa: E731
        print(f"{f.name[:33]:<34} {expected[:14]:<15} {mark(item['img_pred'])[:16]:<17} {mark(item['txt_pred'])[:16]:<17} "
              f"{mark(item['kw_pred'])[:14]:<15} {ocr_chars:>9}  {(t2 - t1) * 1000:.0f}/{(t3 - t2) * 1000:.0f}/{(t4 - t3) * 1000:.0f}")

    if not items:
        sys.exit("no image could be scored")
    fused = leave_one_out(items)

    print("\nRESULTS (fused = image gate + text/image subject, tuned leave-one-out)")
    report("image", [(it["img_pred"], it["img_conf"]) for it in items], items)
    report("text", [(it["txt_pred"], 1.0) for it in items], items)
    report("keyword", [(it["kw_pred"], 1.0) for it in items], items)
    report("fused", fused, items)
    coverage_curve(fused, items)
    app_preds = [fused_predict(it, APP_PARAMS) for it in items]
    report("app", app_preds, items)
    print("  app confidences: right " + ", ".join(f"{c:.2f}" for (p_, c), it in zip(app_preds, items) if hit(p_, it))
          + " | wrong " + ", ".join(f"{c:.2f}" for (p_, c), it in zip(app_preds, items) if not hit(p_, it)))
    coverage_curve(app_preds, items)
    print(f"  params fitted on all images: {fit(items)} (app uses {APP_PARAMS})")

    print("\nLATENCY per image, ms (first image excluded as warm-up)")
    for k, v in lat.items():
        print(f"  {k:<6} p50 {pct(v, 50):6.0f}  p90 {pct(v, 90):6.0f}")
    total = [sum(x) for x in zip(*lat.values())]
    print(f"  total  p50 {pct(total, 50):6.0f}  p90 {pct(total, 90):6.0f}")
    mem = psutil.Process().memory_info()
    peak = getattr(mem, "peak_wset", mem.rss)
    print(f"\nmodels: load image {img.load_s:.1f} s, text {txt.load_s:.1f} s · on disk image {dir_size_mb(args.image_model):.0f} MB, "
          f"text {dir_size_mb(args.text_model):.0f} MB · peak RAM {peak / 1e6:.0f} MB")

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
