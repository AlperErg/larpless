"""Builds the fixed SigLIP prompt embeddings FLScreenModel ships with (Windows and macOS), and checks the pinned
ONNX files the app downloads against the PyTorch models the bench measured.

Run from larpless/:
    scripts\\embed_bench\\.venv\\Scripts\\python -I scripts\\embed_bench\\export_prompts.py

Writes windows/LarpLess/Assets/Models/FLScreenModelPrompts.json and the identical macOS copy in
macos/Focusline-macOS/Native/ScreenModel/ (__tests__/core/screenModelPrompts.test.ts checks they match):
    {"model", "dim", "logitScale", "logitBias", "prompts": [{"id", "embedding": [...]}]}
Prompt ids: "lib_<subject>" (mean of the subject templates; the logit is linear in the text embedding,
so the mean embedding gives the mean logit), "study:<i>", "distract:<i>".

Also checks the C++ preprocessing (box downsample) against the processor, and writes tokenizer test vectors
(token ids for fixed sample strings, never user text) that the native tokenizers must reproduce.

--text-model picks the text model whose ONNX IO and tokenizer cases are checked:
    minilm-ml  (default; the app's one text model for every language since 2026-11-27) the int8
               paraphrase-multilingual-MiniLM-L12-v2, XLM-R SentencePiece Unigram: hash-checks the pinned
               tokenizer.json, derives windows/LarpLess/Assets/Models/minilm-ml-vocab.txt ("piece<TAB>score"
               per line, id = line number; FLUnigram.h loads it, and the app ships it, the ONNX is downloaded)
               and checks its SHA-256, checks the C++ normalisation rule against the tokenizer's charsmap and
               writes unigram_cases.json. The Mac will ship a byte-identical copy (Part B of the Spanish plan).
    minilm     the old all-MiniLM-L6-v2 (BERT WordPiece) -> wordpiece_cases.json, still what the Mac's
               FLScreenModelWordPiece.swift is checked against (wordpiece-check-mac.sh) until Part B ports
               FLUnigram; Windows no longer uses it.
--text-only skips the SigLIP steps (it doesn't rewrite FLScreenModelPrompts.json).
"""

import argparse
import hashlib
import json
import unicodedata
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LARPLESS = HERE.parent.parent
os.environ.setdefault("HF_HOME", str(HERE / ".models"))
sys.stdout.reconfigure(encoding="utf-8")

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
import torch  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402
from PIL import Image  # noqa: E402
from transformers import AutoModel, AutoProcessor, AutoTokenizer  # noqa: E402

sys.path.insert(0, str(HERE))
from prompts import DISTRACTION_PROMPTS, IMAGE_TEMPLATES, STUDY_PROMPTS  # noqa: E402

TORCH_MODEL = "google/siglip2-base-patch16-224"
VISION = ("onnx-community/siglip2-base-patch16-224-ONNX", "ba1f3b0843f24bc5417d38e19c37b287d719b2f4", "onnx/vision_model.onnx")
MINILM = ("Xenova/all-MiniLM-L6-v2", "751bff37182d3f1213fa05d7196b954e230abad9", "onnx/model.onnx")
# paraphrase-multilingual-MiniLM-L12-v2 (Transformers.js v3 export). Both ONNX files declare input_ids,
# attention_mask and token_type_ids (all int64 [batch, seq]; XLM-R ignores the last, feed zeros) and return
# last_hidden_state [batch, seq, 384]; mean-pool + L2 like L6. tokenizer.json gives the same ids as the
# sentence-transformers repo's tokenizer (what bench.py measures); transformers 5's AutoTokenizer on the Xenova
# repo does not, so the cases come from the tokenizers library directly.
MINILM_ML = ("Xenova/paraphrase-multilingual-MiniLM-L12-v2", "2c4055b12046f11709e9df2c122e59ffbdc2f900")
MINILM_ML_FILES = {  # path: (bytes, sha256)
    "onnx/model.onnx": (470268510, "185ae63f47e17a7e8d30d0e6a3cde6a6e4b79bc5b81666ecffc279a6856ca113"),
    "onnx/model_int8.onnx": (118054609, "d6ea442ff6a891daefed7c83b2f596fc5dc66bf697e4d006236f64f34bbcf4c8"),
    "tokenizer.json": (17082913, "b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441"),
}
# Ships as minilm-ml.onnx, the one text model for every language: the int8 export (2026-11-27: Spanish 13/14;
# English holdout 10/11 -> 9/11 accepted to avoid a second download; same speed as L6, ~+50 MB RAM).
MINILM_ML_ONNX = "onnx/model_int8.onnx"
# Shipped in the app (not downloaded), packaged like FLScreenModelPrompts.json. LF line endings: the hash below is of
# exactly these bytes (FLUnigram.h tolerates CRLF, but a CRLF checkout won't match the hash).
ML_VOCAB = LARPLESS / "windows" / "LarpLess" / "Assets" / "Models" / "minilm-ml-vocab.txt"
ML_VOCAB_SHA256 = "62fce312d72594ad30235447483680a6d1bbce5d7e219bbe29a241539e449f92"  # 7763089 bytes, 250002 pieces
OUT =LARPLESS / "windows" / "LarpLess" / "Assets" / "Models" / "FLScreenModelPrompts.json"
OUT_MAC = LARPLESS / "macos" / "Focusline-macOS" / "Native" / "ScreenModel" / "FLScreenModelPrompts.json"


def subjects() -> list[dict]:
    out = subprocess.run(["node", str(HERE / "export_subjects.mjs")], cwd=LARPLESS, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def tent_weights(n_in: int, n_out: int) -> np.ndarray:
    """PIL's bilinear (triangle) resample weights; the support widens with the downsample factor."""
    s = n_in / n_out
    sup = max(s, 1.0)
    w = np.zeros((n_out, n_in))
    for i in range(n_out):
        c = (i + 0.5) * s
        for j in range(int(max(0, np.floor(c - sup))), int(min(n_in, np.ceil(c + sup)))):
            w[i, j] = max(0.0, 1 - abs((j + 0.5 - c) / sup))
        w[i] /= w[i].sum()
    return w


def box_resize_224(rgb: np.ndarray) -> np.ndarray:
    """Exactly what FLScreenModel.h does: separable tent downsample to 224x224, then (x/255 - 0.5) / 0.5."""
    h, w, _ = rgb.shape
    x = np.einsum("ow,hwc->hoc", tent_weights(w, 224), rgb.astype(np.float64))
    x = np.einsum("oh,hwc->owc", tent_weights(h, 224), x)
    x = (x / 255.0 - 0.5) / 0.5
    return x.transpose(2, 0, 1)[None].astype(np.float32)


def siglip() -> None:
    model = AutoModel.from_pretrained(TORCH_MODEL).eval()
    proc = AutoProcessor.from_pretrained(TORCH_MODEL)

    # 1. Prompt embeddings.
    entries: list[tuple[str, list[str]]] = []
    for s in subjects():
        entries.append((s["id"], [t.format(name=s["name"], kws=", ".join(s["keywords"][:3])) for t in IMAGE_TEMPLATES]))
    entries += [(f"study:{i}", [p]) for i, p in enumerate(STUDY_PROMPTS)]
    entries += [(f"distract:{i}", [p]) for i, p in enumerate(DISTRACTION_PROMPTS)]
    prompts = []
    with torch.no_grad():
        for pid, texts in entries:
            inp = proc(text=texts, return_tensors="pt", padding="max_length", max_length=64, truncation=True)
            feats = model.get_text_features(**inp)
            feats = feats if isinstance(feats, torch.Tensor) else feats.pooler_output
            emb = torch.nn.functional.normalize(feats, dim=-1).mean(0)
            prompts.append({"id": pid, "embedding": [round(float(v), 6) for v in emb]})
    doc = {"model": f"{VISION[0]}@{VISION[1]}", "dim": len(prompts[0]["embedding"]),
           "logitScale": round(model.logit_scale.exp().item(), 6), "logitBias": round(model.logit_bias.item(), 6), "prompts": prompts}
    OUT.write_text(json.dumps(doc, separators=(",", ":")), encoding="ascii")
    OUT_MAC.write_bytes(OUT.read_bytes())
    print(f"wrote {OUT.relative_to(LARPLESS)}: {len(prompts)} prompts, dim {doc['dim']}, {OUT.stat().st_size / 1e3:.0f} KB")

    # 2. The pinned ONNX vision model must match the PyTorch image tower, and the C++ resize the processor.
    vpath = hf_hub_download(VISION[0], VISION[2], revision=VISION[1])
    sess = ort.InferenceSession(vpath, providers=["CPUExecutionProvider"])
    print("vision onnx inputs", [(i.name, i.shape) for i in sess.get_inputs()], "outputs", [(o.name, o.shape) for o in sess.get_outputs()])
    bench = sorted((LARPLESS / "bench").glob("*.png"))[:4]
    for f in bench:
        im = Image.open(f).convert("RGB")
        im = im.resize((1024, round(im.height * 1024 / im.width)), Image.LANCZOS)
        pv = proc(images=im, return_tensors="pt")["pixel_values"]
        with torch.no_grad():
            ref = model.get_image_features(pixel_values=pv)
            ref = ref if isinstance(ref, torch.Tensor) else ref.pooler_output
        ref = torch.nn.functional.normalize(ref, dim=-1)[0].numpy()
        outs = {o.name: v for o, v in zip(sess.get_outputs(), sess.run(None, {sess.get_inputs()[0].name: pv.numpy()}))}
        key = "pooler_output" if "pooler_output" in outs else list(outs)[-1]
        onnx_emb = outs[key][0] / np.linalg.norm(outs[key][0])
        box = sess.run(None, {sess.get_inputs()[0].name: box_resize_224(np.asarray(im))})
        box_emb = dict(zip([o.name for o in sess.get_outputs()], box))[key][0]
        box_emb = box_emb / np.linalg.norm(box_emb)
        print(f"  {f.name}: cos(onnx[{key}], torch) = {onnx_emb @ ref:.5f}   cos(box-resize, processor) = {box_emb @ ref:.5f}")


# Fixed sample strings for the tokenizer checks (never user text). The first four are the WordPiece cases.
SAMPLES = ["Calculus: derivative, integral, limit", "HIST110 essay – Causes of the French Revolution",
           "Café résumé naïve!! (ECON-214) e^x=2.5%", "unaffable tokenization x² 中文"]
UNIGRAM_SAMPLES = SAMPLES + [
    "¿Qué es la fotosíntesis? ¡Explícalo con tus palabras!",
    "Año académico 2026–2027: niño, señal, PEQUEÑO, cigüeña, Ñandú",
    "Matemáticas II — Ecuaciones diferenciales (MAT-201) · «Tema 3»",
    "Introducción a la programación en Python: bucles for y while, listas y diccionarios",
    "Historia de España: la Reconquista y los Reyes Católicos (1492)",
    "Résumé café mañana piña",  # decomposed accents (NFKC composes them)
    "ﬁnal ﬂujo Ｈｏｌａ　ＭＵＮＤＯ １２３ ① ½ ㎏ ™ ℌ 𝔘𝔫𝔦𝔠𝔬𝔡𝔢",  # ligatures, full width, compatibility forms
    "  tabs\tand\nnew lines\r\n  several   spaces nbsp​zwsp end　ideographic  ",
    "～ ㋿ ꟲ 🯱 kept as is by the charsmap",
    "\x01ctrl\x7fchars\u0085nel﻿bom▁lower one eighth block",
    "∫ x² dx = x³/3 + C, α ≥ β, π ≈ 3.14159, √2, ∑ᵢ aᵢ",
    "中文 日本語のテキスト русский текст العربية हिन्दी 한국어",
    "😀 emoji ❤️ 👩‍🔬 rare 𠀀𠀁𠀂 ͸͹ unassigned",
    "x<s>y </s> a <mask>b<unk>c<pad> ＜ｓ＞",
    # Per-grapheme charsmap quirks: a mapped first code point swallows its marks, partly composed sequences stay.
    "ｏ̚ ２̑\U0001d7dd ẹ́ Ḹ Ấ 　̵x ﾊﾟ 각",
    "",
    "   ",
    # A long OCR-like screen (lecture notes) that is truncated at 256 ids.
    "Archivo Editar Ver Insertar Formato Herramientas Ayuda | Apuntes de Cálculo I — Tema 4: Derivadas "
    + "Definición: f'(x) = lím h→0 [f(x+h) − f(x)] / h. Reglas de derivación: (u·v)' = u'v + uv'; (u/v)' = (u'v − uv')/v². "
    "Ejemplo 1: f(x) = x³ − 2x² + 5 ⇒ f'(x) = 3x² − 4x. Ejemplo 2: g(x) = sen(x)·eˣ ⇒ g'(x) = cos(x)·eˣ + sen(x)·eˣ. "
    "Regla de la cadena: (f∘g)'(x) = f'(g(x))·g'(x). Ejercicios propuestos: 1) h(x) = ln(x² + 1); 2) k(x) = √(1 − x²); "
    "3) Calcula la recta tangente a y = arctan(x) en x = 1. Lecture 7 – Chain rule and implicit differentiation; "
    "homework due Friday 23:59 via Campus Virtual. Página 12 de 48 · 125 % · Español (España) · Guardado ✓ " * 3,
]


def minilm_cases() -> None:
    # 3. MiniLM ONNX IO + tokenizer test vectors (fixed sample strings only).
    mpath = hf_hub_download(MINILM[0], MINILM[2], revision=MINILM[1])
    vocab = hf_hub_download(MINILM[0], "vocab.txt", revision=MINILM[1])

    print("minilm vocab.txt sha256", hashlib.sha256(Path(vocab).read_bytes()).hexdigest(), Path(vocab).stat().st_size)
    msess = ort.InferenceSession(mpath, providers=["CPUExecutionProvider"])
    print("minilm onnx inputs", [i.name for i in msess.get_inputs()], "outputs", [o.name for o in msess.get_outputs()])
    tok = AutoTokenizer.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
    cases = [{"text": s, "ids": tok(s, truncation=True, max_length=256)["input_ids"]} for s in SAMPLES]
    (HERE / "wordpiece_cases.json").write_text(json.dumps(cases, ensure_ascii=True), encoding="ascii")
    print(f"wrote wordpiece_cases.json ({len(cases)} cases)")


# FLUnigram.h's normalisation, mirrored here to check it: SentencePiece's nmt_nfkc (the tokenizer's Precompiled
# charsmap) maps one code point as NFKC plus these rules, except KEEP, code points the charsmap leaves alone (newer
# than its Unicode tables, and U+FF5E). tokenizers applies it per grapheme (see nmt_normalize).
NMT_REMOVE = frozenset([*range(0x01, 0x09), 0x0B, *range(0x0E, 0x20), 0x7F, 0x8F, 0x9F])
NMT_SPACE = frozenset([0x09, 0x0A, 0x0C, 0x0D, 0x1680, *range(0x200B, 0x2010), 0x2028, 0x2029, 0x2581, 0xFEFF, 0xFFFD])
NMT_KEEP = [(0x32FF, 0x32FF), (0xA7F2, 0xA7F4), (0xAB69, 0xAB69), (0xFF5E, 0xFF5E), (0x10781, 0x10785),
            (0x10787, 0x107B0), (0x107B2, 0x107BA), (0x1E030, 0x1E06D), (0x1F16C, 0x1F16C), (0x1F23B, 0x1F23B),
            (0x1FBF0, 0x1FBF9)]


def nmt_char(c: str) -> str:
    cp = ord(c)
    if cp in NMT_REMOVE:
        return ""
    if cp in NMT_SPACE:
        return " "
    if any(a <= cp <= b for a, b in NMT_KEEP):
        return c
    return unicodedata.normalize("NFKC", c)


def sequence_key(p: str) -> str | None:
    """The charsmap's multi-code-point keys: NFKC composes them into one code point X, and their code points,
    each NFKC-mapped to a single one, spell NFD(X). (Exact on all 219,874 keys of the pinned charsmap.)"""
    x = unicodedata.normalize("NFKC", p)
    if len(x) != 1 or x == p:
        return None
    each = [unicodedata.normalize("NFKC", c) for c in p]
    return x if all(len(e) == 1 for e in each) and "".join(each) == unicodedata.normalize("NFD", x) else None


def nmt_normalize(s: str) -> str:
    """tokenizers' Precompiled normaliser: a grapheme under 6 UTF-8 bytes is replaced whole by the entry of its
    shortest prefix that has one (dropping the rest); otherwise each code point is mapped on its own."""
    import regex  # a transformers dependency; \\X = extended grapheme cluster (FLUnigram.h uses ICU's)

    out = []
    for g in regex.findall(r"\X", s):
        if len(g.encode()) < 6:
            hit = next((m for m in (nmt_char(g[0]) if nmt_char(g[0]) != g[0] else None,
                                    *(sequence_key(g[:i]) for i in range(2, len(g) + 1))) if m is not None), None)
            if hit is not None:
                out.append(hit)
                continue
        out.extend(nmt_char(c) for c in g)
    return "".join(out)


def unigram_cases() -> None:
    from tokenizers import Tokenizer

    repo, rev = MINILM_ML
    tpath = Path(hf_hub_download(repo, "tokenizer.json", revision=rev))
    size, sha = MINILM_ML_FILES["tokenizer.json"]
    got = hashlib.sha256(tpath.read_bytes()).hexdigest()
    if tpath.stat().st_size != size or got != sha:
        sys.exit(f"tokenizer.json: {tpath.stat().st_size} bytes, sha256 {got}; expected {size} {sha}")
    spec = json.loads(tpath.read_text(encoding="utf-8"))
    print("tokenizer.json normalizer", spec["normalizer"]["type"], "pre_tokenizer", json.dumps(spec["pre_tokenizer"]),
          "post_processor", [p.get("SpecialToken", {}).get("id", "$A") for p in spec["post_processor"]["single"]])
    model = spec["model"]
    assert model["type"] == "Unigram" and model["unk_id"] == 3 and not model.get("byte_fallback"), model["type"]
    assert spec["pre_tokenizer"] == {"type": "Sequence", "pretokenizers": [
        {"type": "WhitespaceSplit"}, {"type": "Metaspace", "replacement": "▁", "add_prefix_space": True}]}

    # 1. The vocabulary FLUnigram.h loads. repr() round-trips the float64 score exactly.
    lines = []
    for piece, score in model["vocab"]:
        assert piece and not any(ch in piece for ch in "\t\r\n"), repr(piece)
        lines.append(f"{piece}\t{score!r}\n")
    ML_VOCAB.parent.mkdir(parents=True, exist_ok=True)
    ML_VOCAB.write_text("".join(lines), encoding="utf-8", newline="\n")
    data = ML_VOCAB.read_bytes()
    vocab_sha = hashlib.sha256(data).hexdigest()
    print(f"wrote {ML_VOCAB.relative_to(LARPLESS)}: {len(lines)} pieces, {len(data)} bytes, sha256 {vocab_sha}")
    if vocab_sha != ML_VOCAB_SHA256:
        sys.exit(f"minilm-ml-vocab.txt changed (expected sha256 {ML_VOCAB_SHA256}): rerun the harness, then update the pin")

    # 2. The C++ normalisation rule must equal the charsmap on every code point, and on short random strings from
    # mixed scripts (marks, compatibility forms, jamo, controls), which exercise the per-grapheme rule.
    tk = Tokenizer.from_file(str(tpath))
    norm = tk.normalizer
    bad = [cp for cp in range(0x110000) if not 0xD800 <= cp <= 0xDFFF and norm.normalize_str(chr(cp)) != nmt_char(chr(cp))]
    print(f"normaliser: NFKC + nmt rules {'match' if not bad else 'DIFFER from'} the charsmap"
          f" ({len(bad)} code points differ{': ' + ', '.join(f'U+{cp:04X}' for cp in bad[:20]) if bad else ''};"
          f" Python Unicode {unicodedata.unidata_version})")
    import random

    rng = random.Random(7)
    blocks = [(0x20, 0x7E), (0xA0, 0x24F), (0x300, 0x36F), (0x370, 0x4FF), (0x590, 0x6FF), (0x900, 0x97F), (0x1100, 0x11FF),
              (0x1E00, 0x1EFF), (0x2000, 0x22FF), (0x2460, 0x24FF), (0x3000, 0x33FF), (0xFB00, 0xFB4F), (0xFE30, 0xFE4F),
              (0xFF00, 0xFFEF), (0x1D400, 0x1D7FF), (0x1F100, 0x1F2FF), (0x0, 0x1F)]
    strings = ["".join(chr(rng.randint(*rng.choice(blocks))) for _ in range(rng.randint(1, 5))) for _ in range(20000)]
    same = sum(norm.normalize_str(s) == nmt_normalize(s) for s in strings)
    print(f"normaliser: per-grapheme rule matches the charsmap on {same}/{len(strings)} random short strings"
          " (a miss here is usually Python's regex segmenting graphemes differently from tokenizers)")

    # 3. ONNX IO.
    msess = ort.InferenceSession(hf_hub_download(repo, MINILM_ML_ONNX, revision=rev), providers=["CPUExecutionProvider"])
    print(f"{MINILM_ML_ONNX} inputs", [i.name for i in msess.get_inputs()], "outputs", [o.name for o in msess.get_outputs()])

    # 4. Test vectors from the pinned tokenizer.json (its own truncation is 128; the app uses 256), cross-checked with
    # the sentence-transformers repo's tokenizer, which bench.py measures. (Don't use AutoTokenizer on the Xenova repo:
    # transformers 5 builds a BertTokenizer from its config.json and gives unrelated ids.)
    tk.no_padding()
    tk.enable_truncation(256)
    cases = [{"text": s, "ids": tk.encode(s).ids} for s in UNIGRAM_SAMPLES]
    st_name = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    auto = AutoTokenizer.from_pretrained(st_name)
    same = sum(auto(c["text"], truncation=True, max_length=256)["input_ids"] == c["ids"] for c in cases)
    print(f"  AutoTokenizer({st_name}): {same}/{len(cases)} identical to tokenizer.json")
    assert any(len(c["ids"]) == 256 for c in cases), "the long case should be truncated"
    (HERE / "unigram_cases.json").write_text(json.dumps(cases, ensure_ascii=True), encoding="ascii")
    print(f"wrote unigram_cases.json ({len(cases)} cases)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--text-model", choices=["minilm-ml", "minilm"], default="minilm-ml")
    ap.add_argument("--text-only", action="store_true", help="skip the SigLIP prompt export and checks")
    args = ap.parse_args()
    if not args.text_only:
        siglip()
    if args.text_model == "minilm":
        minilm_cases()
    else:
        unigram_cases()


if __name__ == "__main__":
    main()
