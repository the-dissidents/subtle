# subtle

正在开发中的跨平台字幕编辑器。

## 快捷键说明

注意：
- *表示功能尚未实现
- Ctrl即Mac上的Command，Alt即Option

|| **通用** |
|--:|:--|
| Ctrl+S | 保存 |
| Ctrl+F | 打开查找替换窗口 |
|| **编辑框** |
| Tab  | 向下切换同一条字幕中的条目 |
| Shift+Tab |  向上切换同一条字幕中的条目|
| Enter  | 下一条字幕 |
| Alt+方向键  | 上下切换字幕 |
| Alt+空格  | 播放/暂停视频 |
| Shift+Enter | 换行 |
| Ctrl+Enter | 在后面插入新一条字幕 |
|  | **字幕列表和时间线** |
| 上下方向键 | 上下切换字幕 |
| Ctrl+方向键 | 移动行 |
| Del / Ctrl+Backspace | 删除行 |
| (Shift/Ctrl)+点击 | 连选、多选 |
| Enter / 双击 | 聚焦到编辑框，并且定位到起始时间 |
| Ctrl+C | 复制 |
| Ctrl+X | 剪切 |
| Ctrl+V | 粘贴到选中项之前 |
| 空格 | 播放 / 暂停视频 |
| 左右方向键 | 前进1秒 / 后退1秒 |
|  | **时间线** |
| 鼠标滚轮 | 视图移动 |
| 鼠标左键/拖动 | 选择、移动、调整头尾、缩放 |
| 鼠标中键拖动 | 视图缩放 |
| *鼠标右键拖动 | 创建字幕条 |
| 按住Alt | 禁用吸附 |
| 按住Ctrl | 多选 |
| *Alt+左右方向键 | 微调时间1帧 |

## 已知问题

- 音频波形显示非常之不准确（因为Webkit还没有实现AudioCodec）
- 在Mac上，某些高码率视频无法正常播放
- 在Mac上，拖动进度条可能导致视频播放紊乱，无法暂停；请重新打开视频
	- *以上是Safari和Webkit引擎的问题，并不是我的问题……*
- 只支持浏览器所支持的视频格式（MP4, WebM），不支持MKV等格式，需要事先转码
- 导入格式不太标准或者编码异常的文件会得到空白文档
- 对ASS文件导入解析还很草率，容易出错
- 在Mac上按Option+空格播放/暂停视频时，可能会附带输入一个全角空格。。
- 可能有很多隐藏的bug，所以多多保存