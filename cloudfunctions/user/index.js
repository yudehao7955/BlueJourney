// cloudfunctions/user/index.js
const cloud = require('wx-server-sdk')

cloud.init()

const db = cloud.database()

// 用户云函数入口
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const action = event.action



  try {
    switch (action) {
      // 微信登录（使用 code 获取 openid）
      case 'login':
        return await login(wxContext.OPENID, event.code)

      // 获取用户信息
      case 'getUserInfo':
        return await getUserInfo(wxContext.OPENID)

      // 更新用户信息
      case 'updateUserInfo':
        return await updateUserInfo(wxContext.OPENID, event.data)

      // 获取用户统计
      case 'getUserStats':
        return await getUserStats(wxContext.OPENID)

      // 获取用户成就
      case 'getAchievements':
        return await getUserAchievements(wxContext.OPENID)

      // 获取手机号
      case 'getPhoneNumber':
        return await getPhoneNumber(wxContext.OPENID, event.encryptedData, event.iv)

      default:
        return { success: false, error: '未知操作' }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 微信登录
async function login(openid, code) {
  try {
    // 检查用户是否存在
    const user = await db.collection('users').where({
      openid: openid
    }).get()

    if (user.data && user.data.length > 0) {
      // 用户已存在，更新上次登录时间
      await db.collection('users').doc(user.data[0]._id).update({
        data: {
          lastLoginTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      })
      // 返回用户信息
      return {
        success: true,
        openid: openid,
        nickname: user.data[0].nickname || '',
        avatarUrl: user.data[0].avatarUrl || '',
        isNew: false
      }
    } else {
      // 新用户，创建用户记录
      const newUser = {
        openid: openid,
        nickname: '',
        avatarUrl: '',
        bio: '',
        sportType: 1,
        waterType: 5,
        privacyLevel: 1,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }

      await db.collection('users').add({
        data: newUser
      })

      return {
        success: true,
        openid: openid,
        nickname: '',
        avatarUrl: '',
        isNew: true
      }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取用户信息
async function getUserInfo(openid) {
  try {
    const user = await db.collection('users').where({
      openid: openid
    }).get()

    if (user.data && user.data.length > 0) {
      return {
        success: true,
        userInfo: user.data[0]
      }
    } else {
      // 用户不存在，创建新用户
      const newUser = {
        openid: openid,
        nickname: '',
        avatarUrl: '',
        bio: '',
        sportType: 1,  // 默认桨板
        waterType: 5,  // 默认未公开
        privacyLevel: 1,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }

      await db.collection('users').add({
        data: newUser
      })

      return {
        success: true,
        userInfo: newUser
      }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 更新用户信息
async function updateUserInfo(openid, data) {
  try {
    const user = await db.collection('users').where({
      openid: openid
    }).get()

    if (user.data && user.data.length > 0) {
      await db.collection('users').doc(user.data[0]._id).update({
        data: {
          ...data,
          updateTime: db.serverDate()
        }
      })
      return { success: true }
    } else {
      // 用户不存在，创建新用户
      const newUser = {
        openid: openid,
        nickname: data.nickname || '',
        avatarUrl: data.avatarUrl || '',
        bio: '',
        sportType: 1,
        waterType: 5,
        privacyLevel: 1,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
      await db.collection('users').add({
        data: newUser
      })
      return { success: true }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取用户统计
async function getUserStats(openid) {
  try {
    // 获取用户信息
    const user = await db.collection('users').where({
      openid: openid
    }).get()

    if (!user.data || user.data.length === 0) {
      return {
        success: true,
        stats: {
          totalDistance: 0,
          totalTime: 0,
          totalActivities: 0
        }
      }
    }

    const userId = user.data[0]._id

    // 获取用户的活动统计（只统计已结束的活动）
    const activities = await db.collection('activities').where({
      userId: userId,
      status: 2 // 只统计已结束
    }).get()

    let totalDistance = 0
    let totalTime = 0

    activities.data.forEach(activity => {
      // totalDistance 已经是米单位
      totalDistance += activity.totalDistance || 0
      // duration 已经是秒单位
      totalTime += activity.duration || 0
    })

    return {
      success: true,
      stats: {
        totalDistance: Number((totalDistance / 1000).toFixed(1)),  // 转换为公里，保留 1 位小数
        totalTime: Number((totalTime / 3600).toFixed(1)),  // 转换为小时，保留 1 位小数
        totalActivities: activities.data.length
      }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 成就列表（定义所有可解锁的成就）
const ALL_ACHIEVEMENTS = [
  {
    id: 'first_activity',
    name: '初次启航',
    desc: '完成你的第一次划行',
    icon: '🚣',
    condition: stats => stats.totalActivities >= 1
  },
  {
    id: 'ten_km',
    name: '十里春风',
    desc: '累计划行 10 公里',
    icon: '🌿',
    condition: stats => stats.totalDistance >= 10
  },
  {
    id: 'fifty_km',
    name: '五十不惑',
    desc: '累计划行 50 公里',
    icon: '🌊',
    condition: stats => stats.totalDistance >= 50
  },
  {
    id: 'hundred_km',
    name: '百里挑一',
    desc: '累计划行 100 公里',
    icon: '🏄',
    condition: stats => stats.totalDistance >= 100
  },
  {
    id: 'first_team',
    name: '组队出发',
    desc: '和小伙伴一起划一次',
    icon: '👯',
    condition: (stats, activities) => {
      // 检查是否有 teamActivity
      const hasTeamActivity = activities.data.some(a => a.isTeamActivity)
      return hasTeamActivity
    }
  },
  {
    id: 'five_activities',
    name: '桨不离手',
    desc: '完成 5 次划行',
    icon: '💪',
    condition: stats => stats.totalActivities >= 5
  },
  {
    id: 'ten_activities',
    name: '水上达人',
    desc: '完成 10 次划行',
    icon: '🏆',
    condition: stats => stats.totalActivities >= 10
  },
  {
    id: 'one_hour',
    name: '耐力新手',
    desc: '累计划行 1 小时',
    icon: '⏱️',
    condition: stats => stats.totalTime >= 1
  },
  {
    id: 'ten_hours',
    name: '乘风破浪',
    desc: '累计划行 10 小时',
    icon: '💨',
    condition: stats => stats.totalTime >= 10
  }
]

// 自动检查并解锁成就
async function autoCheckAchievements(userId, stats) {
  try {
    // 获取用户已解锁的成就
    const existing = await db.collection('user_achievements')
      .where({ userId })
      .get()
    
    const existingIds = existing.data.map(a => a.achievementId)
    const toUnlock = []

    // 获取用户所有活动，检查条件
    const activities = await db.collection('activities')
      .where({ userId })
      .get()
    
    // 检查每个成就
    ALL_ACHIEVEMENTS.forEach(ach => {
      if (!existingIds.includes(ach.id)) {
        let unlocked = false
        if (typeof ach.condition === 'function') {
          unlocked = ach.condition(stats, activities)
        }
        if (unlocked) {
          toUnlock.push({
            userId,
            achievementId: ach.id,
            name: ach.name,
            desc: ach.desc,
            icon: ach.icon,
            unlockTime: db.serverDate()
          })
        }
      }
    })

    // 批量插入新解锁的成就
    for (const ach of toUnlock) {
      await db.collection('user_achievements').add({ data: ach })
    }

    return toUnlock.length
  } catch (e) {
    console.error('autoCheckAchievements error', e)
    return 0
  }
}

// 获取用户成就
async function getUserAchievements(openid) {
  try {
    // 获取用户信息
    const user = await db.collection('users').where({
      openid: openid
    }).get()

    if (!user.data || user.data.length === 0) {
      return { success: true, achievements: [] }
    }
    const userId = user.data[0]._id

    // 先自动检查解锁新成就
    // 获取统计数据
    const activities = await db.collection('activities').where({ userId }).get()
    let totalDistance = 0
    let totalTime = 0
    activities.data.forEach(activity => {
      totalDistance += activity.totalDistance || 0
      totalTime += activity.duration || 0
    })
    const stats = {
      totalDistance: (totalDistance / 1000), // 米转公里
      totalTime: (totalTime / 3600), // 秒转小时
      totalActivities: activities.data.length
    }

    // 自动检查解锁
    await autoCheckAchievements(userId, stats)

    // 获取用户所有成就（包括新解锁的）
    const achievements = await db.collection('user_achievements')
      .where({ userId })
      .orderBy('unlockTime', 'desc')
      .get()

    // 填充完整信息
    const result = achievements.data.map(a => {
      const def = ALL_ACHIEVEMENTS.find(d => d.id === a.achievementId)
      return {
        ...a,
        name: def?.name || a.name,
        desc: def?.desc || a.desc,
        icon: def?.icon || a.icon || '🏅'
      }
    })

    return {
      success: true,
      achievements: result
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取手机号
async function getPhoneNumber(openid, encryptedData, iv) {
  try {
    // 注意：获取手机号需要小程序后台配置 getPhoneNumber 接口
    // 这里需要调用微信的解码接口
    // 由于需要商户资质，这里先返回错误提示
    return { 
      success: false, 
      error: '获取手机号需要在小程序后台配置权限，建议用户手动输入' 
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}
