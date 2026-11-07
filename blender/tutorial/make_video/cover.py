# -*- coding: utf-8 -*-
"""教程封面：横版 1920×1080（左标题、右四张成片），竖版 1080×1920 / 3:4 1080×1440（上标题、中间 2×2）。
用法：python3 cover.py 输出.png [--vertical | --3x4]
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

A = os.environ.get("TUT_ASSETS", "/tmp/claude-0/tut")
FULL = os.environ.get("TUT_FULL", "/tmp/claude-0/full")
W, H = 1920, 1080
CJK_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
if not os.path.exists(CJK_B):
    CJK_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
CJK_M = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
CYAN, PINK, AMBER = (56, 200, 255), (255, 80, 160), (255, 190, 70)


def F(path, size):
    return ImageFont.truetype(path, size, index=2)


def gradient_text(base, xy, text, fnt, c1, c2):
    mask = Image.new("L", base.size, 0)
    ImageDraw.Draw(mask).text(xy, text, font=fnt, fill=255)
    bbox = mask.getbbox()
    grad = Image.new("RGB", base.size)
    gd = ImageDraw.Draw(grad)
    x0, x1 = bbox[0], bbox[2]
    for x in range(x0, x1 + 1):
        u = (x - x0) / max(1, x1 - x0)
        gd.line([(x, bbox[1]), (x, bbox[3])], fill=tuple(int(a + (b - a) * u) for a, b in zip(c1, c2)))
    glow = mask.filter(ImageFilter.GaussianBlur(22))
    base.paste(Image.new("RGB", base.size, tuple((a + b) // 2 for a, b in zip(c1, c2))), (0, 0),
               glow.point(lambda v: int(v * 0.55)))
    base.paste(grad, (0, 0), mask)


def card(im, src, box, crop=None, angle=0.0):
    x, y, w, h = box
    pic = Image.open(src).convert("RGB")
    if crop:
        pic = pic.crop(crop)
    pic = pic.resize((w, h), Image.LANCZOS)
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], 26, fill=255)
    layer = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    layer.paste(pic, (20, 20), m)
    ImageDraw.Draw(layer).rounded_rectangle([20, 20, w + 19, h + 19], 26, outline=(255, 255, 255, 90), width=3)
    if angle:
        layer = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh.putalpha(layer.split()[3].filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.8)))
    im.paste(sh, (x - 20 + 14, y - 20 + 22), sh)
    im.paste(layer, (x - 20, y - 20), layer)


def main(out):
    im = Image.new("RGB", (W, H), (8, 10, 18))
    d = ImageDraw.Draw(im)
    for yy in range(H):                                   # 背景渐变 + 两团彩色光
        d.line([(0, yy), (W, yy)], fill=(8, 10 + yy // 90, 18 + yy // 40))
    blob = Image.new("RGB", (W, H), (0, 0, 0))
    bd = ImageDraw.Draw(blob)
    bd.ellipse([1050, -200, 1950, 600], fill=(80, 30, 120))
    bd.ellipse([-300, 600, 700, 1400], fill=(10, 70, 110))
    blob = blob.filter(ImageFilter.GaussianBlur(160))
    im = Image.fromarray(np.clip(np.asarray(im, dtype="int16") + np.asarray(blob, dtype="int16") * 6 // 10, 0, 255)
                         .astype("uint8"))
    d = ImageDraw.Draw(im)
    for x in range(0, W, 64):                             # 淡网格
        d.line([(x, 0), (x, H)], fill=(20, 26, 40))
    for yy in range(0, H, 64):
        d.line([(0, yy), (W, yy)], fill=(20, 26, 40))

    # 右侧四张成片（略微错落）
    cw, ch = 280, 498
    cards = [
        (os.path.join(A, "r1", "f_0124.png"), None, -3),
        (os.path.join(A, "r2", "f_0120.png"), None, 2),
        (os.path.join(A, "r3", "f_0090.png"), None, -2),
        (os.path.join(FULL, "f_0685.png"), None, 3),
    ]
    xs = [985, 1205, 1425, 1610]
    ys = [330, 250, 340, 260]
    for (src, crop, ang), x, y in zip(cards, xs, ys):
        if crop:
            card(im, src, (x, y, cw, int(cw * (crop[3] - crop[1]) / (crop[2] - crop[0]))), crop, ang)
        else:
            card(im, src, (x, y, cw, ch), None, ang)

    d = ImageDraw.Draw(im)
    # 左侧文字
    tag = "BLENDER 实操教程"
    d.rounded_rectangle([100, 130, 100 + d.textlength(tag, font=F(CJK_M, 40)) + 56, 202], 36,
                        fill=(20, 30, 50), outline=CYAN, width=3)
    d.text((128, 136), tag, font=F(CJK_M, 40), fill=CYAN)
    gradient_text(im, (88, 225), "动效", F(CJK_B, 250), CYAN, (150, 120, 255))
    gradient_text(im, (88, 480), "实操", F(CJK_B, 250), (180, 110, 255), PINK)
    d = ImageDraw.Draw(im)
    d.text((104, 840), "4 个案例 · 脚本一键出片", font=F(CJK_M, 52), fill=(240, 244, 252))
    chips = [("几何节点", CYAN), ("场景时间", (150, 120, 255)), ("刚体物理", PINK), ("机械臂造车", AMBER)]
    x = 104
    for t, c in chips:
        tw = d.textlength(t, font=F(CJK_M, 32))
        d.rounded_rectangle([x, 940, x + tw + 40, 996], 28, fill=tuple(v // 5 for v in c), outline=c, width=3)
        d.text((x + 20, 944), t, font=F(CJK_M, 32), fill=c)
        x += tw + 60
    im.save(out, quality=95)
    print("封面:", out)


def background(w, h):
    im = Image.new("RGB", (w, h), (8, 10, 18))
    d = ImageDraw.Draw(im)
    for yy in range(h):
        d.line([(0, yy), (w, yy)], fill=(8, 10 + yy * 22 // h, 18 + yy * 48 // h))
    blob = Image.new("RGB", (w, h), (0, 0, 0))
    bd = ImageDraw.Draw(blob)
    bd.ellipse([w * 0.35, -h * 0.15, w * 1.35, h * 0.35], fill=(80, 30, 120))
    bd.ellipse([-w * 0.4, h * 0.65, w * 0.6, h * 1.2], fill=(10, 70, 110))
    blob = blob.filter(ImageFilter.GaussianBlur(160))
    im = Image.fromarray(np.clip(np.asarray(im, dtype="int16") + np.asarray(blob, dtype="int16") * 6 // 10, 0, 255)
                         .astype("uint8"))
    d = ImageDraw.Draw(im)
    for x in range(0, w, 64):
        d.line([(x, 0), (x, h)], fill=(20, 26, 40))
    for yy in range(0, h, 64):
        d.line([(0, yy), (w, yy)], fill=(20, 26, 40))
    return im


def centered(d, w, y, text, fnt, fill):
    d.text(((w - d.textlength(text, font=fnt)) / 2, y), text, font=fnt, fill=fill)


def main_vertical(out, w, h):
    """竖版：标题在上，四张成片 2×2，副标题和标签在下。"""
    im = background(w, h)
    tall = h >= 1800
    d = ImageDraw.Draw(im)
    tag = "BLENDER 实操教程"
    ft = F(CJK_M, 40)
    tw = d.textlength(tag, font=ft)
    ty = 80 if tall else 60
    d.rounded_rectangle([(w - tw) / 2 - 28, ty, (w + tw) / 2 + 28, ty + 72], 36, fill=(20, 30, 50), outline=CYAN, width=3)
    centered(d, w, ty + 6, tag, ft, CYAN)
    fsz = 230 if tall else 190
    fb = F(CJK_B, fsz)
    tw = ImageDraw.Draw(im).textlength("动效实操", font=fb)
    gradient_text(im, ((w - tw) / 2, ty + 90), "动效实操", fb, CYAN, PINK)
    d = ImageDraw.Draw(im)
    # 2×2 成片
    cw = 350 if tall else 280
    ratio = 1.5 if tall else 4 / 3                         # 卡片高宽比：竖版 2:3，3:4 版 3:4
    chh = int(cw * ratio)
    gap = 40
    top = ty + 90 + int(fsz * 1.45)
    srcs = [os.path.join(A, "r1", "f_0124.png"), os.path.join(A, "r2", "f_0120.png"),
            os.path.join(A, "r3", "f_0090.png"), os.path.join(FULL, "f_0685.png")]
    angs = [-2.5, 2, 2, -2.5]
    for i, (src, ang) in enumerate(zip(srcs, angs)):
        col, row = i % 2, i // 2
        x = int(w / 2 - cw - gap / 2 + col * (cw + gap))
        y = top + row * (chh + gap)
        ph = int(540 * ratio)                              # 截取竖屏画面中段
        crop = (0, (960 - ph) // 2, 540, (960 - ph) // 2 + ph)
        card(im, src, (x, y, cw, chh), crop, ang)
    d = ImageDraw.Draw(im)
    by = top + 2 * chh + gap + (70 if tall else 50)
    centered(d, w, by, "4 个案例 · 脚本一键出片", F(CJK_M, 56 if tall else 46), (240, 244, 252))
    chips = [("几何节点", CYAN), ("场景时间", (150, 120, 255)), ("刚体物理", PINK), ("机械臂造车", AMBER)]
    fc = F(CJK_M, 34 if tall else 28)
    widths = [d.textlength(t, font=fc) + 40 for t, _ in chips]
    total = sum(widths) + 18 * 3
    x = (w - total) / 2
    cy = by + (100 if tall else 80)
    for (t, c), cwid in zip(chips, widths):
        d.rounded_rectangle([x, cy, x + cwid, cy + (60 if tall else 52)], 28, fill=tuple(v // 5 for v in c), outline=c, width=3)
        d.text((x + 20, cy + 4), t, font=fc, fill=c)
        x += cwid + 18
    im.save(out, quality=95)
    print("封面:", out, im.size)


if __name__ == "__main__":
    if "--vertical" in sys.argv:
        main_vertical(sys.argv[1], 1080, 1920)
    elif "--3x4" in sys.argv:
        main_vertical(sys.argv[1], 1080, 1440)
    else:
        main(sys.argv[1])
