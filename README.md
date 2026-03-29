# BlueJourney 蓝旅

> 面向桨板、皮划艇等水上运动爱好者的社交运动应用

## 项目简介

BlueJourney（蓝旅）是一款微信小程序，为水上运动爱好者提供：
- 实时轨迹记录与地图展示
- 运动数据统计（距离、速度、时长）
- 组队功能（实时位置共享）
- 成就系统与社交分享

## 技术栈

- **前端**：微信小程序原生开发 (JavaScript)
- **后端**：微信云开发 (CloudBase)
- **数据库**：云数据库 (MongoDB)
- **地图**：微信原生 map 组件 + 高德地图 API
- **开发工具**：微信开发者工具

## 项目配置

| 配置项 | 值 |
|--------|-----|
| AppID | 在微信公众平台申请 |
| 地图 Key (高德) | 在高德开放平台申请 |
| 云开发环境 | 在微信开发者工具中创建 |

## 目录结构

```
BlueJourney/
├── app.js                    # 应用入口，初始化云开发
├── app.json                  # 应用配置
├── app.wxss                  # 全局样式
├── project.config.json       # 项目配置
├── utils/
│   ├── track.js              # 轨迹折线分段（map polylines）
│   └── track-session.js      # 进行中会话本地持久化（防崩溃丢轨迹）
├── pages/
│   ├── index/               # 首页（地图+轨迹记录）
│   ├── profile/            # 个人中心
│   ├── team/                # 组队大厅
│   ├── activity-list/       # 活动列表
│   └── activity-detail/     # 活动详情
├── cloudfunctions/
│   ├── user/                # 用户云函数
│   └── activity/            # 活动云函数
├── libs/                    # 第三方库（高德地图 SDK）
├── test_data/               # 测试数据
├── scripts/
│   ├── deploy.sh            # 部署脚本
│   └── patched/             # 轨迹优化补丁（见下文「补丁应用」）
└── ...
```

## 功能列表

### 已完成
- ✅ 微信登录 (wx.login)
- ✅ 地图展示与定位
- ✅ 轨迹记录（实时 GPS 采集）
- ✅ 轨迹折线分段绘制、详情页地图视野适配（`includePoints`）
- ✅ 轨迹防丢：本地会话持久化 + 云端增量检查点（结束仍全量保存）
- ✅ 轨迹保存到云数据库（批量写入前清空旧点，避免重复）
- ✅ 轨迹优化（高德 API，用于纠偏距离）
- ✅ 活动列表页（含删除活动，需部署最新 `activity` 云函数）
- ✅ 活动详情页
- ✅ 个人中心（头像、统计）
- ✅ 队伍创建与管理
- ✅ **出发功能 v1.0**：队长创建队伍 → 队员加入 → 全队自动开始轨迹记录
- ✅ 多人轨迹同步：中途加入自动创建活动、已在划行中加入不中断轨迹
- ✅ UI 优化与多 bug 修复
- ✅ CI/CD 自动化部署

### 开发中
- 🚧 二维码邀请加入队伍
- 🚧 成就系统

### 待开发
- ⏳ 轨迹详情页（速度曲线）
- ⏳ 轨迹导出 GPX/KML
- ⏳ 进行中活动恢复
- ⏳ 短信验证码登录

## 开发迭代

| 迭代 | 内容 | 状态 |
|------|------|------|
| 迭代1 | 基础框架（项目结构、云函数、登录） | ✅ |
| 迭代2 | 地图与定位 + UI 完善 | ✅ |
| 迭代3 | 轨迹记录（采集、绘制、保存） | ✅ |
| 迭代4 | 轨迹优化（高德 API）+ 调试修复 | ✅ |
| 迭代5 | 组队出发功能（多人轨迹同步） | ✅ |

## 最近更新 (2026-03-29)

### 出发功能 v1.0 完成
- **队长创建队伍**：队长创建队伍后分享二维码邀请队员加入
- **全队轨迹同步**：队长点击出发后，全队自动开始轨迹记录
- **灵活加入**：中途添加新队员会自动创建活动并开始记录；已在划行中的队员加入队伍不中断当前轨迹
- 修复核心bug：`map` 组件 `polyline` 属性名错误（`polylines` → `polyline`）
- 完善多页面：队伍详情页抽屉默认收起、地图高度适配、解散/离开逻辑、踢出按钮；活动详情页修复抽屉、地图高度、日期格式、统计显示、轨迹显示
- 活动列表页过滤阈值调整：短行程 2km → 200m
- 首页添加活动恢复功能完善

### 历史更新 (2026-03-28)
- **轨迹与云函数优化**：`utils/track.js` 将长轨迹拆成多条 polyline，避免单条点数过多
- **轨迹防丢机制**：进行中划行会话本地持久化；云端增量 `appendTrackPoints`；结束全量覆盖保证数据完整
- 活动详情页修正：速度单位展示、分享路径、地图视野适配
- 云函数 `activity`：分页拉全量、增量检查点失败回滚、删除活动支持

### 已知问题
- 后台/息屏时可能丢点（可评估 `wx.startLocationUpdate` 等持续定位能力）
- 二维码邀请功能弹窗显示正常，待集成真正 QR 库
- 进行中活动恢复（仅检测状态，未从云端恢复轨迹线）

## 补丁应用（首次或合并 `scripts/patched/` 时）

部分环境因文件属主为 root，无法直接在 IDE 里保存 `pages/`、`cloudfunctions/`。在项目根目录执行：

```bash
sudo chown -R "$(whoami)" pages cloudfunctions
cp scripts/patched/pages-index.js pages/index/index.js
cp scripts/patched/pages-activity-detail.js pages/activity-detail/activity-detail.js
cp scripts/patched/activity-detail.wxml pages/activity-detail/activity-detail.wxml
cp scripts/patched/cloudfunctions-activity-index.js cloudfunctions/activity/index.js
```

然后在微信开发者工具中**上传并部署**云函数 `activity`。更完整的说明见 **`scripts/patched/APPLY.md`**。

## 快速开始

1. 下载微信开发者工具
2. 导入项目目录
3. 修改 AppID 为自己的
4. 上传并部署云函数：
   - `cloudfunctions/user`
   - `cloudfunctions/activity`
5. 在云开发控制台创建集合：
   - `users`
   - `activities`
   - `track_points`

## 相关文档

文档已移至 `BlueJourney_docs/` 目录：
- 需求文档
- 开发报告
- UI 设计需求
- 优化报告

## CI/CD 自动化部署

### 环境准备

**1. 安装依赖**
```bash
npm install miniprogram-ci sharp --save-dev
```

**2. 配置私钥**
- 登录 https://mp.weixin.qq.com/
- 进入「设置」→「开发设置」→「开发代码密钥」
- 下载私钥文件，重命名为 `private.key` 放到项目根目录
- **注意**：私钥文件已加入 .gitignore，不要提交到 Git

**3. 添加 IP 白名单**
- 在微信公众平台添加部署服务器的 IP
- 否则会报错：`invalid ip (error 20003)`

### 部署命令

**生成小程序预览二维码**
```bash
npx miniprogram-ci preview \
  --pp . \
  --pkp ./private.key \
  --appid <你的AppID> \
  --qrcode-format image \
  --qrcode-output-dest ./preview.png \
  --upload-version 1.0.0
```

**上传代码到微信后台**
```bash
npx miniprogram-ci upload \
  --pp . \
  --pkp ./private.key \
  --appid <你的AppID> \
  --upload-version 1.0.0 \
  --upload-desc "自动部署"
```

### 使用脚本部署
```bash
bash scripts/deploy.sh
```

### 注意事项

- 预览二维码有效期 7 天
- 正式发布仍需在微信后台审核
- 私钥文件必须加入 .gitignore

---

**最后更新**：2026-03-29（出发功能 v1.0 完成）
**维护人**：星期五 (Friday)
