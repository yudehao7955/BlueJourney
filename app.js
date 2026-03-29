App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: 'cloudbase-6gfuik0s0ed9c8df',
        traceUser: true,
      })
    }
  },
  globalData: {
    userInfo: null,
    openid: null
  }
})
