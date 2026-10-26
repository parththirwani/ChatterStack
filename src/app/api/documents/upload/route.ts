import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { auth } from '@/src/lib/auth';
import { MAX_FILE_SIZE, validStorageKey } from '@/src/lib/server/documents';
import { fileMimeType } from '@/src/lib/api/chat/attachments';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const response = await handleUpload({
      request,
      body: await request.json() as HandleUploadBody,
      onBeforeGenerateToken: async (pathname) => {
        if (!validStorageKey(session.user!.id!, pathname)) throw new Error('Invalid storage path');
        const name = pathname.split('/').at(-1)!;
        const mimeType = fileMimeType(name);
        if (!mimeType) throw new Error('Unsupported file type');
        return { allowedContentTypes: [mimeType], maximumSizeInBytes: MAX_FILE_SIZE, addRandomSuffix: false, validUntil: Date.now() + 5 * 60 * 1000 };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(response);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Upload failed' }, { status: 400 });
  }
}
