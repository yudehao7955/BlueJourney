// utils/debug.js - 调试模块
// 使用方式：在页面中 require 并调用 logDebug(page, message)

const CONFIG = require('./config.js') // 配置模块

/**
 * 调试日志输出
 * @param {Object} page - 页面this对象
 * @param {string} msg - 日志消息
 */
function logDebug(page, msg) {
  // 检查全局开关或页面开关
  const enabled = page.data?.debugMode !== false
  if (!enabled) return

  // 输出到控制台
  console.log(`[DEBUG] ${msg}`)

  // 更新页面调试面板
  if (page.setData && page.data?.debugLogs !== undefined) {
    const logs = page.data.debugLogs || []
    const time = new Date().toLocaleTimeString()
    logs.push(`[${time}] ${msg}`)
    // 限制保留最近100条
    if (logs.length > 100) logs.shift()
    page.setData({ debugLogs: logs })
  }
}

/**
 * 复制所有调试日志到剪贴板
 * @param {Object} page - 页面this对象
 */
function copyDebugLog(page) {
  const logs = page.data.debugLogs || []
  const text = logs.join('\n')
  wx.setClipboardData({
    data: text,
    success: () => {
      wx.showToast({ title: '已复制', icon: 'success' })
    }
  })
}

/**
 * 清空调试日志
 * @param {Object} page - 页面this对象
 */
function clearDebugLog(page) {
  page.setData({ debugLogs: [] })
}

module.exports = {
  logDebug,
  copyDebugLog,
  clearDebugLog
}