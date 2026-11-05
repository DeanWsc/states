# -*- coding: utf-8 -*-
"""
案例一：粒子文字爆散 → 旋涡 → 重组（几何节点）
================================================
用法（Blender 4.2+）：
    blender -b -P 01_lizi_wenzi.py -- --render --preview     预览版
    blender -b -P 01_lizi_wenzi.py -- --render               正式版（1080×1920，5 秒）
    blender -b -P 01_lizi_wenzi.py -- --still 70             只看第 70 帧
也可以在 Blender 里打开「脚本」工作区，载入本文件直接运行（只建场景）。

核心思路（教程里逐步讲）：
    1. 文字 → 网格
    2. 在网格表面撒点（Distribute Points on Faces）
    3. 每个点放一个小方块（Instance on Points）
    4. 用一个「爆散系数」0→1 控制：随机偏移 + 绕竖轴旋转；每个点系数错开，形成波浪感
    5. 给「爆散系数」打关键帧：0 → 1 → 0
    6. 发光材质按位置上色 + 辉光
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import finish, inp, key_modifier_input, output, parse_args, reset_scene, setup_render  # noqa: E402

TEXT = "MOTION"
FRAMES = 150
ARGS = parse_args()


def text_mesh():
    cu = bpy.data.curves.new("文字", "FONT")
    cu.body = TEXT
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.size = 0.95
    cu.extrude = 0.04
    tmp = bpy.data.objects.new("文字曲线", cu)
    bpy.context.scene.collection.objects.link(tmp)
    tmp.rotation_euler = (math.pi / 2, 0, 0)        # 立起来，面向 -Y 方向的相机
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    me.transform(tmp.matrix_world)
    bpy.data.objects.remove(tmp)
    ob = bpy.data.objects.new("粒子文字", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def glow_material():
    m = bpy.data.materials.new("发光渐变")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -2.2
    mr.inputs["From Max"].default_value = 2.2
    nt.links.new(sep.outputs["X"], mr.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].color = (0.05, 0.75, 1.0, 1)
    cr.elements[1].color = (1.0, 0.25, 0.55, 1)
    e = cr.elements.new(0.5)
    e.color = (0.55, 0.3, 1.0, 1)
    nt.links.new(mr.outputs[0], ramp.inputs["Fac"])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 7.0
    nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def build_nodes(ob, mat):
    ng = bpy.data.node_groups.new("粒子爆散", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    s_f = ng.interface.new_socket("爆散系数", in_out="INPUT", socket_type="NodeSocketFloat")
    s_spin = ng.interface.new_socket("旋转", in_out="INPUT", socket_type="NodeSocketFloat")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N, L = ng.nodes, ng.links
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")

    # ② 表面撒点
    dist = N.new("GeometryNodeDistributePointsOnFaces")
    dist.name = "撒点"
    inp(dist, "Density").default_value = 2600
    L.new(gi.outputs[0], dist.inputs["Mesh"])

    # ④ 每个点一个随机数 r，系数错峰：f_i = clamp(F*1.6 - r*0.6)
    r = N.new("FunctionNodeRandomValue")
    r.data_type = "FLOAT"
    inp(r, "Seed", "INT").default_value = 7
    rv = output(r, "VALUE")
    stag = N.new("ShaderNodeMath"); stag.operation = "MULTIPLY_ADD"; stag.use_clamp = True
    L.new(gi.outputs[1], stag.inputs[0]); stag.inputs[1].default_value = 1.6
    neg = N.new("ShaderNodeMath"); neg.operation = "MULTIPLY"
    L.new(rv, neg.inputs[0]); neg.inputs[1].default_value = -0.6
    L.new(neg.outputs[0], stag.inputs[2])
    smooth = N.new("ShaderNodeMapRange"); smooth.interpolation_type = "SMOOTHSTEP"
    L.new(stag.outputs[0], smooth.inputs["Value"])
    f_i = smooth.outputs[0]

    # 随机方向偏移（竖向拉得更开，适合竖屏）
    rvec = N.new("FunctionNodeRandomValue")
    rvec.data_type = "FLOAT_VECTOR"
    inp(rvec, "Min", "VECTOR").default_value = (-1.3, -0.9, -1.5)
    inp(rvec, "Max", "VECTOR").default_value = (1.3, 0.9, 3.4)
    off = N.new("ShaderNodeVectorMath"); off.operation = "SCALE"
    L.new(output(rvec, "VECTOR"), off.inputs[0]); L.new(f_i, inp(off, "Scale"))
    pos = N.new("GeometryNodeInputPosition")
    add = N.new("ShaderNodeVectorMath"); add.operation = "ADD"
    L.new(pos.outputs[0], add.inputs[0]); L.new(off.outputs[0], add.inputs[1])

    # 绕竖轴旋涡：角度 = f_i * (2 + r*3) + 旋转*f_i
    ang = N.new("ShaderNodeMath"); ang.operation = "MULTIPLY_ADD"
    L.new(rv, ang.inputs[0]); ang.inputs[1].default_value = 3.0; ang.inputs[2].default_value = 2.0
    ang2 = N.new("ShaderNodeMath"); ang2.operation = "ADD"
    L.new(ang.outputs[0], ang2.inputs[0]); L.new(gi.outputs[2], ang2.inputs[1])
    ang3 = N.new("ShaderNodeMath"); ang3.operation = "MULTIPLY"
    L.new(ang2.outputs[0], ang3.inputs[0]); L.new(f_i, ang3.inputs[1])
    rot = N.new("ShaderNodeVectorRotate"); rot.rotation_type = "Z_AXIS"
    L.new(add.outputs[0], rot.inputs["Vector"]); L.new(ang3.outputs[0], inp(rot, "Angle"))
    setp = N.new("GeometryNodeSetPosition")
    L.new(dist.outputs["Points"], setp.inputs["Geometry"])
    L.new(rot.outputs[0], inp(setp, "Position"))

    # ③ 每个点放一个小方块，飞散时随机翻滚、略微变小
    cube = N.new("GeometryNodeMeshCube"); cube.name = "小方块"
    for k in ("Size",):
        inp(cube, k).default_value = (0.032, 0.032, 0.032)
    rrot = N.new("FunctionNodeRandomValue"); rrot.data_type = "FLOAT_VECTOR"
    inp(rrot, "Min", "VECTOR").default_value = (0, 0, 0)
    inp(rrot, "Max", "VECTOR").default_value = (6.28, 6.28, 6.28)
    inp(rrot, "Seed", "INT").default_value = 3
    rsc = N.new("ShaderNodeVectorMath"); rsc.operation = "SCALE"
    L.new(output(rrot, "VECTOR"), rsc.inputs[0]); L.new(f_i, inp(rsc, "Scale"))
    scl = N.new("ShaderNodeMapRange")
    L.new(f_i, scl.inputs["Value"]); scl.inputs["To Min"].default_value = 1.0; scl.inputs["To Max"].default_value = 0.6
    inst = N.new("GeometryNodeInstanceOnPoints")
    L.new(setp.outputs[0], inst.inputs["Points"])
    L.new(cube.outputs[0], inst.inputs["Instance"])
    L.new(rsc.outputs[0], inp(inst, "Rotation"))
    L.new(scl.outputs[0], inp(inst, "Scale"))
    real = N.new("GeometryNodeRealizeInstances")
    L.new(inst.outputs[0], real.inputs[0])
    sm = N.new("GeometryNodeSetMaterial")
    sm.inputs["Material"].default_value = mat
    L.new(real.outputs[0], sm.inputs["Geometry"])
    L.new(sm.outputs[0], go.inputs[0])

    mod = ob.modifiers.new("GeometryNodes", "NODES")
    mod.node_group = ng
    return mod, s_f.identifier, s_spin.identifier


def key(ob, mod, ident, frame, value):
    key_modifier_input(ob, mod, ident, frame, value)


def stage():
    w = bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.004, 0.005, 0.012, 1)
    # 镜面地板：让粒子在地上有倒影
    me = bpy.data.meshes.new("地板")
    me.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    fl = bpy.data.objects.new("地板", me)
    bpy.context.scene.collection.objects.link(fl)
    fl.location.z = -1.75
    m = bpy.data.materials.new("镜面地板")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.01, 0.01, 0.015, 1)
    b.inputs["Roughness"].default_value = 0.12
    b.inputs["Metallic"].default_value = 0.6
    me.materials.append(m)


def camera():
    cd = bpy.data.cameras.new("相机")
    cd.lens = 32
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = 2.0
    cam = bpy.data.objects.new("相机", cd)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    tgt = bpy.data.objects.new("对焦点", None)
    bpy.context.scene.collection.objects.link(tgt)
    tgt.location = (0, 0, 0.7)
    cd.dof.focus_object = tgt
    tc = cam.constraints.new("TRACK_TO")                         # 相机始终看着对焦点
    tc.target = tgt
    tc.track_axis = "TRACK_NEGATIVE_Z"
    tc.up_axis = "UP_Y"
    # 缓慢推近 + 轻微环绕
    for f, x, y, z in ((1, -1.2, -9.5, 0.6), (75, 0.6, -8.2, 0.2), (150, -0.4, -7.2, 0.35)):
        cam.location = (x, y, z)
        cam.keyframe_insert("location", frame=f)
    return cam


def main():
    sc = reset_scene()
    ob = text_mesh()
    mat = glow_material()
    mod, s_f, s_spin = build_nodes(ob, mat)
    # ⑤ 关键帧：成形 → 爆散 → 旋涡停留 → 重组
    for f, v in ((1, 0.0), (22, 0.0), (68, 1.0), (98, 1.0), (138, 0.0), (150, 0.0)):
        key(ob, mod, s_f, f, v)
    key(ob, mod, s_spin, 1, 0.0)
    key(ob, mod, s_spin, 150, 2.5)
    stage()
    camera()
    d = setup_render(sc, ARGS, "01_lizi_wenzi", FRAMES)
    finish(sc, ARGS, d, "01_lizi_wenzi")


main()
