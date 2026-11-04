# 两轮追加的部署端完整测试

测试日期：2026-11-03（America/New_York）。使用已有授权 superadmin 会话，同时作为旅行创建者；没有普通旅客账号的实机覆盖。全部行程、生成、修订和评分通过部署端 UI 完成，真实调用已配置 Gemini；没有手动插入生成结果或评分。

## 实际结果

| 环节 | 巴黎 Round 2（Trip 22） | 纽约 Round 3（Trip 23） |
|---|---|---|
| 创建行程、保存偏好 | 11/14–15，两天，EUR 80/人/日，素食、不进博物馆 | 11/20，一天，USD 60/人/日，免费景点、无酒精主题、20:00 前结束 |
| 首次生成 | 发布链 v2，3 步真实输出，6 项活动 | 发布链 v3，3 步真实输出，4 项活动 |
| 首版 UI 评分 | 5/5 | 4/5 |
| Studio 编辑/保存/重排 | 按钮重排后保存、刷新核对、恢复原顺序 | 键盘拖动后保存、刷新核对、恢复原顺序 |
| 真实测试和发布 | 草稿 revision 8 → 测试成功 → 发布 v3 | 草稿 revision 11 → 测试成功 → 发布 v4 |
| Public 预览、应用新版 | v3 修订成功，6 项活动 | 首次 v4 修订失败；同输入重试一次后成功，4 项活动 |
| 新版 UI 评分 | 4/5，未继承旧评分 | 5/5，未继承旧评分 |
| Admin 和数据库核对 | 成功，准确关联两版链、运行、行程及评分 | 成功，同时保留失败运行记录 |
| 判定 | PASS | 完成，但存在一次未解释的运行失败；不能视为全绿 |

两组都验证了：编辑草稿不会改变已发布链；发布后新生成准确引用新链版本；旧行程仍引用历史版本；切换历史版本后对应评分独立。四次 Public 成功运行各保存 3 个真实步骤输出，最终响应与最后一步输出完全一致。两次 Studio 测试另保存 6 个真实步骤输出。数据库中每个测试 Trip 恰有 2 个行程版本。

## 失败与恢复

纽约第一次 v4 修订运行 `56503df9-1fc2-4c90-adae-a75f0056f7a8` 失败，记录耗时 28,948 ms、0 个已保存步骤、没有 proposal、没有新 itinerary version，原行程未受影响。数据库仅记录通用错误 `AI generation or validation failed.`。查询可用 Vercel runtime logs 未取得详细原因，因此不能判断根因或声称已修复。一次同输入、同发布版本的重试成功：`505c5fc6-0170-4616-94b4-07da547645cc`。失败记录完整保留。

## 浏览器可复查入口

- [巴黎行程](https://cynthiaaajin-coms6998-designgenai-fmjegxtsr.vercel.app/trips/22)：切换 Version 1/2，链发布版本分别 v2/v3，评分分别 5/4。
- [纽约行程](https://cynthiaaajin-coms6998-designgenai-fmjegxtsr.vercel.app/trips/23)：Version 1/2，链发布版本分别 v3/v4，评分分别 4/5。
- [Admin Generations](https://trypsync-admin-pqtanifhc-cynthia-coms6998-designgenai.vercel.app/generations)：查看对应运行、准确版本链接、反馈及保留的失败记录。
- [Studio](https://tripsync-chain-studio-uakxl03yh-cynthia-coms6998-designgenai.vercel.app)：Trip Planning Assistant 当前活动发布 v4。

需要应用登录；Admin 与 Studio 仍要求 superadmin。

## 持久化证据

`ecosystem-additional-db-evidence.json` 是 Supabase SQL Editor 可见只读结果的转录，包含实际运行、发布版本、proposal、itinerary version、模型、步骤耗时、反馈、Studio 测试 ID。复查查询：`ecosystem-additional-verify.sql`。本地一致性断言已实际执行：4 次成功 + 1 次失败、成功均 3 步且最终响应一致、活动数量、失败无新行程/提案、4 个独立评分、两次 Studio 测试各 3 步。

这些评分是明确标记的 E2E 测试反馈，不代表真实满意度调查。行程地点、价格、营业时间未独立核实；模型输出不是旅游事实核查。未持久化 token 数/费用，因此不报告估算。

## 范围和限制

本次是两组跨三应用的 A–D 完整业务流程复测，不是再次执行所有破坏性 CRUD 操作。已有自动化安全/CRUD、构建和主题测试另见 handoff。额外核对了纽约手机 390px 页面无横向溢出。普通旅客账号实机拒绝测试、Chrome 原生无痕完整流程，按用户决定仍标为未完成；匿名 HTTP 与部署保护检查不能替代这两项。

本次未修改应用源代码、未重新部署。发布 v3/v4 是实际保存的数据库链版本。当前 active publication：`63c84987-7541-443f-84e7-ec44f5776031`。


后续更新：原生 Chrome 无痕的三部署入口、私人行程及 Admin/Studio 登录墙已实机通过；Google 登录入口到达账号页。登录后的无痕全流程与普通账号拒绝测试仍未执行。详见 `ecosystem-native-incognito-test.md`。
