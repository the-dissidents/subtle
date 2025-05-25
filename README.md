# subtle

<img width="1305" alt="screenshot" src="https://github.com/user-attachments/assets/9b3a1256-9311-40a6-be75-4815bdba997f" />

正在开发中的跨平台字幕编辑器。

## 功能

- [x] 同时支持Mac和Windows，理论上也支持Linux系统
- [x] 导入和导出SRT、ASS格式字幕
- [x] 方便的多语言字幕创作
  - [ ] 快速查字典（待实现）
  - [ ] 机器翻译（待实现）
- [x] 可编辑字幕样式
- [x] 视频预览和波形显示
- [x] 基于时间线的字幕编辑
  - [x] Arctime式拍打和切分功能
  - [x] 选区整体拖动和缩放
- [x] 字幕表格、时间线、视频预览皆可缩放
- [x] 高级搜索功能
- [x] 自定义验证条件（例如用来检查是否适配字幕机）
- [x] 自定义快捷键键位
- [x] 文档自动保存
- [x] 可基于模糊匹配来根据稿本校对字幕

## 局限

- 暂不支持ASS字幕行内格式的编辑。
- 暂不支持解析SUP/SUB等图形字幕格式。
- 视频播放可能比较卡顿，特别是在某些平台上可能需要几秒钟来完成定位操作。
- 我们计划在发布1.0版本之后再陆续引入自动打轴、语音识别、OCR图形字幕等AI功能；1.0之前，我们致力于将基本功能打磨到完美。

此外
- 导入格式不太标准的文件可能失败
- 在Mac上按Option+空格播放/暂停视频时，可能会附带输入一个全角空格？
- 我们尝试复刻来libass的渲染算法，但是字幕定位偶尔还是不能和主流播放器一致；在导出之后最好要用别的软件检查一遍，有没有出现布局问题
- 可能存在更多隐藏的bug

不是bug：
- 这不是一个专门编辑ASS或者什么格式的字幕软件，所以你会发现一些ASS功能在这里不支持，而ASS也不支持这里的一些功能（凭心而论，ASS本来也是一个非常糟糕的格式！）

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
