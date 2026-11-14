# iphone-agent：用 ESP32 像人一样操作 iPhone

ESP32-S3 冒充蓝牙鼠标和键盘，iPhone 打开「辅助触控」后就能被它点击、滑动、打字。
**电脑端**（`iphone_agent/`）：从 Mac 上看 iPhone 屏幕 → 让 Claude 决定下一步 → 通过串口让 ESP32 去点。
**固件**（`firmware/`）：ESP32-S3 上跑的程序，实现下文的串口协议 v0.2。
不越狱、不装 App、不改 iPhone 系统。

## 现在能做什么

| 命令 | 作用 | 需要硬件 |
| --- | --- | --- |
| `python -m iphone_agent demo` | 在内置模拟器上跑完整的校准和「10 点验收」 | 不需要 |
| `python -m iphone_agent shot` | 保存一张截到的 iPhone 画面，检查裁剪对不对 | Mac + iPhone |
| `python -m iphone_agent ports` | 列出串口，找到 ESP32 | ESP32 |
| `python -m iphone_agent calibrate --port P` | 找到指针、测出「鼠标单位 ↔ 屏幕像素」比例，存到 `~/.iphone-agent-calibration.json` | 全部 |
| `python -m iphone_agent accuracy --port P` | **验收 1**：随机 10 个点，报告最大误差，PASS/FAIL | 全部 |
| `python -m iphone_agent tap X Y --port P` | 点截图里的 (X, Y) | 全部 |
| `python -m iphone_agent run "打开设置，进入蓝牙" --port P` | 让 Claude 完成一个任务，**每一步都先问你**（加 `--yes` 不问） | 全部 + API key |
| `python -m iphone_agent scroll --port P` | **刷视频**：每 8 秒上滑一条（`--interval` 改秒数，`--count` 刷几条，`--like-every 3` 每 3 条双击点赞），Ctrl+C 停 | 全部，不需要 API key |

## 烧录固件

需要一块 **ESP32-S3** 开发板（淘宝搜「ESP32-S3 开发板 N16R8」，二三十元），用板子上标着 **USB**（不是 COM/UART）的那个 Type-C 口接电脑：烧录和后面的串口通信都走这个口。

- **最省事**：在 GitHub 仓库的 Actions → iphone-agent → 最近一次成功的运行里下载 `iphone-agent-firmware`，解压得到 `firmware-merged.bin`。用 Chrome 打开乐鑫的网页烧录工具 ESP Launchpad 或 esptool-js，连上板子，把这个文件烧到地址 `0x0`。
- **自己编译**：`pip install platformio`，然后在 `firmware/` 里 `pio run -t upload`。端口不出现时，按住板子上的 BOOT 键再插线。

烧好后 iPhone 蓝牙里会出现「iPhone Agent」，点它配对（不用输配对码）。`firmware/test_host/` 里是不需要板子的逻辑测试（按键码、移动拆分）。

## 第一次使用

1. **装依赖**：`pip install -r requirements.txt`
2. **iPhone**：设置 → 辅助功能 → 触控 → 辅助触控，打开；然后在蓝牙里配对 ESP32。
3. **看屏幕**：iPhone 用**能传数据**的线接 Mac，「信任此电脑」，打开 QuickTime Player → 文件 → 新建影片录制，点录制按钮旁的小箭头选 iPhone。窗口开着就行，不用按录制。
   - 第一次截图时 macOS 会要权限：系统设置 → 隐私与安全性 → 屏幕录制，勾上终端。
   - **不要用「iPhone 镜像」**：它要求手机锁屏，手机一被操作就断开，和 ESP32 点击不能同时用。
4. `python -m iphone_agent shot` 看看 `shot.png`：应该只有手机画面。如果顶上带了窗口标题栏，加 `--crop 28,0,0,0`（上、右、下、左各裁多少像素）。
5. `python -m iphone_agent ports` 找到 ESP32 的串口（Mac 上一般是 `/dev/cu.usbmodem...`）。
6. `python -m iphone_agent calibrate --port /dev/cu.usbmodemXXXX`
7. `python -m iphone_agent accuracy --port /dev/cu.usbmodemXXXX` → 看到 `PASS` 就是验收 1 通过。
8. 先在目标 App 上 `shot` 一次，确认 QuickTime 预览不是黑屏（部分 App 禁止录屏）。
9. `export ANTHROPIC_API_KEY=...`，然后 `python -m iphone_agent run "打开设置，找到蓝牙" --port ...`

## 它怎么做到「点得准」

iOS 的蓝牙鼠标**只有相对移动、还带加速**，所以不能靠算坐标一次点中。每次点击前都是闭环：

1. **找指针**：把指针往右推一下再拉回来，对比前后两张截图，唯一变化的就是指针；圆盘的高度不受左右重叠影响，用它判断推得够不够远，不够就加大再试。贴着右边推不动时改往左推。
2. **按比例移过去**：比例是校准时实测的，不是假设的。
3. **再找一次、再修正**，直到误差在 6 像素内（最多 6 轮）。

模拟器故意加了加速、每步随机误差和屏幕边缘，测试在这些条件下仍能收敛（`python -m unittest discover tests`，21 个测试，不需要硬件和 API key）。

## 打中文

蓝牙键盘只能发按键码，**不能直接打中文**。做法：电脑把文字放进 Mac 剪贴板 → 「通用剪贴板」同步到 iPhone → ESP32 发 `Cmd+V` 粘贴。前提：Mac 和 iPhone 登录同一个 Apple ID，并开着「接力」。英文和数字直接用键盘打。

## 安全边界

- `run` 默认每一步都先问你，确认了才动手。
- 给 Claude 的指令里写明：付款、购买、转账、删除账号或数据、改密码或安全设置、发出任务没写明的消息、输入密码或验证码，一律停下报 `fail`，不做。
- 只做本人自己的手机自动化，不做刷量、批量运营（这类 App 容易风控封号）。

## 费用

每一步都会把一张截图发给 Claude（默认 `claude-opus-5-5`，`--effort medium`）。一个十来步的小任务大约几毛到一两块钱人民币，主要花在图片上；`--effort low` 更省、更快。

## 串口协议 v0.2（给固件）

USB 串口 115200 8N1，一行一条 JSON。在 Grok 的 v0.1 上改了三处，见 `iphone_agent/protocol.py`：

| 指令 | 说明 |
| --- | --- |
| `{"id":1,"op":"reset"}` | 把指针推到左上角 |
| `{"id":2,"op":"move","dx":120,"dy":-40}` | **相对移动**（鼠标单位）。固件拆成固定小步长匀速发送。**v0.1 的绝对坐标 `x,y` 改为相对 `dx,dy`**：坐标换算和闭环修正都在电脑端做，因为只有电脑看得到屏幕 |
| `{"id":3,"op":"click"}` | 左键单击 |
| `{"id":4,"op":"down"}` / `{"id":5,"op":"up"}` | **新增**：按住 / 松开，用来拖动和滑动（代替 v0.1 的 `swipe`） |
| `{"id":6,"op":"type","text":"hello"}` | 只发 ASCII |
| `{"id":7,"op":"key","code":"v","mods":["cmd"]}` | **新增 `mods`**：`cmd` `ctrl` `alt` `shift`，用于 Cmd+V 粘贴中文、Cmd+H 回主屏 |

回复：`{"id":2,"ok":true}` 或 `{"id":2,"ok":false,"err":"..."}`；连上 / 断开 iPhone 时发 `{"event":"connected"}` / `{"event":"disconnected"}`。开机打印的杂讯会被忽略。

## 还没验证的

这些只能等板子到了在真机上确认：

- iOS 辅助触控指针在 QuickTime 画面里的实际大小和对比度（找指针依赖它）；
- `Cmd+H` 能否在 iPhone 上回主屏，不行就改成点辅助触控菜单里的「主屏幕」；
- 指针加速在不同步长下的实际曲线（闭环能容忍，但影响要几轮修正）；
- 固件只在云端编译过，还没在板子上跑过：配对、iOS 是否接受键鼠合一的设备、步长 8 单位 / 10 ms 是否顺滑；
- 刷视频的上滑大约用 1 秒拖完，抖音等 App 是否认这种慢速拖动为翻页（不认就改成更少、更大的步）。
