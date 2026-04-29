import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChatMessage,
  Contact,
  Conversation,
  LoginForm,
  RuntimeStatus,
  fetchContacts,
  fetchConversations,
  fetchMessages,
  getConversationTitle,
  getCurrentAccount,
  getPeerFromConversationId,
  loginByStaticToken,
  logout,
  makeP2PConversationId,
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
  if (message.text) return message.text
  return `消息类型：${message.messageType ?? '未知'}`
}

function makeInitials(name = '') {
  return name.slice(0, 2).toUpperCase() || 'YX'
}

export default function App() {
  const [form, setForm] = useState<LoginForm>({ appkey: '', account: '', token: '' })
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
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('yxchat:lastLogin')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setForm((old) => ({ ...old, appkey: parsed.appkey || '', account: parsed.account || '' }))
      } catch {
        // ignore
      }
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeConversationId])

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

  async function handleLogin(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setNotice('正在初始化 IMSDK 并登录...')
    try {
      await loginByStaticToken(form, {
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
      setLoggedIn(true)
      setNotice('登录成功。已开始同步会话、消息和好友关系。')
      await Promise.all([refreshConversations(true), refreshContacts()])
    } catch (err: any) {
      setNotice(err?.message || `登录失败：${err?.code || '未知错误'}`)
      updateStatus({ login: '登录失败' })
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    setLoading(true)
    await logout()
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

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">YunXin Web IMSDK</p>
          <h1>YXChat</h1>
          <p className="heroText">纯前端 IM 示例：AppKey + accid + token 登录，包含会话、聊天、通讯录和个人中心，不依赖业务服务端 API。</p>
        </div>
        <div className="statusGrid">
          <StatusPill label="登录" value={status.login} />
          <StatusPill label="连接" value={status.connect} />
          <StatusPill label="同步" value={status.sync} />
        </div>
      </section>

      {!loggedIn ? (
        <section className="loginCard">
          <div>
            <p className="eyebrow">Static Token Auth</p>
            <h2>账号密码登录</h2>
            <p>这里的“密码”即云信 IM token。账号创建和 token 获取请在云信控制台或你已有后台完成，本页面不会调用任何服务端 API。</p>
          </div>
          <form className="loginForm" onSubmit={handleLogin}>
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
        <section className="appFrame">
          <aside className="sidebar">
            <div className="profileMini">
              <div className="avatar">{makeInitials(getCurrentAccount())}</div>
              <div>
                <strong>{getCurrentAccount()}</strong>
                <span>IM 在线工作台</span>
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
                  <span><b>{status.login}</b> 状态</span>
                </div>
                <button className="ghost" onClick={handleLogout} disabled={loading}>退出登录</button>
                <p className="hint">安全提示：Demo 仅用于前端集成验证。生产环境不要把 App Secret 放到前端，也不要在前端生成动态 token。</p>
              </div>
            )}
          </section>

          <section className="chatPanel">
            {activeConversation ? (
              <>
                <header className="chatHeader">
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
                        <div className="bubble">
                          <p>{msg.text || `[${msg.messageType || '非文本消息'}]`}</p>
                          <span>{formatTime(msg.createTime)} {msg.sending ? '发送中' : msg.failed ? '失败' : ''}</span>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={bottomRef} />
                </div>
                <form className="composer" onSubmit={handleSend}>
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="输入文本消息，回车发送" />
                  <button>发送</button>
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
