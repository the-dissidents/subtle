# subtle

正在开发中的跨平台字幕编辑器。

## 快捷键说明

注意：
- *表示功能尚未实现
- 在Mac上，Ctrl即Command，Alt即Option
- 正在编辑框中输入的时候，若快捷键和编辑冲突，可以尝试同时按Alt（Option）；如Alt+上下方向键可实现上下切换字幕

|||
|--:|:--|
|——| **通用** |
| Ctrl+S | 保存 |
| Ctrl+Z | 撤销 |
|——| **编辑框** |
| Tab  | 向下切换同一条字幕中的条目 |
| Shift+Tab |  向上切换同一条字幕中的条目|
| Enter  | 下一条字幕 |
| Shift+Enter | 换行 |
| Ctrl+Enter | 在后面插入新一条字幕 |
| Esc | 退出编辑，聚焦到字幕列表 |
|——| **字幕列表和时间线** |
| 上下方向键 | 上下切换字幕 |
| Ctrl+方向键 | 移动行 |
| Del / Ctrl+Backspace | 删除行 |
| (Shift/Ctrl)+点击 | 连选、多选 |
| Enter / 双击 | 聚焦到编辑框，并且定位到起始时间 |
| Ctrl+C | 复制 |
| Ctrl+X | 剪切 |
| Ctrl+V | 粘贴到选中项之前 |
|——| **视频播放** |
| 空格 | 播放 / 暂停 |
| 左右方向键 | 前进1秒 / 后退1秒 |
| Ctrl+左右方向键 | 微调时间1帧 |
| I/O | 设置入点/出点 |
| P | 播放当前选中字幕块 |
|——| **时间线** |
| 鼠标滚轮 | 视图移动 |
| 鼠标左键/拖动 | 选择、移动、调整头尾、缩放 |
| 鼠标中键拖动 | 视图缩放 |
| *鼠标右键拖动 | 创建字幕条 |
| 按住Alt | 禁用吸附 |
| 按住Ctrl | 多选 |
|——|**模糊匹配校对工具**|
| Z / X | 移动选中区域左端点 |
| C / V | 移动选中区域右端点 |
| A | 将选中区域提交到编辑框 |

## 已知问题

跨平台是理论上的；我只有一台苹果电脑可以用来工作。目前还没人提供Windows电脑来尝试编译。

媒体播放功能还不是很完善。由于Webkit引擎还不支持AudioCodecs，我们在Rust后端用ffmpeg库实现了媒体解析和渲染工作；目前大致可以运行，但还不是很稳定。

- 播放偶尔卡顿，在速率稳定性上也略不理想
- 波形显示比较暴力，尚待优化
- 刚从暂停转到播放时，播放速率不稳定；还有一些别的buffering毛病
- 视频定位功能不是很完善，经常出现解码错误（因为没有科学地考虑关键帧布局和时间戳非单调增的帧存储顺序）

此外：
- 导入格式不太标准的文件可能失败，或者得到空白文档
- 在Mac上按Option+空格播放/暂停视频时，可能会附带输入一个全角空格？
- 我有在尝试复刻libass的渲染算法（包括它做错的地方！），但是字幕定位常常还是不能和主流播放器一致；所以，在导出之后最好要用别的软件检查一遍，有没有出现本该在下面的样式跑到上面去或者类似的布局问题
- 可能有很多隐藏的bug，所以多多保存

不是bug：
- 这不是一个专门编辑ASS或者什么格式的字幕软件，所以你会发现一些ASS功能在这里不支持，而ASS也不支持这里的一些功能（凭心而论，ASS本来也是一个非常糟糕的格式！）

## 细节

### bug tracker
- ‼️ 向右边外面框选，导致选择失效；向左边没问题
- 时间线里最好抬起鼠标的时候再选中片段，这样可以拖动已选中的东西被遮挡的边缘
- 加一下above/below/all的查找替换
- 加一下在选择范围内选指定格式
- combine之后出现重复的字幕行（忘了具体reproduce方法）
- 在已经打开视频的情况下，再打开一个含有视频记忆的最近文件，导致assertion error

### 有待实现
- UI状态记忆
  - 上次打开文档；滚动位置
- UI重制
  - 已基本完成！
  - Tooltip遮盖问题
- 编辑体验
  - 在目前选择范围内只选择某样式
  - 选择以上，选择以下
  - 时间轴上拉字幕块；播放时拍打
- 写一个更好的时间轴
  - ‼️ 波形显示使用动态分辨率
  - ❓是否应当直接改成基于轨道/layer，而不是将样式作为轨道
    - 需要做一个权衡；如果像arctime那样完全依赖轨道化时间轴，表格显示就没有意义了，而那可能显著降低效率
  - 在时间轴上不仅显示波形，还显示关键帧（镜头切换？）
  - 吸附到（关键）帧
  - 时间轴上允许拖动来改变样式
- 媒体播放
  - 变速
- 工具和杂项
  - 无时间文本池
    - H-S工具（模糊比对并校正）：基本实现；需要改进算法
	- 戈达尔工具？
	- 克拉默工具？
  - OCR工具
  - Whisper工具

## 如何构建

### macOS

1. 确保能连接外网
2. `git clone`
3. `npm install`
4. `cargo build`
5. `cargo tauri build --target universal-apple-darwin`
6. `./mac-repack-test.sh`

### Windows

相当困难。编译过程中需要在本地构建ffmpeg以便静态链接，这件事必须在支持shell脚本的环境下进行，比如MSYS2。

1. 确保能连接外网。而且要确保在PowerShell里和MSYS2的终端里都可以。
2. 安装**MSYS2**。使用其中的pacman安装以下工具：clang, gcc toolchain, yasm, diffutils，记得选择统一的平台：`mingw64/mingw-w64-x86_64-*`
3. 把clang的地址导出为环境变量LIBCLANG_PATH，否则一些工具可能找不着它
4. 在**MSYS2**下使用rustup安装cargo。一定要把host triple改成`x86_64-pc-windows-gnu`
5. 把MSYS2的可执行文件路径（例如`C:/msys2/usr/bin`）加到 Windows的PATH里面
6. 用官方MSI安装Node.js。最好**不要使用**winget和fnm！**不要在MSYS2里面**安装Node.js！
7. 如果没安装的话，用VS Code安装git
8. `git clone`
9. `npm install`
10. `cargo build`
11. `cargo tauri build`

## 联系

微信 / 豆瓣 emfrosztovis

若想参加试用可联系我们加内测微信群。

邮箱（不太看） emfrosztovis@gmail.com