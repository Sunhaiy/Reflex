from __future__ import annotations

from pathlib import Path

from PIL import Image
from PyQt6.QtCore import QRectF
from PyQt6.QtGui import QColor, QImage, QPainter, QPen
from PyQt6.QtSvg import QSvgRenderer


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "public"
SOURCE_LOGO = PUBLIC_DIR / "suxins-life-icon.svg"
README_LOGO_PATH = ROOT / "logo.png"
LOGO_COPY_PATHS = [PUBLIC_DIR / "logo.png", ROOT / "src" / "assets" / "logo.png"]

APP_ICON_PATH = PUBLIC_DIR / "icon.png"
TRAY_ICON_PATH = PUBLIC_DIR / "tray-icon.png"
ICO_PATH = PUBLIC_DIR / "icon.ico"
ICNS_PATH = PUBLIC_DIR / "icon.icns"


def render_source_logo(canvas_size: int = 1254) -> Image.Image:
    renderer = QSvgRenderer(str(SOURCE_LOGO))
    if not renderer.isValid():
        raise ValueError(f"Could not load SVG logo: {SOURCE_LOGO}")

    image = QImage(canvas_size, canvas_size, QImage.Format.Format_ARGB32_Premultiplied)
    image.fill(QColor(0, 0, 0, 0))

    painter = QPainter(image)
    painter.setRenderHints(
        QPainter.RenderHint.Antialiasing | QPainter.RenderHint.SmoothPixmapTransform,
    )
    painter.setPen(QPen(QColor(0, 0, 0, 0)))
    painter.setBrush(QColor(255, 255, 255))
    corner_radius = canvas_size * 0.16
    painter.drawRoundedRect(QRectF(0, 0, canvas_size, canvas_size), corner_radius, corner_radius)

    logo_padding = canvas_size * 0.19
    renderer.render(
        painter,
        QRectF(
            logo_padding,
            logo_padding,
            canvas_size - (logo_padding * 2),
            canvas_size - (logo_padding * 2),
        ),
    )
    painter.end()

    if not image.save(str(README_LOGO_PATH), "PNG"):
        raise OSError(f"Could not write rendered logo: {README_LOGO_PATH}")
    return Image.open(README_LOGO_PATH).convert("RGBA")


def create_padded_icon(source: Image.Image, canvas_size: int, scale: float) -> Image.Image:
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    target_size = int(canvas_size * scale)
    resized = source.resize((target_size, target_size), Image.Resampling.LANCZOS)
    offset = ((canvas_size - target_size) // 2, (canvas_size - target_size) // 2)
    canvas.paste(resized, offset, resized)
    return canvas


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    source = render_source_logo()
    for path in LOGO_COPY_PATHS:
        path.parent.mkdir(parents=True, exist_ok=True)
        source.save(path)

    # Keep only a slim transparent edge so the rounded white card stays readable
    # in Windows taskbar, desktop, and tray contexts without making the core mark
    # feel undersized.
    app_icon = create_padded_icon(source, canvas_size=1024, scale=0.9)
    tray_icon = create_padded_icon(source, canvas_size=256, scale=0.88)

    app_icon.save(APP_ICON_PATH)
    tray_icon.save(TRAY_ICON_PATH)
    app_icon.save(
        ICO_PATH,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    try:
        app_icon.save(ICNS_PATH, format="ICNS")
    except Exception as exc:  # pragma: no cover - best effort on Windows
        print(f"Warning: could not update ICNS: {exc}")

    print("Generated:")
    print(f" - {README_LOGO_PATH}")
    for path in LOGO_COPY_PATHS:
        print(f" - {path}")
    print(f" - {APP_ICON_PATH}")
    print(f" - {TRAY_ICON_PATH}")
    print(f" - {ICO_PATH}")
    print(f" - {ICNS_PATH}")


if __name__ == "__main__":
    main()
