// cloudfunctions/activity/index.js
const cloud = require('wx-server-sdk')

cloud.init()

const db = cloud.database()
const TRACK_PAGE = 1000

// 拉取某活动全部轨迹点（分页，避免默认 20 条限制）
async function fetchAllTrackPointsByActivity(activityId) {
  let all = []
  let skip = 0
  for (;;) {
    const res = await db.collection('track_points')
      .where({ activityId })
      .orderBy('pointOrder', 'asc')
      .skip(skip)
      .limit(TRACK_PAGE)
      .get()
    all = all.concat(res.data)
    if (res.data.length < TRACK_PAGE) break
    skip += TRACK_PAGE
  }
  return all
}

// 活动云函数入口
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const action = event.action

  try {
    switch (action) {
      // 创建活动
      case 'create':
        return await createActivity(wxContext.OPENID, event.data)

      // 获取进行中的活动
      case 'getActive':
        return await getActiveActivity(wxContext.OPENID)

      // 获取活动详情
      case 'getDetail':
        return await getActivityDetail(event.activityId)

      // 获取活动列表
      case 'getList':
        return await getActivityList(wxContext.OPENID, event.page, event.pageSize)

      // 结束活动
      case 'end':
        return await endActivity(wxContext.OPENID, event.activityId, event.data)

      // 更新活动距离（优化后）
      case 'updateDistance':
        return await updateActivityDistance(wxContext.OPENID, event.activityId, event.optimizedDistance)

      // 暂停活动
      case 'pauseActivity':
        return await pauseActivity(wxContext.OPENID, event.activityId, event.data)

      // 继续活动
      case 'resumeActivity':
        return await resumeActivity(wxContext.OPENID, event.activityId, event.data)

      // 保存轨迹点
      case 'saveTrackPoint':
        return await saveTrackPoint(wxContext.OPENID, event.activityId, event.data)

      // 获取轨迹点
      case 'getTrackPoints':
        return await getTrackPoints(event.activityId)

      // 批量保存轨迹点
      case 'saveBatchTrackPoints':
        return await saveBatchTrackPoints(wxContext.OPENID, event.activityId, event.points)

      // 增量追加轨迹点（进行中检查点，结束保存仍会全量覆盖）
      case 'appendTrackPoints':
        return await appendTrackPoints(wxContext.OPENID, event.activityId, event.points)

      // 删除活动及轨迹
      case 'deleteActivity':
        return await deleteActivity(wxContext.OPENID, event.activityId)

      default:
        return { success: false, error: '未知操作' }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 创建活动
async function createActivity(openid, data) {
  try {

    
    // 获取用户信息
    const user = await db.collection('users').where({
      openid: openid
    }).get()



    if (!user.data || user.data.length === 0) {
      return { success: false, error: '用户不存在' }
    }

    const userId = user.data[0]._id

    // 检查是否有进行中的活动
    const activeActivity = await db.collection('activities').where({
      userId: userId,
      status: 1  // 进行中
    }).get()

    if (activeActivity.data && activeActivity.data.length > 0) {
      return { success: false, error: '已有进行中的活动' }
    }

    // 创建新活动
    const activity = {
      userId: userId,
      openid: openid,
      title: data.title || '划行活动',
      description: data.description || '',
      sportType: data.sportType || 1,  // 1-桨板, 2-皮划艇, 3-其他
      waterType: data.waterType || 5,  // 1-湖泊, 2-河流, 3-海洋, 4-水库, 5-其他
      startPoint: data.startPoint || null,
      startTime: db.serverDate(),
      status: 1,  // 进行中
      totalDistance: 0,
      duration: 0,
      avgSpeed: 0,
      maxSpeed: 0,
      calories: 0,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }

    const result = await db.collection('activities').add({
      data: activity
    })

    return {
      success: true,
      activityId: result._id,
      activity: { ...activity, _id: result._id }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取进行中的活动
async function getActiveActivity(openid) {
  try {
    const user = await db.collection('users').where({
      openid: openid
    }).get()

    if (!user.data || user.data.length === 0) {
      return { success: false, error: '用户不存在' }
    }

    const activities = await db.collection('activities').where({
      userId: user.data[0]._id,
      status: 1  // 进行中
    }).get()

    if (activities.data && activities.data.length > 0) {
      return {
        success: true,
        activity: activities.data[0]
      }
    } else {
      return {
        success: true,
        activity: null
      }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取活动详情
async function getActivityDetail(activityId) {
  try {
    const activity = await db.collection('activities').doc(activityId).get()
    return {
      success: true,
      activity: activity.data
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取活动列表
async function getActivityList(openid, page = 1, pageSize = 10) {
  try {
    const user = await db.collection('users').where({
      openid: openid
    }).get()

    if (!user.data || user.data.length === 0) {
      return { success: true, activities: [], total: 0 }
    }

    const skip = (page - 1) * pageSize

    const activities = await db.collection('activities').where({
      userId: user.data[0]._id
    }).orderBy('createTime', 'desc').skip(skip).limit(pageSize).get()

    const total = await db.collection('activities').where({
      userId: user.data[0]._id
    }).count()

    return {
      success: true,
      activities: activities.data,
      total: total.total
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 结束活动
async function endActivity(openid, activityId, data) {
  try {
    const activity = await db.collection('activities').doc(activityId).get()

    if (!activity.data) {
      return { success: false, error: '活动不存在' }
    }

    if (activity.data.openid !== openid) {
      return { success: false, error: '无权限' }
    }

    // 计算统计数据（拉全量轨迹点）
    const trackPoints = { data: await fetchAllTrackPointsByActivity(activityId) }

    let totalDistance = 0
    let maxSpeed = 0
    let durations = 0
    const trackPointCount = trackPoints.data?.length || 0

    if (trackPointCount > 1) {
      for (let i = 1; i < trackPoints.data.length; i++) {
        const prev = trackPoints.data[i - 1]
        const curr = trackPoints.data[i]
        // 计算距离（简单估算）
        const dist = calculateDistance(
          prev.latitude, prev.longitude,
          curr.latitude, curr.longitude
        )
        totalDistance += dist
        if (curr.speed > maxSpeed) {
          maxSpeed = curr.speed
        }
      }
      // 计算时长 - 使用前端传入的时长（已排除暂停时间），更准确
      durations = data.duration || 0
    }

    // 根据轨迹点数量设置状态
    // status: 1-进行中, 2-正常结束, 3-行程太短
    const status = trackPointCount >= 2 ? 2 : 3

    // 获取活动已有的暂停记录
    const currentActivity = await db.collection('activities').doc(activityId).get()
    const pauses = currentActivity.data?.pauses || []

    // 更新活动
    await db.collection('activities').doc(activityId).update({
      data: {
        endPoint: data.endPoint || null,
        endTime: db.serverDate(),
        status: status,
        totalDistance: totalDistance,
        duration: data.duration || durations,  // 优先使用前端传入的时长
        avgSpeed: durations > 0 ? (totalDistance / (durations / 3600)) : 0,
        maxSpeed: maxSpeed,
        trackPointCount: trackPointCount,
        pauses: pauses,
        updateTime: db.serverDate()
      }
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 暂停活动 - 记录暂停开始时间
async function pauseActivity(openid, activityId, data) {
  try {
    // 获取当前活动
    const activity = await db.collection('activities').doc(activityId).get()
    
    if (!activity.data) {
      return { success: false, error: '活动不存在' }
    }
    
    if (activity.data.openid !== openid) {
      return { success: false, error: '无权限' }
    }
    
    // 获取现有的暂停记录
    const pauses = activity.data.pauses || []
    
    // 添加新的暂停记录
    pauses.push({
      startTime: data.startTime || db.serverDate(),
      endTime: null,
      duration: 0
    })
    
    // 更新活动
    await db.collection('activities').doc(activityId).update({
      data: {
        pauses: pauses,
        isPaused: true,
        updateTime: db.serverDate()
      }
    })
    
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 继续活动 - 记录暂停结束时间和时长
async function resumeActivity(openid, activityId, data) {
  try {
    // 获取当前活动
    const activity = await db.collection('activities').doc(activityId).get()
    
    if (!activity.data) {
      return { success: false, error: '活动不存在' }
    }
    
    if (activity.data.openid !== openid) {
      return { success: false, error: '无权限' }
    }
    
    // 获取现有的暂停记录
    const pauses = activity.data.pauses || []
    
    // 更新最后一个暂停记录
    if (pauses.length > 0) {
      const lastPause = pauses[pauses.length - 1]
      if (!lastPause.endTime) {
        lastPause.endTime = data.endTime || db.serverDate()
        lastPause.duration = data.duration || 0
      }
    }
    
    // 更新活动
    await db.collection('activities').doc(activityId).update({
      data: {
        pauses: pauses,
        isPaused: false,
        updateTime: db.serverDate()
      }
    })
    
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 保存轨迹点
async function saveTrackPoint(openid, activityId, data) {
  try {
    // 获取用户
    const user = await db.collection('users').where({
      openid: openid
    }).get()

    if (!user.data || user.data.length === 0) {
      return { success: false, error: '用户不存在' }
    }

    // 获取当前轨迹点数量
    const count = await db.collection('track_points').where({
      activityId: activityId
    }).count()

    const trackPoint = {
      activityId: activityId,
      userId: user.data[0]._id,
      pointOrder: count.total + 1,
      latitude: data.latitude,
      longitude: data.longitude,
      altitude: data.altitude || 0,
      speed: data.speed || 0,
      accuracy: data.accuracy || 0,
      heading: data.heading || 0,
      timestamp: new Date(data.timestamp || Date.now()),
      createTime: db.serverDate()
    }

    await db.collection('track_points').add({
      data: trackPoint
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取轨迹点
async function getTrackPoints(activityId) {
  try {
    const trackPoints = await fetchAllTrackPointsByActivity(activityId)
    // 确保经纬度是数字类型，这对地图绘制非常关键！
    const normalized = trackPoints.map(p => ({
      ...p,
      latitude: typeof p.latitude === 'number' ? p.latitude : Number(p.latitude),
      longitude: typeof p.longitude === 'number' ? p.longitude : Number(p.longitude),
      speed: typeof p.speed === 'number' ? p.speed : Number(p.speed || 0)
    }))
    console.log(`getTrackPoints ${activityId}: raw ${trackPoints.length} -> normalized ${normalized.length}`)
    return {
      success: true,
      trackPoints: normalized
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 计算两点之间的距离（米）
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000  // 地球半径（米）
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// 增量追加轨迹点（仅进行中活动；失败时回滚本次插入，避免脏数据）
async function appendTrackPoints(openid, activityId, points) {
  try {
    if (!points || points.length === 0) {
      return { success: true, count: 0 }
    }

    const activity = await db.collection('activities').doc(activityId).get()
    if (!activity.data) {
      return { success: false, error: '活动不存在' }
    }
    if (activity.data.openid !== openid) {
      return { success: false, error: '无权限' }
    }
    if (activity.data.status !== 1) {
      return { success: false, error: '活动已结束' }
    }

    const user = await db.collection('users').where({ openid }).get()
    if (!user.data || user.data.length === 0) {
      return { success: false, error: '用户不存在' }
    }
    const userId = user.data[0]._id

    const countRes = await db.collection('track_points').where({ activityId }).count()
    let order = countRes.total
    const addedIds = []

    try {
      for (const p of points) {
        order += 1
        const result = await db.collection('track_points').add({
          data: {
            activityId,
            userId,
            pointOrder: order,
            latitude: p.latitude,
            longitude: p.longitude,
            speed: p.speed || 0,
            accuracy: p.accuracy || 0,
            heading: p.heading || 0,
            timestamp: p.timestamp ? new Date(p.timestamp) : db.serverDate(),
            createTime: db.serverDate()
          }
        })
        addedIds.push(result._id)
      }
    } catch (insertErr) {
      for (const id of addedIds) {
        try {
          await db.collection('track_points').doc(id).remove()
        } catch (removeErr) {
          console.error('appendTrackPoints rollback remove failed', removeErr)
        }
      }
      throw insertErr
    }

    return { success: true, count: points.length, appended: addedIds.length }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 批量保存轨迹点（先清空该活动旧点，避免与历史增量保存重复叠加）
async function saveBatchTrackPoints(openid, activityId, points) {
  try {
    const activity = await db.collection('activities').doc(activityId).get()
    if (!activity.data) {
      return { success: false, error: '活动不存在' }
    }
    if (activity.data.openid !== openid) {
      return { success: false, error: '无权限' }
    }

    await db.collection('track_points').where({ activityId }).remove()

    if (!points || points.length === 0) {
      return { success: true, count: 0 }
    }

    const results = []
    for (const point of points) {
      const result = await db.collection('track_points').add({
        data: {
          activityId: activityId,
          userId: point.userId || '',
          pointOrder: point.pointOrder,
          latitude: point.latitude,
          longitude: point.longitude,
          speed: point.speed || 0,
          accuracy: point.accuracy || 0,
          heading: point.heading || 0,
          timestamp: point.timestamp || db.serverDate(),
          createTime: db.serverDate()
        }
      })
      results.push(result._id)
    }

    return {
      success: true,
      count: results.length,
      ids: results
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 删除活动及关联轨迹点
async function deleteActivity(openid, activityId) {
  try {
    const activity = await db.collection('activities').doc(activityId).get()
    if (!activity.data) {
      return { success: false, error: '活动不存在' }
    }
    if (activity.data.openid !== openid) {
      return { success: false, error: '无权限' }
    }

    await db.collection('track_points').where({ activityId }).remove()
    await db.collection('activities').doc(activityId).remove()
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 更新活动距离（高德优化后）
async function updateActivityDistance(openid, activityId, optimizedDistance) {
  try {
    const activity = await db.collection('activities').doc(activityId).get()
    
    if (!activity.data) {
      return { success: false, error: '活动不存在' }
    }
    
    if (activity.data.openid !== openid) {
      return { success: false, error: '无权限' }
    }
    
    // 高德API返回的 optimizedDistance 单位已经是公里
    // 我们数据库存储单位是米，所以需要转换
    const optimizedDistanceMeters = optimizedDistance * 1000
    
    await db.collection('activities').doc(activityId).update({
      data: {
        totalDistance: optimizedDistanceMeters,
        updateTime: db.serverDate()
      }
    })
    
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 清空所有活动和轨迹点（调试用，只能删除当前用户自己的数据）
async function clearAll(openid) {
  try {
    // 删除所有activities
    const activitiesRes = await db.collection('activities').where({
      openid: openid
    }).remove()
    const deletedActivities = activitiesRes.stats.removed || 0

    // 删除所有track_points
    const pointsRes = await db.collection('track_points').where({
      openid: openid
    }).remove()
    const deletedPoints = pointsRes.stats.removed || 0

    return { 
      success: true, 
      deletedActivities: deletedActivities,
      deletedTrackPoints: deletedPoints
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}
