// pages/settings/settings.js
// 从本地存储读取调试模式
const DEBUG_MODE_KEY = 'debugMode'

Page({
  data: {
    debugMode: false
  },

  onLoad() {
    // 加载本地存储的设置
    const debugMode = wx.getStorageSync(DEBUG_MODE_KEY)
    // 默认值：如果未设置，默认为 false（关闭）
    this.setData({ 
      debugMode: debugMode !== false 
    })
  },

  // 调试模式开关切换
  onDebugModeChange(e) {
    const debugMode = e.detail.value
    this.setData({ debugMode })
    // 保存到本地存储
    wx.setStorageSync(DEBUG_MODE_KEY, debugMode)
    
    wx.showToast({
      title: debugMode ? '调试模式已开启' : '调试模式已关闭',
      icon: 'success',
      duration: 1500
    })
  },

  // 返回上一页
  onBack() {
    wx.navigateBack()
  }
})
