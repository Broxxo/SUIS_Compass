# Zeabur 云端部署步骤

## 当前状态

✅ 数据库已创建并初始化（4个表：users, courses, semester_data, user_settings）  
✅ 后端代码已准备就绪  
✅ 前端代码已准备就绪

---

## 第一步：部署后端服务器

### 1.1 创建后端服务

1. 登录 [Zeabur 控制台](https://dash.zeabur.com)
2. 点击 **"新建服务"** 或 **"New Service"**
3. 选择 **"从 Git 仓库部署"**
4. 连接你的 Git 仓库（GitHub/GitLab/Bitbucket）
   - 如果代码还没推送，先在本地执行：
     ```bash
     git init
     git add .
     git commit -m "Initial commit"
     git remote add origin <你的仓库地址>
     git push -u origin main
     ```
5. 选择项目根目录（包含 `server/` 文件夹的目录）

### 1.2 配置构建设置

在服务设置中找到 **"构建设置"** 或 **"Build Settings"**：

- **构建命令**：`cd server && npm install && npm run build`
- **启动命令**：`cd server && npm start`
- **工作目录**：`server`
- **Node 版本**：选择 20.x

### 1.3 配置环境变量

在服务设置中找到 **"环境变量"**，添加以下变量：

| 变量名 | 值 |
|--------|-----|
| `DATABASE_URL` | `postgresql://root:S1Y25iQTBX8nI7N9dzK3lOGe40btJk6L@sha1.clusters.zeabur.com:32675/zeabur` |
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | 生成随机字符串（可使用命令：`openssl rand -hex 32`） |

**注意**：`DATABASE_URL` 使用你从数据库服务获取的连接字符串。

### 1.4 部署并验证

1. 点击 **"部署"** 或 **"Deploy"**
2. 等待部署完成（约 2-5 分钟）
3. 部署成功后，Zeabur 会提供服务 URL（如 `https://your-service.zeabur.app`）
4. 访问 `https://your-service.zeabur.app/health`
   - 如果返回 `{"status":"ok","timestamp":"..."}`，说明部署成功

---

## 第二步：配置前端连接云端

### 2.1 更新环境变量

在项目根目录编辑 `.env.local` 文件：

```env
VITE_USE_CLOUD_STORAGE=true
VITE_API_URL=https://your-backend-service.zeabur.app/api
```

**注意**：将 `your-backend-service.zeabur.app` 替换为第一步中获取的实际后端服务地址。

### 2.2 重新构建前端

```bash
npm run build
```

### 2.3 部署前端

将构建后的 `dist/` 文件夹部署到你的静态托管服务（Zeabur 或其他平台）。

---

## 第三步：测试

### 3.1 测试登录

1. 打开前端应用
2. 使用预设账号登录：
   - 用户名：`Admin`，密码：`4321`
   - 或 用户名：`HF-Admin`，密码：`1234`
   - 或 用户名：`WX-Admin`，密码：`1234`

### 3.2 测试数据同步

1. 创建一个新课程
2. 刷新页面，课程应该还在
3. 在另一个设备/浏览器登录同一账号，应该能看到相同的数据

---

## 故障排除

### 后端服务无法连接数据库

- 检查 `DATABASE_URL` 环境变量是否正确
- 确认数据库服务正在运行
- 检查网络设置，确保后端服务可以访问数据库

### 前端无法连接后端

- 检查 `VITE_API_URL` 是否正确
- 确认后端服务已成功部署
- 检查浏览器控制台是否有 CORS 错误

### 登录失败

- 确认数据库中的 `users` 表已正确初始化
- 检查后端服务的日志输出
- 确认用户名和密码正确

---

## 完成

部署完成后，你将拥有：
- ✅ 云端 PostgreSQL 数据库
- ✅ 运行在 Zeabur 的后端 API 服务
- ✅ 支持跨设备数据同步的前端应用
