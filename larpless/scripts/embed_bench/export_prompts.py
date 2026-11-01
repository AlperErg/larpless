"""Builds the fixed SigLIP prompt embeddings the Windows FLScreenModel ships with, and checks the pinned
ONNX files the app downloads against the PyTorch models the bench measured.

Run from larpless/:
    scripts\\embed_bench\\.venv\\Scripts\\python -I scripts\\embed_bench\\export_prompts.py

Writes windows/LarpLess/Assets/Models/FLScreenModelPrompts.json:
    {"model", "dim", "logitScale", "logitBias", "prompts": [{"id", "embedding": [...]}]}
Prompt ids: "lib_<subject>" (mean of the subject templates; the logit is linear in the text embedding,
so the mean embedding gives the mean logit), "study:<i>", "distract:<i>".

Also prints tokenizer test vectors (token ids for fixed sample strings, never user text) that
FLWordPiece.h must reproduce, and checks the C++ preprocessing (box downsample) against the processor.
"""

import json
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
OUT = LARPLESS / "windows" / "LarpLess" / "Assets" / "Models" / "FLScreenModelPrompts.json"


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


def main() -> None:
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

    # 3. MiniLM ONNX IO + tokenizer test vectors (fixed sample strings only).
    mpath = hf_hub_download(MINILM[0], MINILM[2], revision=MINILM[1])
    vocab = hf_hub_download(MINILM[0], "vocab.txt", revision=MINILM[1])
    import hashlib

    print("minilm vocab.txt sha256", hashlib.sha256(Path(vocab).read_bytes()).hexdigest(), Path(vocab).stat().st_size)
    msess = ort.InferenceSession(mpath, providers=["CPUExecutionProvider"])
    print("minilm onnx inputs", [i.name for i in msess.get_inputs()], "outputs", [o.name for o in msess.get_outputs()])
    tok = AutoTokenizer.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
    samples = ["Calculus: derivative, integral, limit", "HIST110 essay – Causes of the French Revolution",
               "Café résumé naïve!! (ECON-214) e^x=2.5%", "unaffable tokenization x² 中文"]
    cases = [{"text": s, "ids": tok(s, truncation=True, max_length=256)["input_ids"]} for s in samples]
    (HERE / "wordpiece_cases.json").write_text(json.dumps(cases, ensure_ascii=True), encoding="ascii")
    print(f"wrote wordpiece_cases.json ({len(cases)} cases)")


if __name__ == "__main__":
    main()
