# TripSync 交接：三应用集成与实际验证

截至 2026-11-03（America/New_York）。实现已提交、推送、部署；追加测试报告及证据文件随独立文档提交归档；下表记录经过实际验证的应用源码部署。

## A. 三个应用如何协作

Public 面向旅行者：创建 Trip、收集偏好、生成/修订版本、展示活动、活动投票及整体行程评分。Studio 面向 superadmin：编辑顺序提示链、真实测试、显式发布不可变版本。Admin 面向 superadmin：查看旅行和生成、精确链版本、运行轨迹与评分。

三者核对为同一 Supabase `gzlzlofrngnqlbcngndf`。保留既有 trip、itinerary_versions/items、proposal、活动投票、Community 与访问规则。Studio 草稿在 `studio_chains`，测试在 `studio_runs`，发布快照在 `studio_chain_versions`，活动版本在 `studio_integration_config`，实际 Public 运行在 `studio_trip_runs`，整体版本评分在 `itinerary_feedback`。

Public 生成/修复/提案 API 经 `lib/published-chain.ts` 读取活动发布版本；Public 和 Studio 使用相同 `@tripsync/chain-runtime` 1.0.1 包执行顺序 Gemini 调用。原有 `{{input}}` / `{{previous}}` 解析语义保留，共享纯解析模块供预览使用。后续请求同时保留原输入及前步输出。最终结果通过现有 itinerary/proposal schema 校验；初始生成原子落库，提案先预览再显式应用。既有行程保存真实历史发布 ID，不随草稿/新发布变动。

`studio_gateway` 同时检查旅行者 JWT、服务端随机集成凭据及具体 Trip 权限。数据库只存凭据哈希，Public 服务端持有凭据；未使用浏览器 service-role key。发布/管理/运行接口各自检查现有 superadmin 授权，未削弱 RLS。启用集成后失败明确返回错误，不静默切换提示；关闭功能标记时保留明确的 legacy 路径。仅使用原有 Gemini 服务。

## B. 实现与界面

Studio 封面缩短为标题、用途和登录；品牌符号改为居中的 SVG。桌面使用链列表、连接步骤卡片、提示 Inspector 三栏；手机使用分区/标签。包含变量插入、来源说明、提示预览、重排按钮及鼠标/键盘拖动、未保存提醒、真实运行结果和历史、Save/Test/Publish 与活动/历史版本页。Public 和 Admin 增加有权限的跨应用入口；Admin 可追踪准确发布快照和独立版本评分。

增量迁移 `sql/studio-integration.sql` 已经用户批准并应用到核对的 TripSync 项目，仅新增集成所需结构。迁移 SHA256：`576418da67689a1b34ff48e19488f3a28fff3319a44ad02c018493f6ce9e0c66`。共享包 SHA256：`3c1341db012eba92f5762e40b4f7ae9114ed75f4647078f125188cfc1f824302`。未重置数据、未修改 Chucklesome。

## C. 实际测试结果

| 场景 | 实际证据及结论 |
|---|---|
| A Studio 编辑、重排、执行、发布 | 原京都基线及追加巴黎/纽约均真实执行；追加测试发布 v3/v4，分别保存 3 步输出。按钮、鼠标拖动与键盘重排已执行，保存刷新后保留，测试后恢复正确顺序。 |
| B Public 创建、偏好、生成、评分 | Trip 21 京都基线；追加 Trip 22 巴黎与 Trip 23 纽约。均实际 UI 创建和调用 Gemini，真实活动与评分落库。 |
| C Admin 关联 | 确认 Trip → 行程版本 → 运行 → 精确发布快照 → 反馈；Admin 显示历史/活动版本及真实评分，链接到 Studio 版本。 |
| D 发布后新生成，历史不变 | 京都 v1→v2、巴黎 v2→v3、纽约 v3→v4；持久化 ID 直接核对，不以输出差异推断。纽约一次失败后重试成功，详见追加报告。 |
| E 安全、主题、响应式 | 部署匿名链 API 403、Public 生成/反馈 401，Admin 与私有版本页登录墙；隔离 PostgreSQL 实测普通角色/非所有者拒绝。Light/Dark/System、重载、桌面 1440px/手机 390px、鼠标和键盘重排实测。普通账号浏览器测试未完成；原生 Incognito 部署入口与登录墙已追加实机通过，登录后的全流程未执行。 |

自动化检查已实际执行：三项目生产构建和部署构建通过；Public lint/TypeScript、协作/行程、Phase3、Week6/7、metrics、repair、community、photos、prompt-context、revision 兼容测试通过；新增 PGlite 集成验证不可变发布、草稿隔离、双授权、所有权、执行顺序、原子失败回滚、提案归因、评分及 Admin；Studio lint、链/步骤安全 CRUD、解析等价和实际路由调用共享执行器测试通过；Admin lint、安全及响应展示测试通过。部分自动化 provider adapter 为 mock，独立真实 Gemini E2E 如上，二者未混称。

最终 Public OAuth 修正与同域 HttpOnly 返回 cookie、精确回调、外部路径拒绝/跨源拒绝另经部署 HTTP 实测；最终提交专属域名登录后保持目标行程。全部三项部署 READY，部署保护为空，应用授权保留。

证据文件：`ecosystem-two-full-tests.md`、`ecosystem-additional-db-evidence.json`、`ecosystem-additional-verify.sql`、`ecosystem-db-evidence.json`（早期京都快照）、`ecosystem-live-security.json`、`ecosystem-final-auth-security.json`、`ecosystem-deployments.json`。追加数据为 SQL Editor 可见结果转录，未伪装成直接数据库导出。

## D. 提交用部署地址

| 应用 | 已核对的提交专属 URL | 完整 Git SHA |
|---|---|---|
| Public | [https://cynthiaaajin-coms6998-designgenai-fmjegxtsr.vercel.app](https://cynthiaaajin-coms6998-designgenai-fmjegxtsr.vercel.app) | `99874b9ef08a2a74e420b7146bc722d605bd0692` |
| Admin | [https://trypsync-admin-pqtanifhc-cynthia-coms6998-designgenai.vercel.app](https://trypsync-admin-pqtanifhc-cynthia-coms6998-designgenai.vercel.app) | `81ea31b00dd63581b12f8730c9feae8b89e5042a` |
| Studio | [https://tripsync-chain-studio-uakxl03yh-cynthia-coms6998-designgenai.vercel.app](https://tripsync-chain-studio-uakxl03yh-cynthia-coms6998-designgenai.vercel.app) | `b266933f6e673e3edbb884885c1df21d0b49c790` |

精确 OAuth 回调已经用户授权追加，未引入通配符。两轮追加测试直接运行在上表最终部署。当前数据库活动发布为 v4 `63c84987-7541-443f-84e7-ec44f5776031`；发布版本与源码 Git SHA 是不同概念。

## E. 新手操作

1. 打开 Public 登录，进入 My trips → 创建旅行，填写目的地和日期。
2. 提交偏好，然后 Generate itinerary；生成后显示行程版本及使用的已发布链。
3. 在 Rate this itinerary 选择 1–5 并保存，可补充文字；每项活动的 Like/Dislike 是另一类反馈。切换行程历史查看各版本自己的评分。
4. superadmin 打开 Studio，选择 Trip Planning Assistant，点步骤编辑提示，保存；需要时用箭头或拖动重排。运行真实输入，查看各步结果；测试成功后 Publish to TripSync。仅保存草稿不会影响 Public。
5. 新旅行生成或已有旅行 AI 修订会使用当前发布链。修订先看 Before/After，再 Apply。Admin → Generations 查看同一行程、运行、链版本和评分，点版本链接可看历史提示。

## F. 完成状态及剩余风险

已完成：三应用共享执行与发布、真实归因/反馈、简洁 Studio、跨应用入口、独立部署和精确回调。上述构建、自动化及实际成功流程已执行。

测试失败：纽约第一次 v4 修订失败，原行程未改变；同输入重试一次成功。当前仅存通用错误，根因未确定，未声称已修复。后续应补充不包含敏感提示/密钥的服务端错误分类以定位此类问题。

未完成：普通测试账号浏览器拒绝测试（无可用普通会话）、原生无痕登录后的全流程。用户释放浏览器后，已完成原生 Chrome Incognito 实测：三个提交链接均无 Vercel 登录墙，Public 私人行程、Admin 与 Studio 正常要求应用登录，Public Google 登录入口正常。详见 `ecosystem-native-incognito-test.md`。追加两轮未重复所有删除 CRUD；相关隔离数据库/路由测试已运行。

不支持或未记录：token/成本统计、所有运行的详细失败根因、旅游事实实时验证；顺序提示链不是任意 DAG。输出为真实 JSON/文本及现有行程 UI，未伪装成生成图片/视频。测试评分不代表真实用户满意度。

## 改动文件清单

下面按集成基线至当前源码 HEAD 列出；包含先前 Studio UI 精修，不包含本轮单独归档的证据文件。

### Public

- `.gitignore`
- `README.md`
- `app/api/auth/destination/route.ts`
- `app/api/trips/[tripId]/feedback/route.ts`
- `app/api/trips/[tripId]/generate/route.ts`
- `app/api/trips/[tripId]/proposals/route.ts`
- `app/api/trips/[tripId]/repair/route.ts`
- `app/api/trips/[tripId]/revise/route.ts`
- `app/auth/callback/route.ts`
- `app/trips/[tripId]/page.tsx`
- `components/auth-buttons.tsx`
- `components/header.tsx`
- `components/itinerary-feedback.tsx`
- `components/itinerary-provenance.tsx`
- `docs/ecosystem-integration.md`
- `lib/gemini.ts`
- `lib/published-chain.ts`
- `package-lock.json`
- `package.json`
- `packages/chain-runtime/index.d.ts`
- `packages/chain-runtime/index.js`
- `packages/chain-runtime/package.json`
- `packages/chain-runtime/prompt.d.ts`
- `packages/chain-runtime/prompt.js`
- `scripts/verify-auth-redirects.mjs`
- `scripts/verify-generation-metrics.mjs`
- `scripts/verify-itinerary.mjs`
- `scripts/verify-phase3.mjs`
- `scripts/verify-repair.mjs`
- `scripts/verify-studio-integration.mjs`
- `sql/chain-studio.sql`
- `sql/studio-integration.sql`
- `vendor/tripsync-chain-runtime-1.0.1.tgz`

### Admin

- `app/(admin)/generations/page.tsx`
- `components/admin-shell.tsx`
- `components/sidebar.tsx`

### Studio

- `README.md`
- `app/api/publish/route.ts`
- `app/api/run/route.ts`
- `app/globals.css`
- `app/layout.tsx`
- `app/login/page.tsx`
- `app/page.tsx`
- `app/versions/[id]/page.tsx`
- `components/prompt-inspector.tsx`
- `components/run-card.tsx`
- `components/sortable-flow.tsx`
- `components/studio.tsx`
- `docs/deployments-verified.json`
- `docs/ui-refinement-verification.md`
- `lib/itinerary.ts`
- `lib/prompt-workflow.ts`
- `lib/types.ts`
- `package-lock.json`
- `package.json`
- `scripts/verify-routes.mjs`
- `scripts/verify-workflow.mjs`
- `sql/studio-integration.sql`
- `vendor/tripsync-chain-runtime-1.0.1.tgz`
