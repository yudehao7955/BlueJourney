const { buildMapPolylines } = require('../../utils/track.js')

// pages/team-detail/team-detail.js
Page({
  data: {
    teamId: '',
    team: {},
    latitude: 39.908823, // 默认北京
    longitude: 116.397470,
    markers: [],
    polylines: [],
    subKey: 'G7KBZ-VLFCA-ZUFK2-CHSJA-XLK4F-YLFPY',
    currentOpenid: '',
    showMsgModal: false,
    showQrModal: false,
    qrSize: 180,
    updateTimer: null, // 定时更新计时器
    originalState: null, // 保存原始地图状态，用于恢复
    
    // 快捷消息（常用海上消息）
    quickMessages: [
      { id: 1, text: '集合' },
      { id: 2, text: '收到' },
      { id: 3, text: '补水' },
      { id: 4, text: '靠岸' }
    ],
    
    // 全部消息
    allMessages: [
      { id: 1, text: '集合' },
      { id: 2, text: '收到' },
      { id: 3, text: '补水' },
      { id: 4, text: '靠岸' },
      { id: 5, text: '注意安全' },
      { id: 6, text: '跟上队伍' },
      { id: 7, text: '休息一下' },
      { id: 8, text: '准备返程' },
      { id: 9, text: '有人落单吗？' },
      { id: 10, text: '保持队形' },
      { id: 11, text: '看到你了' },
      { id: 12, text: '我在前面' },
      { id: 13, text: '我在后面' },
      { id: 14, text: '小心石头' },
      { id: 15, text: '有船经过' }
    ]
  },

  onLoad(options) {
    // 获取队伍ID
    if (options.teamId) {
      this.setData({ teamId: options.teamId })
      this.getTeamDetail()
    }
    
    // 获取当前用户
    this.getCurrentUser()
    
    // 默认收起队员面板
    this.setData({ showMemberPanel: false })
    
    // 开启定时更新，每 10 秒更新一次队伍信息和轨迹
    this.startAutoUpdate()
  },

  onShow() {
    // 进入页面后，如果已有定时器，确保更新继续
    if (!this.data.updateTimer) {
      this.startAutoUpdate()
    }
  },

  onUnload() {
    // 页面卸载时清除定时器
    this.stopAutoUpdate()
  },

  onHide() {
    // 页面隐藏时停止更新，节省资源
    this.stopAutoUpdate()
  },

  // 开启自动定时更新（实时获取队员最新位置和轨迹）
  startAutoUpdate() {
    const updateTimer = setInterval(() => {
      this.getTeamDetail()
    }, 10000) // 每 10 秒更新一次
    this.setData({ updateTimer })
  },

  // 停止自动更新
  stopAutoUpdate() {
    if (this.data.updateTimer) {
      clearInterval(this.data.updateTimer)
      this.setData({ updateTimer: null })
    }
  },

  // 切换队员面板显示
  toggleMemberPanel() {
    const willShow = !this.data.showMemberPanel
    this.setData({ showMemberPanel: willShow })
    
    // 抽屉打开时，地图需要自动缩放显示所有队员
    if (willShow && this.data.team.members) {
      const members = this.data.team.members
      if (members.length > 0) {
        const points = members
          .filter(m => m.location)
          .map(m => ({ 
            latitude: Number(m.location.latitude), 
            longitude: Number(m.location.longitude) 
          }))
        if (points.length > 0) {
          wx.nextTick(() => {
            const mapCtx = wx.createMapContext('teamMap', this)
            mapCtx.includePoints({ points, padding: [80, 80, 200, 80] })
          })
        }
      }
    }
  },

  getCurrentUser() {
    // 优先从 globalData 获取 openid（这里一定有值）
    const app = getApp()
    if (app.globalData.openid) {
      this.setData({ currentOpenid: app.globalData.openid })
      return
    }
    
    // fallback: 从 storage 获取 userInfo
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (userInfo.openid) {
      this.setData({ currentOpenid: userInfo.openid })
      return
    }

    // fallback: 调用云函数获取
    this.fetchCurrentUser()
  },

  fetchCurrentUser() {
    wx.cloud.callFunction({
      name: 'user',
      data: { action: 'getUserInfo' },
      success: (res) => {
        if (res.result?.success && res.result.userInfo) {
          const openid = res.result.userInfo.openid
          this.setData({ currentOpenid: openid })
        }
      }
    })
  },

  // 获取队伍详情
  getTeamDetail() {
    wx.showLoading({ title: '加载中...' })
    
    wx.cloud.callFunction({
      name: 'team',
      data: {
        action: 'getDetail',
        teamId: this.data.teamId
      },
      success: (res) => {
        if (res.result?.success && res.result.team) {
          const team = res.result.team
          this.setData({ team })
          
          // 调试日志
          // DEBUG: currentOpenid
          
          // 更新地图（只添加标记，不覆盖轨迹）
          this.updateMap(team)
          
          // 获取所有队员的轨迹（进行中活动）
          this.getMembersTrackPoints()
        } else {
          wx.showToast({ title: '获取失败', icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('getTeamDetail fail', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
      }
    })
  },

  // 获取所有队员的轨迹
  getMembersTrackPoints() {
    wx.cloud.callFunction({
      name: 'team',
      data: {
        action: 'getAllMembersTrackPoints',
        teamId: this.data.teamId
      },
      success: (res) => {
        if (res.result?.success && res.result.memberTracks) {
          this.processMembersTrackPoints(res.result.memberTracks)
        }
      },
      fail: (err) => {
        console.error('getMembersTrackPoints fail', err)
      }
    })
  },
  
  // 处理所有队员的轨迹数据
  processMembersTrackPoints(memberTracks) {
    const polylines = []
    const colors = ['#0066CC', '#FF6600', '#45B7D1', '#96CEB4', '#DDA0DD', '#FFA07A', '#98D8C8']
    
    // 收集所有点用于缩放
    const allPoints = []
    
    // 保存最新位置信息和原始轨迹，用于生成markers和单独显示
    this._memberLatestLocation = {}
    this._memberTracks = memberTracks
    
    memberTracks.forEach((mt, index) => {
      console.log(`member ${index}:`, mt.nickname, 'trackPoints count:', mt.trackPoints?.length)
      if (mt.trackPoints && mt.trackPoints.length > 0) {
        // 确保坐标是数字类型，微信地图要求必须是数字
        const points = mt.trackPoints.map(p => ({
          latitude: Number(p.latitude),
          longitude: Number(p.longitude)
        }))
        
        // 添加到所有点集合
        allPoints.push(...points)
        
        // 保存最新位置（最后一个轨迹点）
        const lastPoint = points[points.length - 1]
        this._memberLatestLocation[mt.openid] = {
          latitude: lastPoint.latitude,
          longitude: lastPoint.longitude
        }
        
        // 直接为每个成员创建一个 polyline，不同队员使用不同颜色
        // 保存 openid 便于单独提取显示
        if (points.length >= 2) {
          polylines.push({
            openid: mt.openid,
            points: points,
            color: colors[index % colors.length],
            width: 6,
            dottedLine: false,
            zIndex: index + 1
          })
          console.log(`Added polyline for member ${mt.nickname}, points: ${points.length}`)
        }
      }
    })
    
    console.log(`Final polylines: ${polylines.length} lines, total points: ${allPoints.length}`)
    
    // 重新生成 markers（使用最新位置从轨迹获取）
    this.regenerateMarkers()
    
    // 设置地图中心点和 polylines
    if (allPoints.length > 0) {
      const centerIdx = Math.floor(allPoints.length / 2)
      this.setData({
        polylines: polylines,
        latitude: allPoints[centerIdx].latitude,
        longitude: allPoints[centerIdx].longitude
      }, () => {
        wx.nextTick(() => {
          const mapCtx = wx.createMapContext('teamMap', this)
          mapCtx.includePoints({ points: allPoints, padding: [80, 80, 200, 80] })
        })
      })
    } else {
      this.setData({ polylines: [] })
    }
  },

  // 重新生成 markers - 优先使用轨迹最后一点作为位置
  regenerateMarkers() {
    const team = this.data.team
    const markers = []
    
    if (team.members && team.members.length > 0) {
      team.members.forEach((member, index) => {
        // 优先级：1. 缓存的最新位置（从轨迹来） 2. member.location 3. 跳过
        let lat = null
        let lng = null
        
        if (this._memberLatestLocation[member.openid]) {
          lat = this._memberLatestLocation[member.openid].latitude
          lng = this._memberLatestLocation[member.openid].longitude
        } else if (member.location) {
          lat = Number(member.location.latitude)
          lng = Number(member.location.longitude)
        }
        
        if (lat && lng) {
          markers.push({
            id: index,
            latitude: lat,
            longitude: lng,
            callout: {
              content: member.nickname || '队员',
              color: '#333',
              fontSize: 12,
              borderRadius: 8,
              padding: 8,
              bgColor: '#fff',
              display: 'ALWAYS'
            }
          })
        }
      })
    }
    
    // 如果还没有轨迹，更新地图中心为第一个marker
    if (markers.length > 0 && (!this.data.polylines || this.data.polylines.length === 0)) {
      this.setData({
        latitude: markers[0].latitude,
        longitude: markers[0].longitude
      })
    }
    
    this.setData({ markers })
  },

  // 更新地图标记和轨迹（仅初始调用）
  updateMap(team) {
    this.setData({ team })
    this._memberLatestLocation = {}
    this.regenerateMarkers()
    this.getMembersTrackPoints() // 获取轨迹，处理完会自动更新markers
  },

  // 发送快捷消息
  sendQuickMessage(e) {
    const msg = e.currentTarget.dataset.msg
    wx.showToast({ title: '已发送: ' + msg, icon: 'none' })
    this.closeMsgModal()
    // TODO: 实际发送消息到队伍聊天
  },

  // 显示更多消息
  showMoreMessages() {
    this.setData({ showMsgModal: true })
  },

  // 关闭消息弹窗
  closeMsgModal() {
    this.setData({ showMsgModal: false })
  },

  // 点击队员"位置"按钮，地图放大聚焦到该队员当前位置
  focusMemberLocation(e) {
    const openid = e.currentTarget.dataset.openid
    let latitude = Number(e.currentTarget.dataset.latitude)
    let longitude = Number(e.currentTarget.dataset.longitude)
    
    // 如果dataset里没有，从_memberLatestLocation拿
    if ((!latitude || !longitude) && this._memberLatestLocation[openid]) {
      latitude = this._memberLatestLocation[openid].latitude
      longitude = this._memberLatestLocation[openid].longitude
    }
    
    if (!latitude || !longitude) {
      wx.showToast({ title: '该队员暂无位置信息', icon: 'none' })
      return
    }
    
    // 更新地图中心到该队员位置，放大比例尺
    this.setData({
      latitude: latitude,
      longitude: longitude,
      scale: 18
    })
    
    // 5 秒后恢复默认比例尺
    setTimeout(() => {
      this.setData({ scale: 16 })
    }, 5000)
  },

  // 点击队员"轨迹"按钮，缩放地图显示该队员的完整轨迹
  showMemberTrack(e) {
    const openid = e.currentTarget.dataset.openid
    
    // 找到该队员的所有轨迹点
    let memberPoints = []
    this.data.polylines.forEach(poly => {
      if (poly.openid === openid && poly.points) {
        memberPoints = memberPoints.concat(poly.points)
      }
    })
    
    // 如果当前polylines还没按队员分开，重新从memberTracks获取
    if (memberPoints.length === 0 && this._memberTracks) {
      const mt = this._memberTracks.find(m => m.openid === openid)
      if (mt && mt.trackPoints) {
        memberPoints = mt.trackPoints.map(p => ({
          latitude: Number(p.latitude),
          longitude: Number(p.longitude)
        }))
      }
    }
    
    if (memberPoints.length === 0) {
      wx.showToast({ title: '该队员暂无轨迹', icon: 'none' })
      return
    }
    
    // 保存当前原始状态，用于之后恢复
    this._originalState = {
      latitude: this.data.latitude,
      longitude: this.data.longitude,
      polylines: this.data.polylines,
      markers: this.data.markers
    }
    
    // 只保留该队员的轨迹
    const singlePolyline = [{
      points: memberPoints,
      color: '#0066CC',
      width: 8,
      dottedLine: false
    }]
    
    // 更新地图
    this.setData({
      polylines: singlePolyline
    })
    
    // 缩放地图让所有轨迹点可见
    wx.nextTick(() => {
      const mapCtx = wx.createMapContext('teamMap', this)
      mapCtx.includePoints({ 
        points: memberPoints, 
        padding: [60, 60, 60, 60] 
      })
    })
    
    // 5 秒后恢复显示所有队员的轨迹
    setTimeout(() => {
      this.restoreOriginalMap()
    }, 5000)
  },

  // 恢复显示所有队员的轨迹和原始地图状态
  restoreOriginalMap() {
    if (!this._originalState) return
    this.setData({
      latitude: this._originalState.latitude,
      longitude: this._originalState.longitude,
      polylines: this._originalState.polylines,
      markers: this._originalState.markers,
      scale: 16
    })
    this._originalState = null
  },

  // 显示踢出确认弹窗
  showKickConfirm(e) {
    const openid = e.currentTarget.dataset.openid
    const nickname = e.currentTarget.dataset.nickname
    wx.showModal({
      title: '确认踢出',
      content: `确定要将 ${nickname} 踢出队伍吗？踢出后无法撤销。`,
      confirmText: '确认踢出',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) {
          this.kickMember(openid)
        }
      }
    })
  },

  // 执行踢出队员
  kickMember(kickOpenid) {
    wx.showLoading({ title: '处理中...' })
    wx.cloud.callFunction({
      name: 'team',
      data: {
        action: 'kickMember',
        teamId: this.data.teamId,
        kickOpenid: kickOpenid
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result?.success) {
          wx.showToast({ title: '已踢出', icon: 'success' })
          this.getTeamDetail() // 重新获取队伍详情
        } else {
          wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '操作失败', icon: 'none' })
      }
    })
  },

  // 队长点击出发
  startJourney() {
    // 检查权限
    if (this.data.currentOpenid !== this.data.team.creatorOpenid) {
      wx.showToast({ title: '只有队长可以出发', icon: 'none' })
      return
    }

    wx.showModal({
      title: '确认出发',
      content: '出发后全队将自动开始记录轨迹，确定开始吗？',
      success: (res) => {
        if (res.confirm) {
          this.doStartJourney()
        }
      }
    })
  },

  // 执行出发
  doStartJourney() {
    wx.showLoading({ title: '出发准备中...' })
    
    wx.cloud.callFunction({
      name: 'team',
      data: {
        action: 'startJourney',
        teamId: this.data.teamId
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result?.success) {
          wx.showToast({ title: '出发啦！', icon: 'success' })
          this.getTeamDetail() // 重新获取队伍详情，刷新状态和轨迹
        } else {
          wx.showToast({ title: res.result?.error || '出发失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '出发失败', icon: 'none' })
      }
    })
  },

  // 队长点击结束行程
  endJourney() {
    // 检查权限
    if (this.data.currentOpenid !== this.data.team.creatorOpenid) {
      wx.showToast({ title: '只有队长可以结束', icon: 'none' })
      return
    }

    wx.showModal({
      title: '确认结束',
      content: '结束后全队停止记录轨迹，确定吗？',
      success: (res) => {
        if (res.confirm) {
          this.doEndJourney()
        }
      }
    })
  },

  // 执行结束行程
  doEndJourney() {
    wx.showLoading({ title: '结束中...' })
    
    wx.cloud.callFunction({
      name: 'team',
      data: {
        action: 'endJourney',
        teamId: this.data.teamId
      },
      success: (res) => {
        wx.hideLoading()
        if (res.result?.success) {
          wx.showToast({ title: '行程结束', icon: 'success' })
          this.getTeamDetail() // 刷新
        } else {
          wx.showToast({ title: res.result?.error || '结束失败', icon: 'none' })
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '结束失败', icon: 'none' })
      }
    })
  },

  // 显示邀请二维码弹窗
  showInviteQrCode() {
    this.setData({ showQrModal: true, qrSize: 200 })
    // 延迟一点再生成 canvas，确保弹窗已经渲染
    setTimeout(() => {
      this.generateTeamQrCode()
    }, 100)
  },

  // 隐藏邀请二维码弹窗
  hideInviteQrCode() {
    this.setData({ showQrModal: false })
  },

  // 生成队伍邀请二维码
  generateTeamQrCode() {
    const that = this
    const teamId = this.data.teamId
    const teamName = this.data.team?.teamName || '蓝旅队伍'
    if (!teamId) return

    // 邀请链接 - 使用 qrcodejs 生成二维码
    const inviteData = JSON.stringify({
      type: 'teamInvite',
      teamId: teamId,
      appid: getApp().appid
    })
    const size = that.data.qrSize || 200
    
    // 延迟绘制确保 canvas 已渲染
    setTimeout(() => {
      const query = wx.createSelectorQuery()
      query.select('#teamQr')
        .fields({ node: true, size: true })
        .exec((res) => {
          if (!res[0] || !res[0].node) {
            wx.showToast({ title: 'canvas获取失败', icon: 'none' })
            return
          }

          const canvas = res[0].node
          const ctx = canvas.getContext('2d')
          const dpr = wx.getSystemInfoSync().pixelRatio || 2
          
          canvas.width = size * dpr
          canvas.height = size * dpr
          ctx.scale(dpr, dpr)

          // 使用 qrcodejs 生成二维码
          const QRCode = require('../../node_modules/qrcodejs/qrcode.min.js')
          const qr = new QRCode(canvas, {
            text: inviteData,
            width: size,
            height: size,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
          })

          console.log('[team-detail] 二维码生成成功')
          // 在二维码上方绘制文字
          that.drawQrText(teamName, teamId)
        })
    }, 200)
  },

  // 在二维码上绘制文字说明
  drawQrText(teamName, teamId) {
    const that = this
    const size = that.data.qrSize || 200
    
    const query = wx.createSelectorQuery()
    query.select('#teamQr')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) {
          return
        }

        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getSystemInfoSync().pixelRatio || 2
        
        canvas.width = size * dpr
        ctx.scale(dpr, dpr)
        
        // 在顶部绘制队伍名称
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.fillRect(0, 0, size, 40)
        
        ctx.fillStyle = '#1a1a1a'
        ctx.font = 'bold 14px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(teamName, size / 2, 26)
        
        // 在底部绘制提示
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
        ctx.fillRect(0, size - 30, size, 30)
        
        ctx.fillStyle = '#0066CC'
        ctx.font = '12px sans-serif'
        ctx.fillText('蓝旅 - 扫码加入队伍', size / 2, size - 10)
      })
  },

  // 保存二维码到相册
  saveQrCodeToAlbum() {
    const that = this
    const qrSize = this.data.qrSize || 200

    wx.canvasToTempFilePath({
      canvasId: 'teamQr',
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            wx.showToast({ title: '已保存到相册', icon: 'success' })
          },
          fail: (err) => {
            console.error('saveQrCodeToAlbum fail', err)
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
        })
      },
      fail: (err) => {
        console.error('canvasToTempFilePath fail', err)
        wx.showToast({ title: '生成图片失败', icon: 'none' })
      }
    })
  },

  // 阻止冒泡
  noop() {}
})