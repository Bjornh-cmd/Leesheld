const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs');
const path = require('node:path');
const prisma = new PrismaClient();

async function main() {
  const lessons = JSON.parse(fs.readFileSync(path.join(__dirname, '../prisma/seed-lessons.json'), 'utf8'));
  for (const item of lessons) {
    const questions = item.questions.map((q) => ({
      prompt: q[0], options: q[1], correctIndex: q[2], explanation: q[3],
      skill: inferSkill(q[0], q[3])
    }));
    await prisma.lesson.upsert({
      where: { id: `seed-${item.id}` },
      update: { title: item.title, topic: item.topic, level: item.level, icon: item.icon || '📘', minutes: item.mins || 6, text: item.story, questions, published: true, global: true },
      create: { id: `seed-${item.id}`, title: item.title, topic: item.topic, level: item.level, icon: item.icon || '📘', minutes: item.mins || 6, text: item.story, questions, published: true, global: true }
    });
  }
  console.log(`Seeded ${lessons.length} reading lessons.`);
}
function inferSkill(q, explanation) {
  const s = `${q} ${explanation}`.toLowerCase();
  if (/hoofdgedachte|belangrijkste boodschap/.test(s)) return 'Hoofdgedachte';
  if (/betekent|woord|verwijst/.test(s)) return 'Woordenschat & verwijswoorden';
  if (/conclusie|afleid|waarom|bedoelt/.test(s)) return 'Conclusies trekken';
  if (/tekstsoort|doel|schrijver/.test(s)) return 'Tekstdoel & tekstsoort';
  return 'Informatie vinden';
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
