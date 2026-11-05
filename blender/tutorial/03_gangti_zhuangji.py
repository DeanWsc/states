# -*- coding: utf-8 -*-
"""
案例三：刚体撞墙 + 子弹时间 + 跟随运镜
=====================================
用法（Blender 4.2+）：
    blender -b -P 03_gangti_zhuangji.py -- --render --preview
    （物理要从第 1 帧顺序算，单独看某一帧也会先把前面算完）

核心思路：
    1. 砖墙：交错排列的方块，全部设为「主动」刚体（Active）
    2. 斜坡和地面设为「被动」刚体（Passive），只挡东西不动
    3. 金属球质量大（20），从斜坡滚下 —— 速度全靠重力，不需要打关键帧
    4. 子弹时间：给刚体世界的「时间缩放」打关键帧 1 → 0.25 → 1
    5. 相机用「标准跟随（Track To）」看着一个空物体，空物体从球移到墙中心
"""
import colorsys
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import finish, parse_args, reset_scene, setup_render, sset  # noqa: E402

FRAMES = 150
WALL_X = -1.2
IMPACT = 61          # 球撞墙的帧（实测得出，改斜坡后要重新看）
ARGS = parse_args()


def box(name, loc, size, mat, rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    x, y, z = (s / 2 for s in size)
    v = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z), (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me.from_pydata(v, [], f)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    bev = ob.modifiers.new("倒角", "BEVEL")
    bev.width = min(size) * 0.08
    bev.segments = 2
    return ob


def mat(name, color, metallic=0.0, rough=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    return m


def rigid(ob, kind="ACTIVE", shape="BOX", mass=1.0, friction=0.6, bounce=0.1):
    with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob],
                                   selected_editable_objects=[ob]):
        bpy.ops.rigidbody.object_add(type=kind)
    rb = ob.rigid_body
    rb.collision_shape = shape
    rb.mass = mass
    rb.friction = friction
    rb.restitution = bounce
    rb.collision_margin = 0.002
    return rb


def build():
    sc = bpy.context.scene
    bpy.ops.rigidbody.world_add()
    rw = sc.rigidbody_world
    rw.point_cache.frame_start = 1
    rw.point_cache.frame_end = FRAMES
    sset(rw, "substeps_per_frame", 20)
    rw.solver_iterations = 20

    floor_m = mat("地面", (0.02, 0.022, 0.03), 0.3, 0.3)
    fl = box("地面", (0, 0, -0.1), (40, 40, 0.2), floor_m)
    fl.modifiers.clear()
    rigid(fl, "PASSIVE")

    ramp_m = mat("斜坡", (0.05, 0.05, 0.06), 0.8, 0.25)
    ang = math.radians(30)
    L = 4.8
    ramp = box("斜坡", (-3.9 - math.cos(ang) * L / 2, 0, math.sin(ang) * L / 2 - 0.05), (L, 1.6, 0.1),
               ramp_m, rot=(0, ang, 0))
    rigid(ramp, "PASSIVE")

    # ① 砖墙：8 层，交错排列
    rnd = random.Random(4)
    palette = [colorsys.hsv_to_rgb(h, 0.75, 0.9) for h in (0.0, 0.08, 0.13, 0.55, 0.6, 0.85)]
    mats = [mat("砖%d" % i, c, 0.0, 0.3) for i, c in enumerate(palette)]
    bw, bh, bd = 0.5, 0.3, 0.32
    for row in range(8):
        n = 7 if row % 2 else 8
        for i in range(n):
            y = (i - (n - 1) / 2) * bw
            ob = box("砖", (WALL_X, y, bh / 2 + row * bh + 0.001), (bd, bw * 0.98, bh * 0.98),
                     mats[rnd.randrange(len(mats))])
            rigid(ob, "ACTIVE", "BOX", mass=0.6)

    # ③ 金属球
    import bmesh
    me = bpy.data.meshes.new("球")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.48)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(mat("铬", (0.9, 0.9, 0.92), 1.0, 0.06))
    ball = bpy.data.objects.new("金属球", me)
    sc.collection.objects.link(ball)
    top = (-3.9 - math.cos(ang) * (L - 0.6), 0, math.sin(ang) * (L - 0.6) + 0.48 / math.cos(ang) + 0.02)
    ball.location = top
    rigid(ball, "ACTIVE", "SPHERE", mass=20.0, friction=0.8, bounce=0.05)

    # ④ 子弹时间
    for f, v in ((1, 1.0), (IMPACT - 3, 1.0), (IMPACT + 3, 0.22), (IMPACT + 40, 0.22), (IMPACT + 56, 1.0)):
        rw.time_scale = v
        rw.keyframe_insert("time_scale", frame=f)
    return ball, top


def lights():
    sc = bpy.context.scene
    w = bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.01, 0.012, 0.02, 1)
    for name, loc, e, col, size in (("主光", (-2, -5, 7), 900, (1, 0.95, 0.9), 4),
                                    ("轮廓光", (4, 4, 4), 600, (0.4, 0.6, 1.0), 3),
                                    ("补光", (-6, 3, 2), 200, (1.0, 0.6, 0.4), 3)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = e
        ld.color = col
        ld.size = size
        ob = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(ob)
        ob.location = loc
        ob.rotation_euler = (-__import__("mathutils").Vector(loc)).to_track_quat("-Z", "Y").to_euler()


def camera(top):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("相机")
    cd.lens = 28
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = 3.2
    cam = bpy.data.objects.new("相机", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = bpy.data.objects.new("看向", None)
    sc.collection.objects.link(tgt)
    cd.dof.focus_object = tgt
    tc = cam.constraints.new("TRACK_TO")
    tc.target = tgt
    tc.track_axis = "TRACK_NEGATIVE_Z"
    tc.up_axis = "UP_Y"
    # ⑤ 看向点：用「复制位置」约束贴着球走，撞墙时把约束影响力从 1 拉到 0，视线就平滑转到墙上
    tgt.location = (WALL_X + 0.3, 0, 1.0)
    cl = tgt.constraints.new("COPY_LOCATION")
    cl.target = bpy.data.objects["金属球"]
    for f, v in ((1, 1.0), (IMPACT - 8, 1.0), (IMPACT + 14, 0.0)):
        cl.influence = v
        cl.keyframe_insert("influence", frame=f)
    for f, loc in ((1, (-7.4, -4.4, 2.6)), (IMPACT - 4, (-3.6, -4.0, 0.9)), (IMPACT + 40, (-2.6, -4.6, 1.0)),
                   (150, (-3.4, -5.8, 1.8))):
        cam.location = loc
        cam.keyframe_insert("location", frame=f)


def main():
    sc = reset_scene()
    ball, top = build()
    lights()
    camera(top)
    d = setup_render(sc, ARGS, "03_gangti_zhuangji", FRAMES, samples=48)
    finish(sc, ARGS, d, "03_gangti_zhuangji")


main()
