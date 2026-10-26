import { del, get, head, list, put } from '@vercel/blob';

/** File bytes live only in a private Vercel Blob store. */
export const documentStorage = {
  async save(pathname: string, bytes: Buffer, contentType: string) {
    return put(pathname, bytes, { access: 'private', contentType, addRandomSuffix: false });
  },
  async stat(pathname: string) {
    return head(pathname);
  },
  async read(pathname: string): Promise<Buffer | null> {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  },
  async stream(pathname: string) {
    return get(pathname, { access: 'private', useCache: false });
  },
  async delete(pathname: string) {
    await del(pathname);
  },
  async list(cursor?: string) {
    return list({ prefix: 'users/', cursor, limit: 1000 });
  },
};
