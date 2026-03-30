// pages/index/index.js
// 高德配置
const AMAP_KEY = '4f3f05ab8fc35c293e54411675c241f1';
const { buildMapPolylines } = require('../../utils/track.js')
const { saveActiveTrackSession, clearActiveTrackSession } = require('../../utils/track-session.js')

// 轨迹采集配置
const CONFIG = {
  MIN_ACCURACY: 300,       // 精度 < 300米才记录（放宽，海上GPS精度较差）
  MIN_DISTANCE: 5,         // 距离 ≥ 5米记录（增大，减少静止点）
  MIN_TIME_INTERVAL: 2000, // 每2秒强制记录一次（缩短）
  MIN_SPEED: 0,             // 不过滤速度
  MAX_SPEED: 55,            // 速度 < 55 km/h（过滤异常跳点）
  // 停留点检测配置
  STOP_SPEED_THRESHOLD: 0.5,  // km/h 低于此速度视为可能停止
  STOP_DURATION_THRESHOLD: 2 * 60 * 1000, // 2分钟 静止超过此时长停止记录
  // 卡尔曼滤波配置
  KALMAN_PROCESS_NOISE: 0.01,
  KALMAN_MEASUREMENT_NOISE: 10
}

const CLOUD_SYNC_MIN_POINTS = 10
const CLOUD_SYNC_INTERVAL_MS = 60 * 1000

// 一维卡尔曼滤波 - 用于平滑GPS经纬度，抑制噪声和漂移
class KalmanFilter {
  constructor(processNoise = 0.01, measurementNoise = 10) {
    this.Q = processNoise;      // 过程噪声
    this.R = measurementNoise; // 测量噪声
    this.P = 1;                // 估计误差协方差
    this.K = 0;                // 卡尔曼增益
    this.x = null;             // 当前估计值
  }

  filter(measurement) {
    if (this.x === null) {
      this.x = measurement;
      return this.x;
    }
    // 预测
    this.P = this.P + this.Q;
    // 更新
    this.K = this.P / (this.P + this.R);
    this.x = this.x + this.K * (measurement - this.x);
    this.P = (1 - this.K) * this.P;
    return this.x;
  }
}

// 工具函数
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

Page({
  data: {
    hasUserInfo: false,
    userInfo: null,
    latitude: 23.099994,
    longitude: 113.324520,
    markers: [],
    polylines: [],
    scale: 14,
    subKey: 'G7KBZ-VLFCA-ZUFK2-CHSJA-XLK4F-YLFPY',
    enableRotate: false,
    showLocation: false,  // 初始不显示地图自带定位，避免二次弹窗
    isRecording: false,
    isPaused: false,
    isCaptain: false,  // 是否是队长
    activeTeam: null,  // 当前活跃队伍
    pauseStartTime: null,
    totalPauseTime: 0,  // 总暂停时长（毫秒）
    timerInterval: null,
    lastRecordTime: 0,  // 计时器
    currentActivity: null,
    enableSatellite: false,
    trackPoints: [],
    activityId: null,
    currentDistance: '0.00',
    currentSpeed: '0.0',
    currentDuration: '00:00:00',
    startTime: null,
    // 停留点检测状态
    stopStartTime: null,
    isStopped: false
  },
  onLoad() {
    this.login()
    this.getLocation()
  },
  onShow() {
    this.checkActiveActivity()
    this.checkActiveTeam()
  },
  onHide() {
    if (this.data.isRecording && this.data.activityId) {
      this.persistActiveTrackLocal()
    }
  },
  // 登录
  login() {
    wx.login({
      success: (res) => {
        wx.cloud.callFunction({
          name: 'user',
          data: { action: 'login', code: res.code },
          success: (loginRes) => {
            if (loginRes.result?.success) {
              this.setData({
                hasUserInfo: true,
                userInfo: {
                  nickName: loginRes.result.nickname || '微信用户',
                  avatarUrl: loginRes.result.avatarUrl || '',
                  openid: loginRes.result.openid || ''
                }
              })
            }
          }
        })
      }
    })
  },
  // 选择头像
  onChooseAvatar(e) {
    this.setData({ 'userInfo.avatarUrl': e.detail.avatarUrl })
    this.updateUserInfo()
  },
  // 更新用户信息
  updateUserInfo() {
    wx.cloud.callFunction({
      name: 'user',
      data: {
        action: 'updateUserInfo',
        data: {
          nickname: this.data.userInfo.nickName || '',
          avatarUrl: this.data.userInfo.avatarUrl || ''
        }
      }
    })
  },
  // 获取当前位置
  getLocation() {
    wx.getSetting({
      success: (settingRes) => {
        if (settingRes.authSetting['scope.userLocation']) {
          // 已授权，直接获取位置并开启 showLocation
          wx.getLocation({
            type: 'gcj02',
            success: (res) => {
              this.setData({
                latitude: res.latitude,
                longitude: res.longitude,
                showLocation: true,
                markers: [{
                  id: 0,
                  latitude: res.latitude,
                  longitude: res.longitude,
                  width: 30,
                  height: 30,
                }]
              })
              // 移动到当前位置
              const mapCtx = wx.createMapContext('myMap', this)
              mapCtx.moveToLocation()
            },
            fail: () => {
              wx.showToast({ title: '定位失败，请开启权限', icon: 'none' })
            }
          })
        } else {
          // 未授权，不开启 showLocation，避免二次弹窗
          // 用户点击开始记录时会请求授权，之后再开启
          console.log('[index] 定位未授权，等待用户点击开始记录时再请求')
        }
      }
    })
  },
  // 移动到当前位置
  moveToLocation() {
    const mapCtx = wx.createMapContext('map', this)
    mapCtx.moveToLocation()
  },
  // 切换卫星地图
  toggleSatellite() {
    this.setData({ enableSatellite: !this.data.enableSatellite })
  },
  // 开始记录轨迹
  startRecording() {
    const that = this
    
    // 先检查定位权限
    wx.getSetting({
      success: (settingRes) => {
        if (!settingRes.authSetting['scope.userLocation']) {
          // 未授权，请求授权
          wx.authorize({
            scope: 'scope.userLocation',
            success: () => {
              // 用户同意，开始获取位置
              that.doStartRecording()
            },
            fail: () => {
              // 用户拒绝，引导去设置页开启
              wx.showModal({
                title: '需要定位权限',
                content: '记录轨迹需要定位权限，请在设置中开启',
                confirmText: '去设置',
                success: (res) => {
                  if (res.confirm) {
                    wx.openSetting()
                  }
                }
              })
            }
          })
        } else {
          // 已授权，直接开始
          that.doStartRecording()
        }
      }
    })
  },

  // 实际开始记录
  doStartRecording() {
    const that = this
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        // 定位成功后开启 showLocation（此时已有授权，不会二次弹窗）
        that.setData({ showLocation: true })
        
        // 先创建活动，获取 activityId
        wx.cloud.callFunction({
          name: 'activity',
          data: { 
            action: 'create', 
            data: {
              sportType: 1, 
              startPoint: { latitude: res.latitude, longitude: res.longitude }
            }
          },
          success: (createRes) => {
            const activityId = createRes.result?.activityId || (createRes.result?.activity?._id)
            if (!activityId) {
              wx.showToast({ title: '创建活动失败', icon: 'none' })
              return
            }
            that._cloudSyncedCount = 0
            that._lastCloudSyncAt = Date.now()
            that._appendInProgress = false
            // 初始化卡尔曼滤波器（平滑GPS位置）
            that.latFilter = new KalmanFilter(CONFIG.KALMAN_PROCESS_NOISE, CONFIG.KALMAN_MEASUREMENT_NOISE)
            that.lngFilter = new KalmanFilter(CONFIG.KALMAN_PROCESS_NOISE, CONFIG.KALMAN_MEASUREMENT_NOISE)
            // 初始化停留点检测
            that.setData({
              activityId,  // 保存 activityId
              isRecording: true,
              startTime: Date.now(),
              stopStartTime: null,
              isStopped: false,
              trackPoints: [{ latitude: res.latitude, longitude: res.longitude, speed: 0, timestamp: Date.now() }],
              currentDistance: '0.00',
              currentSpeed: '0.0',
              markers: [{ id: 0, latitude: res.latitude, longitude: res.longitude, width: 30, height: 30 }]
            })
            that.startTimer()
            wx.showToast({ title: '开始记录', icon: 'success' })
            that.startLocationUpdate()
            that.persistActiveTrackLocal()
          },
          fail: () => {
            wx.showToast({ title: '创建活动失败', icon: 'none' })
          }
        })
      },
      fail: () => {
        wx.showModal({
          title: '定位失败',
          content: '无法获取当前位置，请检查是否开启定位权限',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting()
            }
          }
        })
      }
    })
  },
  // 停止记录轨迹
  stopRecording() {
    // 如果正在暂停中，结束暂停并记录
    if (this.data.isPaused && this.data.pauseStartTime) {
      const pauseEndTime = Date.now()
      const pauseDuration = pauseEndTime - this.data.pauseStartTime
      
      // 累加总暂停时长（使用 setData 保证数据同步）
      const totalPauseTime = this.data.totalPauseTime + pauseDuration
      this.setData({ totalPauseTime: totalPauseTime })
      
      // 立即保存暂停结束记录
      wx.cloud.callFunction({
        name: 'activity',
        data: { 
          action: 'resumeActivity', 
          activityId: this.data.activityId,
          data: {
            endTime: new Date(pauseEndTime),
            duration: Math.floor(pauseDuration / 1000)
          }
        }
      })
    }
    
    this.setData({ 
      isRecording: false,
      isPaused: false,
      pauseStartTime: null,
      totalPauseTime: 0
    })
    this.stopLocationUpdate()
    this.stopTimer()
    wx.showToast({ title: '已停止', icon: 'success' })
    this.saveActivity()
  },
  // 开始位置更新
  // 使用 wx.onLocationChange 持续监听，支持后台定位
  startLocationUpdate() {
    // 先关闭之前的监听
    this.stopLocationUpdate()
    
    // 停止之前的定时器（备用）
    if (this.data.locationTimer) {
      clearInterval(this.data.locationTimer)
    }
    
    // 开启持续定位监听 - 支持后台更新
    wx.startLocationUpdateBackground({
      success: () => {
      },
      fail: (err) => {
        //  fallback 到定时器轮询
        this.data.locationTimer = setInterval(() => {
          if (this.data.isRecording) {
            wx.getLocation({
              type: 'gcj02',
              success: (res) => {
                this.handleLocationUpdate({
                  latitude: res.latitude,
                  longitude: res.longitude,
                  accuracy: res.accuracy,
                  speed: res.speed || 0,
                  direction: res.direction || 0,
                  timestamp: Date.now()
                })
              },
              fail: (err) => {
              }
            })
          }
        }, 2000)
      }
    })
    
    // 监听位置变化事件（即使在后台也会触发）
    wx.onLocationChange((res) => {
      if (this.data.isRecording && !this.data.isPaused) {
        this.handleLocationUpdate({
          latitude: res.latitude,
          longitude: res.longitude,
          accuracy: res.accuracy,
          speed: res.speed || 0,
          direction: res.direction || 0,
          timestamp: Date.now()
        })
      }
    })
  },
  
  // 停止位置更新
  stopLocationUpdate() {
    if (this.data.locationTimer) {
      clearInterval(this.data.locationTimer)
      this.data.locationTimer = null
    }
    wx.stopLocationUpdate()
    wx.offLocationChange()
  },
  // 启动计时器
  startTimer() {
    // 每秒更新一次显示的时长
    this.data.timerInterval = setInterval(() => {
      if (this.data.isRecording && this.data.startTime) {
        const now = Date.now()
        let activeDuration = now - this.data.startTime - this.data.totalPauseTime
        if (this.data.isPaused && this.data.pauseStartTime) {
          activeDuration -= (now - this.data.pauseStartTime)
        }
        activeDuration = Math.max(0, activeDuration)
        this.setData({
          currentDuration: formatDuration(activeDuration)
        })
      }
    }, 1000)
  },
  // 停止计时器
  stopTimer() {
    if (this.data.timerInterval) {
      clearInterval(this.data.timerInterval)
      this.data.timerInterval = null
    }
  },
  // 页面销毁时停止监听
  onUnload() {
    this.stopLocationUpdate()
    this.stopTimer()
  },
  // 处理位置更新
  handleLocationUpdate(res) {
    const now = Date.now()
    const trackPoints = this.data.trackPoints
    const lastPoint = trackPoints[trackPoints.length - 1]
    
    // 1. 精度过滤：精度大于CONFIG.MIN_ACCURACY米的点不记录（accuracy越小越精确）
    // 处理 accuracy 不存在的兼容情况
    if (res.accuracy !== undefined && res.accuracy > CONFIG.MIN_ACCURACY) {
      console.log(`[index] 点被过滤：精度 ${res.accuracy} > ${CONFIG.MIN_ACCURACY}`)
      return
    }
    
    // 2. 暂停时不记录轨迹，只更新地图中心
    if (this.data.isPaused) {
      this.setData({
        latitude: res.latitude,
        longitude: res.longitude
      })
      return
    }
    
    // ===== 卡尔曼滤波平滑 =====
    // 对原始经纬度进行滤波，抑制GPS噪声和漂移
    const filteredLat = this.latFilter.filter(res.latitude)
    const filteredLng = this.lngFilter.filter(res.longitude)
    
    // 3. 计算时间间隔
    const lastRecordTime = this.data.lastRecordTime || 0
    const timeInterval = now - lastRecordTime
    
    // 4. 计算移动距离（使用滤波后的坐标）
    const distance = lastPoint ? calculateDistance(lastPoint.latitude, lastPoint.longitude, filteredLat, filteredLng) : 0
    
    // 5. 计算速度（优先用 GPS 速度，否则用距离计算）
    const speedKmh = res.speed > 0 ? res.speed * 3.6 : (distance / (timeInterval / 1000) * 3.6) || 0
    
    // ===== 停留点检测 =====
    // 速度低于阈值，可能静止
    if (speedKmh < CONFIG.STOP_SPEED_THRESHOLD) {
      if (!this.data.stopStartTime) {
        // 刚开始静止，记录开始时间
        this.setData({ stopStartTime: now })
      } else if (now - this.data.stopStartTime >= CONFIG.STOP_DURATION_THRESHOLD) {
        // 静止超过阈值，进入停止模式，不再记录新点（只更新地图中心）
        if (!this.data.isStopped) {
          console.log(`[index] 进入停留模式，静止超过 ${CONFIG.STOP_DURATION_THRESHOLD / 1000} 秒，停止记录新点`)
          this.setData({ isStopped: true })
        }
        this.setData({
          latitude: filteredLat,
          longitude: filteredLng
        })
        return
      }
    } else {
      // 恢复移动，重置停留检测
      if (this.data.isStopped) {
        console.log(`[index] 恢复移动，重新开始记录`)
        this.setData({ 
          stopStartTime: null, 
          isStopped: false 
        })
      } else {
        this.setData({ 
          stopStartTime: null
        })
      }
    }
    
    // 6. 判断是否需要记录
    const shouldRecord = !lastPoint || 
      timeInterval >= CONFIG.MIN_TIME_INTERVAL || 
      (distance >= CONFIG.MIN_DISTANCE)
    
    if (!shouldRecord) {
      // 即使不记录轨迹，也要更新地图中心
      this.setData({
        latitude: filteredLat,
        longitude: filteredLng
      })
      console.log(`[index] 点被过滤：距离 ${distance.toFixed(1)}m < ${CONFIG.MIN_DISTANCE}m，时间 ${timeInterval}ms < ${CONFIG.MIN_TIME_INTERVAL}ms`)
      return
    }

    // 异常高速跳点（多为 GPS 漂移），不写入轨迹
    if (lastPoint && speedKmh > CONFIG.MAX_SPEED) {
      this.setData({
        latitude: filteredLat,
        longitude: filteredLng
      })
      console.log(`[index] 点被过滤：速度 ${speedKmh.toFixed(1)}km/h > ${CONFIG.MAX_SPEED}km/h`)
      return
    }
    
    // 记录轨迹点（使用滤波后的坐标）
    const newPoint = { 
      latitude: filteredLat, 
      longitude: filteredLng, 
      speed: speedKmh, 
      accuracy: res.accuracy, 
      heading: res.direction, 
      timestamp: now 
    }
    const newTrackPoints = [...trackPoints, newPoint]
    const prevMeters = parseFloat(this.data.currentDistance) * 1000 || 0
    const totalMeters = prevMeters + distance

    // 更新记录时间
    this.setData({ lastRecordTime: now })
    
    // 计算运动时长（排除暂停时间）
    let activeDuration = now - this.data.startTime - this.data.totalPauseTime
    if (this.data.isPaused && this.data.pauseStartTime) {
      activeDuration -= (now - this.data.pauseStartTime)
    }
    activeDuration = Math.max(0, activeDuration)
    
    // ===== 增量更新 polylines（不需要全量重计算，提升性能）=====
    let polylines = this.data.polylines || []
    const basePolylineOptions = {
      color: '#0066CC',
      width: 6,
      dottedLine: false,
      borderColor: '#004080',
      borderWidth: 2
    }
    
    if (polylines.length === 0) {
      // 初始情况，全量计算
      polylines = buildMapPolylines(newTrackPoints)
    } else {
      // 增量更新：追加到最后一段
      const lastSegment = polylines[polylines.length - 1]
      if (lastSegment.points.length < 400) {
        // 最后一段还没满，直接追加
        lastSegment.points.push(newPoint)
      } else {
        // 最后一段已满，新建一段（和前一段重叠一个点保证连续）
        const prevLastPoint = lastSegment.points[lastSegment.points.length - 1]
        polylines.push({ 
          ...basePolylineOptions, 
          points: [prevLastPoint, newPoint] 
        })
      }
    }
    
    // 移除地图中心的配速显示
    this.setData({
      trackPoints: newTrackPoints,
      latitude: filteredLat,  // 地图中心跟随定位
      longitude: filteredLng,
      currentDistance: (totalMeters / 1000).toFixed(2),
      currentSpeed: speedKmh.toFixed(1),
      currentDuration: formatDuration(Math.max(0, activeDuration)),
      polylines: polylines,
      // 固定起点标记，不跟随移动
      markers: newTrackPoints.length === 1 ? [{
        id: 0,
        latitude: newTrackPoints[0].latitude,
        longitude: newTrackPoints[0].longitude,
        width: 40,
        height: 40,
        callout: { content: '起点', padding: 8, borderRadius: 4, display: 'ALWAYS' }
      }] : []
    }, () => {
      console.log(`[index] 已添加轨迹点（卡尔曼滤波），当前共 ${newTrackPoints.length} 点，polylines ${polylines.length} 段`)
      this.persistActiveTrackLocal()
      this.tryCloudIncrementalSync()
    })
  },
  // 本地持久化：进行中划行会话（防崩溃/杀进程）
  buildPersistPayload() {
    return {
      v: 1,
      activityId: this.data.activityId,
      trackPoints: this.data.trackPoints,
      startTime: this.data.startTime,
      totalPauseTime: this.data.totalPauseTime,
      isPaused: this.data.isPaused,
      pauseStartTime: this.data.pauseStartTime,
      lastRecordTime: this.data.lastRecordTime,
      currentDistance: this.data.currentDistance,
      cloudSyncedCount: this._cloudSyncedCount || 0,
      savedAt: Date.now()
    }
  },
  persistActiveTrackLocal() {
    if (!this.data.isRecording || !this.data.activityId) return
    saveActiveTrackSession(this.buildPersistPayload())
  },
  // 云端增量检查点：每 N 点或每 60 秒
  tryCloudIncrementalSync() {
    if (!this.data.isRecording || !this.data.activityId) return
    if (this._appendInProgress) return
    const pts = this.data.trackPoints
    const n = pts.length
    const synced = this._cloudSyncedCount || 0
    if (n <= synced) return
    const unsynced = n - synced
    const now = Date.now()
    const needByCount = unsynced >= CLOUD_SYNC_MIN_POINTS
    const needByTime = (now - (this._lastCloudSyncAt || 0)) >= CLOUD_SYNC_INTERVAL_MS
    if (!needByCount && !needByTime) return

    const slice = pts.slice(synced)
    this._appendInProgress = true
    const payloadPoints = slice.map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      speed: p.speed || 0,
      accuracy: p.accuracy || 0,
      heading: p.heading || 0,
      timestamp: p.timestamp
    }))
    wx.cloud.callFunction({
      name: 'activity',
      data: {
        action: 'appendTrackPoints',
        activityId: this.data.activityId,
        points: payloadPoints
      },
      complete: () => {
        this._appendInProgress = false
      },
      success: (res) => {
        const r = res.result
        if (r && r.success !== false && !r.error) {
          this._cloudSyncedCount = n
          this._lastCloudSyncAt = Date.now()
          this.persistActiveTrackLocal()
        }
      },
      fail: () => {
        this._appendInProgress = false
      }
    })
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
  // 保存活动
  // 保存活动并优化轨迹
  saveActivity() {
    if (!this.data.activityId) return
    
    wx.showLoading({ title: '保存中...' })
    
    // 保存轨迹点（只做一次，不再重复保存）
    this.saveTrackPoints(this.data.activityId)
    
    // 调用高德轨迹优化API（异步，不阻塞）
    if (this.data.trackPoints.length >= 2) {
      this.optimizeTrackWithAmap()
    }
    
    // 先显示成功，再清理数据
    if (this.data.trackPoints.length >= 2) {
      wx.showToast({ title: '保存成功', icon: 'success' })
    } else {
      wx.showToast({ title: '行程太短，无法被记录', icon: 'none' })
    }
    
    // 延迟清理，确保异步操作完成
    setTimeout(() => {
      this._cloudSyncedCount = 0
      this._lastCloudSyncAt = 0
      this._appendInProgress = false
      this.setData({
        activityId: null,
        trackPoints: [],
        polylines: [],
        currentDistance: '0.00',
        currentSpeed: '0.0',
        currentDuration: '00:00:00',
        isRecording: false,
        isPaused: false
      })
    }, 500)
    
    wx.hideLoading()
  },

  // 调用高德轨迹优化API
  optimizeTrackWithAmap() {
    const that = this
    const activityId = this.data.activityId  // 先保存，防止被清空
    
    // 速度单位：本地已存 km/h，直接使用
    const points = this.data.trackPoints.map(p => ({
      location: `${p.longitude},${p.latitude}`,
      locatetime: Math.floor(p.timestamp / 1000),
      speed: p.speed || 0,  // 直接用 km/h
      accuracy: p.accuracy || 0
    }))
    
    wx.request({
      url: 'https://restapi.amap.com/v4/track/optimize',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: {
        key: AMAP_KEY,
        points: points,
        road_correct: false,  // 关闭绑路（海上无路）
        denoise: true,         // 开启去噪
        compress: 2            // 适度抽稀
      },
      success(res) {
        if (res.data.status === '1') {
          // 更新活动距离为优化后的值（使用保存的 activityId）
          wx.cloud.callFunction({
            name: 'activity',
            data: {
              action: 'updateDistance',
              activityId: activityId,
              optimizedDistance: res.data.distance || 0
            }
          })
        } else {
        }
      },
      fail(err) {
      }
    })
  },

  // 保存轨迹点
  saveTrackPoints(activityId) {
    const that = this
    
    // 先获取用户信息获取 userId
    wx.cloud.callFunction({
      name: 'user',
      data: { action: 'getUserInfo' },
      success: (res) => {
        const userId = res.result?.userInfo?._id || ''
        
        const points = that.data.trackPoints.map((p, index) => ({
          activityId,
          userId,
          pointOrder: index + 1,
          latitude: p.latitude,
          longitude: p.longitude,
          speed: p.speed || 0,
          accuracy: p.accuracy || 0,
          heading: p.heading || 0,
          timestamp: new Date(p.timestamp)
        }))
        
        // 保存轨迹点
        wx.cloud.callFunction({
          name: 'activity',
          data: { action: 'saveBatchTrackPoints', activityId, points }
        }).then(() => {
          clearActiveTrackSession()
          // 轨迹点保存后，更新活动状态为已结束
          const lastPoint = that.data.trackPoints.length > 0 
            ? that.data.trackPoints[that.data.trackPoints.length - 1] 
            : null
          
          // 计算运动时长
          let activeDuration = 0
          if (that.data.startTime) {
            const now = Date.now()
            activeDuration = now - that.data.startTime - that.data.totalPauseTime
            if (that.data.isPaused && that.data.pauseStartTime) {
              activeDuration -= (now - that.data.pauseStartTime)
            }
            activeDuration = Math.max(0, activeDuration)
          }
          
          wx.cloud.callFunction({
            name: 'activity',
            data: { 
              action: 'end', 
              activityId,
              data: { 
                endPoint: lastPoint ? { 
                  latitude: lastPoint.latitude,
                  longitude: lastPoint.longitude
                } : null,
                duration: Math.floor(activeDuration / 1000)  // 转换为秒
              }
            },
            success: (endRes) => {
  
            },
            fail: (endErr) => {
            }
          })
        })
      }
    })
  },
  // 暂停/继续记录
  pauseRecording() {
    const isPaused = !this.data.isPaused
    const activityId = this.data.activityId
    
    if (isPaused) {
      // 点击暂停，记录暂停开始时间
      const pauseStartTime = Date.now()
      this.setData({ 
        isPaused: true,
        pauseStartTime: pauseStartTime
      })
      
      // 立即保存暂停开始时间到云端
      wx.cloud.callFunction({
        name: 'activity',
        data: { 
          action: 'pauseActivity', 
          activityId: activityId,
          data: {
            startTime: new Date(pauseStartTime)
          }
        }
      })
    } else {
      // 点击继续，计算本次暂停时长
      const pauseStartTime = this.data.pauseStartTime
      const pauseEndTime = Date.now()
      const pauseDuration = pauseStartTime ? pauseEndTime - pauseStartTime : 0
      
      // 累加总暂停时长（已通过 setData，保证数据同步）
      const totalPauseTime = this.data.totalPauseTime + pauseDuration
      
      this.setData({ 
        isPaused: false,
        pauseStartTime: null,
        totalPauseTime: totalPauseTime
      })
      
      // 立即保存暂停结束时间到云端
      wx.cloud.callFunction({
        name: 'activity',
        data: { 
          action: 'resumeActivity', 
          activityId: activityId,
          data: {
            endTime: new Date(pauseEndTime),
            duration: Math.floor(pauseDuration / 1000)
          }
        }
      })
    }
    
    wx.showToast({ title: isPaused ? '已暂停' : '已继续', icon: 'success' })
    this.persistActiveTrackLocal()
  },
  // 跳转到组队页面
  goToTeam() {
    wx.switchTab({ url: '/pages/team/team' })
  },
  // 检查进行中的活动
  checkActiveActivity() {
    const that = this
    wx.cloud.callFunction({
      name: 'activity',
      data: { action: 'getActive' },
      success: (res) => {
        if (res.result?.activity) {
          const activity = res.result.activity

          // 如果活动已经结束（可能是队长在队伍中点击了结束行程），清理本地状态，允许重新开始
          if (activity.status === 2) {
            console.log('[index] 检测到当前活动已结束（队伍已结束行程），清理本地状态')
            // 清理本地状态，允许用户重新开始划行
            that.setData({
              activityId: null,
              trackPoints: [],
              polylines: [],
              currentDistance: '0.00',
              currentSpeed: '0.0',
              currentDuration: '00:00:00',
              isRecording: false,
              isPaused: false,
              currentActivity: null
            })
            that._cloudSyncedCount = 0
            that._lastCloudSyncAt = 0
            wx.showToast({ title: '队伍行程已结束', icon: 'success' })
            return
          }
          
          // 活动仍在进行中，恢复状态
          // 恢复所有状态
          that.setData({ 
            currentActivity: activity, 
            activityId: activity._id,
            isRecording: true,
            startTime: activity.startTime ? new Date(activity.startTime).getTime() : Date.now(),
            totalPauseTime: activity.totalPauseTime || 0,
            isPaused: activity.isPaused || false,
            stopStartTime: null,
            isStopped: false
          })

          // 初始化卡尔曼滤波器
          that.latFilter = new KalmanFilter(CONFIG.KALMAN_PROCESS_NOISE, CONFIG.KALMAN_MEASUREMENT_NOISE)
          that.lngFilter = new KalmanFilter(CONFIG.KALMAN_PROCESS_NOISE, CONFIG.KALMAN_MEASUREMENT_NOISE)
          
          // 获取轨迹点，恢复地图显示
          wx.cloud.callFunction({
            name: 'activity',
            data: { action: 'getTrackPoints', activityId: activity._id },
            success: (trackRes) => {
              if (trackRes.result?.trackPoints) {
                that.setData({
                  trackPoints: trackRes.result.trackPoints
                })
                
                // 重置增量同步计数（关键修复：恢复后 _cloudSyncedCount 需要与 trackPoints 长度一致）
                that._cloudSyncedCount = trackRes.result.trackPoints.length
                that._lastCloudSyncAt = Date.now()
                
                // 重新构建polylines显示（恢复时全量计算）
                const polylines = buildMapPolylines(trackRes.result.trackPoints)
                that.setData({
                  polylines: polylines
                })
                
                // 用最后一个点初始化卡尔曼滤波
                if (trackRes.result.trackPoints.length > 0) {
                  const last = trackRes.result.trackPoints[trackRes.result.trackPoints.length - 1]
                  that.latFilter.filter(last.latitude)
                  that.lngFilter.filter(last.longitude)
                }
                
                // 计算统计数据
                if (trackRes.result.trackPoints.length > 0) {
                  const stats = that.calculateStats(trackRes.result.trackPoints)
                  that.setData({
                    currentDistance: stats.distance.toFixed(2),
                    currentSpeed: stats.avgSpeed.toFixed(1),
                    currentDuration: formatDuration(stats.duration * 1000)
                  })
                  
                  // 地图中心移动到最后一个点
                  const lastPoint = trackRes.result.trackPoints[trackRes.result.trackPoints.length - 1]
                  that.setData({
                    latitude: lastPoint.latitude,
                    longitude: lastPoint.longitude
                  })
                }
              }
            }
          })
          
          // 重启位置采集和计时器
          that.startLocationUpdate()
          that.startTimer()
          
          // 恢复本地会话存储
          saveActiveTrackSession({
            activityId: activity._id,
            trackPoints: that.data.trackPoints,
            startTime: that.data.startTime,
            totalPauseTime: that.data.totalPauseTime,
            isPaused: that.data.isPaused
          })
        }
      }
    })
  },
  onMarkerTap() {},
  onControlTap() {},

  // 计算统计数据
  calculateStats(points) {
    let totalDistance = 0, maxSpeed = 0, totalSpeed = 0, speedCount = 0

    for (let i = 1; i < points.length; i++) {
      totalDistance += calculateDistance(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude)
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
      distance: totalDistance / 1000,
      duration: Math.floor(duration / 1000),
      avgSpeed: speedCount > 0 ? (totalSpeed / speedCount) : 0,
      maxSpeed: maxSpeed
    }
  },

  // 计算统计数据
  calculateStats(points) {
    let totalDistance = 0, maxSpeed = 0, totalSpeed = 0, speedCount = 0

    for (let i = 1; i < points.length; i++) {
      totalDistance += calculateDistance(points[i - 1].latitude, points[i - 1].longitude, points[i].latitude, points[i].longitude)
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
      distance: totalDistance / 1000,
      duration: Math.floor(duration / 1000),
      avgSpeed: speedCount > 0 ? (totalSpeed / speedCount) : 0,
      maxSpeed: maxSpeed
    }
  }
})

// 检查当前活跃队伍（组队中或行进中）
checkActiveTeam() {
  const that = this
  wx.cloud.callFunction({
    name: 'team',
    data: { action: 'getActive' },
    success: (res) => {
      if (res.result?.team) {
        that.setData({
          activeTeam: res.result.team,
          isCaptain: res.result.team.isCaptain
        })
      } else {
        that.setData({
          activeTeam: null,
          isCaptain: false
        })
      }
    }
  })
},

// 队长点击队伍出发
teamStartJourney() {
  if (!this.data.activeTeam || !this.data.isCaptain) {
    wx.showToast({ title: '只有队长可以出发', icon: 'none' })
    return
  }
  
  wx.showLoading({ title: '出发中...' })
  wx.cloud.callFunction({
    name: 'team',
    data: { 
      action: 'startJourney', 
      teamId: this.data.activeTeam._id 
    },
    success: (res) => {
      wx.hideLoading()
      if (res.result?.success) {
        wx.showToast({ title: '出发！', icon: 'success' })
        // 刷新队伍状态
        this.checkActiveTeam()
        this.checkActiveActivity()
      } else {
        wx.showToast({ title: res.result?.error || '出发失败', icon: 'none' })
      }
    },
    fail: (err) => {
      wx.hideLoading()
      wx.showToast({ title: '出发失败', icon: 'none' })
    }
  })
},

// 队长点击队伍结束
teamEndJourney() {
  if (!this.data.activeTeam || !this.data.isCaptain) {
    wx.showToast({ title: '只有队长可以结束', icon: 'none' })
    return
  }
  
  wx.showModal({
    title: '结束滑行',
    content: '确定结束全队滑行吗？',
    success: (res) => {
      if (res.confirm) {
        wx.showLoading({ title: '结束中...' })
        wx.cloud.callFunction({
          name: 'team',
          data: { 
            action: 'endJourney', 
            teamId: this.data.activeTeam._id 
          },
          success: (res) => {
            wx.hideLoading()
            if (res.result?.success) {
              wx.showToast({ title: '已结束', icon: 'success' })
              // 刷新队伍状态
              this.checkActiveTeam()
              this.checkActiveActivity()
            } else {
              wx.showToast({ title: res.result?.error || '结束失败', icon: 'none' })
            }
          },
          fail: (err) => {
            wx.hideLoading()
            wx.showToast({ title: '结束失败', icon: 'none' })
          }
        })
      }
    }
  })
},
