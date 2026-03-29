// pages/activity-list/activity-list.js
Page({
  data: {
    activities: [],
    hideShort: false,
    filteredActivities: [],
    loading: false
  },

  onShow() {
    this.loadActivities();
  },

  loadActivities() {
    this.setData({ loading: true });
    
    wx.cloud.callFunction({
      name: 'activity',
      data: {
        action: 'getList',
        page: 1,
        pageSize: 50
      },
      success: (res) => {
        if (res.result?.activities) {
          const activities = res.result.activities;
          // 格式化时间
          activities.forEach(item => {
            if (!item.durationFormatted) {
              const hours = Math.floor(item.duration / 3600);
              const minutes = Math.floor((item.duration % 3600) / 60);
              const secs = item.duration % 60;
              item.durationFormatted = `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
            }
            // 格式化创建时间 - 本地时间，年月日 小时:分钟
            if (item.createTime) {
              const d = new Date(item.createTime);
              const year = d.getFullYear();
              const month = (d.getMonth() + 1).toString().padStart(2, '0');
              const day = d.getDate().toString().padStart(2, '0');
              const hour = d.getHours().toString().padStart(2, '0');
              const minute = d.getMinutes().toString().padStart(2, '0');
              item.createTimeFormatted = `${year}-${month}-${day} ${hour}:${minute}`;
            } else {
              item.createTimeFormatted = '未知时间';
            }
            // 转换距离单位 (米 -> 公里)
            const distance = item.totalDistance || 0;
            if (distance > 0 && distance < 10) {
              // bugfix: 如果 distance < 10，说明高德优化返回的已经是公里了
              // 它直接存在了 totalDistance，而我们预期单位是米，所以还原为米
              item.distanceKm = distance.toFixed(2);
            } else if (distance > 0) {
              item.distanceKm = (distance / 1000).toFixed(2);
            } else {
              item.distanceKm = '0.00';
            }
          });
          this.setData({ activities }, () => {
            this.filterList();
          });
        }
      },
      fail: (err) => {
        console.error('获取活动列表失败', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  filterList() {
    let list = [...this.data.activities];
    if (this.data.hideShort) {
      // 过滤短距离（< 200米）
      list = list.filter(item => (item.totalDistance || 0) >= 200);
    }
    this.setData({ filteredActivities: list });
  },

  toggleShortTrips(e) {
    this.setData({ hideShort: e.detail.value }, () => {
      this.filterList();
    });
  },

  shareActivity(e) {
    e.stopPropagation();
    wx.showToast({ title: '生成分享海报中', icon: 'none' });
  },

  deleteActivity(e) {
    e.stopPropagation();
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '提示',
      content: '确定删除这条划行记录吗？',
      success: (res) => {
        if (res.confirm) {
          // 先从本地删除
          const newList = this.data.activities.filter(item => item._id !== id);
          this.setData({ activities: newList }, () => {
            this.filterList();
          });
          
          // 调用云函数删除
          wx.cloud.callFunction({
            name: 'activity',
            data: {
              action: 'deleteActivity',
              activityId: id
            },
            success: () => {
              wx.showToast({ title: '已删除', icon: 'success' });
            },
            fail: (err) => {
              console.error('删除失败', err);
              // 云函数删除失败时只提示
              wx.showToast({ title: '已删除（本地）', icon: 'success' });
            }
          });
        }
      }
    });
  },

  gotoDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/activity-detail/activity-detail?id=${id}` });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  }
});