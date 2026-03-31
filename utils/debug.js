// utils/debug.js - 调试模块
const CONFIG = require('./config.js')

/**
 * 调试日志输出
 * @param {Object} page - 页面this对象
 * @param {string} msg - 日志消息
 * @param {string} prefix - 日志前缀（页面标识）
 */
function logDebug(page, msg, prefix) {
  const enabled = page.data?.debugMode !== false
  if (!enabled) return

  const logs = page.data.debugLogs || []
  const time = new Date().toLocaleTimeString()
  const tag = prefix || '[INDEX]'
  logs.push(`[${time}] ${tag} ${msg}`)

  if (logs.length > 100) logs.shift()
  page.setData({ debugLogs: logs })
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