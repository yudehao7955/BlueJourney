const { buildMapPolylines } = require('../../utils/track.js')

// pages/activity-detail/activity-detail.js
Page({
  data: {
    activityId: null,
    activity: null,
    trackPoints: [],
    polylines: [],
    markers: [],
    latitude: 23.099994,
    longitude: 113.324520,
    scale: 14,
    subKey: 'G7KBZ-VLFCA-ZUFK2-CHSJA-XLK4F-YLFPY',
    stats: { distance: 0, duration: '00:00:00', avgSpeed: 0, maxSpeed: 0 },
    // 新增：抽屉状态，默认收起
    showPanel: false
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ activityId: options.id })
      this.getActivityDetail(options.id)
    }
  },

  // 切换抽屉显示
  togglePanel() {
    const willShow = !this.data.showPanel
    this.setData({ showPanel: willShow })
    
    // 抽屉打开时，自动缩放显示所有轨迹
    if (willShow && this.data.trackPoints.length > 0) {
      const pts = this.data.trackPoints.map(p => ({ latitude: p.latitude, longitude: p.longitude }))
      wx.nextTick(() => {
        const ctx = wx.createMapContext('detailMap', this)
        ctx.includePoints({ points: pts, padding: [100, 80, 200, 80] })
      })
    }
  },

  // 获取活动详情
  getActivityDetail(activityId) {
    wx.showLoading({ title: '加载中...' })
    
    wx.cloud.callFunction({
      name: 'activity',
      data: { action: 'getDetail', activityId },
      success: (res) => {
        wx.hideLoading()
        if (res.result?.activity) {
          const activity = res.result.activity
          
          // 格式化日期为本地时间
          if (activity.createTime) {
            const d = new Date(activity.createTime)
            const year = d.getFullYear()
            const month = (d.getMonth() + 1).toString().padStart(2, '0')
            const day = d.getDate().toString().padStart(2, '0')
            const hour = d.getHours().toString().padStart(2, '0')
            const minute = d.getMinutes().toString().padStart(2, '0')
            activity.createTimeFormatted = `${year}-${month}-${day} ${hour}:${minute}`
          }
          
          // 格式化结束时间
          if (activity.endTime) {
            const d = new Date(activity.endTime)
            const year = d.getFullYear()
            const month = (d.getMonth() + 1).toString().padStart(2, '0')
            const day = d.getDate().toString().padStart(2, '0')
            const hour = d.getHours().toString().padStart(2, '0')
            const minute = d.getMinutes().toString().padStart(2, '0')
            activity.endTimeFormatted = `${year}-${month}-${day} ${hour}:${minute}`
          }
          
          this.setData({ activity })
          this.getTrackPoints(activityId)
        }
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    })
  },

  // 获取轨迹点
  getTrackPoints(activityId) {
    wx.cloud.callFunction({
      name: 'activity',
      data: { action: 'getTrackPoints', activityId },
      success: (res) => {
        if (res.result?.trackPoints) {
          this.processTrackPoints(res.result.trackPoints)
        }
      }
    })
  },

  // 处理轨迹点数据
  processTrackPoints(points) {
    if (points.length === 0) {
      wx.showToast({ title: '无轨迹点数据', icon: 'none' })
      return
    }

    // 调试输出第一个点
    if (points.length > 0) {
    }

    const polylines = buildMapPolylines(points)

    const markers = [
      { id: 0, latitude: points[0].latitude, longitude: points[0].longitude, width: 30, height: 30, callout: { content: '起点', padding: 8, borderRadius: 4, display: 'ALWAYS' } },
      { id: 1, latitude: points[points.length - 1].latitude, longitude: points[points.length - 1].longitude, width: 30, height: 30, callout: { content: '终点', padding: 8, borderRadius: 4, display: 'ALWAYS' } }
    ]

    const centerIdx = Math.floor(points.length / 2)

    // 优先使用数据库已有的统计数据，如果没有再用轨迹点计算
    let stats
    const activity = this.data.activity
    if (activity && activity.totalDistance > 0) {
      stats = {
        distance: (activity.totalDistance / 1000).toFixed(2),
        duration: this.formatDuration(activity.duration * 1000),
        avgSpeed: (activity.avgSpeed || 0).toFixed(1),
        maxSpeed: (activity.maxSpeed || 0).toFixed(1)
      }
    } else {
      stats = this.calculateStats(points)
    }

    this.setData({
      trackPoints: points,
      polylines: polylines,
      markers,
      latitude: points[centerIdx].latitude,
      longitude: points[centerIdx].longitude,
      stats: stats
    }, () => {
      const pts = points.map(p => ({ latitude: p.latitude, longitude: p.longitude }))
      wx.nextTick(() => {
        const ctx = wx.createMapContext('detailMap', this)
        ctx.includePoints({ points: pts, padding: [100, 80, 160, 80] })
      })
    })
  },

  // 计算统计数据
  calculateStats(points) {
    let totalDistance = 0, maxSpeed = 0, totalSpeed = 0, speedCount = 0

    for (let i = 1; i < points.length; i++) {
      totalDistance += this.calculateDistance(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude)
      if (points[i].speed > 0) {
        maxSpeed = Math.max(maxSpeed, points[i].speed)
        totalSpeed += points[i].speed
        speedCount++
      }
    }

    let duration = 0
    if (points[0]?.timestamp && points[points.length - 1]?.timestamp) {
      duration = new Date(points[points.length - 1].timestamp).getTime() - new Date(points[0].timestamp).getTime()
    }

    return {
      distance: (totalDistance / 1000).toFixed(2),
      duration: this.formatDuration(duration),
      avgSpeed: speedCount > 0 ? (totalSpeed / speedCount).toFixed(1) : '0',
      maxSpeed: maxSpeed > 0 ? maxSpeed.toFixed(1) : '0'
    }
  },

  // 计算两点距离（米）
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  },

  // 格式化时长
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000)
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  },

  // 返回上一页
  goBack() {
    wx.navigateBack()
  },

  // 分享
  shareActivity() {
    wx.showToast({ title: '生成分享中...', icon: 'none' })
  },

  // 分享给朋友
  onShareAppMessage() {
    return {
      title: `我完成了 ${this.data.stats.distance}km 的划行！`,
      path: `/pages/activity-detail/activity-detail?id=${this.data.activityId}`
    }
  }
})