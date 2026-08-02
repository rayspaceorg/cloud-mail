# 使用 GitHub Actions 部署到 Cloudflare

本仓库的工作流会在 `main` 分支中的 `mail-worker/**` 或 `mail-vue/**` 发生变化时自动部署，也可以在 GitHub 的 **Actions → Deploy cloud-mail to Cloudflare → Run workflow** 手动触发。

## 工作流会自动完成什么

每次部署会依次完成：

1. 安装 Worker 和 Vue 前端依赖。
2. 构建前端到 `mail-worker/dist`。
3. 检查并按需创建 D1 数据库 `<WORKER_NAME>-db`。
4. 检查并按需创建 KV 命名空间 `<WORKER_NAME>-kv`。
5. 在启用 R2 时检查并按需创建 `<WORKER_NAME>-attachments`。
6. 生成临时 Wrangler 配置，不把 Cloudflare 资源 ID 或 JWT 密钥提交到 Git。
7. 部署 Worker 和静态资源。
8. 通过 `/api/init/<JWT_SECRET>` 自动初始化或升级数据库。

资源检查采用“存在就复用，不存在才创建”的方式，因此可以安全地重复运行。

## GitHub Secrets

在仓库 **Settings → Secrets and variables → Actions → Secrets** 中配置：

| 名称 | 必需 | 说明 |
| --- | :---: | --- |
| `JWT_SECRET` | 是 | 至少 32 位，仅包含字母、数字、`_`、`-` 的随机字符串 |
| `CLOUDFLARE_API_TOKEN` | 二选一 | 推荐的 Cloudflare API Token |
| `CLOUDFLARE_API_KEY` | 二选一 | Cloudflare Global API Key；使用它时还必须设置变量 `CLOUDFLARE_EMAIL` |
| `LINUXDO_CLIENT_SECRET` | 否 | 仅在启用 LinuxDo OAuth 时需要 |

推荐生成 JWT：

```bash
openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-48
```

推荐使用 API Token 而不是 Global API Key。Token 至少需要目标账户的 Workers Scripts、KV、D1 权限，以及目标 Zone 的 Workers Routes 和 Zone Read 权限。启用 R2 时还需要 R2 Edit 权限。

## GitHub Variables

在仓库 **Settings → Secrets and variables → Actions → Variables** 中配置：

| 名称 | 必需 | 示例 | 说明 |
| --- | :---: | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 是 | `012345...` | Cloudflare 账户 ID |
| `CLOUDFLARE_EMAIL` | 使用 Global Key 时 | `name@example.com` | Cloudflare 登录邮箱 |
| `WORKER_NAME` | 否 | `cloud-mail` | 默认 `cloud-mail` |
| `DOMAIN` | 是 | `["example.com"]` | 可收信域名 JSON 数组，也支持逗号分隔 |
| `CUSTOM_DOMAIN` | 否 | `example.com` | Web 管理后台域名；留空则仅使用 workers.dev |
| `ZONE_NAME` | 使用自定义域名时 | `example.com` | `CUSTOM_DOMAIN` 所属的 Cloudflare Zone |
| `ADMIN` | 是 | `admin@example.com` | 初始管理员邮箱，域名必须包含在 `DOMAIN` 中 |
| `R2_ENABLED` | 否 | `false` | 是否绑定 R2；未启用时附件回退到 KV |
| `R2_BUCKET_NAME` | 否 | `cloud-mail-attachments` | 留空则根据 Worker 名自动生成 |
| `CF_EMAIL_ENABLED` | 否 | `false` | 是否添加 Cloudflare Email Sending binding |
| `AI_MODEL` | 否 | `@cf/meta/llama-3.1-8b-instruct` | Workers AI 模型 |
| `ANALYSIS_CACHE` | 否 | `false` | 是否启用分析缓存 |
| `PROJECT_LINK` | 否 | `false` | 是否显示项目链接 |

LinuxDo OAuth 的可选变量为 `LINUXDO_SWITCH`、`LINUXDO_CLIENT_ID`、`LINUXDO_CALLBACK_URL`。

## Cloudflare 邮件路由

部署成功只代表 Web 和 Worker API 已上线。收信还需要在 Cloudflare 为每个收信 Zone 启用 Email Routing，并把规则指向部署后的 Worker：

1. 打开 Cloudflare **Email → Email Routing → Routing rules**。
2. 启用 Email Routing，确认 MX 和 SPF 状态正常。
3. 将 Catch-all 规则的 Action 改为 **Send to a Worker**。
4. 选择 `cloud-mail` Worker 并启用规则。

规则启用后，发送到 `DOMAIN` 中任意地址的邮件才会进入 Cloud Mail。

## 首次部署

配置完 Secrets 和 Variables 后：

1. 打开仓库的 **Actions** 页面。
2. 选择 **Deploy cloud-mail to Cloudflare**。
3. 点击 **Run workflow**。
4. 等待 `Build and deploy` 全部变绿。
5. 打开 `https://CUSTOM_DOMAIN`，使用 `ADMIN` 邮箱登录。

工作流会自动调用初始化接口，不需要手工访问带 JWT 的 URL。

## 常见失败

- `Invalid access token`：把 Global API Key 错配到了 `CLOUDFLARE_API_TOKEN`。应改用 `CLOUDFLARE_API_KEY` 并同时设置 `CLOUDFLARE_EMAIL`。
- `JWT_SECRET must contain...`：重新生成至少 32 位的 URL 安全字符串。
- `Please enable R2`：先在 Cloudflare 开通 R2，或者把 `R2_ENABLED` 设为 `false`。
- `route ... already exists`：检查目标域名是否已经绑定到另一个 Worker。
- Web 可访问但收不到邮件：检查 Email Routing 的 Catch-all 是否指向当前 Worker，而不是转发邮箱。
- 初始化失败：在 Action 日志中查看 `Initialize database` 的 HTTP 状态，并确认自定义域名已经代理到 Worker。
