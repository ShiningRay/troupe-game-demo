# Coin Rush Client 🪙

Coin Rush 多人竞技场小游戏的**浏览器客户端**：零构建单文件（`index.html` + `client.js`），
Canvas 渲染 + 10Hz 快照插值到 60fps、WASD/方向键移动、实时排行榜、断线 3 秒自动重连。

线上协议见 [coin-rush-servers/PROTOCOL.md](https://github.com/ShiningRay/coin-rush-servers/blob/main/PROTOCOL.md)——
本客户端可连接**任意符合该协议的服务器实现**（TypeScript / Crystal / Ruby / Elixir / Go，
见 [coin-rush-servers](https://github.com/ShiningRay/coin-rush-servers)）。

## 运行

客户端是纯静态文件，用任意静态服务器托管即可：

```sh
npx serve .            # 或 python -m http.server 8000
# 打开 http://localhost:8000/?room=lobby&server=127.0.0.1:8787
```

| URL 参数 | 说明 |
|---|---|
| `?room=` | 房间名（默认 `lobby`；不同房间 = 不同 Actor，互不干扰） |
| `?server=host:port` | 服务器地址（缺省 = 本页面所在主机，即服务器同机托管静态文件的部署形态） |

## 玩法

- 输入昵称进场；`WASD` / 方向键移动，碰到金币即得分，金币原地重生
- 右侧排行榜按分数实时排序；渲染按 100ms 快照插值平滑

## 服务器同机托管（可选）

五种服务器实现都支持"静态文件 + WebSocket 同端口"形态：把本仓库 clone 到服务器实现的
**同级目录**（`../coin-rush-client`）即可，服务器检测到该目录会自动托管静态文件，
此时无需 `?server=` 参数，直接开 `http://localhost:<端口>/?room=lobby`。

## License

MIT，见 [LICENSE](LICENSE)。
