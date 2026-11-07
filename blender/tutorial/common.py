# -*- coding: utf-8 -*-
"""教程案例共用的小工具：命令行参数、输出设置、辉光合成、版本兼容。

每个案例脚本都会把本文件所在目录加入 sys.path 再 import，
所以请把 common.py 和案例脚本放在同一个文件夹里。
"""
import os
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {"render": False, "preview": False, "still": None, "out": None, "frames": None}
    i = 0
    while i < len(argv):
        k = argv[i]
        if k == "--render":
            a["render"] = True
        elif k == "--preview":
            a["preview"] = True
        elif k == "--still" and i + 1 < len(argv):
            a["still"] = [int(v) for v in argv[i + 1].split(",") if v.strip()]
            i += 1
        elif k == "--frames" and i + 1 < len(argv):
            lo, hi = argv[i + 1].split("-")
            a["frames"] = (int(lo), int(hi))
            i += 1
        elif k == "--out" and i + 1 < len(argv):
            a["out"] = argv[i + 1]
            i += 1
        i += 1
    return a


def out_dir(args, name):
    if args["out"]:
        d = os.path.abspath(os.path.expanduser(args["out"]))
    else:
        home = os.path.expanduser("~")
        desk = next((os.path.join(home, n) for n in ("Desktop", "桌面") if os.path.isdir(os.path.join(home, n))), home)
        d = os.path.join(desk, "blender_tutorial", name)
    os.makedirs(d, exist_ok=True)
    return d


def sset(obj, attr, value):
    try:
        setattr(obj, attr, value)
        return True
    except (AttributeError, TypeError, ValueError):
        return False


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "BEZIER"
    return bpy.context.scene


def output(node, *types):
    """取节点里第一个可用的输出（兼容 4.x 的多输出和 5.x 的动态输出）。"""
    for o in node.outputs:
        if getattr(o, "enabled", True) and not getattr(o, "is_unavailable", False):
            if not types or o.type in types:
                return o
    return node.outputs[0]


def inp(node, name, *types):
    for s in node.inputs:
        if s.name == name and getattr(s, "enabled", True) and not getattr(s, "is_unavailable", False):
            if not types or s.type in types:
                return s
    return node.inputs[name]


def key_modifier_input(ob, mod, ident, frame, value):
    """给几何节点修改器的输入打关键帧（兼容 4.x 的 mod["Socket_n"] 和 5.x 的 mod.properties.inputs）。"""
    props = getattr(mod, "properties", None)
    if props is not None and hasattr(props, "inputs"):
        sock = getattr(props.inputs, ident)
        sock.value = value
        ob.keyframe_insert(data_path=sock.path_from_id("value"), frame=frame)
    else:
        mod[ident] = value
        ob.keyframe_insert(data_path='modifiers["%s"]["%s"]' % (mod.name, ident), frame=frame)


def setup_glare(sc, strength=0.6, threshold=1.0):
    try:
        if hasattr(sc, "compositing_node_group"):                     # Blender 5.x
            ng = bpy.data.node_groups.new("合成", "CompositorNodeTree")
            ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
            rl = ng.nodes.new("CompositorNodeRLayers")
            g = ng.nodes.new("CompositorNodeGlare")
            go = ng.nodes.new("NodeGroupOutput")
            g.inputs["Type"].default_value = "Bloom"
            g.inputs["Threshold"].default_value = threshold
            g.inputs["Strength"].default_value = strength
            g.inputs["Size"].default_value = 0.7
            ng.links.new(rl.outputs["Image"], g.inputs["Image"])
            ng.links.new(g.outputs["Image"], go.inputs[0])
            sc.compositing_node_group = ng
        else:                                                          # Blender 4.x
            sc.use_nodes = True
            nt = sc.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            rl = nt.nodes.new("CompositorNodeRLayers")
            g = nt.nodes.new("CompositorNodeGlare")
            comp = nt.nodes.new("CompositorNodeComposite")
            if not sset(g, "glare_type", "BLOOM"):
                g.glare_type = "FOG_GLOW"
            sset(g, "threshold", threshold)
            sset(g, "size", 7)
            sset(g, "mix", -0.4)
            nt.links.new(rl.outputs["Image"], g.inputs["Image"])
            nt.links.new(g.outputs["Image"], comp.inputs["Image"])
    except Exception as ex:  # noqa: BLE001
        print("[教程] 辉光未启用:", ex)


def setup_render(sc, args, name, frames, res=(1080, 1920), samples=64):
    r = sc.render
    r.resolution_x, r.resolution_y = res
    r.resolution_percentage = 50 if args["preview"] else 100
    r.fps = 30
    sc.frame_start, sc.frame_end = 1, frames
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if sset(r, "engine", eng):
            break
    ee = sc.eevee
    sset(ee, "taa_render_samples", 16 if args["preview"] else samples)
    sset(ee, "use_raytracing", True)
    sset(ee, "use_shadows", True)
    sset(r, "use_motion_blur", True)
    sset(ee, "use_motion_blur", True)
    vs = sc.view_settings
    sset(vs, "view_transform", "AgX")
    for look in ("AgX - Punchy", "Punchy"):
        if sset(vs, "look", look):
            break
    setup_glare(sc)
    d = out_dir(args, name)
    im = r.image_settings
    sset(im, "media_type", "VIDEO")
    im.file_format = "FFMPEG"
    r.ffmpeg.format = "MPEG4"
    r.ffmpeg.codec = "H264"
    sset(r.ffmpeg, "constant_rate_factor", "HIGH")
    r.ffmpeg.audio_codec = "NONE"
    r.use_file_extension = False
    fname = name + ("_preview" if args["preview"] else "")
    if args["frames"]:
        sc.frame_start, sc.frame_end = args["frames"]
        fname += "_%d-%d" % args["frames"]
    r.filepath = os.path.join(d, fname + ".mp4")
    return d


def finish(sc, args, d, name):
    """保存 .blend，然后按参数渲染单帧或整段。"""
    sc.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(d, name + ".blend"))
    print("[教程] 场景已保存:", os.path.join(d, name + ".blend"))
    if args["still"]:
        sset(sc.render.image_settings, "media_type", "IMAGE")
        sc.render.image_settings.file_format = "PNG"
        sc.render.use_file_extension = True
        for f in args["still"]:
            sc.frame_set(f)
            sc.render.filepath = os.path.join(d, "still_%04d" % f)
            bpy.ops.render.render(write_still=True)
            print("[教程] 单帧:", sc.render.filepath + ".png")
    elif args["render"]:
        bpy.ops.render.render(animation=True)
        print("[教程] 完成:", sc.render.filepath)
    else:
        print("[教程] 只建了场景；加 --render 渲染整段，或 --still 60 渲染单帧。")
