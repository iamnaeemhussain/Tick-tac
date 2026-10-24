#!/usr/bin/env python3
"""
Generates branding assets for Tick-Tac Arena:
  • public/og.png              (1200×630 social share image)
  • public/apple-touch-icon.png (512×512)

Reproducible with Pillow:  pip install pillow
Run:                       python3 scripts/generate_og.py
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
os.makedirs(PUBLIC, exist_ok=True)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# Brand palette
BG_TOP = (24, 20, 64)      # #181440
BG_BOTTOM = (13, 11, 34)   # #0d0b22
CYAN = (34, 211, 238)      # X
ROSE = (251, 113, 133)     # O
VIOLET = (167, 139, 250)
TEXT = (242, 241, 251)
MUTED = (165, 162, 195)
GRID = (120, 115, 190)


def v_gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return img


def add_glow(img, center, radius, color, alpha):
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    x, y = center
    d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color + (alpha,))
    glow = glow.filter(ImageFilter.GaussianBlur(radius / 2.2))
    img.alpha_composite(glow)


def rounded_line(d, xy, width, fill):
    d.line(xy, fill=fill, width=width)
    (x0, y0), (x1, y1) = xy
    r = width / 2
    d.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=fill)
    d.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=fill)


def draw_x(layer, cx, cy, size, color, width):
    h = size / 2
    rounded_line(ImageDraw.Draw(layer), [(cx - h, cy - h), (cx + h, cy + h)], width, color)
    rounded_line(ImageDraw.Draw(layer), [(cx + h, cy - h), (cx - h, cy + h)], width, color)


def draw_o(layer, cx, cy, size, color, width):
    d = ImageDraw.Draw(layer)
    r = size / 2
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=width)


def stroke_alpha_mask(size, marks, stroke, blur):
    """Blurred alpha mask of the mark strokes (white-on-black)."""
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for cx, cy, kind, _color in marks:
        s = stroke * 1.7
        h = s / 2
        if kind == "X":
            d.line([(cx - h, cy - h), (cx + h, cy + h)], fill=255, width=stroke)
            d.line([(cx + h, cy - h), (cx - h, cy + h)], fill=255, width=stroke)
            r = stroke / 2
            for px_, py_ in ((cx - h, cy - h), (cx + h, cy + h), (cx + h, cy - h), (cx - h, cy + h)):
                d.ellipse([px_ - r, py_ - r, px_ + r, py_ + r], fill=255)
        else:
            w = max(2.0, s * 0.26)
            r = s / 2 - w / 2
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=255, width=int(w * 1.6))
    return m.filter(ImageFilter.GaussianBlur(blur))


def color_layer(size, mask, color, alpha=1.0):
    """Solid-color RGBA layer shaped by an alpha mask."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    solid = Image.new("RGBA", size, color + (int(255 * alpha),))
    layer.paste(solid, (0, 0), mask)
    return layer


def marks_layer(size, marks, stroke):
    """Crisp marks with a soft colored halo (no dark-edge artifacts)."""
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    # colored glow per mark color
    for color in {m[3] for m in marks}:
        sub = [m for m in marks if m[3] == color]
        halo = stroke_alpha_mask(size, sub, stroke, blur=stroke * 1.1)
        out.alpha_composite(color_layer(size, halo, color, alpha=0.5))
    # crisp strokes
    d = ImageDraw.Draw(out)
    for cx, cy, kind, color in marks:
        s = stroke * 1.7
        if kind == "X":
            draw_x(out, cx, cy, s, color + (255,), max(2, int(s * 0.34)))
        else:
            w = max(2, int(s * 0.26))
            r = s / 2 - w / 2
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color + (255,), width=w)
    return out


def gradient_text(base, xy, text, font, colors):
    """Draw text with a horizontal gradient fill."""
    tmp = Image.new("L", base.size, 0)
    d = ImageDraw.Draw(tmp)
    d.text(xy, text, font=font, fill=255)
    bbox = tmp.getbbox()
    if not bbox:
        return
    x0, y0, x1, y1 = bbox
    grad = Image.new("RGB", (x1 - x0, y1 - y0))
    px = grad.load()
    c0, c1, c2 = colors
    for x in range(x1 - x0):
        t = x / max(1, (x1 - x0) - 1)
        if t < 0.5:
            u = t * 2
            c = tuple(int(c0[i] + (c1[i] - c0[i]) * u) for i in range(3))
        else:
            u = (t - 0.5) * 2
            c = tuple(int(c1[i] + (c2[i] - c1[i]) * u) for i in range(3))
        for y in range(y1 - y0):
            px[x, y] = c
    base.paste(grad, (x0, y0), tmp.crop(bbox))


def pill(d, xy, text, font, fill, text_color, pad=(26, 12)):
    x, y = xy
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    w, h = tw + pad[0] * 2, th + pad[1] * 2
    d.rounded_rectangle([x, y, x + w, y + h], radius=h / 2, fill=fill, outline=(255, 255, 255, 40))
    d.text((x + pad[0] - bbox[0], y + pad[1] - bbox[1]), text, font=font, fill=text_color)
    return w


def generate_og():
    W, H = 1200, 630
    img = v_gradient((W, H), BG_TOP, BG_BOTTOM).convert("RGBA")
    add_glow(img, (180, -40), 420, (99, 102, 241), 90)
    add_glow(img, (1080, 660), 460, (217, 70, 239), 60)
    add_glow(img, (620, 300), 520, (34, 211, 238), 22)

    # ── board on the right (translucent card drawn on its own overlay) ──
    bx, by, bs = 768, 122, 366  # board box
    cell = bs / 3
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle([bx - 20, by - 20, bx + bs + 20, by + bs + 20], radius=38,
                         fill=(255, 255, 255, 14), outline=(255, 255, 255, 46), width=2)
    for i in (1, 2):
        rounded_line(cd, [(bx + cell * i, by + 14), (bx + cell * i, by + bs - 14)], 7, GRID + (190,))
        rounded_line(cd, [(bx + 14, by + cell * i), (bx + bs - 14, by + cell * i)], 7, GRID + (190,))
    img.alpha_composite(card)
    d = ImageDraw.Draw(img)

    def cc(col, row):
        return bx + cell * col + cell / 2, by + cell * row + cell / 2

    marks = []
    # X wins the diagonal 0-4-8; O holds two cells
    for col, row, kind, color in [
        (0, 0, "X", CYAN), (1, 1, "X", CYAN), (2, 2, "X", CYAN),
        (2, 0, "O", ROSE), (0, 2, "O", ROSE),
    ]:
        cx, cy = cc(col, row)
        marks.append((cx, cy, kind, color))
    img.alpha_composite(marks_layer((W, H), marks, stroke=20))

    # winning diagonal streak
    streak = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(streak)
    p0 = cc(0, 0)
    p2 = cc(2, 2)
    sd.line([p0, p2], fill=(255, 255, 255, 235), width=13)
    r = 6.5
    sd.ellipse([p0[0] - r, p0[1] - r, p0[0] + r, p0[1] + r], fill=(255, 255, 255, 235))
    sd.ellipse([p2[0] - r, p2[1] - r, p2[0] + r, p2[1] + r], fill=(255, 255, 255, 235))
    streak = streak.filter(ImageFilter.GaussianBlur(1.2))
    img.alpha_composite(streak)

    # ── left copy ──
    logo = ImageFont.truetype(FONT_BOLD, 30)
    title = ImageFont.truetype(FONT_BOLD, 78)
    sub = ImageFont.truetype(FONT_REG, 33)
    pillf = ImageFont.truetype(FONT_BOLD, 23)

    # mini logo mark
    lm = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_x(lm, 78, 96, 34, CYAN, 9)
    draw_o(lm, 128, 96, 30, ROSE, 9)
    img.alpha_composite(lm)
    d.text((162, 78), "TICK-TAC ARENA", font=logo, fill=MUTED)

    gradient_text(img, (66, 152), "Play instantly.", title, (CYAN, VIOLET, ROSE))
    d.text((66, 252), "Win together.", font=title, fill=TEXT)

    d.text((68, 382), "Challenge a friend with a single link —", font=sub, fill=MUTED)
    d.text((68, 424), "or battle an unbeatable AI. No sign-up,", font=sub, fill=MUTED)
    d.text((68, 466), "no downloads, unlimited rematches.", font=sub, fill=MUTED)

    pills = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(pills)
    x = 68
    for t in ("No sign-up", "Private rooms", "Free forever"):
        w = pill(pd, (x, 540), t, pillf, (255, 255, 255, 16), TEXT)
        x += w + 14
    img.alpha_composite(pills)

    out = img.convert("RGB")
    path = os.path.join(PUBLIC, "og.png")
    out.save(path, optimize=True)
    print(f"wrote {path} ({os.path.getsize(path) // 1024} KB)")

    # JPEG variant for size-sensitive scrapers (WhatsApp previews < 600KB)
    jpg = os.path.join(PUBLIC, "og.jpg")
    out.save(jpg, quality=82, optimize=True)
    print(f"wrote {jpg} ({os.path.getsize(jpg) // 1024} KB)")


def generate_apple_icon():
    S = 512
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # rounded-square gradient background
    bg = v_gradient((S, S), (37, 31, 105), (23, 19, 62)).convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([8, 8, S - 8, S - 8], radius=116, fill=255)
    img.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([8, 8, S - 8, S - 8], radius=116, outline=(129, 140, 248, 160), width=6)

    marks = marks_layer((S, S), [(176, 190, "X", CYAN), (336, 336, "O", ROSE)], stroke=44)
    img.alpha_composite(marks)

    path = os.path.join(PUBLIC, "apple-touch-icon.png")
    img.convert("RGB").save(path, optimize=True)
    print(f"wrote {path} ({os.path.getsize(path) // 1024} KB)")


if __name__ == "__main__":
    generate_og()
    generate_apple_icon()
