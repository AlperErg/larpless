"""Windows on-device OCR (Windows.Media.Ocr) from in-memory image bytes.

PRIVACY: the recognised text is returned to the caller only. This module never writes it to disk,
never prints it and never puts it in an exception message. The image never touches disk either: it
goes from bytes to an InMemoryRandomAccessStream to a SoftwareBitmap.
"""

import asyncio
import io

from PIL import Image
from winrt.windows.globalization import Language
from winrt.windows.graphics.imaging import BitmapDecoder
from winrt.windows.media.ocr import OcrEngine
from winrt.windows.storage.streams import DataWriter, InMemoryRandomAccessStream


class OcrUnavailable(RuntimeError):
    pass


class WindowsOcr:
    def __init__(self, lang: str = "en-US"):
        engine = OcrEngine.try_create_from_language(Language(lang))
        if engine is None:
            raise OcrUnavailable(f"No Windows OCR language pack for {lang}")
        self._engine = engine

    async def _recognize(self, png: bytes) -> str:
        stream = InMemoryRandomAccessStream()
        writer = DataWriter(stream)
        writer.write_bytes(png)
        await writer.store_async()
        await writer.flush_async()
        writer.detach_stream()
        stream.seek(0)
        decoder = await BitmapDecoder.create_async(stream)
        bitmap = await decoder.get_software_bitmap_async()
        result = await self._engine.recognize_async(bitmap)
        return result.text or ""

    def read(self, image: Image.Image) -> str:
        """Text on the image. Raises a generic error (no text in the message) on failure."""
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="PNG")
        try:
            return asyncio.run(self._recognize(buf.getvalue()))
        except Exception as e:  # noqa: BLE001 - re-raised without any content
            raise RuntimeError(f"OCR failed ({type(e).__name__})") from None
