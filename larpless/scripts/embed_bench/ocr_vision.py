"""macOS on-device OCR (Apple Vision) from an in-memory image, set up like the app's FLScreenModel.ocr()
(macos/Focusline-macOS/Native/ScreenModel/FLScreenModel.swift): VNRecognizeTextRequest, accurate level, one
recognition language, language correction on, lines top to bottom then left to right, joined by newlines.

PRIVACY: the recognised text is returned to the caller only. This module never writes it to disk, never prints
it and never puts it in an exception message. The image never touches disk either: PIL -> PNG bytes in memory
-> CGImageSource -> CGImage.
"""

import io

import Quartz
import Vision
from Foundation import NSData, NSDictionary
from PIL import Image


class OcrUnavailable(RuntimeError):
    pass


class VisionOcr:
    def __init__(self, lang: str = "en-US", language_correction: bool = True):
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        supported, _ = request.supportedRecognitionLanguagesAndReturnError_(None)
        if supported is not None and lang not in list(supported):
            raise OcrUnavailable(f"Vision can't read {lang}")
        self._lang = lang
        self._correction = language_correction

    def read(self, image: Image.Image) -> str:
        """Text on the image. Raises a generic error (no text in the message) on failure."""
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="PNG")
        data = NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))
        source = Quartz.CGImageSourceCreateWithData(data, None)
        cg = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None) if source else None
        if cg is None:
            raise RuntimeError("OCR failed (image decode)")
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setRecognitionLanguages_([self._lang])
        request.setUsesLanguageCorrection_(self._correction)
        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, NSDictionary.dictionary())
        ok, _ = handler.performRequests_error_([request], None)
        if not ok:
            return ""  # the app returns "" too
        observations = list(request.results() or [])

        # Vision's origin is bottom-left: higher maxY is nearer the top (same order as the app).
        def key(o):
            box = o.boundingBox()
            return (box.origin.y + box.size.height, box.origin.x)

        import functools

        def order(a, b):
            (ay, ax), (by, bx) = key(a), key(b)
            if abs(ay - by) > 0.005:
                return -1 if ay > by else 1
            return -1 if ax < bx else (1 if ax > bx else 0)

        lines = []
        for o in sorted(observations, key=functools.cmp_to_key(order)):
            top = o.topCandidates_(1)
            if top and len(top):
                lines.append(str(top[0].string()))
        return "\n".join(lines)
