// pages/team/team.js
Page({
  data: {
    activeTab: 'my',
    teams: [],
    loading: false,
    showCreateModal: false,
    newTeamName: '',
    newTeamDesc: '',
    newMaxMembers: 10,  // 默认最大人数 10
    newIsPublic: true,  // 默认公开
    currentOpenid: ''
  },

  onLoad(options) {
    this.getCurrentUser()
    // 获取当前用户位置，用于计算附近队伍距离
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setData({
          userLatitude: res.latitude,
          userLongitude: res.longitude
        })
      },
      fail: () => {
        // 没有权限就不计算距离，不影响使用
        console.log('[team] 获取用户位置失败，附近队伍无法计算距离')
      }
    })
    // 处理二维码邀请：扫码进来直接加入队伍
    if (options.teamId && options.action === 'join') {
      setTimeout(() => {
        wx.showModal({
          title: '邀请加入队伍',
          content: '确认要加入这个队伍吗？',
          success: (res) => {
            if (res.confirm) {
              this.joinTeam({ currentTarget: { dataset: { id: options.teamId }}})
              // 加入成功后跳转到队伍详情
              setTimeout(() => {
                wx.navigateTo({
                  url: `/pages/team-detail/team-detail?teamId=${options.teamId}`
                })
              }, 1000)
            }
          }
        })
      }, 500) // 延迟等 getUser 完成
    }
  },

  onShow() {
    this.getTeams()
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.getTeams()
    // 接口完成后会调用 stopPullDownRefresh
  },

  // 获取当前用户信息
  getCurrentUser() {
    // 优先从 globalData 获取 openid（这里一定有值）
    const app = getApp()
    if (app.globalData.openid) {
      this.setData({ currentOpenid: app.globalData.openid })
      return
    }
    
    // fallback: 从 storage 获取 userInfo
    const userInfo = wx.getStorageSync('userInfo') || {}
    if (userInfo.openid) {
      this.setData({ currentOpenid: userInfo.openid })
      return
    }

    // fallback: 调用云函数获取
    this.fetchCurrentUser()
  },

  fetchCurrentUser() {
    wx.cloud.callFunction({
      name: 'user',
      data: { action: 'getUserInfo' },
      success: (res) => {
        if (res.result?.success && res.result.userInfo) {
          const openid = res.result.userInfo.openid
          this.setData({ currentOpenid: openid })
        }
      }
    })
  },

  // 切换标签
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    this.getTeams()
  },

  // 获取队伍列表
  getTeams() {
    this.setData({ loading: true })
    
    const action = this.data.activeTab === 'my' ? 'getMyTeams' : 'getNearbyTeams'
    const currentOpenid = this.data.currentOpenid
    
    wx.cloud.callFunction({
      name: 'team',
      data: { 
        action,
        // 获取附近队伍时需要当前用户位置计算距离
        ...(action === 'getNearbyTeams' && {
          longitude: this.data.userLongitude || null,
          latitude: this.data.userLatitude || null
        })
      },
      success: (res) => {
        if (res.result?.success) {
          let teams = res.result.teams || []
          
          // 附近队伍：过滤掉当前用户已经加入的队伍
          if (this.data.activeTab === 'nearby' && currentOpenid) {
            teams = teams.filter(team => {
              // 检查当前用户是否已经在队伍中
              const isMember = team.members?.some(m => m.openid === currentOpenid)
              return !isMember
            })
          }
          
          this.setData({ teams })
        }
      },
      fail: (err) => {
        console.error('获取队伍失败', err)
        wx.showToast({ title: '加载失败', icon: 'none' })
      },
      complete: () => {
        this.setData({ loading: false })
        // 停止下拉刷新
        wx.stopPullDownRefresh()
      }
    })
  },

  // 判断是不是我的队伍
  isMyTeam(teamId) {
    // 已加入的队伍不显示加入按钮
    return false
  },

  // 打开创建队伍弹窗
  openCreateModal() {
    this.setData({ 
      showCreateModal: true,
      newTeamName: '',
      newTeamDesc: '',
      newMaxMembers: 10,
      newIsPublic: true
    })
  },

  // 关闭创建队伍弹窗
  closeCreateModal() {
    this.setData({ showCreateModal: false })
  },

  // 输入队伍名称
  onTeamNameInput(e) {
    this.setData({ newTeamName: e.detail.value })
  },

  // 输入队伍描述
  onTeamDescInput(e) {
    this.setData({ newTeamDesc: e.detail.value })
  },

  // 选择最大人数
  selectMaxMembers(e) {
    const value = parseInt(e.currentTarget.dataset.value, 10)
    this.setData({ newMaxMembers: value })
  },

  // 选择是否公开
  selectIsPublic(e) {
    const value = e.currentTarget.dataset.value === 'true'
    this.setData({ newIsPublic: value })
  },

  // 确认创建队伍
  confirmCreateTeam() {
    const { newTeamName } = this.data
    if (!newTeamName || newTeamName.trim() === '') {
      wx.showToast({ title: '请输入队伍名称', icon: 'none' })
      return
    }

    wx.showLoading({ title: '创建中...' })

    // 获取当前位置
    wx.getLocation({
      type: 'gcj02',
      success: (location) => {
        this.doCreateTeam(location)
      },
      fail: () => {
        // 权限问题，创建时不强制要求位置
        this.doCreateTeam(null)
      }
    })
  },

  // 执行创建队伍
  doCreateTeam(location) {
    const { newTeamName, newTeamDesc, newMaxMembers, newIsPublic } = this.data
    wx.cloud.callFunction({
      name: 'team',
      data: {
        action: 'create',
        data: {
          teamName: newTeamName,
          description: newTeamDesc,
          location: location,
          maxMembers: newMaxMembers,
          isPublic: newIsPublic
        }
      },
      success: (res) => {
        if (res.result?.success) {
          wx.showToast({ title: '创建成功', icon: 'success' })
          this.setData({ showCreateModal: false })
          this.getTeams()
        } else {
          wx.showToast({ title: res.result?.error || '创建失败', icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('创建队伍失败', err)
        wx.showToast({ title: '创建失败', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
      }
    })
  },

  // 扫码加入队伍
  scanCode() {
    wx.scanCode({
      success: (res) => {
        // 解析二维码内容，提取队伍ID
        if (res.path) {
          const match = res.path.match(/teamId=([^&]+)/)
          if (match) {
            this.joinTeam(match[1])
          } else {
            wx.showToast({ title: '无效的队伍二维码', icon: 'none' })
          }
        } else {
          wx.showToast({ title: '无效的二维码', icon: 'none' })
        }
      },
      fail: () => {
        // 用户取消扫描
      }
    })
  },

  // 加入队伍
  joinTeam(e) {
    const teamId = e.currentTarget.dataset.id
    wx.showLoading({ title: '加入中...' })

    wx.cloud.callFunction({
      name: 'team',
      data: {
        action: 'join',
        teamId
      },
      success: (res) => {
        if (res.result?.success) {
          wx.showToast({ title: '加入成功', icon: 'success' })
          this.getTeams()
        } else {
          wx.showToast({ title: res.result?.error || '加入失败', icon: 'none' })
        }
      },
      fail: (err) => {
        console.error('加入队伍失败', err)
        wx.showToast({ title: '加入失败', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
      }
    })
  },

  // 离开队伍（仅普通成员）
  leaveTeam(e) {
    const teamId = e.currentTarget.dataset.id
    wx.showModal({
      title: '提示',
      content: '确定要离开这个队伍吗？',
      success: (res) => {
        if (res.confirm) {
          this.doLeaveTeam(teamId)
        }
      }
    })
  },

  // 执行离开队伍
  doLeaveTeam(teamId) {
    wx.showLoading({ title: '处理中...' })
    
    wx.cloud.callFunction({
      name: 'team',
      data: {
        action: 'leave',
        teamId
      },
      success: (res) => {
        if (res.result?.success) {
          wx.showToast({ title: '已离开', icon: 'success' })
          this.getTeams()
        } else {
          wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.showToast({ title: '操作失败', icon: 'none' })
      },
      complete: () => {
        wx.hideLoading()
      }
    })
  },

  // 解散队伍（仅队长）
  dissolveTeam(e) {
    const teamId = e.currentTarget.dataset.id
    wx.showModal({
      title: '解散队伍',
      content: '确定要解散这个队伍吗？解散后无法恢复。',
      confirmText: '确认解散',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '处理中...' })
          
          wx.cloud.callFunction({
            name: 'team',
            data: {
              action: 'delete',
              teamId
            },
            success: (res) => {
              wx.hideLoading()
              if (res.result?.success) {
                wx.showToast({ title: '已解散', icon: 'success' })
                this.getTeams()
              } else {
                wx.showToast({ title: res.result?.error || '操作失败', icon: 'none' })
              }
            },
            fail: (err) => {
              wx.hideLoading()
              wx.showToast({ title: '操作失败', icon: 'none' })
            }
          })
        }
      }
    })
  },

  // 查看队伍详情
  viewTeamDetail(e) {
    const teamId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/team-detail/team-detail?teamId=${teamId}`
    })
  },

  // 邀请加入
  shareTeam(e) {
    const teamId = e.currentTarget.dataset.id
    const team = this.data.teams.find(t => t._id === teamId)
    wx.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline']
    })
    // 实际分享需要先触发分享
    wx.showToast({ title: '点击右上角分享', icon: 'none' })
  }
})