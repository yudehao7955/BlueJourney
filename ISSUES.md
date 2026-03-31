# 开发进度与待办事项

## 当前版本
v1.3.0 (2026-03-31)

## 已完成功能
- ✅ 单人轨迹记录与实时绘制
- ✅ 活动列表/详情页  
- ✅ 队伍系统（创建队伍、邀请加入）
- ✅ 出发功能 v1.0（队长点击出发，全队自动记录）
- ✅ 多人轨迹同步显示
- ✅ 点击队员定位
- ✅ 首页活动状态恢复完善（检测到活动结束时正确清理本地状态）
- ✅ 队长首页快捷操作（队伍出发/结束滑行按钮）
- ✅ 开发调试模块（内嵌日志面板、一键复制、清理）
- ✅ 二维码邀请框架（依赖 qrcodejs 已安装）
- ✅ **首页代码优化**（数据一致性、性能、错误处理、可维护性全面提升）

## 待完成/进行中功能
- 🔄 二维码邀请功能 - 进行中（需要集成真正的 QR 码生成库）

## 待完成/进行中功能
- 🔄 二维码邀请功能 - 进行中（需要集成真正的 QR 码生成库）

## 待优化
- [ ] 速度分级着色
- [ ] GPX/KML 导出
- [ ] 轨迹优化算法
- [ ] 登录功能优化（短信验证/手机号快捷登录，需要配置）

## 数据库设计

### teams 集合
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| teamName | string | 队伍名称 |
| creatorOpenid | string | 队长 openid |
| creatorNickname | string | 队长昵称 |
| maxMembers | number | 最大人数 |
| status | number | 状态(1-等待出发, 2-行进中, 3-已结束) |
| startTime | date | 出发时间 |
| endTime | date | 结束时间 |
| members | array | 队员数组 |
| memberCount | number | 当前人数 |

### activities 集合
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| openid | string | 用户 openid |
| userId | string | 用户 ID |
| title | string | 活动标题 |
| status | number | 状态(1-进行中, 2-已结束) |
| teamId | string | 关联队伍 ID |
| isTeamActivity | boolean | 是否队伍活动 |
| totalDistance | number | 总距离(米) |
| duration | number | 持续时长(秒) |

### track_points 集合
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| activityId | string | 活动 ID |
| openid | string | 用户 openid |
| latitude | number | 纬度 |
| longitude | number | 经度 |
| speed | number | 速度 |
| timestamp | date | 时间戳 |

### users 集合
| 字段 | 类型 | 说明 |
|------|------|------|
| _id | string | 自动生成 |
| openid | string | 微信 openid |
| nickname | string | 用户昵称 |
| avatarUrl | string | 头像 URL |
| createTime | date | 创建时间 |
| lastLoginTime | date | 上次登录时间 |

---

## 技术配置
- 微信 AppID: wx37a8561526342593
- 腾讯地图 Key: G7KBZ-VLFCA-ZUFK2-CHSJA-XLK4F-YLFPY
- 云开发环境: cloudbase-6gfuik0s0ed9c8df