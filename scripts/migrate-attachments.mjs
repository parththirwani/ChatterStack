/**
 * One-time, resumable migration of legacy base64 message attachments.
 * Run after `npx prisma db push` with DATABASE_URL and private Blob credentials set.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { del, put } from '@vercel/blob';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
let migrated = 0;

try {
  let cursor;
  while (true) {
    const messages = await prisma.message.findMany({
      where: { role: 'user' },
      include: { conversation: { select: { userId: true } } },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!messages.length) break;
    for (const message of messages) {
      if (!Array.isArray(message.attachments)) continue;
      const references = [];
      for (const file of message.attachments) {
        if (!file || typeof file !== 'object') continue;
        if (!file.data) { references.push(file); continue; }
        const { name, mimeType, size, data } = file;
        const bytes = Buffer.from(data, 'base64');
        if (bytes.length !== size || bytes.length < 1 || bytes.length > 5 * 1024 * 1024) {
          throw new Error(`Invalid legacy attachment in message ${message.id}`);
        }
        const userId = message.conversation.userId;
        const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
        let document = await prisma.document.findUnique({ where: { userId_sha256: { userId, sha256 } } });
        if (!document) {
          const storageKey = `users/${userId}/${crypto.randomUUID()}/${name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 180)}`;
          await put(storageKey, bytes, { access: 'private', contentType: mimeType });
          try {
            document = await prisma.document.create({
              data: { userId, name, mimeType, size, sha256, storageKey, lastUsedAt: new Date(), createdAt: message.createdAt },
            });
          } catch (error) {
            await del(storageKey);
            if (error.code !== 'P2002') throw error;
            document = await prisma.document.findUniqueOrThrow({ where: { userId_sha256: { userId, sha256 } } });
          }
        }
        references.push({ documentId: document.id, name: document.name, mimeType: document.mimeType, size: document.size });
      }
      await prisma.message.update({ where: { id: message.id }, data: { attachments: references } });
      migrated += 1;
    }
    cursor = messages.at(-1).id;
  }
  console.log(`Migrated ${migrated} messages`);
} finally {
  await prisma.$disconnect();
  await pool.end();
}
