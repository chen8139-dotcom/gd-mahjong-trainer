# 牌面素材说明

`m1.png`…`m9.png`、`p1.png`…`p9.png`、`s1.png`…`s9.png`、`z1.png`…`z7.png` 共 34 张雀魂风牌面，
裁自开源项目 [sdtafxy/majsoul-helper](https://github.com/sdtafxy/majsoul-helper)（MIT License）
随附的 `Resources/ui.png` 精灵图集（帧坐标由 `Resources/ui.atlas` 给出）。

- 原始 sprite 尺寸 80×129（含 3D 牌体与圆角，透明留边），UI 按 80:129 比例缩放显示；
- 图集每张右上角自带的标注编号（数字/字母）已抹除（连通域检测 + 邻域取色逐行填补）；
- 字牌映射：本仓 `z5=發`、`z6=中`、`z7=白`，图集 `5z=白`、`6z=發`、`7z=中`，已换位对应。

版权说明：图集素材取自《雀魂 MahjongSoul》游戏 UI，版权归雀魂官方所有，
此处仅作学习用途展示，随本项目以 MIT 协议分发时一并遵循 majsoul-helper 的来源声明。
