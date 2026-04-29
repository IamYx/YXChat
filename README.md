# YXChat

一个纯前端的网易云信 Web IMSDK 示例项目，不依赖业务服务端 API。

## 功能

- AppKey + accid + token 静态 Token 登录
- 会话列表
- 聊天详情和文本消息收发
- 通讯录 / 好友列表
- 个人中心和登录状态

## 注意

1. accid 和 token 需要提前在云信控制台或已有后台创建，本项目不会调用服务端 API。
2. 会话列表默认启用云端会话：需要在云信控制台打开“云端会话”开关。
3. 如果未开通云端会话，代码会尝试回退到本地会话能力。

## 本地运行

```bash
npm install
npm run dev
```

## 打包

```bash
npm run build
```
