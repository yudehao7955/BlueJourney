/**
 * 将轨迹点转为 map 组件 polylines（微信小程序单条 polyline 点数有限，需分段）
 * @param {Array<{latitude:number,longitude:number}>} points
 * @param {object} opts
 */
function buildMapPolylines(points, opts = {}) {
  const maxPerLine = opts.maxPerLine || 400
  const color = opts.color || '#0066CC'
  const width = opts.width || 6
  const borderColor = opts.borderColor || '#004080'
  const borderWidth = opts.borderWidth !== undefined ? opts.borderWidth : 2
  const base = { color, width, dottedLine: false, borderColor, borderWidth }

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
    longitude: Number(p.longitude)
  })).filter(p => 
    !isNaN(p.latitude) && 
    !isNaN(p.longitude) &&
    p.latitude >= -90 && p.latitude <= 90 &&
    p.longitude >= -180 && p.longitude <= 180 &&
    !(p.latitude === 0 && p.longitude === 0) // 只排除全0无效点
  )

  console.log(`[buildMapPolylines] 输入点数 ${points.length}, 有效点数 ${coords.length}`)

  if (coords.length < 2) {
    if (points.length > 0) {
      console.warn(`[buildMapPolylines] 输入 ${points.length} 个点，但有效点不足 2 个，请检查点数据格式`)
    }
    return []
  }

  if (coords.length <= maxPerLine) {
    console.log(`[buildMapPolylines] 单段绘制，点数 ${coords.length}`)
    return [{ ...base, points: coords }]
  }

  const polylines = []
  let i = 0
  while (i < coords.length) {
    const end = Math.min(i + maxPerLine, coords.length)
    const chunk = coords.slice(i, end)
    if (chunk.length >= 2) {
      polylines.push({ ...base, points: chunk })
    } else if (chunk.length === 1 && polylines.length > 0) {
      const prev = polylines[polylines.length - 1]
      prev.points = prev.points.concat(chunk)
    }
    i += maxPerLine - 1
  }
  console.log(`[buildMapPolylines] 分段完成，共 ${polylines.length} 段`)
  return polylines
}

module.exports = {
  buildMapPolylines
}
