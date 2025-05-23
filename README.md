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

最近重写了媒体播放功能，目标是把音视频之间的延迟减少到20ms以内，但是可能会出现一些问题。

此外：
- 导入格式不太标准的文件可能失败，或者得到空白文档
- 在Mac上按Option+空格播放/暂停视频时，可能会附带输入一个全角空格？
- 我有在尝试复刻libass的渲染算法（包括它做错的地方！），但是字幕定位常常还是不能和主流播放器一致；所以，在导出之后最好要用别的软件检查一遍，有没有出现本该在下面的样式跑到上面去或者类似的布局问题
- 可能有很多隐藏的bug，所以多多保存

不是bug：
- 这不是一个专门编辑ASS或者什么格式的字幕软件，所以你会发现一些ASS功能在这里不支持，而ASS也不支持这里的一些功能（凭心而论，ASS本来也是一个非常糟糕的格式！）

## 细节（待转换为issues）

### bug tracker
- ‼️ 向右边外面框选，导致选择失效；向左边没问题
- 时间线里最好抬起鼠标的时候再选中片段，这样可以拖动已选中的东西被遮挡的边缘
- 加一下above/below/all的查找替换
- 加一下在选择范围内选指定格式

### 有待实现
- 编辑体验
  - 在目前选择范围内只选择某样式
  - 选择以上，选择以下
  - 时间轴上拉字幕块；播放时拍打
- 写一个更好的时间轴
  - ❓是否应当直接改成基于轨道/layer，而不是将样式作为轨道
    - 需要做一个权衡；如果像arctime那样完全依赖轨道化时间轴，表格显示就没有意义了，而那可能显著降低效率
  - 时间轴上允许拖动来改变样式
- 媒体播放
  - 变速

## 如何构建

### macOS

1. 确保能连接外网，并且已安装`git`，`npm`，`cargo`，以及`dylibbundler`或`homebrew`
2. `git clone`
3. `npm install`
4. `cargo install tauri-cli --version "^2.0.0" --locked`（只需要第一次，后续构建不需要）
5. `cargo tauri build --target universal-apple-darwin`
6. `./mac-repack-test.sh`

### Windows

#### 使用GNU工具链

在Cargo.toml里启用**我们改过的**ffmpeg-sys-next（也许别的也能用，但不保证）：
```
[patch.crates-io]
ffmpeg-sys-next = { git = "https://github.com/the-dissidents/rust-ffmpeg-sys.git", branch = "master" }
```

注意编译过程中需要在本地构建ffmpeg以便静态链接，这件事必须在支持shell脚本的环境下进行，比如MSYS2。

1. 确保能连接外网。
2. 安装**MSYS2**。使用其中的pacman安装以下工具：clang, gcc toolchain, yasm, diffutils，记得选择统一的平台：`mingw64/mingw-w64-x86_64-*`
3. 把clang的地址导出为环境变量LIBCLANG_PATH，否则一些工具可能找不着它
4. 在**MSYS2**下使用rustup安装cargo。把host triple改成`x86_64-pc-windows-gnu`
5. 把MSYS2的可执行文件路径（例如`C:/msys2/usr/bin`）加到Windows的PATH里面
6. 用官方MSI安装Node.js。**不要在MSYS2里面**安装Node.js，否则无法正常运行vite！
7. 如果没安装的话，用VS Code安装git
8. `git clone`
9. `npm install`
10. `cargo install tauri-cli --version "^2.0.0" --locked`（只需要第一次，后续构建不需要）
11. `cargo tauri build`

#### 使用MSVC工具链

在Cargo.toml里启用**我们改过的**ffmpeg-sys-next，但基于官方新版：
```
[patch.crates-io]
ffmpeg-sys-next = { git = "https://github.com/the-dissidents/rust-ffmpeg-sys.git", branch = "official" }
```

- 确保能连接外网。
- 直接在Windows环境下用rustup安装cargo，使用默认的host triple；同时安装Visual Studio
- 安装Windows版NASM，记得加进PATH
- 下载Windows版clang/LLVM（例如`clang+llvm-20.1.3-x86_64-pc-windows-msvc.tar.xz`），设置好LIBCLANG_PATH
- 还是要安装**MSYS2**。`pacman -Syu`，`pacman -S make`
- 把MSYS2的可执行文件路径（例如`C:/msys2/usr/bin`）加到Windows的PATH里面
- 仍然是用官方MSI安装Node.js
- 使用Visual Studio环境（例如`x64 Native Tools Command Prompt for VS 2022`）进行构建。
- 注意，这种情况下编译ffmpeg可能花费非常长的时间
- 还要注意，这种情况下rust-analyzer有可能因为没有Visual Studio环境而失败。为了让它正常工作，需要在它的配置里面加入关于msvc-cargo-wrapper.bat（这是我随便写的一个东西，你可能需要按照自己情况改一下）的几段。


## 联系

微信 / 豆瓣 emfrosztovis

若想参加试用可联系我们加内测微信群。

邮箱（不太看） emfrosztovis@gmail.com