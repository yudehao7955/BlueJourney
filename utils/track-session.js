/**
 * 进行中划行会话本地持久化（防崩溃/杀进程导致内存轨迹丢失）
 */
const ACTIVE_TRACK_STORAGE_KEY = 'bluejourney_active_track_v1'

function saveActiveTrackSession(payload) {
  try {
    wx.setStorageSync(ACTIVE_TRACK_STORAGE_KEY, payload)
  } catch (e) {
    console.warn('saveActiveTrackSession failed', e)
  }
}

function clearActiveTrackSession() {
  try {
    wx.removeStorageSync(ACTIVE_TRACK_STORAGE_KEY)
  } catch (e) {
    // ignore
  }
}

function readActiveTrackSession() {
  try {
    return wx.getStorageSync(ACTIVE_TRACK_STORAGE_KEY) || null
  } catch (e) {
    return null
  }
}

module.exports = {
  ACTIVE_TRACK_STORAGE_KEY,
  saveActiveTrackSession,
  clearActiveTrackSession,
  readActiveTrackSession
}
