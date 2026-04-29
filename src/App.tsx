import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChatMessage,
  Contact,
  Conversation,
  DEFAULT_SDK_VERSION,
  LoginForm,
  RuntimeStatus,
  SDK_VERSION_OPTIONS,
  fetchContacts,
  fetchConversations,
  fetchMessages,
  formatFileSize,
  getConversationTitle,
  getCurrentAccount,
  getLoadedSdkSource,
  getLoadedSdkVersion,
  getPeerFromConversationId,
  loginByStaticToken,
  logout,
  makeP2PConversationId,
  sendMediaMessage,
  sendTextMessage
} from './nimClient'
import './styles.css'

type Tab = 'conversations' | 'contacts' | 'profile'

const emptyStatus: RuntimeStatus = {
  login: '未登录',
  connect: '未连接',
  sync: '未同步'
}

function formatTime(time?: number) {
  if (!time) return ''
  const d = new Date(time)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function messagePreview(message?: ChatMessage) {
  if (!message) return '暂无消息'
  if (message.messageKind === 'image') return '[图片]'
  if (message.messageKind === 'file') return `[文件] ${message.fileName || ''}`.trim()
  if (message.text) return message.text
  return `消息类型：${message.messageType ?? '未知'}`
}

function makeInitials(name = '') {
  return name.slice(0, 2).toUpperCase() || 'YX'
}

function renderMessageBody(msg: ChatMessage) {
  if (msg.messageKind === 'image') {
    return (
      <div className="mediaMessage">
        {msg.fileUrl ? <img src={msg.fileUrl} alt={msg.fileName || 'image'} /> : <p>[图片消息]</p>}
        {msg.fileName && <small>{msg.fileName}</small>}
      </div>
    )
  }

  if (msg.messageKind === 'file') {
    return (
      <a className="fileMessage" href={msg.fileUrl || '#'} target="_blank" rel="noreferrer" onClick={(event) => { if (!msg.fileUrl) event.preventDefault() }}>
        <span className="fileIcon">FILE</span>
        <span>
          <strong>{msg.fileName || '文件消息'}</strong>
          <em>{formatFileSize(msg.fileSize)}</em>
        </span>
      </a>
    )
  }

  return <p>{msg.text || `[${msg.messageType || '非文本消息'}]`}</p>
}

export default function App() {
  const [form, setForm] = useState<LoginForm>({ appkey: '', account: '', token: '', sdkVersion: DEFAULT_SDK_VERSION })
  const [loggedIn, setLoggedIn] = useState(false)
  const [status, setStatus] = useState<RuntimeStatus>(emptyStatus)
  const [tab, setTab] = useState<Tab>('conversations')
  const [loading, setLoading] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [activeConversationId, setActiveConversationId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [startChatAccid, setStartChatAccid] = useState('')
  const [notice, setNotice] = useState('')
  const [sdkInfo, setSdkInfo] = useState({ version: DEFAULT_SDK_VERSION, source: '' })
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('yxchat:lastLogin')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        const savedForm = {
          appkey: parsed.appkey || '',
          account: parsed.account || '',
          token: parsed.token || '',
          sdkVersion: parsed.sdkVersion || DEFAULT_SDK_VERSION
        }
        setForm((old) => ({ ...old, ...savedForm }))
        if (savedForm.appkey && savedForm.account && savedForm.token) {
          void doLogin(savedForm, true)
        }
      } catch {
        // ignore
      }
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeConversationId])

  useEffect(() => {
    if (!notice || !loggedIn) return
    const timer = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [notice, loggedIn])

  const activeConversation = useMemo(
    () => conversations.find((item) => item.conversationId === activeConversationId),
    [conversations, activeConversationId]
  )

  const updateStatus = (patch: Partial<RuntimeStatus>) => setStatus((old) => ({ ...old, ...patch }))

  async function refreshConversations(selectFirst = false) {
    const list: Conversation[] = await fetchConversations()
    setConversations((old) => {
      const byId = new Map<string, Conversation>()
      old.forEach((item) => byId.set(item.conversationId, item))
      list.forEach((item) => byId.set(item.conversationId, item))
      return Array.from(byId.values()).sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))
    })
    if (selectFirst && list[0]?.conversationId) setActiveConversationId(list[0].conversationId)
  }

  async function refreshContacts() {
    setContacts(await fetchContacts())
  }

  async function doLogin(loginForm: LoginForm, silent = false) {
    setLoading(true)
    setNotice(silent ? `正在恢复登录 NIMSDK ${loginForm.sdkVersion || DEFAULT_SDK_VERSION}...` : `正在加载 NIMSDK ${loginForm.sdkVersion || DEFAULT_SDK_VERSION} 并登录...`)
    try {
      await loginByStaticToken(loginForm, {
        onStatus: updateStatus,
        onMessage: (incoming, conversationId) => {
          if (!conversationId || conversationId === activeConversationId) {
            setMessages((old) => [...old, ...incoming])
          }
          refreshConversations(false)
        },
        onConversationChanged: (changed) => {
          setConversations((old) => {
            const byId = new Map(old.map((item) => [item.conversationId, item]))
            changed.forEach((item) => byId.set(item.conversationId, item))
            return Array.from(byId.values()).sort((a, b) => (b.updateTime || 0) - (a.updateTime || 0))
          })
        }
      })
      const version = getLoadedSdkVersion() || loginForm.sdkVersion
      setSdkInfo({ version, source: getLoadedSdkSource() })
      setLoggedIn(true)
      setNotice('')
      await Promise.all([refreshConversations(true), refreshContacts()])
    } catch (err: any) {
      setNotice(err?.message || `登录失败：${err?.code || '未知错误'}`)
      updateStatus({ login: '登录失败' })
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault()
    await doLogin(form)
  }

  async function handleLogout() {
    setLoading(true)
    await logout()
    localStorage.removeItem('yxchat:lastLogin')
    setLoggedIn(false)
    setStatus(emptyStatus)
    setConversations([])
    setContacts([])
    setMessages([])
    setActiveConversationId('')
    setNotice('已退出登录')
    setLoading(false)
  }

  async function openConversation(conversationId: string) {
    setActiveConversationId(conversationId)
    setTab('conversations')
    setMessages(await fetchMessages(conversationId))
  }

  async function startP2PChat(accountId: string) {
    const accid = accountId.trim()
    if (!accid) return
    const conversationId = makeP2PConversationId(accid)
    const exists = conversations.some((item) => item.conversationId === conversationId)
    if (!exists) {
      setConversations((old) => [{ conversationId, name: accid, updateTime: Date.now() }, ...old])
    }
    setStartChatAccid('')
    await openConversation(conversationId)
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!activeConversationId || !text) return
    setDraft('')
    const optimistic: ChatMessage = {
      messageClientId: `local-${Date.now()}`,
      senderId: getCurrentAccount(),
      text,
      messageKind: 'text',
      createTime: Date.now(),
      sending: true
    }
    setMessages((old) => [...old, optimistic])
    try {
      const sent = await sendTextMessage(activeConversationId, text)
      setMessages((old) => old.map((item) => item.messageClientId === optimistic.messageClientId ? sent : item))
      await refreshConversations(false)
    } catch (err: any) {
      setMessages((old) => old.map((item) => item.messageClientId === optimistic.messageClientId ? { ...item, sending: false, failed: true } : item))
      setNotice(`发送失败：${err?.code || err?.message || '未知错误'}`)
    }
  }

  async function handleMediaSelected(event: ChangeEvent<HTMLInputElement>, kind: 'image' | 'file') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !activeConversationId) return

    const localUrl = URL.createObjectURL(file)
    const optimistic: ChatMessage = {
      messageClientId: `media-${Date.now()}`,
      senderId: getCurrentAccount(),
      text: kind === 'image' ? '[图片]' : `[文件] ${file.name}`,
      messageKind: kind,
      fileName: file.name,
      fileSize: file.size,
      fileUrl: localUrl,
      createTime: Date.now(),
      uploadProgress: 0,
      sending: true
    }
    setMessages((old) => [...old, optimistic])
    try {
      const sent = await sendMediaMessage(activeConversationId, file, kind, (percentage) => {
        setMessages((old) => old.map((item) => item.messageClientId === optimistic.messageClientId ? { ...item, uploadProgress: Math.round(percentage * 100) } : item))
      })
      setMessages((old) => old.map((item) => item.messageClientId === optimistic.messageClientId ? sent : item))
      await refreshConversations(false)
    } catch (err: any) {
      setMessages((old) => old.map((item) => item.messageClientId === optimistic.messageClientId ? { ...item, sending: false, failed: true } : item))
      setNotice(`媒体消息发送失败：${err?.code || err?.message || '未知错误'}`)
    } finally {
      URL.revokeObjectURL(localUrl)
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">YunXin Web IMSDK</p>
          <h1>YXChat</h1>
          <p className="heroText">纯前端 IM 示例：支持选择 NIMSDK 版本、静态 Token 登录、文本/图片/文件消息收发，不依赖业务服务端 API。</p>
        </div>
        <div className="statusGrid">
          <StatusPill label="SDK" value={sdkInfo.version} />
          <StatusPill label="登录" value={status.login} />
          <StatusPill label="同步" value={status.sync} />
        </div>
      </section>

      {!loggedIn ? (
        <section className="loginCard">
          <div>
            <p className="eyebrow">Static Token Auth</p>
            <h2>账号密码登录</h2>
            <p>这里的“密码”即云信 IM token。当前默认 NIMSDK 版本为 <b>{DEFAULT_SDK_VERSION}</b>，也可以在登录前选择历史版本或输入自定义版本号。</p>
          </div>
          <form className="loginForm" onSubmit={handleLogin}>
            <label>
              NIMSDK 版本
              <input list="sdkVersions" value={form.sdkVersion} onChange={(e) => setForm({ ...form, sdkVersion: e.target.value })} placeholder={DEFAULT_SDK_VERSION} />
              <datalist id="sdkVersions">
                {SDK_VERSION_OPTIONS.map((version) => <option value={version} key={version} />)}
              </datalist>
            </label>
            <label>
              AppKey
              <input value={form.appkey} onChange={(e) => setForm({ ...form, appkey: e.target.value })} placeholder="请输入云信 AppKey" />
            </label>
            <label>
              accid
              <input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder="请输入 IM 账号 accid" />
            </label>
            <label>
              token
              <input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder="请输入静态 token" type="password" />
            </label>
            <button disabled={loading}>{loading ? '登录中...' : '登录 YXChat'}</button>
            {notice && <p className="notice">{notice}</p>}
          </form>
        </section>
      ) : (
        <section className={`appFrame ${activeConversation ? 'hasActiveChat' : ''}`}>
          <aside className="sidebar">
            <div className="profileMini">
              <div className="avatar">{makeInitials(getCurrentAccount())}</div>
              <div>
                <strong>{getCurrentAccount()}</strong>
                <span>NIMSDK {sdkInfo.version}</span>
              </div>
            </div>
            <nav>
              <button className={tab === 'conversations' ? 'active' : ''} onClick={() => setTab('conversations')}>会话列表</button>
              <button className={tab === 'contacts' ? 'active' : ''} onClick={() => setTab('contacts')}>通讯录</button>
              <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>个人中心</button>
            </nav>
            <form className="quickStart" onSubmit={(event) => { event.preventDefault(); startP2PChat(startChatAccid) }}>
              <input value={startChatAccid} onChange={(e) => setStartChatAccid(e.target.value)} placeholder="输入 accid 发起单聊" />
              <button>开始聊天</button>
            </form>
          </aside>

          <section className="panelList">
            {tab === 'conversations' && (
              <>
                <PanelHeader title="会话" action="刷新" onAction={() => refreshConversations(false)} />
                <div className="list">
                  {conversations.length === 0 && <Empty text="暂无会话。可以在左侧输入对方 accid 发起单聊。" />}
                  {conversations.map((item) => (
                    <button className={`listItem ${item.conversationId === activeConversationId ? 'selected' : ''}`} key={item.conversationId} onClick={() => openConversation(item.conversationId)}>
                      <div className="avatar small">{makeInitials(getConversationTitle(item))}</div>
                      <div className="listMain">
                        <strong>{getConversationTitle(item)}</strong>
                        <span>{messagePreview(item.lastMessage)}</span>
                      </div>
                      <div className="meta">
                        <span>{formatTime(item.updateTime)}</span>
                        {!!item.unreadCount && <em>{item.unreadCount}</em>}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {tab === 'contacts' && (
              <>
                <PanelHeader title="通讯录" action="刷新" onAction={refreshContacts} />
                <div className="list">
                  {contacts.length === 0 && <Empty text="好友列表为空或仍在同步中。" />}
                  {contacts.map((item) => (
                    <button className="listItem" key={item.accountId} onClick={() => startP2PChat(item.accountId)}>
                      <div className="avatar small">{makeInitials(item.name || item.accountId)}</div>
                      <div className="listMain">
                        <strong>{item.name || item.accountId}</strong>
                        <span>{item.accountId}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {tab === 'profile' && (
              <div className="profilePanel">
                <div className="avatar large">{makeInitials(getCurrentAccount())}</div>
                <h2>{getCurrentAccount()}</h2>
                <p>当前登录方式：静态 Token 登录，authType = 0。</p>
                <div className="profileStats">
                  <span><b>{conversations.length}</b> 会话</span>
                  <span><b>{contacts.length}</b> 好友</span>
                  <span><b>{sdkInfo.version}</b> SDK</span>
                </div>
                <button className="ghost" onClick={handleLogout} disabled={loading}>退出登录</button>
                <p className="hint">SDK 来源：{sdkInfo.source || '未记录'}。生产环境不要把 App Secret 放到前端，也不要在前端生成动态 token。</p>
              </div>
            )}
          </section>

          <section className="chatPanel">
            {activeConversation ? (
              <>
                <header className="chatHeader">
                  <button className="mobileBack" onClick={() => setActiveConversationId('')}>返回</button>
                  <div className="avatar small">{makeInitials(getConversationTitle(activeConversation))}</div>
                  <div>
                    <strong>{getConversationTitle(activeConversation)}</strong>
                    <span>{getPeerFromConversationId(activeConversation.conversationId)}</span>
                  </div>
                </header>
                <div className="messages">
                  {messages.length === 0 && <Empty text="暂无历史消息。发送第一条消息试试。" />}
                  {messages.map((msg, index) => {
                    const mine = msg.senderId === getCurrentAccount()
                    return (
                      <div className={`bubbleRow ${mine ? 'mine' : ''}`} key={msg.messageClientId || msg.messageServerId || index}>
                        <div className={`bubble ${msg.messageKind === 'image' ? 'imageBubble' : ''}`}>
                          {renderMessageBody(msg)}
                          <span>{formatTime(msg.createTime)} {msg.uploadProgress !== undefined && msg.sending ? `上传 ${msg.uploadProgress}%` : msg.sending ? '发送中' : msg.failed ? '失败' : ''}</span>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>
                <form className="composer" onSubmit={handleSend}>
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="输入文本消息，回车发送" />
                  <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(event) => handleMediaSelected(event, 'image')} />
                  <input ref={fileInputRef} type="file" hidden onChange={(event) => handleMediaSelected(event, 'file')} />
                  <button type="button" className="toolButton" onClick={() => imageInputRef.current?.click()}>图片</button>
                  <button type="button" className="toolButton" onClick={() => fileInputRef.current?.click()}>文件</button>
                  <button type="submit">发送</button>
                </form>
              </>
            ) : (
              <div className="blankChat">
                <div className="orbit" />
                <h2>选择一个会话</h2>
                <p>从会话列表或通讯录进入聊天，也可以输入 accid 创建单聊。</p>
              </div>
            )}
          </section>
        </section>
      )}

      {notice && loggedIn && <div className="toast">{notice}</div>}
    </main>
  )
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return <div className="statusPill"><span>{label}</span><strong>{value}</strong></div>
}

function PanelHeader({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <header className="panelHeader"><h2>{title}</h2><button onClick={onAction}>{action}</button></header>
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>
}
