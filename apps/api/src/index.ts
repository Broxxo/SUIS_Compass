import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import coursesRoutes from './routes/courses.js';
import semesterRoutes from './routes/semester.js';
import settingsRoutes from './routes/settings.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import classesRoutes from './routes/classes.js';
import classAssistantRoutes from './routes/classAssistant.js';
import { requireValidUser } from './middleware/requireUser.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/courses', requireValidUser, coursesRoutes);
app.use('/api/semester', requireValidUser, semesterRoutes);
app.use('/api/settings', requireValidUser, settingsRoutes);
app.use('/api/ai', requireValidUser, aiRoutes);
app.use('/api/admin', requireValidUser, adminRoutes);
app.use('/api/classes/assistant', requireValidUser, classAssistantRoutes);
app.use('/api/classes', requireValidUser, classesRoutes);

app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'curriculum-roadmap-api' });
});

// 托管前端静态资源（生产构建时 web 的 dist 会拷贝到 api/public）
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) next();
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
