<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { statusBarNoticeManager } from '~/composables/statusbarnotice'

const { closeProjectManagerWindow } = windowsManager()
const { createProject, openProjectFromFile, saveProject } = projectManager()
const { showStatusBarNotice } = statusBarNoticeManager()

const PROJECT_SUCCESS_NOTICE_DURATION_MS = 2000
const PROJECT_SUCCESS_NOTICE_BACKGROUND = '#81c995'
const PROJECT_SUCCESS_NOTICE_TEXT_COLOR = '#0b3818'

const showProjectSuccessNotice = (message: string) => {
  showStatusBarNotice('project', message, PROJECT_SUCCESS_NOTICE_DURATION_MS, {
    backgroundColor: PROJECT_SUCCESS_NOTICE_BACKGROUND,
    textColor: PROJECT_SUCCESS_NOTICE_TEXT_COLOR
  })
}

// 视图状态：'select' 初始选择模式 | 'create' 新建工程表单模式
const isCreating = ref(false)
const projectName = ref('未命名工程')
const errorMessage = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const APP_VERSION = '1.0 公开测试版@buerstrd'

// 切换到新建工程模式
const enterCreateMode = () => {
  isCreating.value = true
  errorMessage.value = ''
  nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

// 取消新建并返回初始选择
const cancelCreate = () => {
  isCreating.value = false
  errorMessage.value = ''
  projectName.value = '未命名工程'
}

// 确认创建工程
const handleCreateConfirm = () => {
  const name = projectName.value.trim() || '未命名工程'
  try {
    createProject(name)

    // 关闭项目管理器窗口
    closeProjectManagerWindow('default-layout')
  } catch (err: any) {
    errorMessage.value = err.message || '创建工程失败'
  }
}

// 触发本地文件选择
const triggerOpenFileDialog = () => {
  errorMessage.value = ''
  fileInputRef.value?.click()
}

const handleSaveProject = () => {
  errorMessage.value = ''
  try {
    saveProject()
    showProjectSuccessNotice('已保存项目')
    closeProjectManagerWindow('preserve-layout')
  } catch (err: any) {
    errorMessage.value = err.message || '保存项目失败'
  }
}

// 处理本地文件选择
const handleFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  errorMessage.value = ''
  try {
    const project = await openProjectFromFile(file)
    showProjectSuccessNotice('成功读取项目')

    // 有已保存窗口布局时保留原布局，旧项目则生成默认四宫格
    const savedWindows = project.data?.windows?.items
    const hasSavedLayout = Array.isArray(savedWindows) &&
      savedWindows.some((windowItem: any) => windowItem?.id && windowItem.id !== 'win-project-manager')
    closeProjectManagerWindow(hasSavedLayout ? 'preserve-layout' : 'default-layout')
  } catch (err: any) {
    errorMessage.value = err.message || '文件读取错误，请确认格式为标准的 .lseproj 文件'
  } finally {
    // 重置 input 以便重复选择同一文件
    target.value = ''
  }
}

</script>

<template>
  <div class="project-manager-container">
    <!-- 项目管理器顶部 -->
    <div class="project-manager-header">
      <div class="header-brand">
        <span class="brand-text">LiveStage Effects</span>
      </div>
      <p class="project-manager-subtitle">
        {{ isCreating ? '填写工程名称以开始新项目' : '创建、打开或保存 .lseproj 项目文件' }}
      </p>
    </div>

    <!-- 错误信息提示条 -->
    <div v-if="errorMessage" class="error-banner">
      <svg class="error-icon" viewBox="0 0 24 24" fill="currentColor">
        <path
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
        />
      </svg>
      <span class="error-text">{{ errorMessage }}</span>
      <button class="error-close-btn" type="button" @click="errorMessage = ''">✕</button>
    </div>

    <!-- 中间主体操作区 -->
    <div class="project-manager-body">
      <!-- 初始选择卡片网格 -->
      <div v-if="!isCreating" class="action-grid">
        <!-- 新建工程卡片 -->
        <button
          class="action-card md3-ripple-surface"
          type="button"
          @click="enterCreateMode"
        >
          <div class="card-icon-box new-box">
            <svg class="card-icon" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 14h-3v3h-2v-3H8v-2h3v-3h2v3h3v2zm-3-7V3.5L18.5 9H13z"
              />
            </svg>
          </div>
          <div class="card-text">
            <span class="card-title">新建工程</span>
            <span class="card-desc">创建全新 .lseproj 项目</span>
          </div>
        </button>

        <!-- 打开工程卡片 -->
        <button
          class="action-card md3-ripple-surface"
          type="button"
          @click="triggerOpenFileDialog"
        >
          <div class="card-icon-box open-box">
            <svg class="card-icon" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"
              />
            </svg>
          </div>
          <div class="card-text">
            <span class="card-title">打开工程</span>
            <span class="card-desc">加载本地 .lseproj 文件</span>
          </div>
        </button>

        <!-- 保存工程卡片 -->
        <button
          class="action-card md3-ripple-surface"
          type="button"
          @click="handleSaveProject"
        >
          <div class="card-icon-box save-box">
            <svg class="card-icon" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"
              />
            </svg>
          </div>
          <div class="card-text">
            <span class="card-title">保存项目</span>
            <span class="card-desc">保存当前布局与配置</span>
          </div>
        </button>

        <!-- 隐藏的文件选择输入框 -->
        <input
          ref="fileInputRef"
          type="file"
          accept=".lseproj,application/json"
          class="hidden-file-input"
          @change="handleFileChange"
        />
      </div>

      <!-- 新建工程内嵌表单 -->
      <div v-else class="create-form-panel">
        <div class="form-row">
          <label class="form-label" for="lse-project-name">工程名称</label>
          <div class="input-container">
            <input
              id="lse-project-name"
              ref="nameInputRef"
              v-model="projectName"
              type="text"
              class="form-input"
              placeholder="请输入工程名称"
              @keydown.enter="handleCreateConfirm"
              @keydown.esc="cancelCreate"
            />
            <span class="input-suffix">.lseproj</span>
          </div>
        </div>

        <div class="form-actions">
          <button
            class="action-btn text-btn"
            type="button"
            @click="cancelCreate"
          >
            返回
          </button>
          <button
            class="action-btn primary-btn"
            type="button"
            @click="handleCreateConfirm"
          >
            <svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
            创建并进入
          </button>
        </div>
      </div>
    </div>

    <!-- 底部栏：工程格式标识 -->
    <div class="project-manager-footer">
      <div class="format-badge">
        <span class="badge-dot" />
        <span class="badge-label">工程格式：*.lseproj</span>
      </div>
      <span class="app-version">版本 {{ APP_VERSION }}</span>
    </div>
  </div>
</template>

<style scoped>
.project-manager-container {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  padding: 24px 28px 20px;
  box-sizing: border-box;
  background-color: var(--md-sys-color-surface, #1c1f26);
  color: var(--md-sys-color-on-surface, #e8edf2);
  user-select: none;
}

/* 顶部品牌与描述 */
.project-manager-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-text {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.project-manager-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

/* 错误提示横幅 */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-top: 10px;
  background-color: rgba(239, 83, 80, 0.12);
  border: 1px solid rgba(239, 83, 80, 0.35);
  border-radius: 8px;
  font-size: 12px;
  color: #ff8a80;
}

.error-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.error-text {
  flex: 1;
}

.error-close-btn {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 12px;
  line-height: 1;
  opacity: 0.75;
}

.error-close-btn:hover {
  opacity: 1;
}

/* 中间主体区 */
.project-manager-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 14px 0;
}

/* 卡片网格 */
.action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
}

.action-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 22px 16px;
  background-color: var(--md-sys-color-surface-container, #22262e);
  border: 1px solid var(--md-sys-color-outline-variant, #3a404c);
  border-radius: 14px;
  cursor: pointer;
  color: var(--md-sys-color-on-surface, #e8edf2);
  transition:
    background-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    border-color 0.2s cubic-bezier(0.2, 0, 0, 1),
    transform 0.15s cubic-bezier(0.2, 0, 0, 1);
}

.action-card:hover {
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  border-color: var(--md-sys-color-primary, #8ab4f8);
  transform: translateY(-1px);
}

.action-card:active {
  transform: translateY(0);
}

.action-card:disabled {
  cursor: default;
  opacity: 0.42;
}

.action-card:disabled:hover {
  background-color: var(--md-sys-color-surface-container, #22262e);
  border-color: var(--md-sys-color-outline-variant, #3a404c);
  transform: none;
}

.card-icon-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  transition: transform 0.2s ease;
}

.action-card:hover .card-icon-box {
  transform: scale(1.06);
}

.card-icon-box.new-box {
  background-color: rgba(138, 180, 248, 0.12);
  color: var(--md-sys-color-primary, #8ab4f8);
}

.card-icon-box.open-box {
  background-color: rgba(185, 195, 212, 0.12);
  color: var(--md-sys-color-secondary, #b9c3d4);
}

.card-icon-box.save-box {
  background-color: rgba(138, 180, 248, 0.12);
  color: var(--md-sys-color-primary, #8ab4f8);
}

.card-icon {
  width: 24px;
  height: 24px;
}

.card-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.card-desc {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.hidden-file-input {
  display: none;
}

/* 新建工程表单面板 */
.create-form-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px;
  background-color: var(--md-sys-color-surface-container, #22262e);
  border: 1px solid var(--md-sys-color-outline-variant, #3a404c);
  border-radius: 14px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.input-container {
  display: flex;
  align-items: center;
  background-color: var(--md-sys-color-surface-container-high, #282c35);
  border: 1px solid var(--md-sys-color-outline-variant, #3a404c);
  border-radius: 8px;
  padding: 0 10px;
  transition: border-color 0.2s ease;
}

.input-container:focus-within {
  border-color: var(--md-sys-color-primary, #8ab4f8);
}

.form-input {
  flex: 1;
  height: 36px;
  background: transparent;
  border: none;
  outline: none;
  color: var(--md-sys-color-on-surface, #e8edf2);
  font-size: 13px;
}

.input-suffix {
  font-size: 12px;
  color: var(--md-sys-color-primary, #8ab4f8);
  font-weight: 500;
  user-select: none;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.text-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.text-btn:hover {
  background-color: rgba(255, 255, 255, 0.05);
  color: var(--md-sys-color-on-surface, #e8edf2);
}

.primary-btn {
  background-color: var(--md-sys-color-primary, #8ab4f8);
  color: var(--md-sys-color-on-primary, #042a59);
  border: none;
}

.primary-btn:hover {
  background-color: #9ec1f9;
}

.btn-icon {
  width: 16px;
  height: 16px;
}

/* 底部栏 */
.project-manager-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid var(--md-sys-color-outline-variant, rgba(255, 255, 255, 0.08));
}

.format-badge {
  display: flex;
  align-items: center;
  gap: 6px;
}

.badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--md-sys-color-primary, #8ab4f8);
  opacity: 0.8;
}

.badge-label {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

.app-version {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant, #aab3bf);
}

</style>
