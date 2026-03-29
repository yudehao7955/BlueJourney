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

    // 获取用户的活动统计
    const activities = await db.collection('activities').where({
      userId: user.data[0]._id
    }).get()

    let totalDistance = 0
    let totalTime = 0

    activities.data.forEach(activity => {
      totalDistance += activity.totalDistance || 0
      totalTime += activity.duration || 0
    })

    return {
      success: true,
      stats: {
        totalDistance: (totalDistance / 1000).toFixed(1),  // 转换为公里
        totalTime: (totalTime / 3600).toFixed(1),  // 转换为小时
        totalActivities: activities.data.length
      }
    }
  } catch (e) {
    return { success: false, error: e.message }
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

    // 获取用户成就
    const achievements = await db.collection('user_achievements').where({
      userId: user.data[0]._id
    }).get()

    return {
      success: true,
      achievements: achievements.data || []
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
