# 原生 Chrome 无痕测试

日期：2026-11-03（America/New_York）。通过 Chrome macOS 原生菜单 File → 新的无痕式窗口创建独立窗口，原生可访问性树明确显示 `Google Chrome（无痕）` 与 `您已进入无痕模式`。没有复用正常窗口的应用会话，没有更改 Cookie 或安全设置。

| 测试 | 实际结果 | 状态 |
|---|---|---|
| Public 提交专属根页面 | 正常显示 Great trips. Better together. 与 Continue with Google；没有 Vercel 登录墙 | PASS |
| Public `/trips/23` 私人行程 | 转到 `/?next=%2Ftrips%2F23` 登录首页；未展示私人行程 | PASS |
| Public Google 登录入口 | 实际点击后到达 accounts.google.com 的 Email or phone 页面；OAuth 目标为 TripSync Supabase，返回为最终 Public 精确 `/auth/callback` | PASS（入口） |
| Admin `/generations` | 转到同部署 `/login`，显示 Admin Console / approved administrators；未展示管理数据，没有 Vercel 登录墙 | PASS |
| Studio 根页面 | 转到同部署 `/login`，显示 Chain Studio / Build and test AI prompt chains. / TripSync superadmins only.；未展示编辑器，没有 Vercel 登录墙 | PASS |

部署 URL：
- Public: https://cynthiaaajin-coms6998-designgenai-fmjegxtsr.vercel.app
- Admin: https://trypsync-admin-pqtanifhc-cynthia-coms6998-designgenai.vercel.app
- Studio: https://tripsync-chain-studio-uakxl03yh-cynthia-coms6998-designgenai.vercel.app

结论：作业要求的“原生无痕中可以访问部署入口、没有 Vercel Deployment Protection、应用本身仍需登录”已实机通过。

范围：无痕 Google 没有现成会话，登录停在账号输入页，未填写账号密码；无痕登录后的生成完整流程未执行。普通旅客账号拒绝测试仍未完成。本结果不将匿名用户与已登录普通用户混为一谈。未修改源码、部署、权限或用户数据。

工具限制：首次原生菜单控制出现超时/失效，重新绑定 Chrome 后正常完成。原生截图接口返回 Screenshot unavailable；证据为实时读取的原生窗口及页面可访问性结果，未生成或声称存在截图。
