# -*- coding: utf-8 -*-
"""
案例二：光波矩阵（几何节点 + 场景时间 + 属性传给材质）
=======================================================
用法（Blender 4.2+）：
    blender -b -P 02_guangbo_juzhen.py -- --render --preview
    blender -b -P 02_guangbo_juzhen.py -- --still 60

核心思路：
    1. 网格（Grid）的每个顶点放一根方柱（Instance on Points）
    2. 算每个点到中心的距离 d，波 = (0.5 + 0.5·sin(d·k − 时间·w))⁴
       —— 「场景时间」节点让它自己动，不用打一个关键帧
    3. 波值控制柱子高度（Scale 的 Z）
    4. 用「存储命名属性」把波值存成 wave，材质里用「属性」节点读出来 → 越高越亮
    5. 只给「振幅」打两个关键帧，做出开场时矩阵从平静到起伏
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from common import finish, inp, key_modifier_input, output, parse_args, reset_scene, setup_render  # noqa: E402

FRAMES = 150
ARGS = parse_args()


def material():
    m = bpy.data.materials.new("光柱")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.02, 0.025, 0.035, 1)
    b.inputs["Metallic"].default_value = 0.7
    b.inputs["Roughness"].default_value = 0.25
    at = nt.nodes.new("ShaderNodeAttribute")                    # ④ 读几何节点存的 wave
    at.attribute_type = "GEOMETRY"
    at.attribute_name = "wave"
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].color = (0.0, 0.05, 0.25, 1)
    cr.elements[1].color = (1.0, 0.35, 0.75, 1)
    mid = cr.elements.new(0.45)
    mid.color = (0.0, 0.55, 1.0, 1)
    nt.links.new(at.outputs["Fac"], ramp.inputs["Fac"])
    strength = nt.nodes.new("ShaderNodeMath")
    strength.operation = "POWER"
    nt.links.new(at.outputs["Fac"], strength.inputs[0])
    strength.inputs[1].default_value = 2.0
    s2 = nt.nodes.new("ShaderNodeMath")
    s2.operation = "MULTIPLY"
    nt.links.new(strength.outputs[0], s2.inputs[0])
    s2.inputs[1].default_value = 3.2
    ec = b.inputs.get("Emission Color") or b.inputs.get("Emission")
    nt.links.new(ramp.outputs["Color"], ec)
    nt.links.new(s2.outputs[0], b.inputs["Emission Strength"])
    return m


def build(ob, mat):
    ng = bpy.data.node_groups.new("光波矩阵", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    s_amp = ng.interface.new_socket("振幅", in_out="INPUT", socket_type="NodeSocketFloat")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N, L = ng.nodes, ng.links
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")

    grid = N.new("GeometryNodeMeshGrid")                         # ① 26×26 个点
    inp(grid, "Size X").default_value = 6.5
    inp(grid, "Size Y").default_value = 6.5
    inp(grid, "Vertices X").default_value = 26
    inp(grid, "Vertices Y").default_value = 26

    pos = N.new("GeometryNodeInputPosition")                     # ② 距离 d
    d = N.new("ShaderNodeVectorMath"); d.operation = "LENGTH"
    L.new(pos.outputs[0], d.inputs[0])
    t = N.new("GeometryNodeInputSceneTime")
    ph1 = N.new("ShaderNodeMath"); ph1.operation = "MULTIPLY"
    L.new(output(d, "VALUE"), ph1.inputs[0]); ph1.inputs[1].default_value = 2.4
    ph2 = N.new("ShaderNodeMath"); ph2.operation = "MULTIPLY"
    L.new(t.outputs["Seconds"], ph2.inputs[0]); ph2.inputs[1].default_value = 4.2
    ph = N.new("ShaderNodeMath"); ph.operation = "SUBTRACT"
    L.new(ph1.outputs[0], ph.inputs[0]); L.new(ph2.outputs[0], ph.inputs[1])
    sn = N.new("ShaderNodeMath"); sn.operation = "SINE"
    L.new(ph.outputs[0], sn.inputs[0])
    w01 = N.new("ShaderNodeMath"); w01.operation = "MULTIPLY_ADD"
    L.new(sn.outputs[0], w01.inputs[0]); w01.inputs[1].default_value = 0.5; w01.inputs[2].default_value = 0.5
    w3 = N.new("ShaderNodeMath"); w3.operation = "POWER"
    L.new(w01.outputs[0], w3.inputs[0]); w3.inputs[1].default_value = 4.0
    wa = N.new("ShaderNodeMath"); wa.operation = "MULTIPLY"
    L.new(w3.outputs[0], wa.inputs[0]); L.new(gi.outputs[1], wa.inputs[1])
    wave = wa.outputs[0]

    h = N.new("ShaderNodeMath"); h.operation = "MULTIPLY_ADD"          # ③ 高度 = 0.1 + 波·1.3
    L.new(wave, h.inputs[0]); h.inputs[1].default_value = 1.3; h.inputs[2].default_value = 0.1
    sc = N.new("ShaderNodeCombineXYZ")
    sc.inputs[0].default_value = 1.0
    sc.inputs[1].default_value = 1.0
    L.new(h.outputs[0], sc.inputs[2])

    cube = N.new("GeometryNodeMeshCube")
    inp(cube, "Size").default_value = (0.2, 0.2, 1.0)
    up = N.new("GeometryNodeTransform")                           # 让方柱从底部长高
    inp(up, "Translation").default_value = (0, 0, 0.5)
    L.new(cube.outputs[0], up.inputs[0])

    inst = N.new("GeometryNodeInstanceOnPoints")
    L.new(grid.outputs[0], inst.inputs["Points"])
    L.new(up.outputs[0], inst.inputs["Instance"])
    L.new(sc.outputs[0], inp(inst, "Scale"))

    store = N.new("GeometryNodeStoreNamedAttribute")              # ④ 存 wave
    store.data_type = "FLOAT"
    store.domain = "INSTANCE"
    inp(store, "Name").default_value = "wave"
    L.new(inst.outputs[0], store.inputs["Geometry"])
    L.new(wave, inp(store, "Value", "VALUE"))
    real = N.new("GeometryNodeRealizeInstances")
    L.new(store.outputs[0], real.inputs[0])
    sm = N.new("GeometryNodeSetMaterial")
    sm.inputs["Material"].default_value = mat
    L.new(real.outputs[0], sm.inputs["Geometry"])
    L.new(sm.outputs[0], go.inputs[0])

    mod = ob.modifiers.new("GeometryNodes", "NODES")
    mod.node_group = ng
    return mod, s_amp.identifier


def stage():
    sc = bpy.context.scene
    w = bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.003, 0.004, 0.01, 1)
    me = bpy.data.meshes.new("地板")
    me.from_pydata([(-40, -40, 0), (40, -40, 0), (40, 40, 0), (-40, 40, 0)], [], [(0, 1, 2, 3)])
    fl = bpy.data.objects.new("地板", me)
    sc.collection.objects.link(fl)
    m = bpy.data.materials.new("地板")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.008, 0.008, 0.012, 1)
    b.inputs["Roughness"].default_value = 0.18
    me.materials.append(m)
    ld = bpy.data.lights.new("顶光", "AREA")
    ld.energy = 120
    ld.size = 6
    lo = bpy.data.objects.new("顶光", ld)
    sc.collection.objects.link(lo)
    lo.location = (0, 0, 6)


def camera():
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("相机")
    cd.lens = 30
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = 2.8
    cam = bpy.data.objects.new("相机", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    tgt = bpy.data.objects.new("看向", None)
    sc.collection.objects.link(tgt)
    tgt.location = (0, 0, 0.2)
    cd.dof.focus_object = tgt
    tc = cam.constraints.new("TRACK_TO")
    tc.target = tgt
    tc.track_axis = "TRACK_NEGATIVE_Z"
    tc.up_axis = "UP_Y"
    # 绕中心慢慢转 70°，同时降低机位
    for f in list(range(1, FRAMES, 10)) + [FRAMES]:
        u = (f - 1) / (FRAMES - 1)
        a = math.radians(225 + 70 * u)
        r = 11.0 - 1.6 * u
        cam.location = (r * math.cos(a), r * math.sin(a), 6.6 - 2.0 * u)
        cam.keyframe_insert("location", frame=f)


def main():
    sc = reset_scene()
    me = bpy.data.meshes.new("空网格")                 # 几何节点自己生成网格，载体物体是空的
    ob = bpy.data.objects.new("光波矩阵", me)
    sc.collection.objects.link(ob)
    mod, s_amp = build(ob, material())
    for f, v in ((1, 0.0), (35, 1.0)):                 # ⑤ 只有两个关键帧
        key_modifier_input(ob, mod, s_amp, f, v)
    stage()
    camera()
    d = setup_render(sc, ARGS, "02_guangbo_juzhen", FRAMES)
    finish(sc, ARGS, d, "02_guangbo_juzhen")


main()
