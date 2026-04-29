export const DEFAULT_SDK_VERSION = '10.9.81'
export const SDK_VERSION_OPTIONS = ['10.9.81', '10.9.80', '10.9.70', '10.9.0', '10.8.30', '10.8.0']

export type LoginForm = {
  appkey: string
  account: string
  token: string
  sdkVersion: string
}

export type RuntimeStatus = {
  login: string
  connect: string
  sync: string
}

export type ChatMessage = {
  messageClientId?: string
  messageServerId?: string
  senderId?: string
  receiverId?: string
  text?: string
  messageType?: number | string
  messageKind: 'text' | 'image' | 'file' | 'other'
  attachment?: any
  fileName?: string
  fileUrl?: string
  fileSize?: number
  imageWidth?: number
  imageHeight?: number
  createTime?: number
  uploadProgress?: number
  sending?: boolean
  failed?: boolean
}

export type Conversation = {
  conversationId: string
  name?: string
  avatar?: string
  unreadCount?: number
  lastMessage?: ChatMessage
  updateTime?: number
  raw?: any
}

export type Contact = {
  accountId: string
  alias?: string
  name?: string
  avatar?: string
  raw?: any
}

let nim: any = null
let currentAccount = ''
let loadedSdkVersion = ''
let loadedSdkSource = ''

declare global {
  interface Window {
    NIM?: any
  }
}

function sdkUrls(version: string) {
  const safeVersion = version.trim() || DEFAULT_SDK_VERSION
  return [
    `https://unpkg.com/nim-web-sdk-ng@${safeVersion}/dist/v2/NIM_BROWSER_SDK.js`,
    `https://cdn.jsdelivr.net/npm/nim-web-sdk-ng@${safeVersion}/dist/v2/NIM_BROWSER_SDK.js`
  ]
}

async function loadScript(url: string) {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`SDK 加载失败：${url}`))
    document.head.appendChild(script)
  })
}

export async function loadNimSdk(version = DEFAULT_SDK_VERSION) {
  const targetVersion = version.trim() || DEFAULT_SDK_VERSION
  if (loadedSdkVersion === targetVersion && window.NIM?.default) return window.NIM.default

  window.NIM = undefined
  let lastError: unknown
  for (const url of sdkUrls(targetVersion)) {
    try {
      await loadScript(url)
      const sdk = window.NIM?.default || window.NIM
      if (sdk?.getInstance) {
        loadedSdkVersion = normalizeSdkVersion(sdk.sdkVersionFormat || sdk.sdkVersion || targetVersion, targetVersion)
        loadedSdkSource = url
        return sdk
      }
    } catch (err) {
      lastError = err
    }
  }
  throw lastError || new Error('无法加载 NIMSDK')
}

function normalizeSdkVersion(value: unknown, fallback: string) {
  const raw = String(value || '').trim()
  if (!raw) return fallback
  if (raw.includes('.')) return raw
  if (/^\d{6}$/.test(raw)) {
    const major = raw.slice(0, 2)
    const minor = String(Number(raw.slice(2, 4)))
    const patch = String(Number(raw.slice(4, 6)))
    return `${major}.${minor}.${patch}`
  }
  return fallback
}

export function getLoadedSdkVersion() {
  return loadedSdkVersion
}

export function getLoadedSdkSource() {
  return loadedSdkSource
}

const tryCall = async <T>(label: string, fn: () => Promise<T> | T): Promise<T | null> => {
  try {
    return await fn()
  } catch (err) {
    console.warn(`[YXChat] ${label} failed`, err)
    return null
  }
}

export function getNim() {
  return nim
}

export function getCurrentAccount() {
  return currentAccount
}

export function getPeerFromConversationId(conversationId = '') {
  const parts = conversationId.split('|')
  const p2pType = '1'
  if (parts.length >= 3 && parts[1] === p2pType) {
    return parts[0] === currentAccount ? parts[2] : parts[0]
  }
  return conversationId
}

export function getConversationTitle(conversation: Conversation) {
  return conversation.name || getPeerFromConversationId(conversation.conversationId) || conversation.conversationId
}

export function normalizeMessage(msg: any): ChatMessage {
  const attachment = msg?.attachment || msg?.attach || msg?.body?.attachment
  const messageType = msg?.messageType ?? msg?.type
  const isImage = messageType === 1 || Boolean(attachment?.width && attachment?.url)
  const isFile = messageType === 6 || Boolean(attachment?.url && attachment?.name && !isImage)
  return {
    messageClientId: msg?.messageClientId || msg?.clientId || msg?.id,
    messageServerId: msg?.messageServerId || msg?.serverId,
    senderId: msg?.senderId || msg?.from || msg?.fromAccount,
    receiverId: msg?.receiverId || msg?.to || msg?.toAccount,
    text: msg?.text || msg?.body?.text || attachment?.text || '',
    messageType,
    messageKind: isImage ? 'image' : isFile ? 'file' : (messageType === 0 || msg?.text ? 'text' : 'other'),
    attachment,
    fileName: attachment?.name,
    fileUrl: attachment?.url,
    fileSize: attachment?.size,
    imageWidth: attachment?.width,
    imageHeight: attachment?.height,
    createTime: msg?.createTime || msg?.time || Date.now(),
    sending: msg?.sending,
    failed: msg?.failed
  }
}

export function normalizeConversation(item: any): Conversation {
  const lastMessage = item?.lastMessage ? normalizeMessage(item.lastMessage) : undefined
  const peer = getPeerFromConversationId(item?.conversationId || '')
  return {
    conversationId: item?.conversationId || '',
    name: item?.name || item?.conversationName || item?.serverExtension?.name || peer,
    avatar: item?.avatar,
    unreadCount: item?.unreadCount || 0,
    lastMessage,
    updateTime: item?.updateTime || item?.sortOrder || lastMessage?.createTime || Date.now(),
    raw: item
  }
}

export function normalizeContact(item: any): Contact {
  const user = item?.userProfile || item?.user || item
  return {
    accountId: item?.accountId || item?.friendAccountId || user?.accountId || user?.account || '',
    alias: item?.alias,
    name: item?.alias || user?.name || user?.nick || user?.accountId || item?.accountId,
    avatar: user?.avatar || user?.avatarUrl,
    raw: item
  }
}

export async function loginByStaticToken(form: LoginForm, callbacks: {
  onStatus?: (status: Partial<RuntimeStatus>) => void
  onMessage?: (messages: ChatMessage[], conversationId?: string) => void
  onConversationChanged?: (conversations: Conversation[]) => void
}) {
  currentAccount = form.account.trim()
  const appkey = form.appkey.trim()
  const token = form.token.trim()
  const NIM = await loadNimSdk(form.sdkVersion)

  if (!appkey || !currentAccount || !token) {
    throw new Error('AppKey、accid、token 都不能为空')
  }

  nim = NIM.getInstance({
    appkey,
    debugLevel: 'debug',
    apiVersion: 'v2',
    enableV2CloudConversation: true
  }, {})

  bindBaseEvents(callbacks)

  await nim.V2NIMLoginService.login(currentAccount, token, {
    forceMode: false,
    authType: 0,
    timeout: 45000,
    retryCount: 3
  })

  localStorage.setItem('yxchat:lastLogin', JSON.stringify({ appkey, account: currentAccount, token, sdkVersion: form.sdkVersion || loadedSdkVersion }))
  callbacks.onStatus?.({ login: '已登录' })
  return nim
}

export async function logout() {
  if (!nim) return
  await tryCall('logout', () => nim.V2NIMLoginService.logout())
  nim = null
  currentAccount = ''
}

function bindBaseEvents(callbacks: {
  onStatus?: (status: Partial<RuntimeStatus>) => void
  onMessage?: (messages: ChatMessage[], conversationId?: string) => void
  onConversationChanged?: (conversations: Conversation[]) => void
}) {
  const login = nim.V2NIMLoginService
  login.on('onLoginStatus', (status: any) => callbacks.onStatus?.({ login: String(status) }))
  login.on('onConnectStatus', (status: any) => callbacks.onStatus?.({ connect: String(status) }))
  login.on('onLoginFailed', (err: any) => callbacks.onStatus?.({ login: `登录失败 ${err?.code || ''}` }))
  login.on('onKickedOffline', () => callbacks.onStatus?.({ login: '已被踢下线' }))
  login.on('onDataSync', (_type: any, state: any) => callbacks.onStatus?.({ sync: String(state) }))

  const messageService = nim.V2NIMMessageService
  messageService?.on?.('onReceiveMessages', (messages: any[]) => {
    const list = (messages || []).map(normalizeMessage)
    callbacks.onMessage?.(list, messages?.[0]?.conversationId)
  })

  const conversationService = getConversationService()
  conversationService?.on?.('onSyncStarted', () => callbacks.onStatus?.({ sync: '会话同步中' }))
  conversationService?.on?.('onSyncFinished', () => callbacks.onStatus?.({ sync: '会话同步完成' }))
  conversationService?.on?.('onSyncFailed', () => callbacks.onStatus?.({ sync: '会话同步失败' }))
  conversationService?.on?.('onConversationChanged', (items: any[]) => callbacks.onConversationChanged?.((items || []).map(normalizeConversation)))
  conversationService?.on?.('onConversationCreated', (item: any) => callbacks.onConversationChanged?.([normalizeConversation(item)]))
  conversationService?.on?.('onTotalUnreadCountChanged', (count: number) => callbacks.onStatus?.({ sync: `总未读 ${count}` }))

  nim.V2NIMFriendService?.on?.('onFriendAdded', () => callbacks.onStatus?.({ sync: '好友列表已更新' }))
  nim.V2NIMFriendService?.on?.('onFriendDeleted', () => callbacks.onStatus?.({ sync: '好友列表已更新' }))
}

function getConversationService() {
  return nim?.V2NIMConversationService || nim?.V2NIMLocalConversationService
}

export function makeP2PConversationId(accountId: string) {
  const util = nim?.V2NIMConversationIdUtil
  if (util?.p2pConversationId) return util.p2pConversationId(accountId)
  return `${currentAccount}|1|${accountId}`
}

export async function fetchConversations() {
  if (!nim) return []
  const cloud = await tryCall('get cloud conversation list', async () => {
    const res = await nim.V2NIMConversationService?.getConversationList?.(0, 100)
    return Array.isArray(res) ? res : res?.conversationList || res?.list || []
  })
  const source = cloud || await tryCall('get local conversation list', async () => {
    const res = await nim.V2NIMLocalConversationService?.getConversationList?.(0, 100)
    return Array.isArray(res) ? res : res?.conversationList || res?.list || []
  }) || []
  const normalized: Conversation[] = source.map(normalizeConversation)
  return normalized.sort((a: Conversation, b: Conversation) => (b.updateTime || 0) - (a.updateTime || 0))
}

export async function fetchMessages(conversationId: string) {
  if (!nim || !conversationId) return []
  const res = await tryCall('get message list', async () => {
    const result = await nim.V2NIMMessageService.getMessageListEx({
      conversationId,
      limit: 50,
      direction: 0
    })
    return Array.isArray(result) ? result : result?.messages || result?.messageList || []
  })
  const normalized: ChatMessage[] = (res || []).map(normalizeMessage)
  return normalized.sort((a: ChatMessage, b: ChatMessage) => (a.createTime || 0) - (b.createTime || 0))
}

export async function sendTextMessage(conversationId: string, text: string) {
  if (!nim) throw new Error('请先登录')
  const message = nim.V2NIMMessageCreator.createTextMessage(text)
  const result = await nim.V2NIMMessageService.sendMessage(message, conversationId)
  return normalizeMessage(result?.message || result || message)
}

export async function sendMediaMessage(
  conversationId: string,
  file: File,
  kind: 'image' | 'file',
  onProgress?: (percentage: number) => void
) {
  if (!nim) throw new Error('请先登录')
  const creator = nim.V2NIMMessageCreator
  const message = kind === 'image'
    ? creator.createImageMessage(file, file.name)
    : creator.createFileMessage(file, file.name)
  const result = await nim.V2NIMMessageService.sendMessage(message, conversationId, {}, (percentage: number) => {
    onProgress?.(percentage)
  })
  return normalizeMessage(result?.message || result || message)
}

export function formatFileSize(size?: number) {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export async function fetchContacts() {
  if (!nim) return []
  const raw = await tryCall('get friend list', () => nim.V2NIMFriendService.getFriendList())
  const contacts: Contact[] = (raw || []).map(normalizeContact)
  return contacts.filter((item: Contact) => item.accountId)
}

export async function fetchUserProfiles(accounts: string[]) {
  if (!nim || accounts.length === 0) return []
  const users = await tryCall('get user profiles', () => nim.V2NIMUserService.getUserList(accounts.slice(0, 100)))
  return users || []
}
