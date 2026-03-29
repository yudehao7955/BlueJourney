// pages/profile/profile.js
Page({
  data: {
    userInfo: null,
    stats: { totalDistance: 0, totalTime: 0, totalActivities: 0 },
    achievements: []
  },

  onLoad() {
    this.getUserProfile()
  },

  onShow() {
    this.getUserProfile()
  },

  // 获取用户信息
  getUserProfile() {
    wx.cloud.callFunction({
      name: 'user',
      data: { action: 'getUserInfo' },
      success: (res) => {
        if (res.result?.userInfo) {
          this.setData({ userInfo: res.result.userInfo })
          this.getUserStats()
          this.getUserAchievements()
        }
      }
    })
  },

  // 获取用户统计
  getUserStats() {
    wx.cloud.callFunction({
      name: 'user',
      data: { action: 'getUserStats' },
      success: (res) => {
        if (res.result?.stats) {
          this.setData({ stats: res.result.stats })
        }
      }
    })
  },

  // 获取用户成就
  getUserAchievements() {
    wx.cloud.callFunction({
      name: 'user',
      data: { action: 'getAchievements' },
      success: (res) => {
        if (res.result?.achievements) {
          this.setData({ achievements: res.result.achievements })
        }
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
        data: { avatarUrl: this.data.userInfo.avatarUrl || '' }
      },
      success: () => {
        wx.showToast({ title: '头像已更新', icon: 'success' })
      }
    })
  },

  // 成就墙
  viewAchievements() {
    wx.navigateTo({ url: '/pages/achievements/achievements' })
  },

  // 设置
  viewSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  // 我的活动
  viewActivities() {
    wx.navigateTo({ url: '/pages/activity-list/activity-list' })
  },

  // 帮助与反馈
  viewHelp() {
    wx.showToast({ title: '功能开发中', icon: 'none' })
  }
})