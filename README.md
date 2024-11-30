# subtle

正在开发中的跨平台字幕编辑器。

## 快捷键说明

注意：
- *表示功能尚未实现
- 在Mac上，Ctrl即Command，Alt即Option
- 正在编辑框中输入的时候，若快捷键和编辑冲突，可以尝试同时按Alt/Option；如Option+上下方向键可实现上下切换字幕

|||
|--:|:--|
|——| **通用** |
| Ctrl+S | 保存 |
| Ctrl+F | 打开查找替换窗口 |
|——| **编辑框** |
| Tab  | 向下切换同一条字幕中的条目 |
| Shift+Tab |  向上切换同一条字幕中的条目|
| Enter  | 下一条字幕 |
| Alt+方向键  | 上下切换字幕 |
| Alt+空格  | 播放/暂停视频 |
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

媒体播放功能还不是很完善。由于Webkit引擎还不支持AudioCodecs，我们计划在Rust后端实现媒体解析和渲染工作，目前只完成了音频波形的部分。

- 某些视频可能无法正常播放
- 拖动进度条可能导致视频播放紊乱，无法暂停。请重新打开视频
	- *以上也是Safari和Webkit引擎的问题*
- 目前，音视频播放只支持浏览器所支持的视频格式（MP4, WebM），不支持MKV等格式，需要事先转码；但大部分文件的波形可以显示

其他bug：
- 导入格式不太标准或者编码异常的文件会得到空白文档
- 对ASS文件导入解析还很草率，容易出错
- 在Mac上按Option+空格播放/暂停视频时，可能会附带输入一个全角空格。。
- 可能有很多隐藏的bug，所以多多保存