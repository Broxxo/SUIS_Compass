import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import coursesRoutes from './routes/courses.js';
import semesterRoutes from './routes/semester.js';
import settingsRoutes from './routes/settings.js';
import curriculumRoutes from './routes/curriculum.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import classesRoutes from './routes/classes.js';
import classAssistantRoutes from './routes/classAssistant.js';
import openLessonRoutes from './routes/openLessons.js';
import schoolCalendarRoutes from './routes/schoolCalendar.js';
import mailboxRoutes from './routes/mailbox.js';
import { requireValidUser } from './middleware/requireUser.js';
import { forbidStudentAccounts } from './middleware/forbidStudent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const PORT = parseInt(process.env.PORT || '8080', 10);

const app = express();

app.use(cors());
app.use('/api/curriculum', express.json({ limit: '50mb' }));
app.use(express.json({ limit: '2mb' }));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/courses', requireValidUser, forbidStudentAccounts, coursesRoutes);
app.use('/api/semester', requireValidUser, forbidStudentAccounts, semesterRoutes);
app.use('/api/settings', requireValidUser, forbidStudentAccounts, settingsRoutes);
app.use('/api/curriculum', requireValidUser, forbidStudentAccounts, curriculumRoutes);
app.use('/api/ai', requireValidUser, forbidStudentAccounts, aiRoutes);
app.use('/api/admin', requireValidUser, forbidStudentAccounts, adminRoutes);
app.use('/api/classes/assistant', requireValidUser, forbidStudentAccounts, classAssistantRoutes);
app.use('/api/open-lessons', requireValidUser, forbidStudentAccounts, openLessonRoutes);
app.use('/api/school-calendar', requireValidUser, forbidStudentAccounts, schoolCalendarRoutes);
app.use('/api/mailbox', requireValidUser, forbidStudentAccounts, mailboxRoutes);
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
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
