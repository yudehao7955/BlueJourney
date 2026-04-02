// pages/index/index.js
// 高德配置
const AMAP_KEY = '4f3f05ab8fc35c293e54411675c241f1';
const { buildMapPolylines, calculateDistance, calculateStats, formatDuration } = require('../../utils/track.js')
const { saveActiveTrackSession, clearActiveTrackSession } = require('../../utils/track-session.js')
const { logDebug, copyDebugLog, clearDebugLog } = require('../../utils/debug.js')

// 轨迹采集配置（优化方案参数）
const CONFIG = Object.freeze({
  MIN_ACCURACY: 1000,
  TIME_THRESHOLD: 3000,      // 时间阈值（毫秒）- 双过滤
  DISTANCE_THRESHOLD: 10,    // 距离阈值（米）- 双过滤
  MAX_RENDER_POINTS: 1500,   // 最大渲染点数，超过则抽稀
  ABNORMAL_SPEED: 50,        // 异常速度阈值（米/秒）- GPS漂移过滤
  MIN_SPEED: 0,
  MAX_SPEED: 500,
  STOP_SPEED_THRESHOLD: 0.5,  // km/h 低于此速度视为可能停止（已放宽判断）
  STOP_DURATION_THRESHOLD: 2 * 60 * 1000, // 2分钟
  STOP_MOVE_THRESHOLD: 5,  // 移动距离阈值（米），超过此距离视为移动中
  KALMAN_PROCESS_NOISE: 0.01,
  KALMAN_MEASUREMENT_NOISE: 10,
  RENDER_INTERVAL_MS: 1000  // 界面渲染刷新间隔（低频渲染）
})

// DEBUG_MODE 从 config.js 引入
const DEBUG_MODE = require('../../utils/config.js').DEBUG_MODE

const CLOUD_SYNC_MIN_POINTS = 2
const CLOUD_SYNC_INTERVAL_MS = 30 * 1000  // 30秒
const MAX_CLOUD_SYNC_RETRIES = 3  // 云同步最大重试次数

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
    lastRecordTime: 0,  // 最后记录时间
    renderTimer: null,  // 地图渲染定时器（低频渲染）
    currentActivity: null,
    enableSatellite: false,
    trackPoints: [],     // 原始数据层（所有经过过滤的点）
    renderPoints: 0,     // 渲染点数统计
    activityId: null,
    currentDistance: '0.00',
    currentSpeed: '0.0',
    currentDuration: '00:00:00',
    startTime: null,
    // 停留点检测状态
    stopStartTime: null,
    isStopped: false,
    // 调试模式（从本地存储读取全局设置）
    debugMode: false,
    debugLogs: [],
    debugScrollTop: 0,
    debugPanelCollapsed: false
  },

  // 内存存储（不触发渲染）- 优化方案：高频采集低频渲染
  rawLocations: [],      // 原始点内存存储（所有通过过滤的点）
  lastLocation: null,    // 上一个原始点（用于计算距离和速度）
  totalDistance: 0,      // 总距离（内存累加，减少计算）
  onLoad() {
    // 绑定位置变化回调，确保 this 正确
    this.handleLocationChangeBound = (res) => {
      this.handleLocationUpdate(res)
    }
    // 读取全局调试模式设置
    try {
      const debugMode = wx.getStorageSync('debugMode')
      this.setData({ debugMode: debugMode !== false })
    } catch (e) {
      this.setData({ debugMode: false })
    }
    logDebug(this, '=== 页面加载 ===', '[首页]')
    this.login()
    this.getLocation()
  },
  onShow() {
    // 每次显示页面时重新读取调试模式设置，保证设置生效
    try {
      const debugMode = wx.getStorageSync('debugMode')
      this.setData({ debugMode: debugMode !== false })
    } catch (e) {
      this.setData({ debugMode: false })
    }
    logDebug(this, '=== 切到前台 ===', '[首页]')
    // 每次显示页面拉取最新队伍信息，保证人数和状态是最新的（解决HOME-7-001：队员加入后首页不刷新人数问题）
    this.checkActiveActivity()
    this.checkActiveTeam()
  },
  onHide() {
    logDebug(this, '=== 切到后台 ===', '[首页]')
    if (this.data.isRecording && this.data.activityId) {
      this.persistActiveTrackLocal()
    }
  },
  // 登录
  login() {
    logDebug(this, '=== 开始登录 ===', '[首页]')
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
  // 请求定位权限
  requestLocationPermission() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (settingRes) => {
          if (settingRes.authSetting['scope.userLocation']) {
            resolve(true)
          } else {
            wx.authorize({
              scope: 'scope.userLocation',
              success: () => resolve(true),
              fail: () => resolve(false)
            })
          }
        },
        fail: () => resolve(false)
      })
    })
  },

  // 获取当前位置（仅用于初始化显示）
  getLocation() {
    logDebug(this, '获取定位...', '[首页]')
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
          // 未授权，不主动申请，等待用户点击开始记录时再申请
          console.log('[index] 未获取定位授权，等待用户主动开始记录')
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
  async startRecording() {
    // 先检查定位权限
    const hasPermission = await this.requestLocationPermission()
    if (!hasPermission) {
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
      return
    }
    // 已授权，开始录制
    this.doStartRecording()
  },

  // 实际开始记录
  doStartRecording() {
    logDebug(this, '=== 开始划行 ===', '[首页]')
    const that = this
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        // 定位成功，不开启 showLocation 避免默认蓝色圆点
        
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
          success: async (createRes) => {
            const activityId = createRes.result?.activityId || (createRes.result?.activity?._id)
            if (!activityId) {
              wx.showToast({ title: '创建活动失败', icon: 'none' })
              return
            }
            logDebug(this, '活动ID: ' + activityId)
            that._cloudSyncedCount = 0
            that._lastCloudSyncAt = Date.now()
            that._appendInProgress = false
            // 初始化卡尔曼滤波器（平滑GPS位置）
            that.latFilter = new KalmanFilter(CONFIG.KALMAN_PROCESS_NOISE, CONFIG.KALMAN_MEASUREMENT_NOISE)
            that.lngFilter = new KalmanFilter(CONFIG.KALMAN_PROCESS_NOISE, CONFIG.KALMAN_MEASUREMENT_NOISE)
            // 初始化优化方案内存存储
            that.rawLocations = []
            that.totalDistance = 0
            const firstPoint = { 
              latitude: res.latitude, 
              longitude: res.longitude, 
              speed: 0, 
              timestamp: Date.now() 
            }
            that.lastLocation = firstPoint
            that.rawLocations.push(firstPoint)
            
            // 初始化停留点检测
            that.setData({
              activityId,  // 保存 activityId
              isRecording: true,
              startTime: Date.now(),
              stopStartTime: null,
              isStopped: false,
              trackPoints: [firstPoint],
              renderPoints: that.rawLocations.length,
              currentDistance: '0.00',
              currentSpeed: '0.0',
              markers: [{ id: 0, latitude: res.latitude, longitude: res.longitude, width: 30, height: 30 }]
            })
            that.startTimer()
            wx.showToast({ title: '开始记录', icon: 'success' })
            that.startLocationUpdate()
            // 启动低频渲染定时器（优化方案核心）
            that.data.renderTimer = setInterval(() => that.refreshMap(), CONFIG.RENDER_INTERVAL_MS)
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
    // 停止低频渲染定时器
    if (this.data.renderTimer) {
      clearInterval(this.data.renderTimer)
      this.data.renderTimer = null
    }
    this.stopLocationUpdate()
    this.stopTimer()
    wx.showToast({ title: '已停止', icon: 'success' })
    this.saveActivity()
  },
  // 开始位置更新
  // 使用 wx.onLocationChange 持续监听，支持后台定位
  startLocationUpdate() {
    const that = this
    // 先关闭之前的监听
    this.stopLocationUpdate()
    
    // 停止之前的定时器（备用）
    if (this.data.locationTimer) {
      clearInterval(this.data.locationTimer)
      this.setData({ locationTimer: null })
    }
    
    // 先检查后台定位权限状态
    wx.getSetting({
      success: (settingRes) => {
        const hasBackgroundPermission = settingRes.authSetting['scope.userLocationBackground']
        
        // 如果用户之前明确拒绝过后台定位，引导去设置开启
        if (hasBackgroundPermission === false) {
          console.log('[index] 用户已拒绝后台定位，引导去设置')
          wx.showModal({
            title: '需要后台定位权限',
            content: '为了在息屏时完整记录运动轨迹，请在设置中开启后台定位权限',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                // 用户点击去设置，跳转设置页
                wx.openSetting({
                  success: (settingResult) => {
                    // 用户在设置页授权后回来，重新尝试开启后台定位
                    if (settingResult.authSetting['scope.userLocationBackground']) {
                      console.log('[index] 用户开启后台定位，重新启动')
                      that.startLocationUpdate()
                    } else {
                      // 仍未授权，降级前台轮询
                      that.startForegroundPolling()
                      wx.onLocationChange(that.handleLocationChangeBound)
                    }
                  },
                  fail: () => {
                    // 打开设置失败，降级前台轮询
                    that.startForegroundPolling()
                    wx.onLocationChange(that.handleLocationChangeBound)
                  }
                })
              } else {
                // 用户取消，直接降级前台轮询
                that.startForegroundPolling()
                wx.onLocationChange(that.handleLocationChangeBound)
              }
            }
          })
          return
        }
        
        // 如果未询问过（undefined）或已授权（true），尝试开启后台定位
        // 如果是第一次调用，微信会自动弹窗询问用户授权
        wx.startLocationUpdateBackground({
          success: () => {
            console.log('[index] 后台定位启动成功')
          },
          fail: (err) => {
            //  fallback 到定时器轮询
            console.warn('[index] 后台定位启动失败，降级为前台轮询', err)
            wx.showToast({
              title: '已切换至前台定位模式，息屏后可能中断轨迹',
              icon: 'none',
              duration: 3000
            })
            that.startForegroundPolling()
          }
        })
        
        // 监听位置变化事件（即使在后台也会触发）
        // 不要用闭包，确保每次都调用当前实例最新的 handleLocationUpdate 和读取最新 data
        wx.onLocationChange(that.handleLocationChangeBound)
      }
    })
  },
  
  // 前台轮询定位（降级方案）
  startForegroundPolling() {
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
  },
  
  // 停止位置更新
  stopLocationUpdate() {
    if (this.data.locationTimer) {
      clearInterval(this.data.locationTimer)
      this.data.locationTimer = null
    }
    if (this.data.renderTimer) {
      clearInterval(this.data.renderTimer)
      this.data.renderTimer = null
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
  // 处理位置更新（优化方案：高频采集存入内存，不每次渲染）
  handleLocationUpdate(res) {
    const now = Date.now()
    const last = this.lastLocation

    // 1. 精度过滤：精度大于CONFIG.MIN_ACCURACY米的点不记录（accuracy越小越精确）
    if (res.accuracy !== undefined && res.accuracy > CONFIG.MIN_ACCURACY) {
      if (DEBUG_MODE) {
        logDebug(this, `过滤: 精度${res.accuracy}m > ${CONFIG.MIN_ACCURACY}m`)
      }
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
    
    // ===== 优化方案：异常速度过滤（GPS漂移）=====
    // 计算瞬时速度（米/秒），异常高速点直接丢弃
    if (last) {
      const deltaTime = (now - last.timestamp) / 1000
      const distance = this.calculateDistance(last.latitude, last.longitude, filteredLat, filteredLng)
      const speed = distance / deltaTime
      if (speed > CONFIG.ABNORMAL_SPEED && deltaTime > 0) {
        if (DEBUG_MODE) {
          logDebug(this, `丢弃异常漂移点: 速度 ${speed.toFixed(2)}m/s > ${CONFIG.ABNORMAL_SPEED}m/s`)
        }
        return
      }
    }
    
    // ===== 优化方案：双阈值过滤（时间+距离）=====
    // 只有满足时间阈值或距离阈值才存入原始层
    const timeDiff = last ? now - last.timestamp : Infinity
    const distanceDiff = last ? this.calculateDistance(last.latitude, last.longitude, filteredLat, filteredLng) : Infinity
    
    if (!last || timeDiff >= CONFIG.TIME_THRESHOLD || distanceDiff >= CONFIG.DISTANCE_THRESHOLD) {
      // 当前点通过过滤，存入原始层
      const point = {
        latitude: filteredLat,
        longitude: filteredLng,
        speed: res.speed > 0 ? res.speed * 3.6 : (distanceDiff / (timeDiff / 1000) * 3.6) || 0,
        accuracy: res.accuracy,
        heading: res.direction,
        timestamp: now
      }
      
      // ===== 停留点检测 =====
      // 如果从停留模式恢复移动，当前点已在原始层，保证轨迹连续
      const wasStopped = this.data.isStopped
      const isMoving = distanceDiff >= CONFIG.STOP_MOVE_THRESHOLD
      
      if (this.rawLocations.length < 2) {
        // 不足两个点，不做停留检测
      } else {
        // 速度低于阈值且移动距离不足，可能是静止
        if (!isMoving && point.speed < CONFIG.STOP_SPEED_THRESHOLD) {
          if (!this.data.stopStartTime) {
            this.setData({ stopStartTime: now })
          } else if (now - this.data.stopStartTime >= CONFIG.STOP_DURATION_THRESHOLD) {
            if (!this.data.isStopped) {
              console.log(`[index] 进入停留模式，静止超过 ${CONFIG.STOP_DURATION_THRESHOLD / 1000} 秒`)
              this.setData({ isStopped: true })
            }
            this.setData({
              latitude: filteredLat,
              longitude: filteredLng
            })
            return
          }
        } else {
          if (this.data.isStopped) {
            console.log(`[index] 恢复移动，重新开始记录`)
            this.setData({ 
              stopStartTime: null, 
              isStopped: false 
            })
          } else {
            this.setData({ stopStartTime: null })
          }
        }
      }
      
      // 更新原始数据层（内存存储）
      this.rawLocations.push(point)
      this.lastLocation = point
      
      // 更新总距离（内存累加）
      if (last) {
        this.totalDistance += distanceDiff
      }
      
      // 更新 data 中的 trackPoints（用于云同步和最终保存）
      this.setData({
        trackPoints: this.rawLocations,
        renderPoints: this.rawLocations.length,
        lastRecordTime: now
      })
      
      // 更新地图中心跟随移动
      this.setData({
        latitude: filteredLat,
        longitude: filteredLng
      })
      
      if (DEBUG_MODE) {
        logDebug(this, `[采集] 原始点数=${this.rawLocations.length} 距离=${this.totalDistance.toFixed(0)}m`, '首页')
      }
    }
  },

  // 定时刷新地图（优化方案核心：低频渲染 + 抽稀 + 差分更新）
  refreshMap() {
    if (!this.data.isRecording) return

    // 获取抽稀后的渲染点集
    const renderPoints = this.getRenderPoints()
    const directionMarkers = this.data.markers || []
    
    // 全量构建 polylines（抽稀后点数可控，性能足够）
    const result = buildMapPolylines(renderPoints)
    let polylines
    if (Array.isArray(result)) {
      polylines = result
    } else {
      polylines = result.polylines
    }
    
    // 差分更新：仅更新 polyline，减少 setData 数据量
    const stats = calculateStats(this.rawLocations)
    this.setData({
      'polylines': polylines,
      'markers': directionMarkers,
      currentDistance: (this.totalDistance / 1000).toFixed(2),
      renderPoints: renderPoints.length
    }, () => {
      this.persistActiveTrackLocal()
      this.tryCloudIncrementalSync()
    })
  },

  // 获取渲染点集（必要时抽稀）
  getRenderPoints() {
    let points = this.rawLocations.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude
    }))
    if (points.length > CONFIG.MAX_RENDER_POINTS) {
      const before = points.length
      points = this.simplifyPoints(points, 0.00005)
      if (DEBUG_MODE) {
        logDebug(this, `抽稀完成: ${before} -> ${points.length}`, '首页')
      }
    }
    return points
  },

  // 道格拉斯-普克抽稀算法（优化方案：控制渲染点数量）
  simplifyPoints(points, tolerance) {
    if (points.length <= 2) return points
    let maxDist = 0, maxIdx = 0
    for (let i = 1; i < points.length - 1; i++) {
      const dist = this.perpendicularDistance(points[i], points[0], points[points.length - 1])
      if (dist > maxDist) {
        maxDist = dist
        maxIdx = i
      }
    }
    if (maxDist > tolerance) {
      const left = this.simplifyPoints(points.slice(0, maxIdx + 1), tolerance)
      const right = this.simplifyPoints(points.slice(maxIdx), tolerance)
      return left.slice(0, -1).concat(right)
    } else {
      return [points[0], points[points.length - 1]]
    }
  },

  // 计算点到直线的垂直距离（用于抽稀算法）
  perpendicularDistance(point, start, end) {
    const dx = end.longitude - start.longitude
    const dy = end.latitude - start.latitude
    if (dx === 0 && dy === 0) {
      return Math.hypot(point.longitude - start.longitude, point.latitude - start.latitude)
    }
    const t = ((point.longitude - start.longitude) * dx + (point.latitude - start.latitude) * dy) / (dx*dx + dy*dy)
    if (t < 0) return Math.hypot(point.longitude - start.longitude, point.latitude - start.latitude)
    if (t > 1) return Math.hypot(point.longitude - end.longitude, point.latitude - end.latitude)
    const projX = start.longitude + t * dx
    const projY = start.latitude + t * dy
    return Math.hypot(point.longitude - projX, point.latitude - projY)
  },

  // 计算两点间距离（米）- 哈弗辛公式（用于优化方案的距离计算）
  calculateDistance(p1, p2, lat1, lng2) {
    // 支持两种调用方式：calculateDistance(p1, p2) 或 calculateDistance(lat1, lng1, lat2, lng2)
    let rLat1, rLng1, rLat2, rLng2
    if (typeof p2 === 'number') {
      rLat1 = p1 * Math.PI / 180
      rLng1 = lat1 * Math.PI / 180
      rLat2 = lat1 * Math.PI / 180
      rLng2 = p2 * Math.PI / 180
    } else {
      rLat1 = p1.latitude * Math.PI / 180
      rLng1 = p1.longitude * Math.PI / 180
      rLat2 = p2.latitude * Math.PI / 180
      rLng2 = p2.longitude * Math.PI / 180
    }
    const R = 6371000 // 地球半径（米）
    const deltaLat = rLat2 - rLat1
    const deltaLng = rLng2 - rLng1
    const a = Math.sin(deltaLat/2) ** 2 + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(deltaLng/2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  },

  // 本地持久化：进行中划行会话（防崩溃/杀进程）
  // 本地持久化：进行中划行会话（防崩溃/杀进程）
  buildPersistPayload() {
    return {
      v: 2,  // 版本 2 支持优化方案
      activityId: this.data.activityId,
      trackPoints: this.data.trackPoints,
      startTime: this.data.startTime,
      totalPauseTime: this.data.totalPauseTime,
      isPaused: this.data.isPaused,
      pauseStartTime: this.data.pauseStartTime,
      lastRecordTime: this.data.lastRecordTime,
      currentDistance: (this.totalDistance / 1000).toFixed(2),
      cloudSyncedCount: this._cloudSyncedCount || 0,
      totalDistance: this.totalDistance,
      rawLocations: this.rawLocations,
      lastLocation: this.lastLocation,
      savedAt: Date.now()
    }
  },
  persistActiveTrackLocal() {
    if (!this.data.isRecording || !this.data.activityId) return
    saveActiveTrackSession(this.buildPersistPayload())
  },
  // 云端增量同步，带重试机制
  async tryCloudIncrementalSync() {
    if (!this.data.isRecording || !this.data.activityId) return
    if (this._appendInProgress) {
      if (DEBUG_MODE) {
        logDebug(this, `同步进行中跳过`, '首页')
      }
      return
    }
    const pts = this.data.trackPoints
    const n = pts.length
    const synced = this._cloudSyncedCount || 0
    if (n <= synced) return
    const unsynced = n - synced
    const now = Date.now()
    const needByCount = unsynced >= CLOUD_SYNC_MIN_POINTS
    const needByTime = (now - (this._lastCloudSyncAt || 0)) >= CLOUD_SYNC_INTERVAL_MS
    if (!needByCount && !needByTime) {
      if (DEBUG_MODE) {
        logDebug(this, `未达同步阈值 已同步${synced} 未同步${unsynced} 距上次${now - (this._lastCloudSyncAt || 0)}ms`, '首页')
      }
      return
    }
    if (DEBUG_MODE) {
      logDebug(this, `开始同步 已同步${synced}点 本次将传${unsynced}点`, '首页')
    }

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
    
    // 带重试的云函数调用
    let success = false
    for (let retry = 0; retry < MAX_CLOUD_SYNC_RETRIES; retry++) {
      try {
        await new Promise((resolve, reject) => {
          wx.cloud.callFunction({
            name: 'activity',
            data: {
              action: 'appendTrackPoints',
              activityId: this.data.activityId,
              points: payloadPoints
            },
            success: (res) => {
              resolve(res)
            },
            fail: (err) => {
              reject(err)
            }
          })
        })
        this._cloudSyncedCount = n
        this._lastCloudSyncAt = Date.now()
        success = true
        if (DEBUG_MODE) {
          logDebug(this, `同步成功 已同步${n}点`, '首页')
        }
        break
      } catch (err) {
        console.warn(`[index] 云同步失败，重试 ${retry + 1}/${MAX_CLOUD_SYNC_RETRIES}`, err)
        // 等待一会再重试
        await new Promise(resolve => setTimeout(resolve, 1000 * (retry + 1)))
      }
    }
    
    if (!success) {
      console.error(`[index] 云同步连续 ${MAX_CLOUD_SYNC_RETRIES} 次失败，本次放弃`)
      wx.showToast({
        title: '网络异常，数据已本地保存',
        icon: 'none',
        duration: 2000
      })
    }
    
    this._appendInProgress = false
  },

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
    logDebug(this, '检查进行中活动...', '首页')
    const that = this

    // 如果本地已经在记录中，不要从云端覆盖，避免弄丢未同步的点
    if (that.data.isRecording && that.data.activityId) {
      logDebug(this, `本地已有进行中活动 ${that.data.activityId}，跳过云端恢复`, '首页')
      return
    }

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

          // 初始化优化方案内存存储
          that._cloudSyncedCount = 0
          that._lastCloudSyncAt = Date.now()
          that._appendInProgress = false
          that.latFilter = new KalmanFilter(CONFIG.KALMAN_PROCESS_NOISE, CONFIG.KALMAN_MEASUREMENT_NOISE)
          that.lngFilter = new KalmanFilter(CONFIG.KALMAN_PROCESS_NOISE, CONFIG.KALMAN_MEASUREMENT_NOISE)
          that.rawLocations = []
          that.totalDistance = 0
          
          // 获取轨迹点，恢复地图显示
          wx.cloud.callFunction({
            name: 'activity',
            data: { action: 'getTrackPoints', activityId: activity._id },
            success: (trackRes) => {
              if (trackRes.result?.trackPoints) {
                // 恢复到优化方案内存结构
                that.rawLocations = trackRes.result.trackPoints
                that.totalDistance = calculateStats(trackRes.result.trackPoints).distance * 1000
                that.lastLocation = that.rawLocations[that.rawLocations.length - 1]
                that.setData({
                  trackPoints: that.rawLocations,
                  renderPoints: that.rawLocations.length
                })
                // 重置增量同步计数（关键修复：恢复后 _cloudSyncedCount 需要与 trackPoints 长度一致）
                that._cloudSyncedCount = trackRes.result.trackPoints.length
                that._lastCloudSyncAt = Date.now()
                
                // 获取抽稀后的渲染点并刷新地图
                that.refreshMap()
                
                // 用最后一个点初始化卡尔曼滤波
                if (that.rawLocations.length > 0) {
                  const last = that.rawLocations[that.rawLocations.length - 1]
                  that.latFilter.filter(last.latitude)
                  that.lngFilter.filter(last.longitude)
                }
                
                // 计算统计数据
                if (that.rawLocations.length > 0) {
                  const stats = calculateStats(that.rawLocations)
                  that.setData({
                    currentDistance: (that.totalDistance / 1000).toFixed(2),
                    currentSpeed: stats.avgSpeed.toFixed(1),
                    currentDuration: formatDuration(stats.durationMs)
                  })
                  
                  // 地图中心移动到最后一个点
                  const lastPoint = that.rawLocations[that.rawLocations.length - 1]
                  that.setData({
                    latitude: lastPoint.latitude,
                    longitude: lastPoint.longitude
                  })
                }
              }
            }
          })
          
          // 重启位置采集、计时器和低频渲染
          that.startLocationUpdate()
          that.startTimer()
          that.data.renderTimer = setInterval(() => that.refreshMap(), CONFIG.RENDER_INTERVAL_MS)
          
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
      data: { action: 'startJourney', teamId: this.data.activeTeam._id },
      success: (res) => {
        wx.hideLoading()
        if (res.result?.success) {
          wx.showToast({ title: '出发！', icon: 'success' })
          this.checkActiveTeam()
          this.checkActiveActivity()
        } else {
          wx.showToast({ title: res.result?.error || '出发失败', icon: 'none' })
        }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '出发失败', icon: 'none' }) }
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
            data: { action: 'endJourney', teamId: this.data.activeTeam._id },
            success: (res) => {
              wx.hideLoading()
              if (res.result?.success) {
                wx.showToast({ title: '已结束', icon: 'success' })
                this.checkActiveTeam()
                this.checkActiveActivity()
              } else {
                wx.showToast({ title: res.result?.error || '结束失败', icon: 'none' })
              }
            },
            fail: () => { wx.hideLoading(); wx.showToast({ title: '结束失败', icon: 'none' }) }
          })
        }
      }
    })
  },

  // 复制调试日志
  copyDebugLog() {
    const logs = this.data.debugLogs.join('\n')
    wx.setClipboardData({
      data: logs,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' })
      }
    })
  },

  // 清空调试日志
  clearDebugLog() {
    this.setData({ debugLogs: [] })
  },

  // 清空所有活动数据（调试用）
  clearAllActivities() {
    const that = this
    wx.showModal({
      title: '确认清空',
      content: '将要清空数据库中所有 activity 和 track_point 记录，确定吗？',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '清空中...' })
          wx.cloud.callFunction({
            name: 'activity',
            data: { action: 'clearAll' },
            success: res => {
              wx.hideLoading()
              if (res.result?.success) {
                wx.showToast({ 
                  title: `清空成功\n${res.result.deletedActivities} 活动\n${res.result.deletedTrackPoints} 轨迹点`, 
                  icon: 'success', 
                  duration: 2000 
                })
                // 清空本地状态（包含优化方案新增的内存变量和定时器）
                that._cloudSyncedCount = 0
                that._lastCloudSyncAt = 0
                that._appendInProgress = false
                that.rawLocations = []
                that.totalDistance = 0
                that.lastLocation = null
                if (that.data.renderTimer) {
                  clearInterval(that.data.renderTimer)
                  that.data.renderTimer = null
                }
                that.setData({
                  activityId: null,
                  trackPoints: [],
                  polylines: [],
                  currentDistance: '0.00',
                  currentSpeed: '0.0',
                  currentDuration: '00:00:00',
                  isRecording: false,
                  isPaused: false,
                  currentActivity: null,
                  renderPoints: 0
                })
              } else {
                wx.showToast({ title: res.result?.error || '清空失败', icon: 'none' })
              }
            },
            fail: err => {
              wx.hideLoading()
              wx.showToast({ title: '请求失败', icon: 'none' })
              console.error('clearAll failed', err)
            }
          })
        }
      }
    })
  },
  
  // 展开/收起调试面板
  toggleDebugPanel() {
    this.setData({ debugPanelCollapsed: !this.data.debugPanelCollapsed })
  },
})
