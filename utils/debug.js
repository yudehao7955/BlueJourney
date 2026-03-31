// utils/debug.js - 调试模块
const CONFIG = require('./config.js')
const DEBUG_MODE_KEY = 'debugMode'

/**
 * 获取全局调试模式设置
 */
function isDebugEnabled() {
  try {
    return wx.getStorageSync(DEBUG_MODE_KEY) !== false
  } catch (e) {
    // 默认关闭
    return false
  }
}

/**
 * 调试日志输出
 * @param {Object} page - 页面this对象
 * @param {string} msg - 日志消息
 * @param {string} prefix - 日志前缀（页面标识）
 */
function logDebug(page, msg, prefix) {
  // 全局调试模式关闭则不记录
  if (!isDebugEnabled()) return

  // 如果页面没有debugMode数据，也不记录
  const enabled = page.data?.debugMode !== false
  if (!enabled) return

  const logs = page.data.debugLogs || []
  const time = new Date().toLocaleTimeString()
  const tag = prefix || '[INDEX]'
  logs.push(`[${time}] ${tag} ${msg}`)

  // 限制最多保留 500 条日志
  if (logs.length > 500) logs.shift()
  
  // 自动滚动到最新日志（设置scroll-top为一个大值）
  const maxScrollTop = logs.length * 100  // 每条日志约100px高度
  page.setData({ debugLogs: logs, debugScrollTop: maxScrollTop + 1000 })
}

/**
 * 复制所有调试日志到剪贴板
 */
function copyDebugLog(page) {
  const logs = page.data.debugLogs || []
  const text = logs.join('\n')
  wx.setClipboardData({
    data: text,
    success: () => wx.showToast({ title: '已复制', icon: 'success' })
  })
}

/**
 * 清空调试日志
 */
function clearDebugLog(page) {
  page.setData({ debugLogs: [] })
}

module.exports = {
  logDebug,
  copyDebugLog,
  clearDebugLog
}