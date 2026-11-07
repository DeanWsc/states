# 机械臂造车 · Blender 自动渲染

`jixiebi_zaoche_blender.py` 一行命令自动建场景、按六段运镜渲染出竖屏 MP4（1080×1920、30fps、24.5 秒、无声）。不需要在 Blender 里手动操作。

## 用法

1. 安装 Blender 4.2 或更新版本（官网免费下载）。
2. 先跑预览版（540×960、低采样），检查运镜和构图：

   ```
   # macOS
   /Applications/Blender.app/Contents/MacOS/Blender -b -P jixiebi_zaoche_blender.py -- --render --preview
   # Windows（换成你电脑上 blender.exe 的路径）
   "C:\Program Files\Blender Foundation\Blender 4.2\blender.exe" -b -P jixiebi_zaoche_blender.py -- --render --preview
   ```

3. 预览没问题，去掉 `--preview` 再跑一遍就是正式版。想要更真实的质感加 `--cycles`（慢很多）。

成片和场景文件 `jixiebi_zaoche.blend` 在 **桌面/jixiebi_render** 文件夹里（可用 `--out 目录` 改位置）。

| 参数 | 作用 |
|---|---|
| `--render` | 建完场景后渲染整段动画（不加只建场景、保存 .blend） |
| `--preview` | 预览版：半分辨率、低采样 |
| `--cycles` | 用 Cycles 渲染（默认 EEVEE） |
| `--still 120,300,700` | 只渲染这几帧为 PNG，最快的检查方式 |
| `--frames 600-735` | 只渲染一段 |
| `--out 目录` | 输出目录 |
| `--font 字体文件` | 指定中文标题字体 |

## 运镜

| 镜头 | 时间 | 画面 | 装配模块 |
|---|---|---|---|
| 1 | 0.0–3.5s | 高空环绕，全息蓝图扫描出现 | — |
| 2 | 3.5–8.0s | 前侧推近 | 底盘、前轮 |
| 3 | 8.0–11.0s | 低机位贴地跟拍后轮 | 后轮、发动机 |
| 4 | 11.0–15.7s | 右侧环绕 | 车头、右侧车身、左侧车身 |
| 5 | 15.7–20.7s | 高位后侧 | 座舱、发动机盖、车尾、尾翼 |
| 6 | 20.7–24.5s | 低机位正面英雄镜头 | 车灯 → 点灯 → 标题 |

每个零件先在料台上以全息形态出现，机械臂（解析 IK 驱动）吸起、搬运、对位落下，落位时焊接火花 + 闪光 + 真实点光源，然后从全息变成实体。带景深、运动模糊、顶灯体积光、辉光。

## 调整

脚本开头几个参数：

- `LIGHT_SCALE`：画面偏暗调大（如 1.5），偏亮调小（如 0.7）
- `PAINT`：车漆颜色（线性 RGB），默认深红
- `HOLO` / `HOLO_STRENGTH`：全息颜色和亮度
- `VOLUME_DENSITY`：顶灯光束浓度，0 关闭
- `TITLE_CN` / `TITLE_EN` / `SUBTITLE`：标题文字。中文标题会自动找系统字体（苹方、黑体、微软雅黑、Noto CJK…），找不到就用英文

## 渲染时间参考

EEVEE 预览版在有独显的电脑上通常几分钟到十几分钟；正式版（96 采样、运动模糊）每帧几秒，整段大约半小时到一小时。Cycles 会更久，会自动尝试用 GPU（OptiX / CUDA / HIP / Metal / oneAPI）。
