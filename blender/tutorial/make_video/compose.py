# -*- coding: utf-8 -*-
"""把案例渲染帧、步骤图、示意图合成为横屏教程视频（1920×1080，30fps，中文字幕）。

需要：Pillow、ffmpeg、Noto Sans CJK 字体。素材路径在 ASSETS 里配置。
用法：python3 compose.py 输出.mp4 [--draft]
"""
import math
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
ASSETS = os.environ.get("TUT_ASSETS", "/tmp/claude-0/tut")
FULL = os.environ.get("TUT_FULL", "/tmp/claude-0/full")          # 机械臂造车完整渲染帧
DRAFT = "--draft" in sys.argv

BG = (11, 14, 22)
FG = (232, 238, 248)
DIM = (140, 152, 172)
CYAN = (56, 200, 255)
PINK = (255, 90, 160)
AMBER = (255, 180, 60)
PANEL = (20, 25, 38)

CJK_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
CJK_R = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
MONO = "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf"
_fc = {}


def font(path, size):
    k = (path, size)
    if k not in _fc:
        idx = 2 if path.endswith(".ttc") else 0          # ttc 第 3 个字形是简体中文
        _fc[k] = ImageFont.truetype(path, size, index=idx)
    return _fc[k]


def mtext(d, xy, text, size, fill):
    """等宽字体画英文/代码，遇到中文字符换成中文字体（等宽字体没有中文字形）。"""
    x, y = xy
    fm, fc = font(MONO, size), font(CJK_R, size)
    for ch in text:
        f = fm if ord(ch) < 0x2E80 else fc
        d.text((x, y + (0 if f is fm else -int(size * 0.12))), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f)
    return x


def wrap(draw, text, fnt, width):
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur); cur = ""; continue
        t = cur + ch
        if draw.textlength(t, font=fnt) > width:
            lines.append(cur); cur = ch
        else:
            cur = t
    if cur:
        lines.append(cur)
    return lines


# ---------------------------------------------------------------- 背景与面板
def background():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    for y in range(H):                                   # 竖向渐变
        c = tuple(int(BG[i] + (6 if i < 2 else 12) * y / H) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    for x in range(0, W, 60):                            # 淡淡的网格
        d.line([(x, 0), (x, H)], fill=(18, 23, 34))
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=(18, 23, 34))
    return im


BG_IM = None
PX, PY, PW, PH = 1300, 60, 540, 960                     # 右侧竖屏演示面板


def slide_base(seg):
    im = BG_IM.copy()
    d = ImageDraw.Draw(im)
    x0 = 90
    if seg.get("chapter"):
        f = font(CJK_B, 26)
        tw = d.textlength(seg["chapter"], font=f)
        d.rounded_rectangle([x0, 70, x0 + tw + 36, 116], 23, fill=(26, 40, 60), outline=CYAN, width=2)
        d.text((x0 + 18, 76), seg["chapter"], font=f, fill=CYAN)
        if seg.get("step"):
            d.text((x0 + tw + 60, 78), seg["step"], font=font(MONO, 26), fill=DIM)
    y = 150
    for line in wrap(d, seg.get("title", ""), font(CJK_B, 56), 1120):
        d.text((x0, y), line, font=font(CJK_B, 56), fill=FG)
        y += 76
    y += 18
    for b in seg.get("bullets", []):
        fb = font(CJK_R, 32)
        lines = wrap(d, b, fb, 1060)
        d.ellipse([x0 + 4, y + 17, x0 + 16, y + 29], fill=PINK)
        for ln in lines:
            d.text((x0 + 36, y), ln, font=fb, fill=(210, 218, 232))
            y += 48
        y += 14
    if seg.get("code"):
        y += 10
        fm = font(MONO, 25)
        code = seg["code"].strip("\n").split("\n")
        h = 28 + 38 * len(code)
        d.rounded_rectangle([x0, y, x0 + 1110, y + h], 14, fill=(16, 20, 30), outline=(44, 54, 76), width=2)
        for i, ln in enumerate(code):
            col = (120, 136, 160) if ln.lstrip().startswith("#") else (170, 230, 255)
            mtext(d, (x0 + 24, y + 16 + 38 * i), ln, 25, col)
    # 右侧面板外框
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).rounded_rectangle([PX - 6, PY - 6, PX + PW + 6, PY + PH + 6], 22, outline=255, width=6)
    glow = glow.filter(ImageFilter.GaussianBlur(10))
    im.paste(Image.new("RGB", (W, H), CYAN), (0, 0), glow.point(lambda v: int(v * 0.35)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([PX - 3, PY - 3, PX + PW + 3, PY + PH + 3], 18, outline=(70, 110, 150), width=3)
    if seg.get("label"):
        f = font(CJK_B, 22)
        tw = d.textlength(seg["label"], font=f)
        d.rounded_rectangle([PX + 16, PY + 16, PX + 40 + tw, PY + 54], 12, fill=(0, 0, 0, 160))
        d.text((PX + 28, PY + 20), seg["label"], font=f, fill=AMBER)
    return im


def draw_caption(im, text, alpha=1.0, full=False):
    if not text:
        return
    d = ImageDraw.Draw(im)
    f = font(CJK_B, 34)
    x0, w = (0, W) if full else (90, 1120)
    lines = wrap(d, text, f, w - 40)
    y = H - 60 - 50 * len(lines)
    for ln in lines:
        tw = d.textlength(ln, font=f)
        x = x0 + (w - tw) / 2
        for dx, dy in ((-2, 0), (2, 0), (0, -2), (0, 2), (2, 2)):
            d.text((x + dx, y + dy), ln, font=f, fill=(0, 0, 0))
        d.text((x, y), ln, font=f, fill=(255, 236, 160))
        y += 50


# ---------------------------------------------------------------- 素材
def load(path, size=(PW, PH)):
    if not os.path.exists(path):                       # 素材还没渲染出来时用占位
        return Image.new("RGB", size, (5, 6, 10))
    im = Image.open(path).convert("RGB")
    if im.size != size:
        im = im.resize(size, Image.LANCZOS)
    return im


def seq_frame(dirpath, prefix, n, total_frames, f_local):
    """按时间取序列帧；缺帧（还在渲染）时退回到最近一帧。"""
    k = n[0] + min(f_local, n[1] - n[0])
    for kk in range(k, n[0] - 1, -1):
        p = os.path.join(dirpath, "%s%04d.png" % (prefix, kk))
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            return load(p)
    return Image.new("RGB", (PW, PH), (5, 6, 10))


def kenburns(img, u, zoom=1.0, focus=(0.5, 0.5)):
    z = zoom * (1.0 + 0.06 * u)
    w, h = img.size
    cw, ch = w / z, h / z
    cx, cy = focus[0] * w, focus[1] * h
    x0 = min(max(cx - cw / 2, 0), w - cw)
    y0 = min(max(cy - ch / 2, 0), h - ch)
    return img.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((PW, PH), Image.BILINEAR)


# ---------------------------------------------------------------- 示意图（画在 540×960 面板里）
def diag_canvas():
    im = Image.new("RGB", (PW, PH), PANEL)
    return im, ImageDraw.Draw(im)


def node(d, x, y, w, title, sub="", col=CYAN, h=None):
    h = h or (96 if sub else 64)
    d.rounded_rectangle([x, y, x + w, y + h], 12, fill=(30, 36, 52), outline=col, width=3)
    d.rectangle([x + 3, y + 3, x + w - 3, y + 30], fill=tuple(int(c * 0.35) for c in col))
    d.text((x + 14, y + 2), title, font=font(CJK_B, 22), fill=FG)
    if sub:
        mtext(d, (x + 14, y + 42), sub, 20, DIM)
    return (x + w / 2, y), (x + w / 2, y + h)


def arrow(d, a, b, col=DIM):
    d.line([a, b], fill=col, width=4)
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    for s in (-1, 1):
        d.line([b, (b[0] - 16 * math.cos(ang + s * 0.45), b[1] - 16 * math.sin(ang + s * 0.45))], fill=col, width=4)


def chain(items, title, notes=()):
    im, d = diag_canvas()
    d.text((30, 30), title, font=font(CJK_B, 30), fill=AMBER)
    y = 110
    prev = None
    for t, sub, col in items:
        top, bot = node(d, 50, y, 440, t, sub, col)
        if prev:
            arrow(d, prev, (top[0], top[1] - 4))
        prev = bot
        y += 132
    yy = y + 6
    for n in notes:
        for ln in wrap(d, n, font(CJK_R, 24), 470):
            d.text((36, yy), ln, font=font(CJK_R, 24), fill=(200, 210, 225))
            yy += 36
        yy += 8
    return im


def graph(title, xs_label, ys_label, curves, xr, yr, marks=(), notes=()):
    im, d = diag_canvas()
    d.text((30, 30), title, font=font(CJK_B, 30), fill=AMBER)
    gx, gy, gw, gh = 70, 140, 430, 360
    d.rectangle([gx, gy, gx + gw, gy + gh], outline=(60, 72, 96), width=2)
    for i in range(1, 4):
        d.line([(gx, gy + gh * i / 4), (gx + gw, gy + gh * i / 4)], fill=(36, 44, 62))
    d.text((gx, gy + gh + 12), xs_label, font=font(CJK_R, 22), fill=DIM)
    d.text((gx - 52, gy - 40), ys_label, font=font(CJK_R, 22), fill=DIM)

    def P(x, y):
        return (gx + gw * (x - xr[0]) / (xr[1] - xr[0]), gy + gh - gh * (y - yr[0]) / (yr[1] - yr[0]))
    for pts, col in curves:
        d.line([P(*p) for p in pts], fill=col, width=5)
    for x, y, txt in marks:
        px, py = P(x, y)
        d.ellipse([px - 8, py - 8, px + 8, py + 8], fill=PINK)
        mtext(d, (px + 10, py - 34), txt, 20, FG)
    yy = gy + gh + 60
    for n in notes:
        for ln in wrap(d, n, font(CJK_R, 24), 470):
            d.text((36, yy), ln, font=font(CJK_R, 24), fill=(200, 210, 225))
            yy += 36
        yy += 8
    return im


def smoothstep(a, b, x):
    t = min(max((x - a) / (b - a), 0), 1)
    return t * t * (3 - 2 * t)


def diag_keys1():
    keys = [(1, 0), (22, 0), (68, 1), (98, 1), (138, 0), (150, 0)]
    pts = []
    for f in range(1, 151):
        for (a, va), (b, vb) in zip(keys, keys[1:]):
            if a <= f <= b:
                pts.append((f, va + (vb - va) * smoothstep(a, b, f)))
                break
    return graph("「爆散系数」关键帧", "帧  0 → 150", "系数", [(pts, CYAN)], (0, 150), (-0.1, 1.15),
                 marks=[(22, 0, "22"), (68, 1, "68"), (98, 1, "98"), (138, 0, "138")],
                 notes=["只打 6 个关键帧：成形 → 爆散 → 停留 → 重组。",
                        "每个点的系数再按随机数错开，所以不是一起飞，而是一波一波散开。"])


def diag_wave():
    curves = []
    for t, col in ((0.0, CYAN), (0.25, PINK)):
        pts = [(x / 50, (0.5 + 0.5 * math.sin(x / 50 * 2.4 - t * 4.2 * 1.5)) ** 4) for x in range(0, 226)]
        curves.append((pts, col))
    return graph("波 = (0.5+0.5·sin(d·k − t·w))⁴", "到中心的距离 d", "高度", curves, (0, 4.5), (-0.05, 1.1),
                 notes=["蓝线是此刻，粉线是 0.4 秒后：波峰在往外推。",
                        "时间 t 来自「场景时间」节点，不用打关键帧，动画自己跑。",
                        "四次方让波峰变窄，柱子起伏更利落。"])


def diag_timescale():
    keys = [(1, 1), (58, 1), (64, 0.22), (101, 0.22), (117, 1), (150, 1)]
    pts = []
    for f in range(1, 151):
        for (a, va), (b, vb) in zip(keys, keys[1:]):
            if a <= f <= b:
                pts.append((f, va + (vb - va) * smoothstep(a, b, f)))
                break
    return graph("刚体世界「时间缩放」", "帧  0 → 150", "速度", [(pts, PINK)], (0, 150), (0, 1.15),
                 marks=[(61, 0.6, "撞击 61"), (101, 0.22, "101")],
                 notes=["撞击前 3 帧开始减速到 0.22 倍，碎块在空中慢慢翻滚。",
                        "40 帧后再恢复正常速度 —— 这就是「子弹时间」。"])


def diag_ik():
    im, d = diag_canvas()
    d.text((30, 30), "两段臂解析 IK", font=font(CJK_B, 30), fill=AMBER)
    S = (120, 620)
    L1, L2 = 260, 240
    T = (420, 470)
    dx, dy = T[0] - S[0], -(T[1] - S[1])
    dist = math.hypot(dx, dy)
    a1 = math.atan2(dy, dx) + math.acos((L1 ** 2 + dist ** 2 - L2 ** 2) / (2 * L1 * dist))
    E = (S[0] + L1 * math.cos(a1), S[1] - L1 * math.sin(a1))
    d.line([(60, 700), (500, 700)], fill=(60, 72, 96), width=3)
    d.rectangle([90, 620, 150, 700], fill=(255, 120, 30))
    d.line([S, E], fill=(255, 140, 40), width=26)
    d.line([E, T], fill=(255, 170, 70), width=20)
    for p in (S, E):
        d.ellipse([p[0] - 18, p[1] - 18, p[0] + 18, p[1] + 18], fill=(40, 44, 56), outline=FG, width=3)
    d.ellipse([T[0] - 12, T[1] - 12, T[0] + 12, T[1] + 12], fill=CYAN)
    d.line([S, T], fill=CYAN, width=2)
    d.text((T[0] - 40, T[1] - 52), "目标点", font=font(CJK_R, 24), fill=CYAN)
    d.text((E[0] - 10, E[1] - 54), "肘", font=font(CJK_R, 24), fill=FG)
    d.text((S[0] - 30, S[1] + 26), "肩", font=font(CJK_R, 24), fill=FG)
    lines = ["d  = |目标 − 肩|", "a1 = atan2(z, r)", "     + acos((L1²+d²−L2²) / (2·L1·d))", "a2 = atan2(z − L1·sin a1,",
             "           r − L1·cos a1)", "转台角 = atan2(Δy, Δx)"]
    y = 730
    for ln in lines:
        mtext(d, (30, y), ln, 21, (170, 230, 255))
        y += 34
    return im


def diag_shots():
    im, d = diag_canvas()
    d.text((30, 30), "六段运镜时间线", font=font(CJK_B, 30), fill=AMBER)
    shots = [("高空环绕全息蓝图", 0, 3.5), ("前侧推近：底盘·前轮", 3.5, 8.0), ("贴地跟拍后轮", 8.0, 11.0),
             ("侧面环绕：车身", 11.0, 15.7), ("高位后侧：座舱·尾翼", 15.7, 20.7), ("正面英雄镜头：点灯", 20.7, 24.5)]
    cols = [CYAN, (120, 160, 255), PINK, AMBER, (140, 230, 160), (255, 120, 120)]
    y = 110
    for (t, a, b), c in zip(shots, cols):
        x0 = 40 + 460 * a / 24.5
        x1 = 40 + 460 * b / 24.5
        d.rounded_rectangle([x0, y, x1, y + 34], 8, fill=c)
        d.text((40, y + 42), "%.1f–%.1fs  %s" % (a, b, t), font=font(CJK_R, 23), fill=FG)
        y += 120
    d.text((30, y), "每段一台相机，用时间轴标记（Marker）\n绑定相机实现硬切，运动模糊不会串到下一段。",
           font=font(CJK_R, 23), fill=(200, 210, 225))
    return im


def label_overlay(img, labels):
    im = img.copy()
    d = ImageDraw.Draw(im)
    for x, y, t, col in labels:
        f = font(CJK_B, 28)
        tw = d.textlength(t, font=f)
        d.rounded_rectangle([x - 8, y - 6, x + tw + 10, y + 40], 10, fill=(0, 0, 0), outline=col, width=3)
        d.text((x, y - 2), t, font=f, fill=col)
    return im


# ---------------------------------------------------------------- 分镜表
def segments():
    S = os.path.join(ASSETS, "steps")
    R1, R2, R3 = (os.path.join(ASSETS, r) for r in ("r1", "r2", "r3"))
    img = lambda p, zoom=1.0, focus=(0.5, 0.5): ("img", p, zoom, focus)  # noqa: E731
    seq = lambda dirp, a, b, prefix="f_": ("seq", dirp, prefix, (a, b))  # noqa: E731
    C1, C2, C3, C4 = "案例一 · 几何节点", "案例二 · 场景时间", "案例三 · 刚体物理", "案例四 · 综合实战"
    return [
        dict(kind="intro", dur=7, caption="四个案例，从零开始，用脚本做出炫酷动效。"),
        dict(kind="slide", dur=7, chapter="准备", title="准备工作：Blender 4.2+，一行命令出片",
             bullets=["每个案例都是一个 Python 脚本，自动建场景、打关键帧、设置渲染", "也可以在 Blender「脚本」工作区里打开直接运行，再进界面里看节点"],
             code="blender -b -P 01_lizi_wenzi.py -- --render --preview\nblender -b -P 01_lizi_wenzi.py -- --still 70",
             media=img(os.path.join(R1, "f_0080.png")), label="案例一成片",
             caption="先装好 Blender 4.2 或更新版本，脚本放在同一个文件夹里。"),
        # ---------- 案例一
        dict(kind="chapter", dur=3.5, chapter=C1, title="粒子文字：爆散 → 旋涡 → 重组", media=seq(R1, 40, 150)),
        dict(kind="slide", dur=5, chapter=C1, step="STEP 1/6", title="文字转成网格",
             bullets=["添加文字物体，输入 MOTION，挤出一点厚度", "转换成网格，作为几何节点的「载体」"],
             code='cu = bpy.data.curves.new("文字", "FONT")\ncu.body = "MOTION"; cu.extrude = 0.04',
             media=img(os.path.join(S, "1a_text.png"), 1.12), caption="第一步，把文字变成网格，后面所有效果都长在它上面。"),
        dict(kind="slide", dur=5.5, chapter=C1, step="STEP 2/6", title="在表面撒点",
             bullets=["「在面上分布点」节点，密度 2600", "点越多字越清楚，但渲染越慢"],
             code='dist = nodes.new("GeometryNodeDistributePointsOnFaces")\ndist.inputs["Density"].default_value = 2600',
             media=img(os.path.join(S, "1b_points.png"), 1.12), caption="在文字表面均匀撒上几千个点，每个点就是一颗粒子。"),
        dict(kind="slide", dur=5.5, chapter=C1, step="STEP 3/6", title="每个点放一个小方块",
             bullets=["「实例化于点上」：实例 = 3 厘米的立方体", "最后「实现实例」+「设置材质」"],
             media=img(os.path.join(S, "1c_cubes.png"), 1.12), caption="再给每个点放一个小方块，看起来还是文字，其实已经是粒子了。"),
        dict(kind="slide", dur=7, chapter=C1, step="STEP 4/6", title="爆散系数：一个数控制全部",
             bullets=["偏移 = 随机向量 × 系数", "旋涡 = 绕竖轴旋转，角度 = 系数 × (2 + 随机·3)", "错峰：每个点的系数 = clamp(F·1.6 − 随机·0.6)"],
             media=("diag", chain([("文字网格", "Group Input", DIM), ("在面上分布点", "Density 2600", CYAN),
                                   ("设置位置", "偏移 + 绕 Z 旋转", PINK), ("实例化于点上", "Cube 0.032", CYAN),
                                   ("实现实例 · 设置材质", "", AMBER)], "节点链",
                                  ["粉色节点由「爆散系数」驱动：0 是文字，1 是旋涡云。"])),
             caption="核心只有一个「爆散系数」：零是文字，一是旋涡，中间值就是爆散的过程。"),
        dict(kind="slide", dur=5, chapter=C1, step="STEP 4/6", title="系数 = 0.45 时",
             bullets=["先散开的是随机数小的点", "这就是「错峰」带来的层次感"],
             media=img(os.path.join(S, "1d_half.png")), caption="系数到一半时，一部分粒子已经飞出去，一部分还留在字上。"),
        dict(kind="slide", dur=6, chapter=C1, step="STEP 5/6", title="给系数打关键帧",
             bullets=["几何节点修改器的输入可以直接打关键帧", "4.x：mod[\"Socket_1\"]   5.x：mod.properties.inputs"],
             code='key_modifier_input(ob, mod, ident, frame=68, value=1.0)',
             media=("diag", diag_keys1()), caption="只给这个系数打六个关键帧，整段动画就出来了。"),
        dict(kind="slide", dur=5.5, chapter=C1, step="STEP 6/6", title="发光材质 + 辉光 = 成片",
             bullets=["自发光颜色按 X 坐标渐变：青 → 紫 → 粉", "合成器加 Bloom 辉光，地板做镜面倒影"],
             media=seq(R1, 1, 150), label="成片", caption="最后加上渐变发光和辉光，这就是成片效果。"),
        # ---------- 案例二
        dict(kind="chapter", dur=3.5, chapter=C2, title="光波矩阵：不打关键帧的循环动画", media=seq(R2, 60, 150)),
        dict(kind="slide", dur=5, chapter=C2, step="STEP 1/4", title="网格的每个顶点放一根方柱",
             bullets=["「网格」节点：26 × 26 个顶点", "方柱先往上挪半格，缩放时只从底部长高"],
             media=img(os.path.join(S, "2a_grid.png"), 1.2), caption="同样的套路：网格的每个点上放一根方柱。"),
        dict(kind="slide", dur=7, chapter=C2, step="STEP 2/4", title="用距离和时间算一道波",
             bullets=["d = 点到中心的距离", "t =「场景时间」节点的秒数", "波值控制方柱 Z 方向的缩放"],
             media=("diag", diag_wave()), caption="高度由距离和时间算出来，波峰会自己一圈一圈往外推。"),
        dict(kind="slide", dur=5, chapter=C2, step="STEP 3/4", title="高度跟着波起伏",
             bullets=["振幅只打两个关键帧：0 → 1", "开场时矩阵从平静慢慢起伏"],
             media=img(os.path.join(S, "2b_wave.png"), 1.2), caption="整段只有振幅这两个关键帧，其余全靠场景时间。"),
        dict(kind="slide", dur=6.5, chapter=C2, step="STEP 4/4", title="把波值传给材质",
             bullets=["「存储命名属性」把波值存为 wave", "材质里「属性」节点读 wave → 颜色渐变 + 发光强度"],
             media=("diag", chain([("实例化于点上", "Scale.z = 波", CYAN), ("存储命名属性", "name = wave", PINK),
                                   ("实现实例", "", CYAN), ("材质：属性节点", "wave → 颜色/强度", AMBER)],
                                  "几何 → 材质", ["几何节点和材质之间就靠这个名字连起来。", "柱子越高越亮，颜色从深蓝到青到粉。"])),
             caption="关键一步：几何节点里存一个属性，材质里按名字读出来，柱子越高越亮。"),
        dict(kind="slide", dur=5, chapter=C2, title="成片", bullets=["相机绕中心转 70°，同时降低机位", "镜面地板 + 辉光"],
             media=seq(R2, 1, 150), label="成片", caption="加上环绕运镜和地面倒影，一个可以无限循环的光波矩阵就完成了。"),
        # ---------- 案例三
        dict(kind="chapter", dur=3.5, chapter=C3, title="刚体撞墙 + 子弹时间", media=seq(R3, 55, 150)),
        dict(kind="slide", dur=6, chapter=C3, step="STEP 1/3", title="主动刚体和被动刚体",
             bullets=["砖墙、金属球：主动（Active），受重力和碰撞", "斜坡、地面：被动（Passive），只挡不动", "球质量 20，砖块 0.6 —— 质量差决定撞得多猛"],
             code='bpy.ops.rigidbody.object_add(type="ACTIVE")\nob.rigid_body.mass = 20.0',
             media=img(os.path.join(S, "3a_roles.png")), caption="物理效果不用手动动画：球从斜坡滚下来，速度全靠重力。"),
        dict(kind="slide", dur=6.5, chapter=C3, step="STEP 2/3", title="子弹时间：给时间缩放打关键帧",
             bullets=["刚体世界的「时间缩放」可以动画", "先不加慢放跑一遍，量出撞击帧（61），再围绕它打关键帧"],
             media=("diag", diag_timescale()), caption="先量出撞墙的那一帧，再在它前后把时间缩放压到零点二二。"),
        dict(kind="slide", dur=6, chapter=C3, step="STEP 3/3", title="相机：先跟球，再看墙",
             bullets=["相机用「标准跟随」看着一个空物体", "空物体加「复制位置」约束贴着球走", "撞墙时把约束影响力从 1 拉到 0，视线平滑转到墙上"],
             media=seq(R3, 1, 70), label="跟随运镜", caption="一个约束加一个影响力关键帧，镜头就能先追球、再看墙。"),
        dict(kind="slide", dur=5, chapter=C3, title="成片", bullets=["烘焙物理缓存后，渲染可以随时中断、续渲"],
             media=seq(R3, 40, 150), label="成片", caption="烘焙好物理缓存，砖墙每次都会以同样的方式倒下。"),
        # ---------- 案例四
        dict(kind="chapter", dur=3.5, chapter=C4, title="机械臂造车：把前面的技巧组合起来", media=seq(FULL, 380, 470)),
        dict(kind="slide", dur=6, chapter=C4, step="STEP 1/5", title="模块化：12 个零件 + 全息蓝图",
             bullets=["车身用截面放样 + 布尔开孔，再按区域切成 12 个模块", "每个模块挂在一个空物体下，搬运时只动空物体"],
             media=img(os.path.join(FULL, "f_0060.png")), label="全息蓝图", caption="先把整车拆成十二个模块，开场用全息蓝图把整车扫描出来。"),
        dict(kind="slide", dur=6.5, chapter=C4, step="STEP 2/5", title="机械臂：两段臂解析 IK",
             bullets=["给定吸盘目标点，直接算出转台、大臂、小臂角度", "逐帧烘焙成关键帧，零件跟着吸盘走"],
             media=("diag", diag_ik()), caption="机械臂不用骨骼，用两段臂的几何公式直接算出每个关节的角度。"),
        dict(kind="slide", dur=6, chapter=C4, step="STEP 3/5", title="全息 → 实体：一个属性切换",
             bullets=["每个零件都有自定义属性 holo", "材质里用「属性」节点读 holo，在真实材质和全息发光之间混合"],
             media=img(os.path.join(FULL, "f_0151.png"), 1.3, (0.5, 0.55)), caption="零件以全息形态出现，落位时把 holo 从一拉到零，就变成了实体。"),
        dict(kind="slide", dur=5.5, chapter=C4, step="STEP 4/5", title="焊接：粒子火花 + 闪光 + 真实光源",
             bullets=["每个落位点一个粒子发射器，只在落位那 9 帧发射", "点光源亮度按帧随机闪烁，照亮车身"],
             media=seq(FULL, 400, 470), caption="落位时同时触发火花粒子、闪光和一盏闪烁的点光源。"),
        dict(kind="slide", dur=6, chapter=C4, step="STEP 5/5", title="六段运镜",
             bullets=["六台相机 + 时间轴标记硬切", "低机位、环绕、推近交替，节奏跟着装配走"],
             media=("diag", diag_shots()), caption="最后用六段运镜把整个装配过程串起来。"),
        dict(kind="slide", dur=8, chapter=C4, title="成片", bullets=["完整脚本：jixiebi_zaoche_blender.py"],
             media=seq(FULL, 600, 735), label="成片", caption="点亮车灯，标题出现，一部机械臂造车短片就完成了。"),
        dict(kind="outro", dur=7, caption="脚本都在 blender/tutorial 文件夹里，改参数就能做出你自己的版本。"),
    ]


def clip_len(media):
    if media and media[0] == "seq":
        a, b = media[3]
        return (b - a + 1) / FPS
    return 0


def render_media(media, t, dur):
    if media is None:
        return None
    if media[0] == "img":
        return kenburns(load(media[1]), t / max(dur, 0.1), media[2], media[3])
    if media[0] == "diag":
        return media[1]
    if media[0] == "seq":
        a, b = media[3]
        return seq_frame(media[1], media[2], (a, b), b - a + 1, int(t * FPS))
    return None


def intro_frame(t, seg):
    im = BG_IM.copy()
    clips = [(os.path.join(ASSETS, "r1"), 1), (os.path.join(ASSETS, "r2"), 1), (os.path.join(ASSETS, "r3"), 40), (FULL, 560)]
    w, h = 300, 533
    x0 = (W - 4 * w - 3 * 40) // 2
    for i, (dp, st) in enumerate(clips):
        fr = seq_frame(dp, "f_", (st, st + 149 if dp != FULL else 735), 150, int(t * FPS) + 30).resize((w, h), Image.BILINEAR)
        y = 420 + int(18 * math.sin(t * 1.2 + i))
        im.paste(fr, (x0 + i * (w + 40), y))
        ImageDraw.Draw(im).rounded_rectangle([x0 + i * (w + 40) - 2, y - 2, x0 + i * (w + 40) + w + 2, y + h + 2], 10,
                                             outline=(70, 110, 150), width=3)
    d = ImageDraw.Draw(im)
    a = min(1, t / 0.8)
    f = font(CJK_B, 96)
    title = "Blender 动效实操"
    tw = d.textlength(title, font=f)
    d.text(((W - tw) / 2, 110 + 20 * (1 - a)), title, font=f, fill=tuple(int(c * a) for c in FG))
    f2 = font(CJK_R, 40)
    sub = "几何节点 · 场景时间 · 刚体物理 · 综合实战"
    tw = d.textlength(sub, font=f2)
    d.text(((W - tw) / 2, 250), sub, font=f2, fill=tuple(int(c * a) for c in CYAN))
    return im


def chapter_frame(t, seg):
    im = BG_IM.copy()
    m = render_media(seg["media"], t, seg["dur"])
    if m:
        big = m.resize((608, 1080), Image.BILINEAR)
        im.paste(big, (W - 608 - 120, 0))
        grad = Image.new("L", (W, H), 0)
        gd = ImageDraw.Draw(grad)
        for x in range(W - 728, W - 520):
            gd.line([(x, 0), (x, H)], fill=int(255 * (1 - (x - (W - 728)) / 208)))
        im.paste(BG_IM, (0, 0), grad)
    d = ImageDraw.Draw(im)
    a = min(1, t / 0.6)
    d.text((140, 380), seg["chapter"], font=font(CJK_B, 44), fill=tuple(int(c * a) for c in CYAN))
    d.line([(140, 450), (140 + int(560 * a), 450)], fill=PINK, width=5)
    y = 480
    for ln in wrap(d, seg["title"], font(CJK_B, 62), 1060):
        d.text((140, y), ln, font=font(CJK_B, 62), fill=FG)
        y += 96
    return im


def outro_frame(t, seg):
    im = BG_IM.copy()
    d = ImageDraw.Draw(im)
    d.text((140, 170), "本期脚本", font=font(CJK_B, 64), fill=FG)
    rows = [("01_lizi_wenzi.py", "粒子文字爆散重组 · 几何节点"), ("02_guangbo_juzhen.py", "光波矩阵 · 场景时间 + 属性传材质"),
            ("03_gangti_zhuangji.py", "刚体撞墙 · 子弹时间 + 跟随运镜"), ("jixiebi_zaoche_blender.py", "机械臂造车 · 综合实战")]
    y = 310
    for i, (a, b) in enumerate(rows):
        al = min(1, max(0, (t - 0.3 * i) / 0.5))
        d.text((160, y), a, font=font(MONO, 40), fill=tuple(int(c * al) for c in CYAN))
        d.text((860, y + 2), b, font=font(CJK_R, 38), fill=tuple(int(c * al) for c in FG))
        y += 100
    mtext(d, (160, y + 40), "blender -b -P 脚本.py -- --render --preview", 34, AMBER)
    return im


def segment_frame(seg, t):
    k = seg["kind"]
    if k == "intro":
        im = intro_frame(t, seg)
    elif k == "chapter":
        im = chapter_frame(t, seg)
    elif k == "outro":
        im = outro_frame(t, seg)
    else:
        im = seg["_base"].copy()
        m = render_media(seg.get("media"), t, seg["dur"])
        if m:
            im.paste(m, (PX, PY))
            if seg.get("label"):
                d = ImageDraw.Draw(im)
                f = font(CJK_B, 24)
                tw = d.textlength(seg["label"], font=f)
                d.rounded_rectangle([PX + 16, PY + 16, PX + 44 + tw, PY + 58], 12, fill=(0, 0, 0))
                d.text((PX + 30, PY + 20), seg["label"], font=f, fill=AMBER)
    ca = min(1, t / 0.4)
    draw_caption(im, seg.get("caption"), ca, full=(k != "slide"))
    return im


def main():
    global BG_IM
    out = sys.argv[1]
    BG_IM = background()
    segs = segments()
    for s in segs:
        s["dur"] = max(s["dur"], min(clip_len(s.get("media")), 9.0) if s["kind"] == "slide" else 0)
        if s["kind"] == "slide":
            s["_base"] = slide_base(s)
    scale = 0.5 if DRAFT else 1.0
    size = (int(W * scale), int(H * scale))
    total = sum(s["dur"] for s in segs)
    print("总时长 %.1f 秒，%d 段" % (total, len(segs)))
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s",
                           "%dx%d" % size, "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                           "-crf", "20", "-preset", "medium", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    XF = 8                                                      # 交叉淡化帧数
    prev_tail = None
    for si, s in enumerate(segs):
        n = int(round(s["dur"] * FPS))
        for i in range(n):
            im = segment_frame(s, i / FPS)
            if prev_tail is not None and i < XF:
                im = Image.blend(prev_tail, im, (i + 1) / (XF + 1))
            if i == n - 1:
                prev_tail = im
            if scale != 1.0:
                im = im.resize(size, Image.BILINEAR)
            ff.stdin.write(im.tobytes())
        print("  段 %d/%d 完成" % (si + 1, len(segs)), flush=True)
    ff.stdin.close()
    ff.wait()
    print("完成:", out)


if __name__ == "__main__":
    main()
