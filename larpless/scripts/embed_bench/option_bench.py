"""Option 2 bench: a small VLM (SmolVLM) used as a decision model, scoring each answer instead of generating.

For each screenshot the model reads the image and the question once (the prefix, kept in the KV cache), then
every option ("Calculus", "History", ..., "Not study") is scored as the answer: the sum of its tokens'
log-probabilities, end-of-answer token included. The best-scoring option is the verdict and a softmax over
the scores is the confidence. No text is generated, so there is no JSON to parse and no free-form answer.

Run from larpless/ (Windows, after the venv setup in requirements.txt):

    scripts\\embed_bench\\.venv\\Scripts\\python -I scripts\\embed_bench\\option_bench.py
    ...option_bench.py --edge 0                    # no tiling: one 512 px image (64 image tokens)
    ...option_bench.py --edge 1024                 # 512 px tiles of the screen resized to 1024 (default)
    ...option_bench.py --courses                   # sidecar "course" names as extra options
    ...option_bench.py --list-options              # also list the options in the question
    ...option_bench.py --model HuggingFaceTB/SmolVLM-500M-Instruct
    ...option_bench.py --rerank-from scores.json   # only Option 1's shortlist (bench.py --dump-scores)

With --rerank-from, it also reports the pipeline the app would run: Option 1 when it's sure (the app's
thresholds), Option 2 on Option 1's shortlist otherwise.

PRIVACY (CLAUDE.md "Privacy invariants"): images are resized and JPEG-encoded in memory only; the window
title goes into the prompt in memory only. Output shows file names, labels, scores and timings, never the
title or anything read from the screen. Nothing is written but model weights (HF_HOME =
scripts/embed_bench/.models); the network is used only to download them.
"""

import argparse
import copy
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Pinned so the bench is reproducible (Apache-2.0 both).
REVISIONS = {
    "HuggingFaceTB/SmolVLM-256M-Instruct": "7e3e67edbbed1bf9888184d9df282b700a323964",
    "HuggingFaceTB/SmolVLM-500M-Instruct": "a7da5b986cb59b408707209984f360a5f4ad7e47",
}

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument("--model", default="HuggingFaceTB/SmolVLM-256M-Instruct", choices=sorted(REVISIONS))
p.add_argument("--edge", type=int, default=1024,
               help="resize the longest edge to this and cut 512 px tiles (+1 global view); 0 = one 512 px image")
p.add_argument("--width", type=int, default=1024, help="capture width, as the app's power profile (768/1024/1280)")
p.add_argument("--jpeg-quality", type=int, default=60)
p.add_argument("--norm", choices=["sum", "mean"], default="sum", help="option score: sum or mean of token log-probs")
p.add_argument("--list-options", action="store_true", help="list every option in the question")
p.add_argument("--calibrate", action="store_true",
               help="subtract each option's score on a blank grey screen (contextual calibration: removes the "
                    "model's prior for some answers)")
p.add_argument("--courses", action="store_true", help='add sidecar "course" names as options')
p.add_argument("--rerank-from", metavar="PATH", help="bench.py --dump-scores file: score only its shortlist")
p.add_argument("--top-k", type=int, default=5, help="shortlist size with --rerank-from")
p.add_argument("--only", default="", help="only files whose name contains this")
p.add_argument("--dir", default="", help="a subfolder of bench/ to score instead, e.g. holdout")
p.add_argument("--offline", action="store_true", help="use cached weights only")
p.add_argument("--debug", action="store_true", help="raise errors (the traceback may show the prompt: local use only)")
args = p.parse_args()
sys.stdout.reconfigure(encoding="utf-8")

os.environ.setdefault("HF_HOME", str(HERE / ".models"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
if args.offline:
    os.environ["HF_HUB_OFFLINE"] = "1"

import numpy as np  # noqa: E402
import psutil  # noqa: E402
import torch  # noqa: E402

sys.path.insert(0, str(HERE))
from benchdata import (  # noqa: E402
    NAMES, NOT_STUDY, course_modules, coverage_curve, custom_courses, expectation, expected_label, hit, list_images,
    load_like_capture, misses_by_kind, pct, report, sidecar, verdict_curves,
)

# The app's thresholds (src/core/screenModel.ts), for the simulated Option 1 -> Option 2 pipeline.
MIN_CONFIDENCE = 0.2
MIN_NOT_STUDY_CONFIDENCE = 0.7

NOT_STUDY_ANSWER = "Not study"
# Options scored per forward pass, each on its own copy of the prefix's KV cache (bounds the memory).
OPTION_BATCH = 16
QUESTION = ("Which course is the student studying on this screen? If it is not study (videos, social media, "
            "games, chat, shopping, news), answer \"Not study\". Answer with the course name only.")


def question(title: str | None, options: list[str]) -> str:
    q = (f"Window title: {title}\n" if title else "") + QUESTION
    if args.list_options:
        q += "\nOptions: " + "; ".join(options) + "."
    return q


class OptionScorer:
    def __init__(self, model_id: str):
        from transformers import AutoModelForImageTextToText, AutoProcessor

        rev = REVISIONS[model_id]
        t = time.perf_counter()
        self.processor = AutoProcessor.from_pretrained(model_id, revision=rev)
        self.model = AutoModelForImageTextToText.from_pretrained(model_id, revision=rev, dtype=torch.float32).eval()
        self.load_s = time.perf_counter() - t
        self.tok = self.processor.tokenizer
        self.end = "<end_of_utterance>"
        self._option_ids: dict[str, list[int]] = {}

    def option_ids(self, option: str) -> list[int]:
        """The answer as the chat template would close it: " <option><end_of_utterance>"."""
        if option not in self._option_ids:
            self._option_ids[option] = self.tok(" " + option + self.end, add_special_tokens=False)["input_ids"]
        return self._option_ids[option]

    def inputs(self, image, prompt: str):
        kw = {"do_image_splitting": False} if args.edge == 0 else {"do_image_splitting": True, "size": {"longest_edge": args.edge}}
        return self.processor(text=prompt, images=[image], return_tensors="pt", **kw)

    @torch.no_grad()
    def score(self, image, title: str | None, options: list[str]) -> tuple[np.ndarray, dict]:
        """Log-likelihood of each option as the answer. The prefix is run once; options are scored in batches,
        each batch on a copy of the prefix's cache repeated per option."""
        messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": question(title, options)}]}]
        prompt = self.processor.apply_chat_template(messages, add_generation_prompt=True)
        t0 = time.perf_counter()
        inputs = self.inputs(image, prompt)
        t1 = time.perf_counter()
        out = self.model(**inputs, use_cache=True)
        t2 = time.perf_counter()
        prefix_len = inputs["input_ids"].shape[1]
        first = torch.log_softmax(out.logits[0, -1].float(), dim=-1)
        all_ids = [self.option_ids(o) for o in options]
        scores = []
        for start in range(0, len(options), OPTION_BATCH):
            batch = all_ids[start : start + OPTION_BATCH]
            # Each option's tokens after the first, right-padded; the first is scored from the prefix's logits.
            width = max(len(ids) for ids in batch) - 1
            lps = [float(first[ids[0]]) for ids in batch]
            if width > 0:
                tail = torch.full((len(batch), width), self.tok.pad_token_id or 0, dtype=torch.long)
                mask = torch.zeros(len(batch), prefix_len + width, dtype=torch.long)
                mask[:, :prefix_len] = 1
                for b, ids in enumerate(batch):
                    tail[b, : len(ids) - 1] = torch.tensor(ids[:-1])
                    mask[b, prefix_len : prefix_len + len(ids) - 1] = 1
                cache = copy.deepcopy(out.past_key_values)
                cache.batch_repeat_interleave(len(batch))
                o = self.model(input_ids=tail, attention_mask=mask, past_key_values=cache, use_cache=True)
                logp = torch.log_softmax(o.logits.float(), dim=-1)
                for b, ids in enumerate(batch):
                    lps[b] += float(sum(logp[b, i, t] for i, t in enumerate(ids[1:])))
                del cache, o, logp
            scores += [lp / len(ids) if args.norm == "mean" else lp for lp, ids in zip(lps, batch)]
        t3 = time.perf_counter()
        image_tokens = int((inputs["input_ids"][0] == self.model.config.image_token_id).sum())
        timing = {"prep": (t1 - t0) * 1000, "prefill": (t2 - t1) * 1000, "options": (t3 - t2) * 1000}
        return np.array(scores), {"timing": timing, "prefix_tokens": prefix_len, "image_tokens": image_tokens}


_priors: dict[tuple, np.ndarray] = {}


def prior(scorer: OptionScorer, options: list[str], size: tuple[int, int]) -> np.ndarray:
    """Each option's score on a blank grey screen with no title: what the model answers when it sees nothing.
    Computed once per option list (no user data in it)."""
    from PIL import Image

    key = tuple(options)
    if key not in _priors:
        _priors[key] = scorer.score(Image.new("RGB", size, (128, 128, 128)), None, options)[0]
    return _priors[key]


def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max())
    return e / e.sum()


def dir_size_mb(model_id: str) -> float:
    root = Path(os.environ["HF_HOME"]) / "hub" / ("models--" + model_id.replace("/", "--")) / "blobs"
    return sum(f.stat().st_size for f in root.glob("*")) / 1e6 if root.exists() else 0.0


def main() -> None:
    files = list_images(args.only, args.dir)
    if not files:
        sys.exit("bench/ has no images.")
    sides = {f: sidecar(f) for f in files}
    files = [f for f in files if expected_label(f) is not None]
    courses = custom_courses(files, sides) if args.courses else []
    all_options = NAMES + [m["name"] for m in course_modules(courses)] + [NOT_STUDY_ANSWER]

    shortlists: dict[str, dict] = {}
    if args.rerank_from:
        dump = json.loads(Path(args.rerank_from).read_text(encoding="utf-8"))
        dump_names = {m["name"] for m in dump["modules"]}
        if dump_names != set(all_options) - {NOT_STUDY_ANSWER}:
            sys.exit("the dump's modules differ from these options: dump it with the same --courses setting")
        shortlists = {it["file"]: it for it in dump["items"]}

    scorer = OptionScorer(args.model)
    print(f"option bench · {len(files)} images{f' in bench/{args.dir}' if args.dir else ''} · {args.model} · "
          f"{'one 512 px image' if args.edge == 0 else f'tiles of a {args.edge} px screen'} · score {args.norm} · "
          f"{'options listed' if args.list_options else 'options not listed'}{' · calibrated' if args.calibrate else ''} · "
          f"{f'rerank Option 1 top-{args.top_k}' if shortlists else f'{len(all_options)} options'} · {torch.get_num_threads()} threads")
    if courses:
        print(f"  custom courses: {', '.join(courses)}")

    items, preds, piped = [], [], []
    lat = {"prep": [], "prefill": [], "options": []}
    tokens = []
    print(f"\n{'file':<34} {'expected':<15} {'option 2':<20} {'conf':>5}  {'runner-up':<16} img-tok  ms(prefill/options)")
    for n, f in enumerate(files):
        side = sides[f]
        expected, accept = expectation(f, side, courses)
        options = all_options
        short = shortlists.get(f.name)
        if shortlists:
            if short is None:
                print(f"{f.name:<34} not in the dump, skipped")
                continue
            options = [name for name, _ in short["shortlist"]["top"][: args.top_k]] + [NOT_STUDY_ANSWER]
        try:
            capture = load_like_capture(f, args.width, args.jpeg_quality)
            raw, info = scorer.score(capture, side.get("windowTitle"), options)
            del capture
            if args.calibrate:
                raw = raw - prior(scorer, options, (args.width, round(args.width * 10 / 16)))
        except Exception as e:  # noqa: BLE001 - never echo content (the prompt holds the title), only the type
            if args.debug:
                raise
            print(f"{f.name:<34} error {type(e).__name__} (--debug to raise it)")
            continue
        probs = softmax(raw)
        order = np.argsort(probs)[::-1]
        pred = options[int(order[0])]
        pred = NOT_STUDY if pred == NOT_STUDY_ANSWER else pred
        conf = float(probs[order[0]])
        item = dict(file=f.name, expected=expected, accept=accept, kind=side.get("kind"))
        items.append(item)
        preds.append((pred, conf))
        if short is not None:
            # The app's pipeline: Option 1 when it's sure, Option 2 on its shortlist otherwise.
            label1, conf1 = short["bench"]
            sure = conf1 >= (MIN_NOT_STUDY_CONFIDENCE if label1 == NOT_STUDY else MIN_CONFIDENCE)
            piped.append((label1, conf1, "1") if sure else (pred, conf, "2"))
        if n > 0:
            for k, v in info["timing"].items():
                lat[k].append(v)
        tokens.append(info["prefix_tokens"])
        mark = ("✓ " if hit(pred, item) else "✗ ") + pred
        runner = options[int(order[1])] if len(order) > 1 else "-"
        print(f"{f.name[:33]:<34} {expected[:14]:<15} {mark[:19]:<20} {conf:5.2f}  {runner[:15]:<16} {info['image_tokens']:>7}  "
              f"{info['timing']['prefill']:.0f}/{info['timing']['options']:.0f}")

    if not items:
        sys.exit("no image could be scored")
    print("\nRESULTS")
    report("option 2", preds, items)
    coverage_curve(preds, items)
    verdict_curves(preds, items)
    misses_by_kind(preds, items)
    if piped:
        print(f"\nPIPELINE (Option 1 when sure, else Option 2 on its top-{args.top_k}): "
              f"Option 1 answered {sum(1 for x in piped if x[2] == '1')}/{len(piped)}")
        report("pipeline", [(lbl, c) for lbl, c, _ in piped], items)
        report("option 1", [tuple(shortlists[it["file"]]["bench"]) for it in items], items)
        # The decision metric: on the screens Option 1 is unsure of (Ollama's share today), who is right more?
        unsure = [i for i, x in enumerate(piped) if x[2] == "2"]
        if unsure:
            sub = [items[i] for i in unsure]
            print(f"  on the {len(unsure)} screens Option 1 is unsure of:")
            report("  opt 1", [tuple(shortlists[it["file"]]["bench"]) for it in sub], sub)
            report("  opt 2", [preds[i] for i in unsure], sub)

    print("\nLATENCY per image, ms (first image excluded as warm-up)")
    for k, v in lat.items():
        print(f"  {k:<8} p50 {pct(v, 50):6.0f}  p90 {pct(v, 90):6.0f}")
    total = [sum(x) for x in zip(*lat.values())]
    print(f"  total    p50 {pct(total, 50):6.0f}  p90 {pct(total, 90):6.0f}   (prefix {int(np.median(tokens))} tokens median)")
    mem = psutil.Process().memory_info()
    peak = getattr(mem, "peak_wset", mem.rss)
    print(f"\nmodel: load {scorer.load_s:.1f} s · on disk {dir_size_mb(args.model):.0f} MB · peak RAM {peak / 1e6:.0f} MB")
    if len(items) < 50:
        print(f"\nNOTE: only {len(items)} images, so these numbers are noisy. Aim for 50+.")


if __name__ == "__main__":
    main()
