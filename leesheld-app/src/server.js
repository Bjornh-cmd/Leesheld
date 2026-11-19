const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
const { z } = require('zod');
const path = require('node:path');

const app = express();
const prisma = new PrismaClient();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET moet minimaal 32 tekens lang zijn.');
  process.exit(1);
}
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"],
    formAction: ["'self'"], frameAncestors: ["'none'"]
  } }, crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  name: 'leesheld.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 14 }
}));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Ongeldige aanvraagbron.' });
      } catch { return res.status(403).json({ error: 'Ongeldige aanvraagbron.' }); }
    }
  }
  next();
});

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicUser = u => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role, parentId: u.parentId });
function requireAuth(req, res, next) { if (!req.session.userId) return res.status(401).json({ error: 'Log eerst in.' }); next(); }
function requireRole(role) { return (req, res, next) => { if (req.session.role !== role) return res.status(403).json({ error: 'Je hebt geen toegang tot deze functie.' }); next(); }; }
async function getUser(req) { return prisma.user.findUnique({ where: { id: req.session.userId } }); }
function lessonVisibleWhere(user) {
  if (user.role === 'PARENT') return { OR: [{ global: true }, { ownerId: user.id }] };
  return { OR: [{ global: true }, { ownerId: user.parentId, assignedToId: null }, { ownerId: user.parentId, assignedToId: user.id }] };
}
function cleanLesson(l) {
  // Never send answer keys or explanations to the browser before submission.
  const questions = (Array.isArray(l.questions) ? l.questions : []).map(q => ({ prompt: q.prompt, options: q.options, skill: q.skill || 'Informatie vinden' }));
  return { id: l.id, title: l.title, topic: l.topic, level: l.level, icon: l.icon, minutes: l.minutes, text: l.text, questions, createdAt: l.createdAt };
}

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'leesheld' }));
app.get('/api/me', asyncRoute(async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = await getUser(req);
  if (!user) { req.session.destroy(() => {}); return res.json({ user: null }); }
  res.json({ user: publicUser(user) });
}));

const parentRegister = z.object({ displayName: z.string().trim().min(2).max(50), username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_.-]+$/), email: z.string().trim().email().max(120).optional().or(z.literal('')), password: z.string().min(10).max(100) });
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const parsed = parentRegister.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Controleer je naam, gebruikersnaam, e-mailadres en wachtwoord (minimaal 10 tekens).' });
  const d = parsed.data;
  const username = d.username.toLowerCase();
  const email = d.email ? d.email.toLowerCase() : null;
  const exists = await prisma.user.findFirst({ where: { OR: [{ username }, ...(email ? [{ email }] : [])] } });
  if (exists) return res.status(409).json({ error: 'Deze gebruikersnaam of dit e-mailadres is al in gebruik.' });
  const user = await prisma.user.create({ data: { username, email, displayName: d.displayName, passwordHash: await bcrypt.hash(d.password, 12), role: 'PARENT' } });
  req.session.regenerate(err => { if (err) return res.status(500).json({ error: 'Sessie kon niet worden gestart.' }); req.session.userId = user.id; req.session.role = user.role; res.json({ user: publicUser(user) }); });
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const identity = String(req.body.identity || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!identity || !password || identity.length > 120 || password.length > 100) return res.status(400).json({ error: 'Vul je gebruikersnaam en wachtwoord in.' });
  const user = await prisma.user.findFirst({ where: { OR: [{ username: identity }, { email: identity }] } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Gebruikersnaam of wachtwoord klopt niet.' });
  req.session.regenerate(err => { if (err) return res.status(500).json({ error: 'Sessie kon niet worden gestart.' }); req.session.userId = user.id; req.session.role = user.role; res.json({ user: publicUser(user) }); });
}));
app.post('/api/auth/logout', requireAuth, (req, res) => req.session.destroy(err => { res.clearCookie('leesheld.sid', { httpOnly: true, sameSite: 'lax', secure: isProd }); if (err) return res.status(500).json({ error: 'Uitloggen is niet gelukt.' }); res.json({ ok: true }); }));

app.get('/api/lessons', requireAuth, asyncRoute(async (req, res) => {
  const user = await getUser(req);
  const lessons = await prisma.lesson.findMany({ where: { published: true, ...lessonVisibleWhere(user) }, orderBy: [{ global: 'desc' }, { createdAt: 'desc' }] });
  res.json({ lessons: lessons.map(cleanLesson) });
}));

const questionSchema = z.object({ prompt: z.string().trim().min(5).max(500), options: z.array(z.string().trim().min(1).max(300)).min(3).max(4), correctIndex: z.number().int().min(0).max(3), explanation: z.string().trim().min(3).max(1000), skill: z.string().trim().max(80).optional() }).refine(q => q.correctIndex < q.options.length, { message: 'Juiste antwoord valt buiten de antwoordopties.' });
const lessonSchema = z.object({ assignedChildId: z.string().optional().nullable(), title: z.string().trim().min(3).max(100), topic: z.string().trim().min(2).max(60), level: z.enum(['Makkelijk', 'Gemiddeld', 'Moeilijk']), icon: z.string().max(8).optional(), minutes: z.number().int().min(1).max(60).optional(), text: z.string().trim().min(100).max(15000), questions: z.array(questionSchema).min(3).max(20) });
app.post('/api/lessons', requireAuth, requireRole('PARENT'), asyncRoute(async (req, res) => {
  const parsed = lessonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Controleer de tekst en vragen. Gebruik minimaal 100 tekens tekst en minimaal 3 vragen.' });
  const d = parsed.data;
  if (d.assignedChildId) {
    const child = await prisma.user.findFirst({ where: { id: d.assignedChildId, parentId: req.session.userId, role: 'CHILD' }, select: { id: true } });
    if (!child) return res.status(400).json({ error: 'Dit kindaccount hoort niet bij jouw ouderaccount.' });
  }
  const { assignedChildId, ...lessonData } = d;
  const lesson = await prisma.lesson.create({ data: { ...lessonData, icon: d.icon || '📘', minutes: d.minutes || 6, ownerId: req.session.userId, assignedToId: assignedChildId || null, global: false, published: true } });
  res.status(201).json({ lesson: cleanLesson(lesson) });
}));
app.delete('/api/lessons/:id', requireAuth, requireRole('PARENT'), asyncRoute(async (req, res) => {
  const result = await prisma.lesson.deleteMany({ where: { id: req.params.id, ownerId: req.session.userId } });
  if (!result.count) return res.status(404).json({ error: 'Deze eigen tekst is niet gevonden.' });
  res.json({ ok: true });
}));

const childSchema = z.object({ displayName: z.string().trim().min(2).max(50), username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_.-]+$/), password: z.string().min(8).max(100) });
app.post('/api/children', requireAuth, requireRole('PARENT'), asyncRoute(async (req, res) => {
  const parsed = childSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Controleer de gegevens. Gebruikersnaam: 3-24 tekens, wachtwoord: minimaal 8 tekens.' });
  const d = parsed.data;
  const username = d.username.toLowerCase();
  if (await prisma.user.findUnique({ where: { username } })) return res.status(409).json({ error: 'Deze gebruikersnaam bestaat al.' });
  const child = await prisma.user.create({ data: { displayName: d.displayName, username, passwordHash: await bcrypt.hash(d.password, 12), role: 'CHILD', parentId: req.session.userId } });
  res.status(201).json({ child: publicUser(child), credentials: { username, password: d.password } });
}));
app.get('/api/children', requireAuth, requireRole('PARENT'), asyncRoute(async (req, res) => {
  const children = await prisma.user.findMany({ where: { parentId: req.session.userId, role: 'CHILD' }, orderBy: { createdAt: 'asc' }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 100 } } });
  res.json({ children: children.map(c => ({ ...publicUser(c), attempts: c.attempts.length, average: c.attempts.length ? Math.round(c.attempts.reduce((s, a) => s + a.score, 0) / c.attempts.length) : null, lastScore: c.attempts[0]?.score ?? null })) });
}));
app.post('/api/children/:id/password', requireAuth, requireRole('PARENT'), asyncRoute(async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8 || password.length > 100) return res.status(400).json({ error: 'Gebruik minimaal 8 tekens.' });
  const result = await prisma.user.updateMany({ where: { id: req.params.id, parentId: req.session.userId, role: 'CHILD' }, data: { passwordHash: await bcrypt.hash(password, 12) } });
  if (!result.count) return res.status(404).json({ error: 'Kindaccount niet gevonden.' });
  res.json({ ok: true });
}));
app.get('/api/children/:id/progress', requireAuth, requireRole('PARENT'), asyncRoute(async (req, res) => {
  const child = await prisma.user.findFirst({ where: { id: req.params.id, parentId: req.session.userId, role: 'CHILD' }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 100 } } });
  if (!child) return res.status(404).json({ error: 'Kindaccount niet gevonden.' });
  res.json({ child: publicUser(child), attempts: child.attempts.map(a => ({ id: a.id, title: a.topic, score: a.score, correct: a.correct, total: a.total, level: a.level, topic: a.topic, createdAt: a.createdAt })) });
}));

async function progressFor(userId) {
  const attempts = await prisma.attempt.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  const totalXp = attempts.reduce((s, a) => s + 10 + a.correct * 10, 0);
  const average = attempts.length ? Math.round(attempts.reduce((s, a) => s + a.score, 0) / attempts.length) : null;
  const best = attempts.length ? Math.max(...attempts.map(a => a.score)) : null;
  const skillMap = {};
  for (const a of attempts) for (const q of (Array.isArray(a.answers) ? a.answers : [])) {
    if (!q.skill) continue;
    skillMap[q.skill] ||= { total: 0, correct: 0 };
    skillMap[q.skill].total++;
    if (q.isCorrect) skillMap[q.skill].correct++;
  }
  const skills = Object.entries(skillMap).map(([name, v]) => ({ name, accuracy: Math.round(v.correct / v.total * 100), total: v.total })).sort((a, b) => a.accuracy - b.accuracy);
  return { count: attempts.length, xp: totalXp, average, best, skills, history: attempts.slice(0, 20).map(a => ({ id: a.id, lessonId: a.lessonId, title: a.topic, score: a.score, correct: a.correct, total: a.total, level: a.level, date: a.createdAt })) };
}
app.get('/api/progress', requireAuth, requireRole('CHILD'), asyncRoute(async (req, res) => res.json(await progressFor(req.session.userId))));

app.get('/api/adaptive/next', requireAuth, requireRole('CHILD'), asyncRoute(async (req, res) => {
  const user = await getUser(req);
  const p = await progressFor(user.id);
  let targetLevel = 'Gemiddeld';
  let reason = 'Dit is je startmeting. We beginnen met een oefening op gemiddeld niveau.';
  if (p.count >= 2) {
    if (p.average >= 82) { targetLevel = 'Moeilijk'; reason = 'Je resultaten zijn sterk. We maken de uitdaging iets groter.'; }
    else if (p.average < 55) { targetLevel = 'Makkelijk'; reason = 'We oefenen eerst de basisvaardigheden en bouwen daarna verder.'; }
    else { targetLevel = 'Gemiddeld'; reason = 'Je bent goed op weg. We blijven oefenen op dit niveau.'; }
  }
  const lessons = await prisma.lesson.findMany({ where: { published: true, ...lessonVisibleWhere(user) }, include: { attempts: { where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 2 } } });
  if (!lessons.length) return res.status(404).json({ error: 'Er zijn nog geen oefeningen beschikbaar.' });
  const weak = p.skills[0]?.name;
  const eligible = lessons.filter(l => l.level === targetLevel && !l.attempts.length);
  let poolLessons = eligible.length ? eligible : lessons.filter(l => l.level === targetLevel);
  if (!poolLessons.length) poolLessons = lessons;
  if (weak) {
    const skillMatches = poolLessons.filter(l => Array.isArray(l.questions) && l.questions.some(q => q.skill === weak));
    if (skillMatches.length) poolLessons = skillMatches;
  }
  poolLessons.sort((a, b) => a.attempts.length - b.attempts.length);
  const lesson = poolLessons[Math.floor(Math.random() * Math.min(poolLessons.length, 4))];
  res.json({ lesson: cleanLesson(lesson), targetLevel, reason, xp: p.xp, streakHint: p.count });
}));
app.post('/api/attempts', requireAuth, requireRole('CHILD'), asyncRoute(async (req, res) => {
  const id = String(req.body.lessonId || '');
  const answerIndexes = req.body.answers;
  if (!Array.isArray(answerIndexes) || answerIndexes.length > 20 || answerIndexes.some(x => !Number.isInteger(x) || x < -1 || x > 3)) return res.status(400).json({ error: 'Ongeldige antwoorden.' });
  const user = await getUser(req);
  const lesson = await prisma.lesson.findFirst({ where: { id, published: true, ...lessonVisibleWhere(user) } });
  if (!lesson) return res.status(404).json({ error: 'Oefening niet gevonden.' });
  const questions = Array.isArray(lesson.questions) ? lesson.questions : [];
  if (answerIndexes.length !== questions.length) return res.status(400).json({ error: 'Niet alle vragen zijn ingevuld.' });
  let correct = 0;
  const answerDetails = questions.map((q, i) => {
    const isCorrect = answerIndexes[i] === q.correctIndex;
    if (isCorrect) correct++;
    return { skill: q.skill || 'Informatie vinden', selectedIndex: answerIndexes[i], correctIndex: q.correctIndex, isCorrect };
  });
  const score = Math.round(correct / questions.length * 100);
  const attempt = await prisma.attempt.create({ data: { userId: user.id, lessonId: lesson.id, score, correct, total: questions.length, level: lesson.level, topic: lesson.title, answers: answerDetails } });
  res.status(201).json({ attempt: { score, correct, total: questions.length, xpEarned: 10 + correct * 10, id: attempt.id, review: questions.map((q, i) => ({ isCorrect: answerIndexes[i] === q.correctIndex, explanation: q.explanation, correctAnswer: q.options[q.correctIndex] })) } });
}));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Er ging iets mis op de server. Probeer het opnieuw.' });
});

const server = app.listen(PORT, '0.0.0.0', () => console.log(`Leesheld draait op poort ${PORT}`));
async function shutdown() { server.close(); await prisma.$disconnect(); await pool.end(); process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
