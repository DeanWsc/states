# -*- coding: utf-8 -*-
"""
机械臂造车 —— Blender 自动建场景 + 自动渲染脚本
==================================================

一行命令：自动建场景、按六段运镜自动渲染出竖屏 MP4（1080×1920, 30fps, 24.5 秒, 无声）。

用法（Blender 4.2 或更新版本）：

    macOS:
      /Applications/Blender.app/Contents/MacOS/Blender -b -P jixiebi_zaoche_blender.py -- --render --preview
    Windows:
      "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe" -b -P jixiebi_zaoche_blender.py -- --render --preview
    Linux:
      blender -b -P jixiebi_zaoche_blender.py -- --render --preview

参数（写在 `--` 后面）：
    --render        建完场景后直接渲染整段动画（不加则只建场景并保存 .blend）
    --preview       预览版：540×960、低采样，几分钟出片，用来检查运镜和构图
    --cycles        用 Cycles 渲染（更真实，但慢很多）；默认 EEVEE
    --still N       只渲染第 N 帧为 PNG（检查单帧画面用；多帧用逗号：--still 120,300,700）
    --frames A-B    只渲染第 A 到 B 帧（如 --frames 600-735），文件名会带上帧范围
    --out 目录      输出目录（默认：桌面/jixiebi_render）
    --font 路径     指定中文标题字体文件（默认自动查找系统字体）

成片和场景文件 jixiebi_zaoche.blend 放在输出目录里。

运镜（六段硬切）：
    1  0.0– 3.5s  高空环绕全息蓝图
    2  3.5– 8.0s  前侧推近：装底盘、前轮
    3  8.0–11.0s  低机位贴地跟拍后轮：装后轮、发动机
    4 11.0–15.7s  侧面环绕：装车头、左右车身
    5 15.7–20.7s  高位后侧：装座舱、发动机盖、车尾、尾翼
    6 20.7–24.5s  低机位正面英雄镜头：装车灯、点灯、标题
"""

import math
import os
import random
import sys

import bpy  # noqa: I001  （必须先于 bmesh 导入）
import bmesh
from mathutils import Euler, Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

# ---------------------------------------------------------------------------
# 可调参数
# ---------------------------------------------------------------------------
LIGHT_SCALE = 1.0                 # 画面偏暗调大（如 1.5），偏亮调小（如 0.7）
PAINT = (0.42, 0.012, 0.018)      # 车漆颜色（线性 RGB），默认深红
HOLO = (0.10, 0.65, 1.00)         # 全息颜色
HOLO_STRENGTH = 3.0               # 全息亮度
VOLUME_DENSITY = 0.010            # 顶灯光束（空气雾）浓度，0 关闭

TITLE_CN = "机械臂造车"
TITLE_EN = "ROBOTIC BUILD"
SUBTITLE = "12 MODULES  ·  ONE TAKE"

FPS = 30
FRAMES = 735                      # 24.5 秒
RES = (1080, 1920)

# ---------------------------------------------------------------------------
# 命令行
# ---------------------------------------------------------------------------


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {"render": False, "preview": False, "cycles": False, "still": None, "out": None, "font": None,
         "frames": None}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k == "--render":
            a["render"] = True
        elif k == "--preview":
            a["preview"] = True
        elif k == "--cycles":
            a["cycles"] = True
        elif k == "--still" and i + 1 < len(argv):
            a["still"] = [int(v) for v in argv[i + 1].split(",") if v.strip()]; i += 1
        elif k == "--out" and i + 1 < len(argv):
            a["out"] = argv[i + 1]; i += 1
        elif k == "--frames" and i + 1 < len(argv):
            lo_, hi_ = argv[i + 1].split("-")
            a["frames"] = (int(lo_), int(hi_)); i += 1
        elif k == "--font" and i + 1 < len(argv):
            a["font"] = argv[i + 1]; i += 1
        else:
            print("[jixiebi] 忽略未知参数:", k)
        i += 1
    return a


ARGS = parse_args()


def output_dir():
    if ARGS["out"]:
        d = os.path.abspath(os.path.expanduser(ARGS["out"]))
    else:
        home = os.path.expanduser("~")
        desk = None
        for name in ("Desktop", "桌面", os.path.join("OneDrive", "Desktop"), os.path.join("OneDrive", "桌面")):
            p = os.path.join(home, name)
            if os.path.isdir(p):
                desk = p
                break
        d = os.path.join(desk or home, "jixiebi_render")
    os.makedirs(d, exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------


def sset(obj, attr, value):
    """设置可能因版本不同而不存在的属性，失败就跳过。"""
    try:
        setattr(obj, attr, value)
        return True
    except (AttributeError, TypeError, ValueError):
        return False


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def smooth(u):
    u = clamp(u, 0.0, 1.0)
    return u * u * (3 - 2 * u)


def ease(u):
    u = clamp(u, 0.0, 1.0)
    return 4 * u * u * u if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2


def lerp(a, b, u):
    return a + (b - a) * u


def vlerp(a, b, u):
    return Vector(a).lerp(Vector(b), u)


def pchip(table):
    """单调三次插值（不会过冲），用来定义车身曲线。"""
    xs = [p[0] for p in table]
    ys = [p[1] for p in table]
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    return f


COLL = {}


def coll(name):
    if name not in COLL:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        COLL[name] = c
    return COLL[name]


def link(obj, cname="Scene"):
    coll(cname).objects.link(obj)
    return obj


def init_props(obj):
    obj["holo"] = 0.0   # 1 = 全息形态
    obj["hid"] = 0.0    # 1 = 完全隐形
    obj["glow"] = 0.0   # 车灯/吸盘发光
    obj["fade"] = 0.0   # 蓝图幽灵可见度


def mesh_obj(name, bm, mats, cname="Scene", smooth_shade=True):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth_shade:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    init_props(ob)
    return link(ob, cname)


def bm_box(bm, center, size, mat=0, rot=None):
    r = bmesh.ops.create_cube(bm, size=1.0)
    vs = r["verts"]
    M = Matrix.Translation(center)
    if rot is not None:
        M = M @ Euler(rot).to_matrix().to_4x4()
    M = M @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    bmesh.ops.transform(bm, matrix=M, verts=vs)
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mat
    return vs


def bm_cyl(bm, center, radius, depth, axis="Z", segs=32, mat=0, r2=None, cap=True):
    r = bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs,
                              radius1=radius, radius2=radius if r2 is None else r2, depth=depth)
    vs = r["verts"]
    rot = {"Z": Matrix.Identity(4), "X": Matrix.Rotation(math.pi / 2, 4, "Y"),
           "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center) @ rot, verts=vs)
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mat
    return vs


def bm_sphere(bm, center, radius, scale=(1, 1, 1), mat=0, segs=24):
    r = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2, radius=radius)
    vs = r["verts"]
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center) @ Matrix.Diagonal((*scale, 1.0)), verts=vs)
    for f in {f for v in vs for f in v.link_faces}:
        f.material_index = mat
    return vs


def bm_lathe(bm, profile, segs=48, mat=0, closed=True):
    """绕 Y 轴旋转 (r, y) 轮廓。"""
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        rings.append([bm.verts.new((r * math.cos(a), y, r * math.sin(a))) for r, y in profile])
    n = len(profile)
    faces = []
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % segs]
        for j in range(n if closed else n - 1):
            k = (j + 1) % n
            f = bm.faces.new((A[j], A[k], B[k], B[j]))
            f.material_index = mat
            faces.append(f)
    return faces


def chaikin(pts, it=2, closed=True):
    for _ in range(it):
        out = []
        n = len(pts)
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            p, q = pts[i], pts[(i + 1) % n]
            out.append((0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]))
            out.append((0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]))
        if not closed:
            out = [pts[0]] + out + [pts[-1]]
        pts = out
    return pts


def add_bevel(ob, width=0.01, segs=2):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segs
    sset(m, "limit_method", "ANGLE")
    sset(m, "harden_normals", False)
    return m


def flat(ob):
    for p in ob.data.polygons:
        p.use_smooth = False


def key_prop(ob, name, frame, value):
    ob[name] = float(value)
    ob.keyframe_insert(data_path='["%s"]' % name, frame=frame)


# ---------------------------------------------------------------------------
# 材质
# ---------------------------------------------------------------------------


def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    sset(m, "use_transparent_shadow", True)
    sset(m, "surface_render_method", "DITHERED")
    sset(m, "blend_method", "HASHED")          # 旧版本兼容
    sset(m, "shadow_method", "HASHED")
    return m, nt


def inp(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    return None


def principled(nt, color, metallic=0.0, rough=0.5, coat=0.0, coat_rough=0.03, alpha=1.0):
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    s = inp(b, "Coat Weight", "Clearcoat")
    if s:
        s.default_value = coat
    s = inp(b, "Coat Roughness", "Clearcoat Roughness")
    if s:
        s.default_value = coat_rough
    b.inputs["Alpha"].default_value = alpha
    return b


def attr(nt, name):
    a = nt.nodes.new("ShaderNodeAttribute")
    a.attribute_type = "OBJECT"
    a.attribute_name = name
    return a.outputs["Fac"]


def math_node(nt, op, a, b=None, val=None):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            nt.links.new(x, n.inputs[i])
    return n.outputs[0]


def holo_shader(nt, strength=HOLO_STRENGTH):
    """全息：菲涅尔边缘 + 扫描线，叠加发光。"""
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    lines = math_node(nt, "MULTIPLY", sep.outputs["Z"], 70.0)
    lines = math_node(nt, "SINE", lines)
    lines = math_node(nt, "MULTIPLY_ADD", lines, 0.5)
    lines.node.inputs[2].default_value = 0.5
    lines = math_node(nt, "POWER", lines, 10.0)
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.35
    edge = math_node(nt, "POWER", lw.outputs["Facing"], 1.5)
    tot = math_node(nt, "MULTIPLY_ADD", edge, 1.8)
    nt.links.new(lines, tot.node.inputs[2])
    tot = math_node(nt, "ADD", tot, 0.12)
    tot = math_node(nt, "MULTIPLY", tot, strength)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*HOLO, 1)
    nt.links.new(tot, em.inputs["Strength"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(em.outputs[0], add.inputs[0])
    nt.links.new(tr.outputs[0], add.inputs[1])
    return add.outputs[0]


def finish(nt, real_out):
    """real → (holo 混合) → (hid 隐形) → 输出。所有车辆/机械臂材质都走这里。"""
    holo = holo_shader(nt)
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(attr(nt, "holo"), mix.inputs[0])
    nt.links.new(real_out, mix.inputs[1])
    nt.links.new(holo, mix.inputs[2])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix2 = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(attr(nt, "hid"), mix2.inputs[0])
    nt.links.new(mix.outputs[0], mix2.inputs[1])
    nt.links.new(tr.outputs[0], mix2.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(mix2.outputs[0], out.inputs["Surface"])


def mat_basic(name, color, metallic=0.0, rough=0.5, coat=0.0, alpha=1.0, coat_rough=0.03):
    m, nt = new_mat(name)
    b = principled(nt, color, metallic, rough, coat, coat_rough, alpha)
    finish(nt, b.outputs[0])
    return m


def mat_paint():
    m, nt = new_mat("车漆")
    b = principled(nt, PAINT, metallic=0.55, rough=0.32, coat=1.0, coat_rough=0.02)
    # 金属闪粉：细噪声扰动粗糙度
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 900.0
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["To Min"].default_value = 0.22
    ramp.inputs["To Max"].default_value = 0.42
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Value"])
    nt.links.new(ramp.outputs[0], b.inputs["Roughness"])
    finish(nt, b.outputs[0])
    return m


def mat_carbon():
    m, nt = new_mat("碳纤维")
    b = principled(nt, (0.02, 0.02, 0.022), metallic=0.2, rough=0.35, coat=1.0, coat_rough=0.03)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    ck = nt.nodes.new("ShaderNodeTexChecker")
    ck.inputs["Scale"].default_value = 90.0
    ck.inputs["Color1"].default_value = (0.008, 0.008, 0.009, 1)
    ck.inputs["Color2"].default_value = (0.045, 0.045, 0.05, 1)
    nt.links.new(tc.outputs["Object"], ck.inputs["Vector"])
    nt.links.new(ck.outputs["Color"], b.inputs["Base Color"])
    finish(nt, b.outputs[0])
    return m


def mat_glow(name, color, base_strength, on_strength, body=(0.6, 0.6, 0.65)):
    """车灯类：平时是灰白灯罩，glow 属性 0→1 时点亮。"""
    m, nt = new_mat(name)
    b = principled(nt, body, metallic=0.0, rough=0.15)
    e = inp(b, "Emission Color", "Emission")
    e.default_value = (*color, 1)
    s = math_node(nt, "MULTIPLY_ADD", attr(nt, "glow"), on_strength)
    s.node.inputs[2].default_value = base_strength
    nt.links.new(s, inp(b, "Emission Strength"))
    finish(nt, b.outputs[0])
    return m


def mat_emit(name, color, strength, use_hid=True):
    m, nt = new_mat(name)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*color, 1)
    em.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if use_hid:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(attr(nt, "hid"), mix.inputs[0])
        nt.links.new(em.outputs[0], mix.inputs[1])
        nt.links.new(tr.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    else:
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def mat_ghost():
    """蓝图幽灵：只有全息，强度由 fade 控制。"""
    m, nt = new_mat("全息蓝图")
    holo = holo_shader(nt, HOLO_STRENGTH * 0.6)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(attr(nt, "fade"), mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(holo, mix.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    sset(m, "use_transparent_shadow", True)
    return m


MAT = {}


def build_materials():
    MAT["paint"] = mat_paint()
    MAT["black"] = mat_basic("黑色饰件", (0.012, 0.012, 0.013), rough=0.45)
    MAT["gloss_black"] = mat_basic("亮黑", (0.01, 0.01, 0.011), rough=0.08, coat=1.0)
    MAT["glass"] = mat_basic("深色玻璃", (0.005, 0.006, 0.008), rough=0.02, coat=1.0, alpha=0.55)
    MAT["carbon"] = mat_carbon()
    MAT["tire"] = mat_basic("轮胎", (0.022, 0.022, 0.024), rough=0.78)
    MAT["rim"] = mat_basic("轮毂", (0.11, 0.11, 0.12), metallic=1.0, rough=0.22)
    MAT["chrome"] = mat_basic("金属", (0.75, 0.75, 0.78), metallic=1.0, rough=0.12)
    MAT["disc"] = mat_basic("刹车盘", (0.35, 0.35, 0.36), metallic=0.9, rough=0.38)
    MAT["caliper"] = mat_basic("卡钳", (0.95, 0.55, 0.02), rough=0.3, coat=0.6)
    MAT["alu"] = mat_basic("铝", (0.55, 0.56, 0.58), metallic=1.0, rough=0.3)
    MAT["engine_red"] = mat_basic("发动机红", (0.5, 0.02, 0.02), rough=0.25, coat=0.5)
    MAT["seat"] = mat_basic("座椅", (0.03, 0.03, 0.032), rough=0.65)
    MAT["spring"] = mat_basic("弹簧", (0.9, 0.5, 0.02), metallic=0.3, rough=0.3)
    MAT["head"] = mat_glow("大灯", (0.85, 0.93, 1.0), 0.15, 70.0)
    MAT["tail"] = mat_glow("尾灯", (1.0, 0.02, 0.01), 0.25, 55.0, body=(0.25, 0.01, 0.01))
    MAT["arm"] = mat_basic("机械臂", (0.05, 0.052, 0.058), metallic=0.4, rough=0.35, coat=0.4)
    MAT["arm_accent"] = mat_basic("机械臂橙", (0.95, 0.32, 0.02), rough=0.35, coat=0.5)
    MAT["grip"] = mat_glow("吸盘光圈", HOLO, 0.4, 25.0, body=(0.05, 0.05, 0.05))
    MAT["ghost"] = mat_ghost()
    MAT["spark"] = mat_emit("火花", (1.0, 0.55, 0.15), 60.0, use_hid=False)
    MAT["flash"] = mat_emit("闪光", (0.75, 0.88, 1.0), 120.0, use_hid=False)
    MAT["ring"] = mat_emit("平台光环", HOLO, 6.0)
    MAT["strip"] = mat_emit("背景灯条", (0.9, 0.95, 1.0), 5.0, use_hid=False)


# ---------------------------------------------------------------------------
# 车身（放样 + 布尔开孔 + 分块）
# ---------------------------------------------------------------------------
X_FRONT, X_REAR = 2.30, -2.25
AX_F, AX_R = 1.36, -1.36
WHEEL_F = dict(r=0.345, w=0.27, y=0.855)
WHEEL_R = dict(r=0.36, w=0.33, y=0.865)
GROUND = 0.06                     # 平台高度

F_W = pchip([(-2.25, 0.90), (-1.95, 0.97), (-1.36, 1.035), (-0.8, 1.0), (0.0, 0.97), (0.8, 0.985),
             (1.36, 1.02), (1.85, 0.97), (2.30, 0.84)])
F_ZB = pchip([(-2.25, 0.30), (-2.0, 0.17), (-1.6, 0.13), (1.6, 0.13), (2.05, 0.15), (2.30, 0.21)])
F_ZBELT = pchip([(-2.25, 0.80), (-1.85, 0.86), (-1.0, 0.85), (-0.4, 0.80), (0.5, 0.72),
                 (1.0, 0.67), (1.6, 0.58), (2.05, 0.48), (2.30, 0.40)])
F_HC = pchip([(-2.25, 0.025), (-1.6, 0.035), (-1.1, 0.11), (-0.55, 0.26), (-0.1, 0.345), (0.25, 0.36),
              (0.62, 0.24), (1.05, 0.045), (1.4, 0.03), (2.30, 0.02)])
F_WC = pchip([(-2.25, 0.62), (-1.6, 0.74), (-0.8, 0.80), (0.3, 0.80), (1.0, 0.76), (1.6, 0.66), (2.30, 0.50)])


def bump(x):
    return 0.075 * math.exp(-((x - AX_F) / 0.33) ** 2) + 0.065 * math.exp(-((x - AX_R) / 0.36) ** 2)


def section_ctrl(x):
    W, zb, zbelt, hc, wc = F_W(x), F_ZB(x), F_ZBELT(x), F_HC(x), F_WC(x)
    k = clamp(hc / 0.36, 0.0, 1.0)
    wr = lerp(wc * 0.62, 0.53, k)
    bz = bump(x)
    p4z = max(zbelt + bz - 0.13, zb + 0.17)
    return [
        (0.0, zbelt + hc),
        (wr, zbelt + hc - 0.035 * k - 0.004),
        (wc, zbelt + 0.012),
        (W - 0.10, zbelt + bz * 0.9),
        (W, p4z),
        (W - 0.05, zb + 0.10),
        (W - 0.14, zb),
        (0.0, zb),
    ]


SPAN_N = [6, 8, 5, 5, 7, 4, 5]   # 每段采样数


def catmull(p0, p1, p2, p3, t):
    """centripetal Catmull-Rom"""
    def tj(ti, a, b):
        return ti + max(((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.25, 1e-4)
    t0 = 0.0
    t1 = tj(t0, p0, p1)
    t2 = tj(t1, p1, p2)
    t3 = tj(t2, p2, p3)
    t = lerp(t1, t2, t)

    def L(a, b, ta, tb):
        u = (t - ta) / (tb - ta)
        return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
    A1, A2, A3 = L(p0, p1, t0, t1), L(p1, p2, t1, t2), L(p2, p3, t2, t3)
    B1, B2 = L(A1, A2, t0, t2), L(A2, A3, t1, t3)
    return L(B1, B2, t1, t2)


def section_half(x):
    c = section_ctrl(x)
    ext = [(-c[1][0], c[1][1])] + c + [(-c[6][0], c[6][1])]
    pts = []
    for s in range(7):
        n = SPAN_N[s]
        for i in range(n):
            pts.append(catmull(ext[s], ext[s + 1], ext[s + 2], ext[s + 3], i / n))
    pts.append(c[7])
    return pts


def end_scale(x):
    ef, er = 0.26, 0.10
    if x > X_FRONT - ef:
        u = (x - (X_FRONT - ef)) / ef
        return math.sqrt(max(1 - u * u, 0.0))
    if x < X_REAR + er:
        u = ((X_REAR + er) - x) / er
        return math.sqrt(max(1 - u * u, 0.0))
    return 1.0


def stations():
    br = [X_REAR, -1.6, -0.4, 1.0, X_FRONT]
    xs = []
    for a, b in zip(br[:-1], br[1:]):
        n = max(4, int((b - a) / 0.03))
        for i in range(n):
            xs.append(a + (b - a) * i / n)
    xs.append(X_FRONT)
    # 两端加密做圆角
    out = []
    for x in xs:
        out.append(x)
    extra = []
    for k in range(1, 7):
        u = 1 - (1 - k / 7) ** 2
        extra.append(X_FRONT - 0.26 + 0.26 * u * 0.985)
        extra.append(X_REAR + 0.10 - 0.10 * u * 0.985)
    out = sorted(set([round(v, 5) for v in out + extra if X_REAR + 0.0015 <= v <= X_FRONT - 0.003]))
    return out


def build_body_mesh():
    bm = bmesh.new()
    rings = []
    xs = stations()
    for x in xs:
        half = section_half(x)
        ring = half + [(-y, z) for (y, z) in reversed(half[1:-1])]
        s = end_scale(x)
        s = max(s, 0.16)
        zc = sum(p[1] for p in ring) / len(ring)
        rings.append([bm.verts.new((x, y * s, zc + (z - zc) * s)) for (y, z) in ring])
    n = len(rings[0])
    for a, b in zip(rings[:-1], rings[1:]):
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((a[j], a[k], b[k], b[j]))
    for ring, x in ((rings[0], xs[0]), (rings[-1], xs[-1])):
        c = sum((v.co for v in ring), Vector()) / n
        cv = bm.verts.new(c)
        for j in range(n):
            bm.faces.new((ring[j], ring[(j + 1) % n], cv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def cutter(name, bm):
    ob = mesh_obj(name, bm, [MAT["black"]], "_cutters", smooth_shade=False)
    ob.hide_render = True
    ob.hide_viewport = True
    return ob


def build_body():
    body = mesh_obj("body_src", build_body_mesh(), [MAT["paint"]], "_cutters")
    # 所有切割体合成一个网格，只做一次布尔（多个布尔叠加时 Exact 求解器偶尔出错）
    bm = bmesh.new()
    for ax, rr in ((AX_F, 0.425), (AX_R, 0.44)):                      # 轮拱
        bm_cyl(bm, Vector((ax, 0, WHEEL_F["r"] if ax > 0 else WHEEL_R["r"])), rr, 3.0, "Y", 64)
    bm_box(bm, Vector((2.32, 0, 0.29)), Vector((0.36, 1.25, 0.15)))     # 前脸大进气口
    for sy in (1, -1):                                                  # 侧面进气口
        bm_sphere(bm, Vector((-0.50, sy * 1.03, 0.52)), 1.0, (0.36, 0.20, 0.15), segs=32)
    bm_box(bm, Vector((-2.3, 0, 0.2)), Vector((0.42, 1.3, 0.12)))       # 后扩散器
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cut = cutter("cutters", bm)
    m = body.modifiers.new("cut", "BOOLEAN")
    m.object = cut
    m.operation = "DIFFERENCE"
    for solver in ("MANIFOLD", "EXACT"):          # 5.x 有 Manifold，更稳；4.x 用 Exact
        if sset(m, "solver", solver):
            break
    sset(m, "material_mode", "TRANSFER")
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(me)
    # 材质槽：0 漆 1 黑 2 玻璃
    names = [m.name for m in me.materials]
    black_idx = names.index(MAT["black"].name) if MAT["black"].name in names else -1
    for f in bm.faces:
        f.material_index = 1 if (black_idx >= 0 and f.material_index == black_idx) else 0
        if f.material_index == 1:
            f.smooth = False
    # 保险：删掉布尔运算偶尔残留在车身外面的切割体碎片
    stray = [f for f in bm.faces if all(abs(v.co.y) > F_W(v.co.x) + 0.03 for v in f.verts)]
    if stray:
        print("[jixiebi] 清理布尔残片:", len(stray))
        bmesh.ops.delete(bm, geom=stray, context="FACES")
    # 沿分块线切开，保证每块边缘整齐（布尔产生的长面也会被切断）
    for co, no in (((0, 0, 0), (0, 1, 0)), ((1.0, 0, 0), (1, 0, 0)), ((-1.6, 0, 0), (1, 0, 0)),
                   ((-0.4, 0, 0), (1, 0, 0))):
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no)
    return bm


def classify(face):
    c = face.calc_center_median()
    x, y, z = c
    if x > 1.0:
        return "nose"
    if x < -1.6:
        return "tail"
    ctrl = section_ctrl(x)
    wc, zc = ctrl[2]
    if abs(y) < wc - 0.005 and z > zc - 0.03:
        return "cockpit" if x > -0.4 else "cover"
    return "side_L" if y > 0 else "side_R"


def glass_face(region, face):
    x, y, z = face.calc_center_median()
    belt = F_ZBELT(x)
    if region == "cockpit":
        if x > 0.27 and z > belt + 0.035 and x < 0.97:
            return True                                      # 前挡
        if z > belt + 0.05 and abs(y) > 0.42 and x > -0.35:
            return True                                      # 侧窗
    if region == "cover":
        if x > -1.25 and z > belt + 0.05 and abs(y) < 0.40:
            return True                                      # 后窗（能看到发动机）
    return False


def split_body(bm_all):
    parts = {}
    regions = ["nose", "tail", "cockpit", "cover", "side_L", "side_R"]
    cls = [classify(f) for f in bm_all.faces]
    for r in regions:
        bm = bm_all.copy()
        kill = [f for f, c in zip(bm.faces, cls) if c != r]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        for f in bm.faces:
            if f.material_index == 0 and glass_face(r, f):
                f.material_index = 2
        smooth_flags = [f.smooth for f in bm.faces]
        ob = mesh_obj("车身_" + r, bm, [MAT["paint"], MAT["black"], MAT["glass"]], "Car")
        for p, s in zip(ob.data.polygons, smooth_flags):
            p.use_smooth = s
        so = ob.modifiers.new("厚度", "SOLIDIFY")
        so.thickness = 0.012
        so.offset = -1.0
        sset(so, "use_even_offset", True)
        parts[r] = ob
    return parts


# ---------------------------------------------------------------------------
# 其他零件
# ---------------------------------------------------------------------------


def build_wheel(name, x, side, spec, cname="Car"):
    R, w = spec["r"], spec["w"]
    rim_r = R - 0.105
    objs = []
    # 轮胎
    prof = [(rim_r + 0.005, -w / 2 + 0.01), (R - 0.035, -w / 2), (R, -w / 2 + 0.035), (R, w / 2 - 0.035),
            (R - 0.035, w / 2), (rim_r + 0.005, w / 2 - 0.01), (rim_r - 0.01, 0.0)]
    prof = chaikin(prof, 2, True)
    bm = bmesh.new()
    bm_lathe(bm, prof, 64)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    objs.append(mesh_obj(name + "_胎", bm, [MAT["tire"]], cname))
    # 轮毂：轮辋 + 10 辐条 + 中心
    bm = bmesh.new()
    lip = [(rim_r + 0.006, w / 2 - 0.012), (rim_r - 0.012, w / 2 - 0.006), (rim_r - 0.02, -w / 2 + 0.02),
           (rim_r - 0.004, -w / 2 + 0.02)]
    bm_lathe(bm, chaikin(lip, 1, True), 64)
    face_y = w / 2 - 0.03
    for i in range(10):
        a = 2 * math.pi * i / 10
        for off in (-0.06, 0.06):
            aa = a + off * 0.5
            mid = (rim_r * 0.52)
            c = Vector((mid * math.cos(aa), face_y - 0.015, mid * math.sin(aa)))
            bm_box(bm, c, Vector((rim_r * 0.92, 0.035, 0.026)), rot=(0, -aa, 0))
    bm_cyl(bm, Vector((0, face_y - 0.01, 0)), 0.075, 0.06, "Y", 24)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rim = mesh_obj(name + "_轮毂", bm, [MAT["rim"]], cname)
    add_bevel(rim, 0.004, 2)
    objs.append(rim)
    # 中心盖
    bm = bmesh.new()
    bm_cyl(bm, Vector((0, face_y + 0.025, 0)), 0.045, 0.02, "Y", 24)
    objs.append(mesh_obj(name + "_盖", bm, [MAT["chrome"]], cname))
    # 刹车盘 + 卡钳
    bm = bmesh.new()
    bm_cyl(bm, Vector((0, -0.02, 0)), rim_r - 0.05, 0.03, "Y", 48)
    objs.append(mesh_obj(name + "_盘", bm, [MAT["disc"]], cname))
    bm = bmesh.new()
    for k in range(5):
        a = math.radians(120 + k * 9)
        bm_box(bm, Vector(((rim_r - 0.05) * math.cos(a), -0.02, (rim_r - 0.05) * math.sin(a))),
               Vector((0.06, 0.08, 0.07)), rot=(0, -a, 0))
    cal = mesh_obj(name + "_卡钳", bm, [MAT["caliper"]], cname)
    add_bevel(cal, 0.008, 2)
    objs.append(cal)
    M = Matrix.Translation((x, side * spec["y"], R + GROUND))
    if side < 0:
        M = M @ Matrix.Rotation(math.pi, 4, "Z")
    for o in objs:
        o.matrix_world = M
    return objs


def build_axle(name, x, spec):
    objs = []
    for side in (1, -1):
        objs += build_wheel(name + ("左" if side > 0 else "右"), x, side, spec)
    z = spec["r"] + GROUND
    bm = bmesh.new()
    bm_box(bm, Vector((x, 0, z + 0.02)), Vector((0.16, 1.15, 0.09)))        # 副车架横梁
    for side in (1, -1):
        y0 = side * 0.30
        y1 = side * (spec["y"] - 0.10)
        for dz, dx in ((0.11, 0.0), (-0.11, 0.0)):                            # 上下叉臂
            for sx in (-0.13, 0.13):
                a = Vector((x + sx, y0, z + dz * 0.6))
                b = Vector((x, y1, z + dz))
                c = (a + b) / 2
                d = b - a
                rot = Vector((1, 0, 0)).rotation_difference(d).to_euler()
                bm_box(bm, c, Vector((d.length, 0.03, 0.03)), rot=rot)
        bm_box(bm, Vector((x, side * (spec["y"] - 0.07), z)), Vector((0.10, 0.06, 0.26)))   # 立柱
    ob = mesh_obj(name + "_悬挂", bm, [MAT["arm"]], "Car")
    add_bevel(ob, 0.006, 1)
    objs.append(ob)
    bm = bmesh.new()
    for side in (1, -1):                                                       # 避震（黄色）
        bm_cyl(bm, Vector((x - 0.04, side * 0.52, z + 0.20)), 0.045, 0.34, "Z", 16)
    objs.append(mesh_obj(name + "_避震", bm, [MAT["spring"]], "Car"))
    return objs


def build_chassis():
    objs = []
    bm = bmesh.new()
    zf = GROUND + 0.12
    bm_box(bm, Vector((-0.05, 0, zf + 0.02)), Vector((3.9, 1.62, 0.04)))             # 底板
    for s in (1, -1):
        bm_box(bm, Vector((-0.1, s * 0.78, zf + 0.10)), Vector((2.5, 0.12, 0.16)))  # 门槛纵梁
    bm_box(bm, Vector((-0.42, 0, zf + 0.33)), Vector((0.06, 1.45, 0.62)))           # 防火墙
    bm_box(bm, Vector((1.0, 0, zf + 0.20)), Vector((0.06, 1.35, 0.36)))             # 前舱隔板
    bm_box(bm, Vector((1.62, 0, zf + 0.15)), Vector((0.7, 0.9, 0.12)))              # 前防撞结构
    ob = mesh_obj("底盘_碳纤维", bm, [MAT["carbon"]], "Car")
    add_bevel(ob, 0.01, 2)
    objs.append(ob)
    bm = bmesh.new()
    for s in (1, -1):
        bm_box(bm, Vector((-1.85, s * 0.42, zf + 0.12)), Vector((0.9, 0.07, 0.10)))  # 后副车架
    bm_box(bm, Vector((-1.85, 0, zf + 0.12)), Vector((0.07, 0.9, 0.10)))
    ob = mesh_obj("底盘_副车架", bm, [MAT["alu"]], "Car")
    add_bevel(ob, 0.008, 1)
    objs.append(ob)
    bm = bmesh.new()                                                                 # 座椅
    for s in (1, -1):
        y = s * 0.37
        bm_box(bm, Vector((0.05, y, zf + 0.13)), Vector((0.46, 0.44, 0.12)))
        bm_box(bm, Vector((-0.22, y, zf + 0.43)), Vector((0.12, 0.44, 0.62)), rot=(0, -0.32, 0))
        for b in (1, -1):
            bm_box(bm, Vector((-0.12, y + b * 0.21, zf + 0.32)), Vector((0.30, 0.06, 0.32)), rot=(0, -0.3, 0))
    ob = mesh_obj("座椅", bm, [MAT["seat"]], "Car")
    add_bevel(ob, 0.03, 3)
    objs.append(ob)
    bm = bmesh.new()                                                                  # 方向盘 + 仪表台
    r = bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=0.17, radius2=0.17, depth=0.03)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0.52, 0.37, zf + 0.52)) @ Matrix.Rotation(math.radians(-70), 4, "Y"),
                        verts=r["verts"])
    bm_box(bm, Vector((0.72, 0, zf + 0.48)), Vector((0.22, 1.40, 0.14)))
    ob = mesh_obj("仪表台", bm, [MAT["black"]], "Car")
    so = ob.modifiers.new("t", "SOLIDIFY")
    so.thickness = 0.03
    objs.append(ob)
    return objs


def build_engine():
    objs = []
    x0, z0 = -0.95, GROUND + 0.22
    bm = bmesh.new()
    bm_box(bm, Vector((x0, 0, z0 + 0.14)), Vector((0.85, 0.38, 0.26)))
    for s in (1, -1):
        bm_box(bm, Vector((x0, s * 0.20, z0 + 0.33)), Vector((0.82, 0.18, 0.16)), rot=(s * 0.55, 0, 0))
    ob = mesh_obj("发动机_缸体", bm, [MAT["alu"]], "Car")
    add_bevel(ob, 0.015, 2)
    objs.append(ob)
    bm = bmesh.new()
    for s in (1, -1):
        bm_box(bm, Vector((x0, s * 0.28, z0 + 0.43)), Vector((0.80, 0.10, 0.06)), rot=(s * 0.55, 0, 0))
    bm_box(bm, Vector((x0, 0, z0 + 0.48)), Vector((0.70, 0.22, 0.10)))
    ob = mesh_obj("发动机_缸盖", bm, [MAT["engine_red"]], "Car")
    add_bevel(ob, 0.02, 2)
    objs.append(ob)
    bm = bmesh.new()
    for i in range(4):
        for s in (1, -1):
            bm_cyl(bm, Vector((x0 - 0.27 + i * 0.18, s * 0.075, z0 + 0.58)), 0.03, 0.10, "Z", 16)
    for s in (1, -1):                                                                  # 排气管
        for k in (0.08, 0.2):
            bm_cyl(bm, Vector((x0 - 0.75, s * k, z0 + 0.05)), 0.035, 0.7, "X", 16)
    objs.append(mesh_obj("发动机_进气排气", bm, [MAT["chrome"]], "Car"))
    bm = bmesh.new()                                                                    # 变速箱
    bm_box(bm, Vector((x0 - 0.62, 0, z0 + 0.10)), Vector((0.42, 0.30, 0.22)))
    ob = mesh_obj("变速箱", bm, [MAT["arm"]], "Car")
    add_bevel(ob, 0.02, 2)
    objs.append(ob)
    return objs


def raycaster(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.transform(ob.matrix_world)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def curve_obj(name, pts, radius, mat, cname="Car", squash=1.0):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, v in zip(sp.points, pts):
        p.co = (*v, 1.0)
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    init_props(ob)
    return link(ob, cname)


def surface_strip(tree, path_xy, lift=0.006, down=True, z_probe=3.0):
    pts = []
    for x, y in path_xy:
        hit = tree.ray_cast(Vector((x, y, z_probe)), Vector((0, 0, -1)))
        if hit[0] is None:
            continue
        pts.append(hit[0] + hit[1] * lift)
    return pts


def build_lights(nose):
    tree = raycaster(nose)
    objs = []
    for s in (1, -1):
        path = [(lerp(2.10, 1.80, u), s * lerp(0.40, 0.88, u ** 0.8)) for u in [i / 24 for i in range(25)]]
        pts = surface_strip(tree, path, 0.008)
        objs.append(curve_obj("大灯_主" + ("左" if s > 0 else "右"), pts, 0.016, MAT["head"]))
        path = [(lerp(2.03, 1.86, u), s * lerp(0.42, 0.74, u)) for u in [i / 16 for i in range(17)]]
        pts = surface_strip(tree, [(px - 0.08, py) for px, py in path], 0.008)
        objs.append(curve_obj("大灯_日行" + ("左" if s > 0 else "右"), pts, 0.008, MAT["head"]))
    return objs, tree


def build_tail_extras(tail):
    objs = []
    tree = raycaster(tail)
    zt = F_ZBELT(-2.2) - 0.07
    pts = []
    for i in range(41):
        y = lerp(-0.86, 0.86, i / 40)
        hit = tree.ray_cast(Vector((-4.0, y, zt + GROUND)), Vector((1, 0, 0)))
        if hit[0] is not None:
            pts.append(hit[0] + hit[1] * 0.01)
    objs.append(curve_obj("通体尾灯", pts, 0.022, MAT["tail"]))
    bm = bmesh.new()
    for i in range(7):                                              # 扩散器鳍片
        y = lerp(-0.6, 0.6, i / 6)
        bm_box(bm, Vector((-2.08, y, GROUND + 0.20)), Vector((0.42, 0.012, 0.13)), rot=(0, 0.25, 0))
    bm_box(bm, Vector((-2.05, 0, GROUND + 0.13)), Vector((0.5, 1.30, 0.012)), rot=(0, 0.2, 0))
    objs.append(mesh_obj("扩散器", bm, [MAT["carbon"]], "Car"))
    bm = bmesh.new()
    for s in (1, -1):                                               # 排气尾嘴
        bm_cyl(bm, Vector((-2.2, s * 0.15, GROUND + 0.30)), 0.048, 0.18, "X", 24)
    ob = mesh_obj("排气尾嘴", bm, [MAT["chrome"]], "Car")
    so = ob.modifiers.new("t", "SOLIDIFY")
    so.thickness = 0.006
    objs.append(ob)
    return objs


def build_nose_extras():
    bm = bmesh.new()
    bm_box(bm, Vector((2.08, 0, GROUND + 0.155)), Vector((0.45, 1.75, 0.018)))                # 前铲
    for s in (1, -1):
        bm_box(bm, Vector((2.05, s * 0.86, GROUND + 0.20)), Vector((0.32, 0.012, 0.09)))
    ob = mesh_obj("前铲", bm, [MAT["carbon"]], "Car")
    add_bevel(ob, 0.004, 1)
    bm = bmesh.new()                                                                           # 进气格栅
    for i in range(9):
        bm_box(bm, Vector((2.12, lerp(-0.55, 0.55, i / 8), GROUND + 0.29)), Vector((0.02, 0.012, 0.13)))
    g = mesh_obj("进气格栅", bm, [MAT["gloss_black"]], "Car")
    return [ob, g]


def build_side_extras(side):
    s = 1 if side == "L" else -1
    bm = bmesh.new()
    bm_box(bm, Vector((-0.25, s * 1.0, GROUND + 0.17)), Vector((2.0, 0.05, 0.035)))           # 侧裙
    ob = mesh_obj("侧裙_" + side, bm, [MAT["carbon"]], "Car")
    add_bevel(ob, 0.008, 1)
    bm = bmesh.new()                                                                            # 后视镜
    bm_sphere(bm, Vector((0.78, s * 1.06, GROUND + 0.86)), 1.0, (0.09, 0.07, 0.045))
    bm_box(bm, Vector((0.80, s * 0.96, GROUND + 0.83)), Vector((0.05, 0.12, 0.018)))
    m = mesh_obj("后视镜_" + side, bm, [MAT["carbon"]], "Car")
    return [ob, m]


def build_cover_extras(cover):
    tree = raycaster(cover)
    bm = bmesh.new()
    for i in range(6):                                                                          # 发动机盖百叶
        x = lerp(-1.30, -1.55, i / 5)
        for s in (1, -1):
            hit = tree.ray_cast(Vector((x, s * 0.56, 3.0)), Vector((0, 0, -1)))
            if hit[0] is None:
                continue
            n = hit[1]
            rot = Vector((0, 0, 1)).rotation_difference(n).to_euler()
            bm_box(bm, hit[0] + n * 0.006, Vector((0.025, 0.26, 0.012)), rot=rot)
    return [mesh_obj("百叶", bm, [MAT["gloss_black"]], "Car")]


def build_wing():
    objs = []
    xc, zc = -1.98, GROUND + 1.24
    prof = [(0.17, 0.0), (0.10, 0.022), (-0.02, 0.026), (-0.15, 0.010), (-0.16, -0.004), (-0.02, -0.012), (0.12, -0.008)]
    prof = chaikin(prof, 2, True)
    bm = bmesh.new()
    rings = []
    span = 0.92
    for y in (-span, span):
        rings.append([bm.verts.new((xc + px * math.cos(0.14) + pz * math.sin(0.14), y, zc - px * math.sin(0.14) + pz * math.cos(0.14)))
                      for px, pz in prof])
    n = len(prof)
    for j in range(n):
        k = (j + 1) % n
        bm.faces.new((rings[0][j], rings[0][k], rings[1][k], rings[1][j]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for s in (1, -1):                                                         # 端板
        bm_box(bm, Vector((xc - 0.02, s * (span + 0.01), zc - 0.03)), Vector((0.42, 0.012, 0.22)))
    ob = mesh_obj("尾翼", bm, [MAT["carbon"]], "Car")
    add_bevel(ob, 0.004, 1)
    objs.append(ob)
    bm = bmesh.new()
    for s in (1, -1):                                                         # 鹅颈支架
        base_z = F_ZBELT(-1.8) + F_HC(-1.8) + GROUND
        a = Vector((-1.80, s * 0.42, base_z - 0.02))
        b = Vector((-1.96, s * 0.42, zc + 0.03))
        c = (a + b) / 2
        d = b - a
        rot = Vector((0, 0, 1)).rotation_difference(d).to_euler()
        bm_box(bm, c, Vector((0.12, 0.016, d.length)), rot=rot)
    ob = mesh_obj("尾翼支架", bm, [MAT["arm"]], "Car")
    add_bevel(ob, 0.004, 1)
    objs.append(ob)
    return objs


# ---------------------------------------------------------------------------
# 模块 / 时间轴
# ---------------------------------------------------------------------------
#               名称          落位帧  机械臂
MODULES = [("底盘",          150, "A"),
           ("前轮",          200, "B"),
           ("后轮",          268, "A"),
           ("发动机",        318, "B"),
           ("车头",          362, "A"),
           ("右侧车身",      405, "B"),
           ("左侧车身",      448, "A"),
           ("座舱",          490, "B"),
           ("发动机盖",      530, "A"),
           ("车尾",          572, "B"),
           ("尾翼",          612, "A"),
           ("车灯",          655, "B")]

LIGHTS_ON = 668
TITLE_IN = 688

SHOTS = [(1, 105), (106, 239), (240, 330), (331, 470), (471, 622), (623, FRAMES)]

ARM_BASE = {"A": Vector((-0.9, 3.45, 0.0)), "B": Vector((0.9, -3.45, 0.0))}
PAD = {"A": Vector((-0.9, 6.1, 0.0)), "B": Vector((0.9, -6.1, 0.0))}
H_SH, L1, L2, LW = 1.45, 2.75, 2.55, 0.80


def build_car():
    bm_all = build_body()
    body = split_body(bm_all)
    bm_all.free()
    mods = {name: [] for name, _, _ in MODULES}
    mods["底盘"] += build_chassis()
    mods["前轮"] += build_axle("前轮", AX_F, WHEEL_F)
    mods["后轮"] += build_axle("后轮", AX_R, WHEEL_R)
    mods["发动机"] += build_engine()
    for ob in body.values():                    # 车身以地面为 0 建模，抬到平台上
        ob.location.z += GROUND
    bpy.context.view_layer.update()
    mods["车头"] += [body["nose"]] + build_nose_extras()
    mods["右侧车身"] += [body["side_R"]] + build_side_extras("R")
    mods["左侧车身"] += [body["side_L"]] + build_side_extras("L")
    mods["座舱"] += [body["cockpit"]]
    mods["发动机盖"] += [body["cover"]] + build_cover_extras(body["cover"])
    mods["车尾"] += [body["tail"]] + build_tail_extras(body["tail"])
    mods["尾翼"] += build_wing()
    lights, _ = build_lights(body["nose"])
    mods["车灯"] += lights
    return mods


def world_bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type == "MESH":
            pts = [o.matrix_world @ v.co for v in o.data.vertices]
        else:
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        for p in pts:
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


# ---------------------------------------------------------------------------
# 机械臂
# ---------------------------------------------------------------------------


def build_arm(key):
    B = ARM_BASE[key]
    parts = {}
    bm = bmesh.new()
    bm_cyl(bm, Vector((B.x, B.y, 0.12)), 0.75, 0.24, segs=48)
    bm_cyl(bm, Vector((B.x, B.y, 0.32)), 0.55, 0.18, segs=48)
    base = mesh_obj("臂%s_底座" % key, bm, [MAT["arm"]], "Arms")
    add_bevel(base, 0.02, 2)
    bm = bmesh.new()
    bm_cyl(bm, Vector((B.x, B.y, 0.06)), 0.82, 0.02, segs=64)
    link_ring = mesh_obj("臂%s_光圈" % key, bm, [MAT["ring"]], "Arms")
    link_ring.location.z = 0.0

    turret = bpy.data.objects.new("臂%s_转台" % key, None)
    link(turret, "Arms")
    turret.location = (B.x, B.y, 0.41)
    bm = bmesh.new()
    bm_cyl(bm, Vector((0, 0, 0.12)), 0.48, 0.24, segs=48)
    bm_box(bm, Vector((0, 0, 0.62)), Vector((0.52, 0.62, 0.95)))
    bm_cyl(bm, Vector((0, 0, H_SH - 0.41)), 0.33, 0.78, "Y", 40)
    t_mesh = mesh_obj("臂%s_转台壳" % key, bm, [MAT["arm_accent"]], "Arms")
    add_bevel(t_mesh, 0.04, 3)
    t_mesh.parent = turret

    upper = bpy.data.objects.new("臂%s_大臂" % key, None)
    link(upper, "Arms")
    upper.parent = turret
    upper.location = (0, 0, H_SH - 0.41)
    bm = bmesh.new()
    bm_box(bm, Vector((L1 / 2, 0, 0)), Vector((L1 - 0.2, 0.36, 0.42)))
    bm_cyl(bm, Vector((L1, 0, 0)), 0.26, 0.56, "Y", 40)
    u_mesh = mesh_obj("臂%s_大臂壳" % key, bm, [MAT["arm"]], "Arms")
    add_bevel(u_mesh, 0.05, 3)
    u_mesh.parent = upper
    bm = bmesh.new()
    bm_box(bm, Vector((L1 * 0.5, 0, 0.215)), Vector((L1 * 0.7, 0.2, 0.02)))
    u_acc = mesh_obj("臂%s_大臂饰条" % key, bm, [MAT["arm_accent"]], "Arms")
    u_acc.parent = upper

    fore = bpy.data.objects.new("臂%s_小臂" % key, None)
    link(fore, "Arms")
    fore.parent = upper
    fore.location = (L1, 0, 0)
    bm = bmesh.new()
    bm_box(bm, Vector((L2 / 2, 0, 0)), Vector((L2 - 0.15, 0.26, 0.28)))
    bm_cyl(bm, Vector((L2, 0, 0)), 0.17, 0.36, "Y", 32)
    f_mesh = mesh_obj("臂%s_小臂壳" % key, bm, [MAT["arm_accent"]], "Arms")
    add_bevel(f_mesh, 0.04, 3)
    f_mesh.parent = fore

    wrist = bpy.data.objects.new("臂%s_手腕" % key, None)
    link(wrist, "Arms")
    wrist.parent = fore
    wrist.location = (L2, 0, 0)
    bm = bmesh.new()
    bm_cyl(bm, Vector((0, 0, -LW * 0.45)), 0.10, LW * 0.8, "Z", 24)
    bm_cyl(bm, Vector((0, 0, -LW + 0.04)), 0.26, 0.05, "Z", 40)
    w_mesh = mesh_obj("臂%s_吸盘" % key, bm, [MAT["arm"]], "Arms")
    add_bevel(w_mesh, 0.01, 2)
    w_mesh.parent = wrist
    bm = bmesh.new()
    r = bmesh.ops.create_cone(bm, cap_ends=False, segments=40, radius1=0.27, radius2=0.27, depth=0.018)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0, -LW + 0.04)), verts=r["verts"])
    g_mesh = mesh_obj("臂%s_吸盘光圈" % key, bm, [MAT["grip"]], "Arms")
    g_mesh.parent = wrist
    return dict(turret=turret, upper=upper, fore=fore, wrist=wrist, grip=g_mesh)


def arm_ik(key, tip):
    B = ARM_BASE[key]
    W = Vector((tip.x, tip.y, tip.z + LW))
    S = Vector((B.x, B.y, H_SH))
    dx, dy = W.x - S.x, W.y - S.y
    yaw = math.atan2(dy, dx)
    r = math.hypot(dx, dy)
    z = W.z - S.z
    d = clamp(math.hypot(r, z), abs(L1 - L2) + 0.05, L1 + L2 - 0.002)
    a1 = math.atan2(z, r) + math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1))
    ex, ez = L1 * math.cos(a1), L1 * math.sin(a1)
    a2 = math.atan2(z - ez, r - ex)
    return yaw, a1, a2


def cyl(key, p):
    B = ARM_BASE[key]
    return math.hypot(p.x - B.x, p.y - B.y), math.atan2(p.y - B.y, p.x - B.x), p.z


def ang_delta(a0, a1, prefer_x=None, key=None):
    d = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    if prefer_x is not None and abs(d) > math.radians(100):
        mid = a0 + d / 2
        if (math.cos(mid) > 0) != (prefer_x > 0):
            d = d - math.copysign(2 * math.pi, d)
    return d


def cyl_path(key, p0, p1, u, prefer_x=None, arc=0.0):
    r0, a0, z0 = cyl(key, p0)
    r1, a1, z1 = cyl(key, p1)
    d = ang_delta(a0, a1, prefer_x)
    e = ease(u)
    r, a, z = lerp(r0, r1, e), a0 + d * e, lerp(z0, z1, e) + arc * math.sin(math.pi * e)
    B = ARM_BASE[key]
    return Vector((B.x + r * math.cos(a), B.y + r * math.sin(a), z)), d * (1 - e)


def rest_tip(key):
    B = ARM_BASE[key]
    s = 1 if key == "A" else -1
    return Vector((B.x, B.y - s * 1.3, 2.9))


class Job:
    pass


def plan_jobs(mods, roots):
    jobs = []
    for name, T, arm in MODULES:
        j = Job()
        j.name, j.T, j.arm = name, T, arm
        j.root = roots[name]
        j.grip = INFO[name]["grip"].copy()
        j.lo, j.hi = INFO[name]["lo"], INFO[name]["hi"]
        j.minz = j.lo.z
        pad = PAD[arm]
        lift = j.grip.z - j.minz
        j.pick = Vector((pad.x, pad.y, 0.75 + lift))
        j.high = max(2.55, j.grip.z + 1.25)
        j.prefer_x = j.grip.x if abs(j.grip.x) > 0.3 else (-1.0 if arm == "A" else 1.0)
        if name in ("前轮",):
            j.prefer_x = 1.0
        jobs.append(j)
    return jobs


def job_state(j, f):
    """返回 (吸盘位置, 模块位置或 None, 模块 dyaw, 吸盘发光)。"""
    T, key = j.T, j.arm
    rest = rest_tip(key)
    pick_hi = Vector((j.pick.x, j.pick.y, j.high))
    final_hi = Vector((j.grip.x, j.grip.y, j.high))
    # 整段搬运的总转角（从料台到最终位置）
    d_total = ang_delta(cyl(key, pick_hi)[1], cyl(key, final_hi)[1], j.prefer_x)
    t = f - T
    mod_pos, dyaw, glow = None, -d_total, 0.0
    if t < -55:
        tip = rest
    elif t < -40:
        tip, _ = cyl_path(key, rest, j.pick, (t + 55) / 15, None, arc=0.5)
    elif t < -36:
        tip = j.pick.copy()
        glow = (t + 40) / 4
    elif t < -26:
        tip = vlerp(j.pick, pick_hi, ease((t + 36) / 10))
        glow = 1
    elif t < -10:
        tip, rem = cyl_path(key, pick_hi, final_hi, (t + 26) / 16, j.prefer_x)
        dyaw = -rem
        glow = 1
    elif t <= 0:
        tip = vlerp(final_hi, j.grip, ease((t + 10) / 10))
        dyaw = 0.0
        glow = 1
    elif t <= 10:
        tip = j.grip.copy()
        dyaw, glow = 0.0, 1
    elif t <= 12:
        tip = j.grip.copy()
        dyaw, glow = 0.0, 1 - (t - 10) / 2
    elif t <= 27:
        u = (t - 12) / 15
        up = vlerp(j.grip, Vector((j.grip.x, j.grip.y, j.high)), ease(min(u * 2.5, 1)))
        tip, _ = cyl_path(key, up, rest, max(0, u * 1.25 - 0.25), None)
        dyaw = 0.0
    else:
        tip = rest
    if -36 <= t <= 0:
        mod_pos = tip.copy()
    return tip, mod_pos, dyaw, glow


def animate_arms(arms, jobs):
    for key, arm in arms.items():
        my = sorted([j for j in jobs if j.arm == key], key=lambda j: j.T)
        prev_yaw = None
        for f in range(0, FRAMES + 2):
            j = None
            for cand in my:
                if cand.T - 56 <= f <= cand.T + 28:
                    j = cand
                    break
            if j is None:
                tip, glow = rest_tip(key), 0.0
                # 第一项任务前和任务之间：轻微待机摆动
                tip = tip + Vector((0.06 * math.sin(f * 0.05 + (0 if key == "A" else 2)), 0, 0.04 * math.sin(f * 0.07)))
            else:
                tip, _, _, glow = job_state(j, f)
            yaw, a1, a2 = arm_ik(key, tip)
            if prev_yaw is not None:
                while yaw - prev_yaw > math.pi:
                    yaw -= 2 * math.pi
                while yaw - prev_yaw < -math.pi:
                    yaw += 2 * math.pi
            prev_yaw = yaw
            arm["turret"].rotation_euler = (0, 0, yaw)
            arm["turret"].keyframe_insert("rotation_euler", frame=f)
            arm["upper"].rotation_euler = (0, -a1, 0)
            arm["upper"].keyframe_insert("rotation_euler", frame=f)
            arm["fore"].rotation_euler = (0, -(a2 - a1), 0)
            arm["fore"].keyframe_insert("rotation_euler", frame=f)
            arm["wrist"].rotation_euler = (0, a2, 0)
            arm["wrist"].keyframe_insert("rotation_euler", frame=f)
            if f % 2 == 0 or glow not in (0.0, 1.0):
                key_prop(arm["grip"], "glow", f, glow)


# ---------------------------------------------------------------------------
# 模块动画：全息出现 → 搬运 → 落位 → 焊接 → 实体化
# ---------------------------------------------------------------------------


INFO = {}


def make_roots(mods):
    roots = {}
    for name, objs in mods.items():
        lo, hi = world_bbox(objs)
        c = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2))
        best, grip = -1e9, Vector((c.x, c.y, hi.z))
        for o in objs:                      # 吸盘落在零件表面：偏高、偏中心的顶点
            if o.type != "MESH":
                continue
            for v in o.data.vertices:
                p = o.matrix_world @ v.co
                score = p.z - 0.8 * (p.xy - c).length
                if score > best:
                    best, grip = score, p.copy()
        grip.z += 0.01
        root = bpy.data.objects.new("模块_" + name, None)
        link(root, "Car")
        root.location = grip
        root.empty_display_size = 0.2
        bpy.context.view_layer.update()
        inv = root.matrix_world.inverted()
        for o in objs:
            mw = o.matrix_world.copy()
            o.parent = root
            o.matrix_parent_inverse = inv
            o.matrix_world = mw
        INFO[name] = dict(grip=grip, lo=lo, hi=hi)
        roots[name] = root
    return roots


def animate_modules(mods, roots, jobs):
    for j in jobs:
        root = roots[j.name]
        objs = mods[j.name]
        T = j.T
        appear = T - 58
        for f in range(appear - 1, T + 2):
            _, mp, dyaw, _ = job_state(j, f)
            if mp is None:
                if f < T - 36:
                    bob = 0.05 * math.sin((f - appear) * 0.2) * clamp((T - 40 - f) / 8, 0, 1)
                    mp = j.pick.copy() + Vector((0, 0, bob))
                else:
                    mp = j.grip.copy()
                    dyaw = 0.0
            root.location = mp
            root.rotation_euler = (0, 0, dyaw)
            root.keyframe_insert("location", frame=f)
            root.keyframe_insert("rotation_euler", frame=f)
        for o in objs:
            o.hide_render = True
            o.hide_viewport = True
            o.keyframe_insert("hide_render", frame=1)
            o.keyframe_insert("hide_viewport", frame=1)
            o.hide_render = False
            o.hide_viewport = False
            o.keyframe_insert("hide_render", frame=appear)
            o.keyframe_insert("hide_viewport", frame=appear)
            key_prop(o, "hid", appear, 1.0)
            key_prop(o, "hid", appear + 10, 0.0)
            key_prop(o, "holo", appear, 1.0)
            key_prop(o, "holo", T, 1.0)
            key_prop(o, "holo", T + 2, 0.55)
            key_prop(o, "holo", T + 9, 0.0)


def build_ghosts(mods, roots, jobs):
    """全息蓝图：整车的幽灵副本，开场扫描出现，各模块落位时消失。"""
    order = {j.name: i for i, j in enumerate(jobs)}
    ghosts = []
    for j in jobs:
        for o in mods[j.name]:
            if o.type not in ("MESH", "CURVE"):
                continue
            g = o.copy()
            g.animation_data_clear()
            g.parent = None
            g.matrix_world = o.matrix_world.copy()
            g.modifiers.clear() if hasattr(g.modifiers, "clear") else None
            g.name = "蓝图_" + o.name
            link(g, "Blueprint")
            for s in g.material_slots:
                s.link = "OBJECT"
                s.material = MAT["ghost"]
            init_props(g)
            g.visible_shadow = False
            i = order[j.name]
            t0 = 8 + i * 4
            key_prop(g, "fade", 1, 0.0)
            key_prop(g, "fade", t0, 0.0)
            key_prop(g, "fade", t0 + 14, 1.0)
            key_prop(g, "fade", 112, 1.0)
            key_prop(g, "fade", 140, 0.45)
            key_prop(g, "fade", j.T - 2, 0.45)
            key_prop(g, "fade", j.T + 2, 0.0)
            ghosts.append(g)
    # 底盘幽灵的父子关系要在复制后用世界矩阵（模块根此时都在最终位置）
    return ghosts


def build_welds(jobs):
    rnd = random.Random(7)
    bm = bmesh.new()
    bm_cyl(bm, Vector((0.0, 0, 0)), 0.004, 0.07, "X", 6)
    spark = mesh_obj("火花", bm, [MAT["spark"]], "FX")
    spark.location = (0, 0, -30)
    bm = bmesh.new()
    bm_sphere(bm, Vector(), 1.0, segs=16)
    flash_src = mesh_obj("闪光源", bm, [MAT["flash"]], "FX")
    flash_src.location = (0, 0, -32)
    for idx, j in enumerate(jobs):
        lo, hi = j.lo, j.hi
        side = 1 if j.arm == "A" else -1
        pts = [j.grip + Vector((0, 0, -0.03)),
               Vector(((lo.x + hi.x) / 2 + 0.2, hi.y if side > 0 else lo.y, lo.z + 0.6 * (hi.z - lo.z)))]
        for k, p in enumerate(pts):
            bm = bmesh.new()
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.04)
            em = mesh_obj("焊点_%02d_%d" % (idx + 1, k), bm, [MAT["spark"]], "FX")
            em.location = p
            em.show_instancer_for_render = False
            em.show_instancer_for_viewport = False
            em.modifiers.new("sparks", "PARTICLE_SYSTEM")
            ps = em.particle_systems[0]
            ps.seed = idx * 3 + k
            st = ps.settings
            st.count = 150
            st.frame_end = j.T + 9
            st.frame_start = j.T
            st.lifetime = 14
            st.lifetime_random = 0.6
            st.emit_from = "FACE"
            st.normal_factor = 2.4
            st.factor_random = 2.6
            st.render_type = "OBJECT"
            st.instance_object = spark
            st.particle_size = 1.0
            st.size_random = 0.7
            st.use_rotations = True
            st.rotation_mode = "VEL"
            st.effector_weights.gravity = 1.0
            ps.point_cache.frame_start = 1
            ps.point_cache.frame_end = FRAMES + 1
            if k == 0:
                fl = flash_src.copy()
                fl.name = "闪光_%02d" % (idx + 1)
                link(fl, "FX")
                fl.location = p
                for f, s in ((j.T - 1, 0.0), (j.T, 0.16), (j.T + 2, 0.10), (j.T + 5, 0.05), (j.T + 9, 0.0)):
                    fl.scale = (s, s, s)
                    fl.keyframe_insert("scale", frame=f)
                ld = bpy.data.lights.new("焊接光_%02d" % (idx + 1), "POINT")
                ld.color = (0.75, 0.85, 1.0)
                ld.shadow_soft_size = 0.05
                lo_ = bpy.data.objects.new(ld.name, ld)
                link(lo_, "FX")
                lo_.location = p + Vector((0, 0, 0.12))
                ld.energy = 0.0
                ld.keyframe_insert("energy", frame=j.T - 1)
                for f in range(j.T, j.T + 11):
                    ld.energy = (1800 if f == j.T else rnd.uniform(250, 1100)) * LIGHT_SCALE * (1 - (f - j.T) / 12)
                    ld.keyframe_insert("energy", frame=f)
                ld.energy = 0.0
                ld.keyframe_insert("energy", frame=j.T + 12)


# ---------------------------------------------------------------------------
# 场景：地面、平台、灯光、空气雾
# ---------------------------------------------------------------------------


def build_stage():
    m, nt = new_mat("地面")
    b = principled(nt, (0.012, 0.013, 0.016), metallic=0.3, rough=0.22)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])

    def gl(sock):
        v = math_node(nt, "MULTIPLY", sock, 1.0)
        v = math_node(nt, "FRACT", v)
        v = math_node(nt, "SUBTRACT", v, 0.5)
        v = math_node(nt, "ABSOLUTE", v)
        return math_node(nt, "GREATER_THAN", v, 0.493)
    g = math_node(nt, "MAXIMUM", gl(sep.outputs["X"]), gl(sep.outputs["Y"]))
    dist = nt.nodes.new("ShaderNodeVectorMath")
    dist.operation = "LENGTH"
    nt.links.new(geo.outputs["Position"], dist.inputs[0])
    fall = math_node(nt, "DIVIDE", dist.outputs["Value"], 14.0)
    fall = math_node(nt, "SUBTRACT", 1.0, fall)
    fall = math_node(nt, "MAXIMUM", fall, 0.0)
    g = math_node(nt, "MULTIPLY", g, fall)
    g = math_node(nt, "MULTIPLY", g, 0.9)
    e = inp(b, "Emission Color", "Emission")
    e.default_value = (*HOLO, 1)
    nt.links.new(g, inp(b, "Emission Strength"))
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=60)
    mesh_obj("地面", bm, [m], "Stage", smooth_shade=False)

    plat = mat_basic("平台", (0.03, 0.032, 0.036), metallic=0.8, rough=0.28)
    bm = bmesh.new()
    bm_cyl(bm, Vector((0, 0, GROUND / 2)), 3.4, GROUND, segs=128)
    ob = mesh_obj("平台", bm, [plat], "Stage")
    add_bevel(ob, 0.01, 2)
    for r, w in ((3.42, 0.035), (2.7, 0.012), (1.2, 0.01)):
        cu = curve_obj("光环", [(r * math.cos(a), r * math.sin(a), GROUND + 0.004)
                                for a in [2 * math.pi * i / 128 for i in range(129)]], w, MAT["ring"], "Stage")
        cu.data.bevel_resolution = 1
    for key, p in PAD.items():                                 # 料台
        bm = bmesh.new()
        bm_cyl(bm, Vector((p.x, p.y, 0.03)), 1.2, 0.06, segs=64)
        ob = mesh_obj("料台_" + key, bm, [plat], "Stage")
        add_bevel(ob, 0.01, 2)
        curve_obj("料台光环_" + key, [(p.x + 1.18 * math.cos(a), p.y + 1.18 * math.sin(a), 0.065)
                                    for a in [2 * math.pi * i / 96 for i in range(97)]], 0.02, MAT["ring"], "Stage")
    # 远处的竖向灯条（给车漆提供反射）
    for i in range(18):
        a = 2 * math.pi * (i + 0.5) / 18
        bm = bmesh.new()
        bm_box(bm, Vector((16 * math.cos(a), 16 * math.sin(a), 3.5)), Vector((0.25, 0.25, 7.0)))
        mesh_obj("灯条", bm, [MAT["strip"]], "Stage")

    # 世界
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.004, 0.006, 0.010, 1)
    bg.inputs[1].default_value = 1.0

    # 空气雾：让顶灯出现光束
    if VOLUME_DENSITY > 0:
        vm = bpy.data.materials.new("空气雾")
        vm.use_nodes = True
        nt = vm.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        pv = nt.nodes.new("ShaderNodeVolumePrincipled")
        pv.inputs["Density"].default_value = VOLUME_DENSITY
        pv.inputs["Anisotropy"].default_value = 0.35
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(pv.outputs[0], out.inputs["Volume"])
        bm = bmesh.new()
        bm_box(bm, Vector((0, 0, 6.0)), Vector((34, 34, 12.0)))
        mesh_obj("空气雾", bm, [vm], "Stage", smooth_shade=False)

    L = {}

    def light(name, kind, loc, energy, color=(1, 1, 1), size=1.0, rot=None, target=None, spot=None, size_y=None):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy * LIGHT_SCALE
        ld.color = color
        if kind == "AREA":
            ld.shape = "RECTANGLE"
            ld.size = size
            ld.size_y = size_y or size
        elif kind == "SPOT":
            ld.spot_size = math.radians(spot or 40)
            ld.spot_blend = 0.35
            ld.shadow_soft_size = 0.15
        else:
            ld.shadow_soft_size = size
        ob = bpy.data.objects.new(name, ld)
        link(ob, "Lights")
        ob.location = loc
        if target is not None:
            d = Vector(target) - Vector(loc)
            ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        elif rot is not None:
            ob.rotation_euler = rot
        L[name] = ob
        return ob

    light("顶灯_中", "SPOT", (0.0, 0.0, 9.5), 4500, (1.0, 0.97, 0.92), target=(0, 0, 0), spot=34)
    light("顶灯_前", "SPOT", (2.6, 0.6, 9.0), 2400, (0.85, 0.92, 1.0), target=(1.2, 0, 0), spot=30)
    light("顶灯_后", "SPOT", (-2.6, -0.6, 9.0), 2400, (0.85, 0.92, 1.0), target=(-1.2, 0, 0), spot=30)
    light("柔光箱", "AREA", (0, 0, 5.5), 900, (1, 1, 1), size=5.0, size_y=1.6, rot=(0, 0, 0))
    light("轮廓光_左", "AREA", (-1.0, 6.5, 2.4), 700, (0.55, 0.8, 1.0), size=7.0, size_y=0.4, target=(0, 0, 0.6))
    light("轮廓光_右", "AREA", (1.0, -6.5, 2.4), 700, (0.55, 0.8, 1.0), size=7.0, size_y=0.4, target=(0, 0, 0.6))
    light("背光", "AREA", (-7.0, 0, 3.0), 600, (1.0, 0.6, 0.35), size=4.0, size_y=1.0, target=(0, 0, 0.5))
    light("补光", "AREA", (6.0, 2.0, 2.0), 250, (0.9, 0.95, 1.0), size=3.0, target=(0, 0, 0.5))
    for key, p in PAD.items():
        light("料台灯_" + key, "POINT", (p.x, p.y, 1.6), 0, HOLO, size=0.6)
    return L


def animate_lights(L, jobs):
    # 料台全息投射光：零件出现时亮
    for key in ("A", "B"):
        lt = L["料台灯_" + key]
        lt.data.energy = 0.0
        lt.data.keyframe_insert("energy", frame=1)
        for j in jobs:
            if j.arm != key:
                continue
            a = j.T - 58
            for f, e in ((a - 1, 0), (a + 6, 600), (j.T - 36, 300), (j.T - 26, 0)):
                lt.data.energy = e * LIGHT_SCALE
                lt.data.keyframe_insert("energy", frame=f)
    # 英雄镜头：顶灯压暗，车灯点亮
    for name in ("顶灯_中", "顶灯_前", "顶灯_后", "柔光箱"):
        d = L[name].data
        e0 = d.energy
        d.keyframe_insert("energy", frame=LIGHTS_ON - 10)
        d.energy = e0 * 0.55
        d.keyframe_insert("energy", frame=LIGHTS_ON)
        d.energy = e0 * 0.75
        d.keyframe_insert("energy", frame=LIGHTS_ON + 12)


def light_up(mods):
    seq = [(LIGHTS_ON - 1, 0.0), (LIGHTS_ON, 1.0), (LIGHTS_ON + 2, 0.15), (LIGHTS_ON + 4, 1.0),
           (LIGHTS_ON + 5, 0.4), (LIGHTS_ON + 8, 1.0)]
    for name in ("车灯", "车尾"):
        for o in mods[name]:
            if o.type == "CURVE":
                for f, v in seq:
                    key_prop(o, "glow", f, v)
    # 真实大灯光源
    for s in (1, -1):
        ld = bpy.data.lights.new("大灯光束", "SPOT")
        ld.spot_size = math.radians(55)
        ld.spot_blend = 0.6
        ld.color = (0.85, 0.92, 1.0)
        ld.shadow_soft_size = 0.05
        ob = bpy.data.objects.new(ld.name, ld)
        link(ob, "Lights")
        ob.location = (2.15, s * 0.65, GROUND + 0.58)
        ob.rotation_euler = Vector((1, s * 0.05, -0.12)).to_track_quat("-Z", "Y").to_euler()
        for f, v in seq:
            ld.energy = v * 900 * LIGHT_SCALE
            ld.keyframe_insert("energy", frame=f)
    ld = bpy.data.lights.new("尾灯光", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = 1.6, 0.1
    ld.color = (1.0, 0.05, 0.03)
    ob = bpy.data.objects.new(ld.name, ld)
    link(ob, "Lights")
    ob.location = (-2.35, 0, GROUND + 0.75)
    ob.rotation_euler = Vector((-1, 0, -0.2)).to_track_quat("-Z", "Y").to_euler()
    for f, v in seq:
        ld.energy = v * 250 * LIGHT_SCALE
        ld.keyframe_insert("energy", frame=f)


# ---------------------------------------------------------------------------
# 运镜
# ---------------------------------------------------------------------------
CAR_C = Vector((0, 0, 0.6))


def orbit(r, ang_deg, h, c=CAR_C):
    a = math.radians(ang_deg)
    return Vector((c.x + r * math.cos(a), c.y + r * math.sin(a), h))


def shot_eval(i, u, f):
    """返回 (机位, 看向点, 焦距, 对焦点, 光圈)。"""
    e = ease(u)
    if i == 0:      # 高空环绕全息蓝图
        pos = orbit(lerp(10.0, 8.6, e), lerp(212, 292, u), lerp(9.6, 8.2, e), Vector((0, 0, 0)))
        tgt = Vector((0, 0, 0.35))
        return pos, tgt, 27, tgt, 5.6
    if i == 1:      # 前侧推近：底盘 + 前轮
        pos = orbit(lerp(8.4, 4.6, e), lerp(38, 26, e), lerp(3.3, 1.25, e), Vector((0.6, 0, 0)))
        tgt = vlerp((0.3, 0, 0.35), (1.15, -0.25, 0.38), e)
        return pos, tgt, lerp(30, 36, e), vlerp((0.3, 0, 0.3), (AX_F, 0.6, 0.38), e), 2.8
    if i == 2:      # 低机位贴地跟拍后轮
        pos = vlerp((-4.0, 2.55, 0.26), (-2.55, 2.25, 0.32), e)
        pos += Vector((0, 0.01 * math.sin(f * 0.9), 0.008 * math.sin(f * 1.3)))
        tgt = vlerp((-1.45, 0.75, 0.62), (-1.2, 0.55, 0.75), e)
        return pos, tgt, 22, Vector((AX_R, 0.95, 0.4)), 2.2
    if i == 3:      # 侧面环绕（右侧，避开 A 臂底座）
        pos = orbit(lerp(8.6, 7.8, e), lerp(196, 252, u), lerp(2.9, 2.0, e))
        tgt = Vector((0.1, 0, 0.55))
        return pos, tgt, 30, Vector((0, -0.9, 0.6)), 3.5
    if i == 4:      # 高位后侧
        pos = orbit(lerp(8.6, 7.4, e), lerp(150, 168, e), lerp(5.8, 4.4, e))
        tgt = vlerp((-0.3, 0, 0.5), (-0.9, 0, 0.75), e)
        return pos, tgt, lerp(29, 31, e), vlerp((-0.3, 0, 0.8), (-1.9, 0, 1.1), e), 4.0
    # 低机位正面英雄镜头
    pos = vlerp((5.6, 2.2, 0.42), (4.4, -0.55, 0.50), e)
    tgt = vlerp((0.5, 0.2, 0.62), (0.2, 0.0, 0.72), e)
    return pos, tgt, lerp(32, 29, e), Vector((2.1, 0.0, 0.6)), 2.8


def build_cameras():
    sc = bpy.context.scene
    cams = []
    for i, (a, b) in enumerate(SHOTS):
        cd = bpy.data.cameras.new("镜头%d" % (i + 1))
        cd.sensor_fit = "AUTO"
        cd.sensor_width = 36
        cd.clip_start = 0.05
        cd.clip_end = 200
        cd.dof.use_dof = True
        cd.dof.aperture_blades = 7
        cam = bpy.data.objects.new(cd.name, cd)
        link(cam, "Cameras")
        cam.rotation_mode = "QUATERNION"
        prev = None
        for f in range(a - 1, b + 2):
            u = clamp((f - a) / max(b - a, 1), -0.05, 1.05)
            pos, tgt, lens, focus, fstop = shot_eval(i, u, f)
            q = (Vector(tgt) - pos).to_track_quat("-Z", "Y")
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            prev = q
            cam.location = pos
            cam.rotation_quaternion = q
            cam.keyframe_insert("location", frame=f)
            cam.keyframe_insert("rotation_quaternion", frame=f)
            cd.lens = lens
            cd.keyframe_insert("lens", frame=f)
            cd.dof.focus_distance = (Vector(focus) - pos).length
            cd.dof.aperture_fstop = fstop
            cd.dof.keyframe_insert("focus_distance", frame=f)
            cd.dof.keyframe_insert("aperture_fstop", frame=f)
        m = sc.timeline_markers.new("S%d" % (i + 1), frame=a)
        m.camera = cam
        cams.append(cam)
    sc.camera = cams[0]
    return cams


def find_font():
    if ARGS["font"] and os.path.isfile(ARGS["font"]):
        return ARGS["font"]
    cands = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "C:/Windows/Fonts/msyhbd.ttc",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/Deng.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/wenquanyi/wqy-microhei/wqy-microhei.ttc",
    ]
    for p in cands:
        if os.path.isfile(p):
            return p
    # macOS 新版本把 PingFang 放在资源目录里
    root = "/System/Library/AssetsV2"
    if os.path.isdir(root):
        for dp, _, fs in os.walk(root):
            for fn in fs:
                if fn.startswith("PingFang") and fn.endswith((".ttc", ".ttf")):
                    return os.path.join(dp, fn)
    return None


def build_title(cam):
    font_path = find_font()
    font = None
    text = TITLE_EN
    if font_path:
        try:
            font = bpy.data.fonts.load(font_path)
            text = TITLE_CN
            print("[jixiebi] 标题字体:", font_path)
        except Exception as ex:  # noqa: BLE001
            print("[jixiebi] 字体加载失败，改用英文标题:", ex)
    else:
        print("[jixiebi] 没找到中文字体，改用英文标题")
    m, nt = new_mat("标题")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (0.92, 0.96, 1.0, 1)
    em.inputs["Strength"].default_value = 4.0
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(attr(nt, "hid"), mix.inputs[0])
    nt.links.new(em.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    m2, nt2 = new_mat("标题强调")
    em2 = nt2.nodes.new("ShaderNodeEmission")
    em2.inputs["Color"].default_value = (*HOLO, 1)
    em2.inputs["Strength"].default_value = 6.0
    tr2 = nt2.nodes.new("ShaderNodeBsdfTransparent")
    mix2 = nt2.nodes.new("ShaderNodeMixShader")
    nt2.links.new(attr(nt2, "hid"), mix2.inputs[0])
    nt2.links.new(em2.outputs[0], mix2.inputs[1])
    nt2.links.new(tr2.outputs[0], mix2.inputs[2])
    out2 = nt2.nodes.new("ShaderNodeOutputMaterial")
    nt2.links.new(mix2.outputs[0], out2.inputs["Surface"])

    sc = bpy.context.scene
    sc.frame_set(TITLE_IN + 12)
    D = cam.data.dof.focus_distance
    lens = cam.data.lens
    half_h = D * 18.0 / lens
    half_w = half_h * RES[0] / RES[1]
    objs = []

    def txt(name, body, size, y, mat, fnt, spacing=1.0):
        cu = bpy.data.curves.new(name, "FONT")
        cu.body = body
        if fnt:
            cu.font = fnt
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        cu.size = size
        cu.space_character = spacing
        cu.materials.append(mat)
        ob = bpy.data.objects.new(name, cu)
        link(ob, "Title")
        init_props(ob)
        ob.parent = cam
        ob.location = (0, y, -D)
        ob.visible_shadow = False
        objs.append(ob)
        return ob
    n = max(len(text), 1)
    size = min(half_w * 1.55 / (n if text == TITLE_CN else n * 0.62), half_h * 0.16)
    y0 = half_h * 0.60
    txt("标题", text, size, y0, m, font, 1.05 if text == TITLE_CN else 1.1)
    txt("副标题", SUBTITLE, size * 0.22, y0 - size * 0.85, m2, None, 1.3)
    bm = bmesh.new()
    bm_box(bm, Vector((0, 0, 0)), Vector((half_w * 0.5, size * 0.03, 0.001)))
    bar = mesh_obj("标题线", bm, [m2], "Title", smooth_shade=False)
    bar.parent = cam
    bar.location = (0, y0 - size * 0.62, -D)
    bar.visible_shadow = False
    objs.append(bar)
    for k, ob in enumerate(objs):
        t0 = TITLE_IN + k * 5
        ob.hide_render = True
        ob.keyframe_insert("hide_render", frame=1)
        ob.hide_render = False
        ob.keyframe_insert("hide_render", frame=t0)
        key_prop(ob, "hid", t0, 1.0)
        key_prop(ob, "hid", t0 + 14, 0.0)
        s0 = ob.scale.copy()
        ob.scale = s0 * 0.96
        ob.keyframe_insert("scale", frame=t0)
        ob.scale = s0
        ob.keyframe_insert("scale", frame=t0 + 18)
    sc.frame_set(1)


# ---------------------------------------------------------------------------
# 渲染设置
# ---------------------------------------------------------------------------


def enable_gpu():
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except Exception:  # noqa: BLE001
        return False
    for t in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = t
            prefs.get_devices()
            devs = [d for d in prefs.devices if d.type == t]
            if devs:
                for d in prefs.devices:
                    d.use = d.type in (t, "CPU") if t != "METAL" else True
                bpy.context.scene.cycles.device = "GPU"
                print("[jixiebi] Cycles 使用 GPU:", t)
                return True
        except Exception:  # noqa: BLE001
            continue
    print("[jixiebi] 未找到可用 GPU，Cycles 用 CPU 渲染")
    return False


def setup_compositor(sc):
    """辉光（bloom），兼容 4.x 和 5.x；失败则跳过。"""
    try:
        if hasattr(sc, "compositing_node_group"):          # 5.x
            ng = bpy.data.node_groups.new("合成", "CompositorNodeTree")
            ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            rl = ng.nodes.new("CompositorNodeRLayers")
            g = ng.nodes.new("CompositorNodeGlare")
            go = ng.nodes.new("NodeGroupOutput")
            g.inputs["Type"].default_value = "Bloom"
            g.inputs["Quality"].default_value = "High" if not ARGS["preview"] else "Medium"
            g.inputs["Threshold"].default_value = 1.2
            g.inputs["Strength"].default_value = 0.55
            g.inputs["Size"].default_value = 0.7
            ng.links.new(rl.outputs["Image"], g.inputs["Image"])
            ng.links.new(g.outputs["Image"], go.inputs[0])
            sc.compositing_node_group = ng
        else:                                               # 4.x
            sc.use_nodes = True
            nt = sc.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            rl = nt.nodes.new("CompositorNodeRLayers")
            g = nt.nodes.new("CompositorNodeGlare")
            comp = nt.nodes.new("CompositorNodeComposite")
            if not sset(g, "glare_type", "BLOOM"):
                g.glare_type = "FOG_GLOW"
            sset(g, "quality", "HIGH" if not ARGS["preview"] else "MEDIUM")
            sset(g, "threshold", 1.2)
            sset(g, "size", 7)
            sset(g, "mix", -0.45)
            nt.links.new(rl.outputs["Image"], g.inputs["Image"])
            nt.links.new(g.outputs["Image"], comp.inputs["Image"])
        sset(sc.render, "use_compositing", True)
    except Exception as ex:  # noqa: BLE001
        print("[jixiebi] 合成辉光未启用:", ex)


def setup_render(out_dir):
    sc = bpy.context.scene
    r = sc.render
    r.resolution_x, r.resolution_y = RES
    r.resolution_percentage = 50 if ARGS["preview"] else 100
    r.fps = FPS
    r.fps_base = 1.0
    sc.frame_start, sc.frame_end = 1, FRAMES
    if ARGS["cycles"]:
        r.engine = "CYCLES"
        enable_gpu()
        cy = sc.cycles
        cy.samples = 48 if ARGS["preview"] else 384
        sset(cy, "use_adaptive_sampling", True)
        sset(cy, "use_denoising", True)
        sset(cy, "max_bounces", 8)
        sset(cy, "volume_step_rate", 4.0 if ARGS["preview"] else 2.0)
        sset(cy, "volume_bounces", 0)
        sset(cy, "sample_clamp_indirect", 8.0)
        sset(cy, "caustics_reflective", False)
        sset(cy, "caustics_refractive", False)
    else:
        for name in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            if sset(r, "engine", name):
                break
        ee = sc.eevee
        sset(ee, "taa_render_samples", 24 if ARGS["preview"] else 96)
        sset(ee, "use_raytracing", True)
        sset(ee, "ray_tracing_method", "SCREEN")
        sset(ee, "use_shadows", True)
        sset(ee, "shadow_ray_count", 2)
        sset(ee, "shadow_step_count", 8)
        sset(ee, "volumetric_tile_size", "8" if ARGS["preview"] else "4")
        sset(ee, "volumetric_samples", 48 if ARGS["preview"] else 96)
        sset(ee, "volumetric_end", 40.0)
        sset(ee, "use_volumetric_shadows", True)
        sset(ee, "use_gtao", True)
        sset(ee, "use_fast_gi", True)
        sset(ee, "motion_blur_steps", 1 if ARGS["preview"] else 4)
        try:
            ee.ray_tracing_options.resolution_scale = "2" if ARGS["preview"] else "1"
        except Exception:  # noqa: BLE001
            pass
    # 运动模糊（4.2+ 统一在 render 上；老版本在 eevee 上）
    sset(r, "use_motion_blur", True)
    sset(sc.eevee, "use_motion_blur", True)
    sset(r, "motion_blur_shutter", 0.5)
    # 色彩
    vs = sc.view_settings
    sset(vs, "view_transform", "AgX")
    for look in ("AgX - Punchy", "Punchy", "AgX - Medium High Contrast", "Medium High Contrast"):
        if sset(vs, "look", look):
            break
    vs.exposure = 0.0
    setup_compositor(sc)
    # MP4 输出
    im = r.image_settings
    sset(im, "media_type", "VIDEO")
    im.file_format = "FFMPEG"
    r.ffmpeg.format = "MPEG4"
    r.ffmpeg.codec = "H264"
    sset(r.ffmpeg, "constant_rate_factor", "HIGH")
    sset(r.ffmpeg, "ffmpeg_preset", "GOOD")
    r.ffmpeg.gopsize = FPS
    r.ffmpeg.audio_codec = "NONE"
    r.use_file_extension = False
    name = "jixiebi_zaoche_preview" if ARGS["preview"] else "jixiebi_zaoche"
    if ARGS["frames"]:
        sc.frame_start, sc.frame_end = ARGS["frames"]
        name += "_%d-%d" % ARGS["frames"]
    name += ".mp4"
    r.filepath = os.path.join(out_dir, name)
    return os.path.join(out_dir, name)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def main():
    out_dir = output_dir()
    print("[jixiebi] 输出目录:", out_dir)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = "机械臂造车"
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, FRAMES

    build_materials()
    print("[jixiebi] 建车 …")
    mods = build_car()
    roots = make_roots(mods)
    jobs = plan_jobs(mods, roots)
    ghosts = build_ghosts(mods, roots, jobs)
    print("[jixiebi] 场景与灯光 …")
    L = build_stage()
    arms = {k: build_arm(k) for k in ("A", "B")}
    print("[jixiebi] 动画 …")
    animate_modules(mods, roots, jobs)
    animate_arms(arms, jobs)
    build_welds(jobs)
    animate_lights(L, jobs)
    light_up(mods)
    cams = build_cameras()
    build_title(cams[-1])
    for c in ("_cutters",):
        if c in COLL:
            COLL[c].hide_render = True
            COLL[c].hide_viewport = True
    # 关键帧插值：布尔属性自动是常量；其余线性（逐帧烘焙的已经平滑）
    movie = setup_render(out_dir)
    sc.frame_set(1)
    blend = os.path.join(out_dir, "jixiebi_zaoche.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    print("[jixiebi] 场景已保存:", blend)

    if ARGS["still"]:
        sset(sc.render.image_settings, "media_type", "IMAGE")
        sc.render.image_settings.file_format = "PNG"
        sc.render.use_file_extension = True
        for f in ARGS["still"]:
            sc.frame_set(f)
            sc.render.filepath = os.path.join(out_dir, "still_%04d" % f)
            bpy.ops.render.render(write_still=True)
            print("[jixiebi] 单帧已渲染:", sc.render.filepath + ".png")
    elif ARGS["render"]:
        print("[jixiebi] 开始渲染 %d 帧 → %s" % (sc.frame_end - sc.frame_start + 1, movie))
        bpy.ops.render.render(animation=True)
        print("[jixiebi] 完成:", movie)
    else:
        print("[jixiebi] 未加 --render，只建了场景。加 --render 开始渲染。")


if __name__ == "__main__":
    main()
