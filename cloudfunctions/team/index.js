// cloudfunctions/team/index.js
const cloud = require('wx-server-sdk')

cloud.init()

const db = cloud.database()
const _ = db.command

// 队伍云函数入口
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const action = event.action
  const openid = wxContext.OPENID

  try {
    switch (action) {
      // 创建队伍
      case 'create':
        return await createTeam(openid, event.data)

      // 获取我的队伍列表
      case 'getMyTeams':
        return await getMyTeams(openid)

      // 获取附近队伍（可按距离筛选）
      case 'getNearbyTeams':
        return await getNearbyTeams(openid, event.data)

      // 加入队伍
      case 'join':
        return await joinTeam(openid, event.teamId)

      // 离开队伍
      case 'leave':
        return await leaveTeam(openid, event.teamId)

      // 获取队伍详情
      case 'getDetail':
        return await getTeamDetail(openid, event.teamId)

      // 更新队伍信息
      case 'update':
        return await updateTeam(openid, event.teamId, event.data)

      // 删除队伍（仅队长）
      case 'delete':
        return await deleteTeam(openid, event.teamId)

      // 踢出队员（仅队长）
      case 'kickMember':
        return await kickMember(openid, event.teamId, event.kickOpenid)

      // 获取所有队员的轨迹（进行中活动）
      case 'getAllMembersTrackPoints':
        return await getAllMembersTrackPoints(event.teamId)

      // 队长出发：全队开始记录
      case 'startJourney':
        return await startJourney(openid, event.teamId)

      // 队长结束行程：全队停止记录，所有活动标记为结束
      case 'endJourney':
        return await endJourney(openid, event.teamId)

      default:
        return { success: false, error: '未知操作' }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 创建队伍
async function createTeam(openid, data) {
  try {
    // 获取用户信息
    const userRes = await db.collection('users').where({ openid }).get()
    if (!userRes.data || userRes.data.length === 0) {
      return { success: false, error: '用户不存在' }
    }
    const user = userRes.data[0]

    // 创建队伍
    const team = {
      teamName: data.teamName || '我的队伍',
      creatorId: user._id,
      creatorOpenid: openid,
      creatorNickname: user.nickname || '未知用户',
      creatorAvatar: user.avatarUrl || '',
      maxMembers: data.maxMembers || 10,
      status: 1, // 1-组队中(等待出发), 2-行进中, 3-已结束
      startTime: null,
      endTime: null,
      members: [{
        userId: user._id,
        openid: openid,
        nickname: user.nickname || '未知用户',
        avatarUrl: user.avatarUrl || '',
        role: 'leader', // leader-队长, member-成员
        joinedAt: db.serverDate(),
        activityId: null
      }],
      memberCount: 1,
      // 队伍位置（创建时的位置）
      location: data.location || null,
      // 队伍类型：1-桨板，2-皮划艇，3-其他
      sportType: data.sportType || 1,
      description: data.description || '',
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }

    const result = await db.collection('teams').add({ data: team })

    return {
      success: true,
      teamId: result._id,
      team: { ...team, _id: result._id }
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取我的队伍列表
async function getMyTeams(openid) {
  try {
    const userRes = await db.collection('users').where({ openid }).get()
    if (!userRes.data || userRes.data.length === 0) {
      return { success: true, teams: [] }
    }
    const userId = userRes.data[0]._id

    const teamsRes = await db.collection('teams')
      .where({
        'members': {
          $elemMatch: { userId }
        }
      })
      .orderBy('createTime', 'desc')
      .limit(20)
      .get()

    return {
      success: true,
      teams: teamsRes.data
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取附近队伍（简单实现：显示所有公开队伍）
async function getNearbyTeams(openid, data) {
  try {
    // 获取附近队伍：创建时间7天内，状态为进行中的队伍
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    
    const teamsRes = await db.collection('teams')
      .where({
        status: 1,
        createTime: _.gt(sevenDaysAgo)
      })
      .orderBy('createTime', 'desc')
      .limit(50)
      .get()

    // 获取当前用户
    const userRes = await db.collection('users').where({ openid }).get()
    const userId = userRes.data?.[0]?._id

    // 过滤掉我已加入的队伍
    const filteredTeams = teamsRes.data.filter(team => {
      const isMember = team.members?.some(m => m.userId === userId)
      return !isMember
    })

    return {
      success: true,
      teams: filteredTeams
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 加入队伍
async function joinTeam(openid, teamId) {
  try {
    // 获取用户信息
    const userRes = await db.collection('users').where({ openid }).get()
    if (!userRes.data || userRes.data.length === 0) {
      return { success: false, error: '用户不存在' }
    }
    const user = userRes.data[0]

    // 获取队伍
    const teamRes = await db.collection('teams').doc(teamId).get()
    if (!teamRes.data) {
      return { success: false, error: '队伍不存在' }
    }
    const team = teamRes.data

    // 检查是否已加入
    const isMember = team.members?.some(m => m.openid === openid)
    if (isMember) {
      return { success: false, error: '您已经是队员' }
    }

    // 检查是否已满
    if (team.memberCount >= team.maxMembers) {
      return { success: false, error: '队伍已满' }
    }

    // 添加队员
    const newMember = {
      userId: user._id,
      openid: openid,
      nickname: user.nickname || '未知用户',
      avatarUrl: user.avatarUrl || '',
      role: 'member',
      joinedAt: db.serverDate(),
      activityId: null
    }
    
    // 如果队伍已经出发，需要为新队员创建活动（优先复用用户当前进行中的活动）
    if (team.status === 2) { // 行进中
      // 先查找用户是否已有进行中的活动
      // 通过 userId 查询更可靠（因为所有活动都有 userId 字段）
      const existingRes = await db.collection('activities')
        .where({
          userId: user._id,
          status: 1 // 进行中
        })
        .limit(1)
        .get()
      
      if (existingRes.data && existingRes.data.length > 0) {
        // 复用已有活动，绑定activityId，并更新teamId
        newMember.activityId = existingRes.data[0]._id
        await db.collection('activities').doc(newMember.activityId).update({
          data: {
            teamId: teamId,
            isTeamActivity: true
          }
        })
      } else {
        // 没有已有活动，创建新活动
        const activity = {
          userId: user._id,
          openid: openid,
          _openid: openid,
          title: `${team.teamName} - 队伍行程`,
          status: 1, // 1-进行中
          teamId: teamId,
          isTeamActivity: true,
          createTime: db.serverDate(),
          startTime: db.serverDate(),
          totalDistance: 0,
          duration: 0,
          avgSpeed: 0,
          maxSpeed: 0
        }
        
        const activityRes = await db.collection('activities').add({ data: activity })
        newMember.activityId = activityRes._id
      }
    }

    const newMembers = [...(team.members || []), newMember]

    await db.collection('teams').doc(teamId).update({
      data: {
        members: newMembers,
        memberCount: team.memberCount + 1,
        updateTime: db.serverDate()
      }
    })

    return { 
      success: true, 
      activityId: newMember.activityId,
      isTeamStarted: team.status === 2
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 离开队伍
async function leaveTeam(openid, teamId) {
  try {
    // 获取队伍
    const teamRes = await db.collection('teams').doc(teamId).get()
    if (!teamRes.data) {
      return { success: false, error: '队伍不存在' }
    }
    const team = teamRes.data

    // 检查是否是队长
    if (team.creatorOpenid === openid) {
      return { success: false, error: '队长不能离开，请先解散队伍' }
    }

    // 移除队员
    const newMembers = team.members?.filter(m => m.openid !== openid) || []

    await db.collection('teams').doc(teamId).update({
      data: {
        members: newMembers,
        memberCount: team.memberCount - 1,
        updateTime: db.serverDate()
      }
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 获取队伍详情
async function getTeamDetail(openid, teamId) {
  try {
    const teamRes = await db.collection('teams').doc(teamId).get()
    if (!teamRes.data) {
      return { success: false, error: '队伍不存在' }
    }

    return {
      success: true,
      team: teamRes.data
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 更新队伍信息（仅队长）
async function updateTeam(openid, teamId, data) {
  try {
    const teamRes = await db.collection('teams').doc(teamId).get()
    if (!teamRes.data) {
      return { success: false, error: '队伍不存在' }
    }
    if (teamRes.data.creatorOpenid !== openid) {
      return { success: false, error: '只有队长可以修改队伍信息' }
    }

    const updateData = {
      updateTime: _.serverDate()
    }
    if (data.teamName) updateData.teamName = data.teamName
    if (data.description) updateData.description = data.description
    if (data.status) {
      updateData.status = data.status
      if (data.status === 2) {
        updateData.startTime = _.serverDate()
      } else if (data.status === 3) {
        updateData.endTime = _.serverDate()
      }
    }

    await db.collection('teams').doc(teamId).update({ data: updateData })

    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 删除队伍（仅队长）
async function deleteTeam(openid, teamId) {
  try {
    const teamRes = await db.collection('teams').doc(teamId).get()
    if (!teamRes.data) {
      return { success: false, error: '队伍不存在' }
    }
    if (teamRes.data.creatorOpenid !== openid) {
      return { success: false, error: '只有队长可以解散队伍' }
    }

    await db.collection('teams').doc(teamId).remove()

    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 踢出队员（仅队长）
async function kickMember(openid, teamId, kickOpenid) {
  try {
    const team = await db.collection('teams').doc(teamId).get()
    if (!team.data) {
      return { success: false, error: '队伍不存在' }
    }
    if (team.data.creatorOpenid !== openid) {
      return { success: false, error: '只有队长可以踢出队员' }
    }
    if (kickOpenid === openid) {
      return { success: false, error: '队长不能踢出自己，请解散队伍' }
    }

    // 过滤掉要踢出的队员
    const newMembers = team.data.members?.filter(m => m.openid !== kickOpenid) || []

    await db.collection('teams').doc(teamId).update({
      data: {
        members: newMembers,
        memberCount: newMembers.length,
        updateTime: db.serverDate()
      }
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
}
// 获取所有队员的轨迹（进行中活动）
async function getAllMembersTrackPoints(teamId) {
  try {
    const teamRes = await db.collection('teams').doc(teamId).get()
    if (!teamRes.data) {
      return { success: false, error: '队伍不存在' }
    }
    const members = teamRes.data.members || []
    
    const memberTracks = []
    
    for (const member of members) {
      // 优先级：队员绑定的activityId > 查找进行中活动
      let activityId = null
      if (member.activityId) {
        activityId = member.activityId
      } else {
        const activityRes = await db.collection('activities')
          .where({
            openid: member.openid,
            status: 1
          })
          .limit(1)
          .get()
        
        if (activityRes.data && activityRes.data.length > 0) {
          activityId = activityRes.data[0]._id
        }
      }
      
      if (activityId) {
        const trackRes = await db.collection('track_points')
          .where({ activityId: activityId })
          .orderBy('pointOrder', 'asc')
          .limit(1000)
          .get()
        
        memberTracks.push({
          openid: member.openid,
          nickname: member.nickname,
          activityId: activityId,
          trackPoints: trackRes.data || []
        })
      }
    }
    
    return { success: true, memberTracks }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 队长出发：全队开始记录
async function startJourney(openid, teamId) {
  try {
    // 获取队伍信息
    const teamRes = await db.collection('teams').doc(teamId).get()
    if (!teamRes.data) {
      return { success: false, error: '队伍不存在' }
    }
    const team = teamRes.data
    
    // 检查权限：只有队长能出发
    if (team.creatorOpenid !== openid) {
      return { success: false, error: '只有队长可以出发' }
    }
    
    // 检查状态：只能从组队中开始
    if (team.status !== 1) {
      return { success: false, error: `当前队伍状态不对，无法出发：${team.status}` }
    }
    
    const members = team.members || []
    const updateResults = []
    
    // 遍历所有队员，**复用已有活动（如果队员已经在划行），没有则创建新活动**
    for (const member of members) {
      // 队员已经有进行中的活动，直接复用，不创建新的
      if (!member.activityId) {
        // 查找队员是否已有进行中的活动
        // 通过 userId 查询更可靠（因为所有活动都有 userId 字段）
        const existingRes = await db.collection('activities')
          .where({
            userId: member.userId,
            status: 1 // 进行中
          })
          .limit(1)
          .get()
        
        if (existingRes.data && existingRes.data.length > 0) {
          // 复用已有活动，绑定activityId
          member.activityId = existingRes.data[0]._id
          // 更新活动的teamId
          await db.collection('activities').doc(member.activityId).update({
            data: {
              teamId: teamId,
              isTeamActivity: true
            }
          })
          console.log(`[startJourney] 复用已有活动 ${member.activityId} for ${member.nickname}`)
        } else {
          // 没有已有活动，创建新活动
          const activity = {
            userId: member.userId,
            openid: member.openid,
            _openid: member.openid,
            title: `${team.teamName} - 队伍行程`,
            status: 1, // 进行中
            teamId: teamId,
            isTeamActivity: true,
            createTime: db.serverDate(),
            startTime: db.serverDate(),
            totalDistance: 0,
            duration: 0,
            avgSpeed: 0,
            maxSpeed: 0
          }
          
          const activityRes = await db.collection('activities').add({ data: activity })
          member.activityId = activityRes._id
          console.log(`[startJourney] 创建新活动 ${member.activityId} for ${member.nickname}`)
        }
      }
      // 如果已经有activityId，什么都不用做，直接保留
      
      updateResults.push({ 
        openid: member.openid, 
        activityId: member.activityId 
      })
    }
    
    // 更新队伍状态为行进中
    await db.collection('teams').doc(teamId).update({
      data: {
        status: 2, // 行进中
        startTime: db.serverDate(),
        members: members, // 更新每个队员的activityId
        updateTime: db.serverDate()
      }
    })
    
    return {
      success: true,
      started: true,
      memberActivities: updateResults
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// 队长结束行程：全队停止记录，所有活动标记为结束
async function endJourney(openid, teamId) {
  try {
    // 获取队伍信息
    const teamRes = await db.collection('teams').doc(teamId).get()
    if (!teamRes.data) {
      return { success: false, error: '队伍不存在' }
    }
    const team = teamRes.data
    
    // 检查权限：只有队长能结束
    if (team.creatorOpenid !== openid) {
      return { success: false, error: '只有队长可以结束行程' }
    }
    
    // 检查状态：只能从行进中结束
    if (team.status !== 2) {
      return { success: false, error: `当前队伍状态不对，无法结束：${team.status}` }
    }
    
    const members = team.members || []
    const results = []
    
    // 遍历所有队员，将每个队员绑定的活动标记为已结束
    for (const member of members) {
      if (member.activityId) {
        // 更新活动状态为已结束，并记录结束时间
        await db.collection('activities').doc(member.activityId).update({
          data: {
            status: 2, // 2-已结束
            endTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        })
        results.push({ 
          openid: member.openid, 
          activityId: member.activityId,
          ended: true
        })
      }
    }
    
    // 更新队伍状态为已结束
    await db.collection('teams').doc(teamId).update({
      data: {
        status: 3, // 已结束
        endTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
    
    return {
      success: true,
      ended: true,
      memberActivities: results
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}
