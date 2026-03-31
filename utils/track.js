/**
 * 将轨迹点转为 map 组件 polylines（微信小程序单条 polyline 点数有限，需分段）
 * @param {Array<{latitude:number,longitude:number,speed?:number}>} points
 * @param {object} opts
 */
function buildMapPolylines(points, opts = {}) {
  const maxPerLine = opts.maxPerLine || 400
  const baseWidth = opts.width || 8
  const borderColor = opts.borderColor || '#003366'
  const borderWidth = opts.borderWidth !== undefined ? opts.borderWidth : 3
  const colorFrom = opts.colorFrom || '#2E8BFF' // 低速 - 亮蓝色
  const colorTo = opts.colorTo || '#1E90FF'   // 高速 - 蓝色
  const enableSpeedColor = opts.enableSpeedColor !== false // 默认开启根据速度变色

  if (!points || points.length === 0) {
    console.log('[buildMapPolylines] 没有轨迹点')
    return []
  }

  // 确保每个点都有正确的经纬度属性
  // 兼容从云数据库读出时经纬度是字符串的情况
  // 检查经纬度是否在合理范围内：纬度(-90 ~ 90)，经度(-180 ~ 180)
  // 不直接排除经纬度恰好为0的点（兼容赤道/本初子午线附近真实轨迹）
  const coords = points.map(p => ({
    latitude: Number(p.latitude),
    longitude: Number(p.longitude),
    speed: p.speed ? Number(p.speed) : 0
  })).filter(p => 
    !isNaN(p.latitude) && 
    !isNaN(p.longitude) &&
    p.latitude >= -90 && p.latitude <= 90 &&
    p.longitude >= -180 && p.longitude <= 180 &&
    !(p.latitude === 0 && p.longitude === 0) // 只排除全0无效点
  )

  console.log(`[buildMapPolylines] 输入点数 ${points.length}, 有效点数 ${coords.length}`)
  if (coords.length < 2) {
    points.forEach((p, i) => {
      console.log(`[buildMapPolylines] 点[${i}]: lat=${p.latitude} lng=${p.longitude} speed=${p.speed}`)
    })
  }

  if (coords.length < 2) {
    if (points.length > 0) {
      console.warn(`[buildMapPolylines] 输入 ${points.length} 个点，但有效点不足 2 个，请检查点数据格式`)
    }
    return { polylines: [], directionMarkers: [] }
  }

  // 如果不启用速度颜色，直接返回单段（原逻辑）
  if (!enableSpeedColor || coords.length <= maxPerLine && !hasSpeed(coords)) {
    const base = { 
      color: getAvgColor(coords, colorFrom, colorTo), 
      width: baseWidth, 
      dottedLine: false, 
      borderColor, 
      borderWidth 
    }
    console.log(`[buildMapPolylines] 单段绘制，点数 ${coords.length}`)
    return [{ ...base, points: coords }]
  }

  // 启用速度颜色：将每两点之间分段，根据平均速度设置颜色
  // 这样可以从起点到终点体现方向和速度渐变
  const polylines = []
  const maxSpeed = 20 // 最大速度按 20km/h 计算
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const avgSpeed = (p1.speed + p2.speed) / 2
    const color = getSpeedColor(avgSpeed, maxSpeed, colorFrom, colorTo)

    // 每个线段单独绘制，使用对应速度的颜色
    // 这样可以体现出速度变化，从起点到终点方向也更清晰
    if (polylines.length > 0 && polylines[polylines.length - 1].points.length < maxPerLine) {
      // 添加到当前段
      polylines[polylines.length - 1].points.push(p2)
    } else {
      // 新建段
      polylines.push({
        color,
        width: baseWidth,
        dottedLine: false,
        borderColor,
        borderWidth,
        points: [p1, p2]
      })
    }
  }

  console.log(`[buildMapPolylines] 分段完成，共 ${polylines.length} 段，${enableSpeedColor ? '按速度渐变' : '单段'}`)

  // 在终点添加方向箭头 marker
  let directionMarkers = []
  if (coords.length >= 2 && opts.addDirectionArrow !== false) {
    // 取最后两点计算方向
    const p1 = coords[coords.length - 2]
    const p2 = coords[coords.length - 1]
    const rotation = calculateDirection(p1.latitude, p1.longitude, p2.latitude, p2.longitude)
    
    directionMarkers = [{
      id: -1, // 箭头 marker id
      latitude: p2.latitude,
      longitude: p2.longitude,
      iconPath: '/images/arrow-direction.png',
      rotate: rotation,
      width: 30,
      height: 30,
      anchor: { x: .5, y: .5 } // 中心锚点
    }]
  }

  // 返回 polylines + directionMarkers，调用者可以将 markers 添加到地图
  return {
    polylines,
    directionMarkers
  }
}

// 判断是否有速度数据
function hasSpeed(points) {
  return points.some(p => p.speed > 0)
}

// 根据速度获取颜色：低速浅蓝，高速深蓝
function getSpeedColor(speed, maxSpeed, colorFrom, colorTo) {
  if (speed <= 0) return colorFrom
  const ratio = Math.min(speed / maxSpeed, 1)
  
  // 从 colorFrom 插值到 colorTo
  // 解析 hex 颜色到 RGB
  const from = hexToRgb(colorFrom)
  const to = hexToRgb(colorTo)
  
  const r = Math.round(from.r * (1 - ratio) + to.r * ratio)
  const g = Math.round(from.g * (1 - ratio) + to.g * ratio)
  const b = Math.round(from.b * (1 - ratio) + to.b * ratio)
  
  return rgbToHex(r, g, b)
}

// 计算平均颜色（单段模式）
function getAvgColor(points, colorFrom, colorTo) {
  if (!hasSpeed(points)) {
    return colorFrom
  }
  let totalSpeed = 0
  points.forEach(p => {
    totalSpeed += p.speed || 0
  })
  const avgSpeed = totalSpeed / points.length
  const maxSpeed = 20
  return getSpeedColor(avgSpeed, maxSpeed, colorFrom, colorTo)
}

// hex 转 RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 }
}

// RGB 转 hex
function rgbToHex(r, g, b) {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

// 计算两点之间的方向角度（从 p1 → p2），返回旋转角度（度数）
function calculateDirection(lat1, lon1, lat2, lon2) {
  // 转换为弧度
  const rLat1 = lat1 * Math.PI / 180
  const rLon1 = lon1 * Math.PI / 180
  const rLat2 = lat2 * Math.PI / 180
  const rLon2 = lon2 * Math.PI / 180

  const dLon = rLon2 - rLon1
  const y = Math.sin(dLon) * Math.cos(rLat2)
  const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon)
  let brng = Math.atan2(y, x)
  brng = brng * 180 / Math.PI
  // 转为 0-360 角度，箭头方向
  return (brng + 360) % 360
}

// 计算两点距离（Haversine formula, 单位：米）
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000 // 地球半径
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 计算轨迹统计数据
function calculateStats(points) {
  let totalDistance = 0
  let maxSpeed = 0
  let totalSpeed = 0
  let speedCount = 0

  for (let i = 1; i < points.length; i++) {
    totalDistance += calculateDistance(
      points[i - 1].latitude, points[i - 1].longitude,
      points[i].latitude, points[i].longitude
    )
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
    distance: totalDistance / 1000, // km
    durationMs: duration,
    duration: Math.floor(duration / 1000),
    avgSpeed: speedCount > 0 ? (totalSpeed / speedCount) : 0,
    maxSpeed: maxSpeed
  }
}

// 格式化时长为 HH:MM:SS
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

module.exports = {
  buildMapPolylines,
  calculateDistance,
  calculateStats,
  formatDuration
}
